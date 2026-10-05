const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

/**
 * Bounded LRU Cache for Waveforms (Max 50 entries, Max 5MB total memory)
 */
const MAX_CACHE_SIZE = 50;
const MAX_CACHE_BYTES = 5 * 1024 * 1024; // 5 MB
const waveformCache = new Map();
let currentCacheBytes = 0;

function setCache(key, value) {
  const valueBytes = value.byteLength || (value.length * 4);

  // Reject caching single items larger than maximum cache capacity
  if (valueBytes > MAX_CACHE_BYTES) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[waveform-service] Waveform size (${(valueBytes / 1024 / 1024).toFixed(2)} MB) exceeds maximum cache capacity (${(MAX_CACHE_BYTES / 1024 / 1024).toFixed(2)} MB). Skipping cache.`);
    }
    return;
  }

  if (waveformCache.has(key)) {
    const oldVal = waveformCache.get(key);
    currentCacheBytes -= (oldVal.byteLength || (oldVal.length * 4));
    waveformCache.delete(key);
  }

  // Evict until under byte limit and count limit
  while (
    (waveformCache.size >= MAX_CACHE_SIZE || currentCacheBytes + valueBytes > MAX_CACHE_BYTES) &&
    waveformCache.size > 0
  ) {
    const firstKey = waveformCache.keys().next().value;
    const firstVal = waveformCache.get(firstKey);
    currentCacheBytes -= (firstVal.byteLength || (firstVal.length * 4));
    waveformCache.delete(firstKey);
  }

  currentCacheBytes = Math.max(0, currentCacheBytes);
  waveformCache.set(key, value);
  currentCacheBytes += valueBytes;
}

function getCache(key) {
  if (!waveformCache.has(key)) return null;
  const value = waveformCache.get(key);
  waveformCache.delete(key);
  waveformCache.set(key, value);
  return value;
}

// ---------------------------------------------------------------------------
// Disk tier
//
// The in-memory LRU above dies with the process, so reopening the same clip in
// a later session recomputes every peak with FFmpeg. A small JSON cache on disk
// keyed by the source file's path + mtime + size makes that instant, and any
// entry whose source changed is discarded and rebuilt. The tier is opt-in:
// until configureDiskCache() supplies a directory it is completely inert, which
// keeps unit tests hermetic.
// ---------------------------------------------------------------------------

const MAX_DISK_ENTRIES = 60;
const MAX_DISK_ENTRY_BYTES = 5 * 1024 * 1024; // 5 MB

let diskCacheDir = null;

/**
 * Point the disk tier at a directory. A falsy value disables it entirely.
 * The directory is created lazily on the first write, never here.
 */
function configureDiskCache(dir) {
  diskCacheDir = (typeof dir === 'string' && dir) ? dir : null;
}

function getDiskCacheDir() {
  return diskCacheDir;
}

/** Deterministic entry filename for a cache key. */
function diskEntryPath(key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex');
  return path.join(diskCacheDir, `${hash}.json`);
}

/** Delete one entry, ignoring every failure (it may already be gone). */
function deleteDiskEntry(entryPath) {
  try {
    fs.promises.unlink(entryPath).catch(() => {});
  } catch (e) {
    /* ignore */
  }
}

/**
 * Read a cached peak array for key, but only when the source file is byte-for-
 * byte the one the entry was built from (same mtime + size). Returns null on
 * any mismatch, absence, or malformed entry - the caller then recomputes.
 */
async function readDiskCache(key, filePath, numPoints) {
  if (!diskCacheDir) return null;

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (e) {
    return null; // unreadable source: leave any entry for a later attempt
  }

  const entryPath = diskEntryPath(key);
  let raw;
  try {
    raw = await fs.promises.readFile(entryPath, 'utf8');
  } catch (e) {
    return null; // no entry yet
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    deleteDiskEntry(entryPath); // corrupt: drop it and recompute
    return null;
  }

  const valid = parsed
    && parsed.key === key
    && parsed.mtimeMs === stat.mtimeMs
    && parsed.size === stat.size
    && parsed.points === numPoints
    && Array.isArray(parsed.peaks)
    && parsed.peaks.length === numPoints;

  if (!valid) {
    deleteDiskEntry(entryPath); // stale (source changed) or wrong shape
    return null;
  }

  return new Float32Array(parsed.peaks);
}

/**
 * Keep the disk tier bounded: at most MAX_DISK_ENTRIES files, oldest first.
 * Best-effort - a failure here must never surface.
 */
async function evictDiskCache() {
  if (!diskCacheDir) return;
  let names;
  try {
    names = await fs.promises.readdir(diskCacheDir);
  } catch (e) {
    return;
  }

  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(diskCacheDir, name);
    try {
      const st = await fs.promises.stat(full);
      entries.push({ full, mtimeMs: st.mtimeMs });
    } catch (e) {
      /* vanished mid-scan: ignore */
    }
  }

  if (entries.length <= MAX_DISK_ENTRIES) return;
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const removeCount = entries.length - MAX_DISK_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    try {
      await fs.promises.unlink(entries[i].full);
    } catch (e) {
      /* ignore */
    }
  }
}

/**
 * Persist one entry. Fire-and-forget by design: the write is never awaited on
 * the extraction path, and every failure (including the returned promise) is
 * swallowed so a read-only or full disk can't break a waveform load.
 */
function writeDiskCache(key, filePath, numPoints, peaks) {
  if (!diskCacheDir || !peaks) return;
  Promise.resolve()
    .then(async () => {
      const stat = await fs.promises.stat(filePath);
      const payload = JSON.stringify({
        key,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        points: numPoints,
        peaks: Array.from(peaks)
      });
      if (Buffer.byteLength(payload, 'utf8') > MAX_DISK_ENTRY_BYTES) return;
      await fs.promises.mkdir(diskCacheDir, { recursive: true });
      await fs.promises.writeFile(diskEntryPath(key), payload, 'utf8');
      await evictDiskCache();
    })
    .catch(() => {});
}

const { Worker } = require('worker_threads');

/**
 * Extract waveform peaks using a worker thread to keep the main event loop smooth.
 *
 * Checks the memory tier first, then the (optional) disk tier, and only then
 * spawns FFmpeg. Peaks that come back from FFmpeg populate both tiers.
 *
 * @param {string} filePath Path to input media file
 * @param {number} [audioIndex=0] Audio track index
 * @param {number} [requestedPoints=2000] Target number of waveform points
 * @returns {Promise<Float32Array|null>} Float32Array of normalized peaks (0.0–1.0)
 */
async function extractWaveform(filePath, audioIndex, requestedPoints = 2000) {
  const trackIndex = audioIndex !== undefined ? audioIndex : 0;
  const numPoints = Math.max(100, Math.min(10000, requestedPoints));
  const cacheKey = `${filePath}_${trackIndex}_${numPoints}`;

  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  const fromDisk = await readDiskCache(cacheKey, filePath, numPoints);
  if (fromDisk) {
    setCache(cacheKey, fromDisk);
    return fromDisk;
  }

  return extractWaveformUncached(filePath, trackIndex, numPoints, cacheKey);
}

/**
 * The original FFmpeg extraction path, split out so the caching tiers can wrap
 * it. Always called with a cache miss already established.
 */
function extractWaveformUncached(filePath, trackIndex, numPoints, cacheKey) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ffmpegPath)) {
      return reject(new Error(`ffmpeg not found at ${ffmpegPath}`));
    }

    // Populate both tiers and resolve in one place. A null result (no peaks)
    // is cached nowhere: there is nothing worth remembering.
    const finishExtraction = (peaks) => {
      if (!peaks) return resolve(peaks);
      setCache(cacheKey, peaks);
      writeDiskCache(cacheKey, filePath, numPoints, peaks);
      resolve(peaks);
    };

    const workerPath = path.join(__dirname, 'waveform-worker.js');

    if (Worker && fs.existsSync(workerPath)) {
      const worker = new Worker(workerPath, {
        workerData: { ffmpegPath, filePath, trackIndex, numPoints }
      });

      const cleanupWorker = () => {
        try { worker.terminate(); } catch (e) {}
      };

      worker.on('message', (msg) => {
        cleanupWorker();
        if (msg.error) {
          const errMsg = typeof msg.error === 'string' ? msg.error : (msg.error.message || 'Worker extraction failed');
          const err = new Error(errMsg);
          if (typeof msg.error === 'object') {
            err.code = msg.error.code;
            err.stderrTail = msg.error.stderrTail;
          }
          reject(err);
        } else if (msg.peaksBuffer) {
          finishExtraction(new Float32Array(msg.peaksBuffer));
        } else if (msg.peaks) {
          finishExtraction(new Float32Array(msg.peaks));
        } else {
          resolve(null);
        }
      });

      worker.on('error', (err) => {
        cleanupWorker();
        resolve(null);
      });

      worker.on('exit', (code) => {
        cleanupWorker();
        if (code !== 0) resolve(null);
      });
      return;
    }

    // Fallback inline extraction (for mock or restricted thread environments)
    const args = [
      '-nostdin',
      '-y',
      '-i', filePath,
      '-map', `0:a:${trackIndex}`,
      '-ac', '1',
      '-ar', '8000',
      '-f', 's16le',
      '-'
    ];

    const child = spawn(ffmpegPath, args);
    const CHUNK_BUCKET_SIZE = 500; // 5x larger bucket for fast inline fallback
    const intermediatePeaks = [];
    let leftoverBuffer = null;
    let currentBucketMax = 0;
    let currentBucketSamples = 0;

    child.stdout.on('data', (chunk) => {
      let data = chunk;
      if (leftoverBuffer) {
        data = Buffer.concat([leftoverBuffer, chunk]);
        leftoverBuffer = null;
      }

      const sampleCount = Math.floor(data.length / 2);
      const remainder = data.length % 2;

      if (remainder > 0) {
        leftoverBuffer = data.subarray(data.length - remainder);
      }

      const samples = new Int16Array(data.buffer, data.byteOffset, sampleCount);

      for (let i = 0; i < samples.length; i++) {
        const val = Math.abs(samples[i]);
        if (val > currentBucketMax) {
          currentBucketMax = val;
        }
        currentBucketSamples++;

        if (currentBucketSamples >= CHUNK_BUCKET_SIZE) {
          intermediatePeaks.push(currentBucketMax / 32768.0);
          currentBucketMax = 0;
          currentBucketSamples = 0;
        }
      }
    });

    child.stderr.on('data', () => {});

    child.on('close', () => {
      if (currentBucketSamples > 0) {
        intermediatePeaks.push(currentBucketMax / 32768.0);
      }

      if (intermediatePeaks.length === 0) {
        return resolve(null);
      }

      const peaks = new Float32Array(numPoints);
      const step = intermediatePeaks.length / numPoints;

      for (let i = 0; i < numPoints; i++) {
        const start = Math.floor(i * step);
        const end = Math.min(Math.floor((i + 1) * step), intermediatePeaks.length);
        let max = 0;
        for (let j = start; j < Math.max(start + 1, end); j++) {
          if (intermediatePeaks[j] > max) {
            max = intermediatePeaks[j];
          }
        }
        peaks[i] = max;
      }

      finishExtraction(peaks);
    });

    child.on('error', () => {
      resolve(null);
    });
  });
}

function clearCache() {
  waveformCache.clear();
  currentCacheBytes = 0;
}

function getCacheSize() {
  return waveformCache.size;
}

function getCacheBytes() {
  return currentCacheBytes;
}

module.exports = {
  extractWaveform,
  clearCache,
  getCacheSize,
  getCacheBytes,
  setCache,
  configureDiskCache,
  getDiskCacheDir,
  // Exported for testing internals (mirrors export-planner._internals).
  _internals: {
    readDiskCache,
    writeDiskCache,
    evictDiskCache,
    diskEntryPath,
    deleteDiskEntry,
    MAX_DISK_ENTRIES,
    MAX_DISK_ENTRY_BYTES
  }
};
