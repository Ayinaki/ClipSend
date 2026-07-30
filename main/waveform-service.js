const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

const { Worker } = require('worker_threads');

/**
 * Extract waveform peaks using a worker thread to keep the main event loop smooth.
 *
 * @param {string} filePath Path to input media file
 * @param {number} [audioIndex=0] Audio track index
 * @param {number} [requestedPoints=2000] Target number of waveform points
 * @returns {Promise<Float32Array|null>} Float32Array of normalized peaks (0.0–1.0)
 */
function extractWaveform(filePath, audioIndex, requestedPoints = 2000) {
  return new Promise((resolve, reject) => {
    const trackIndex = audioIndex !== undefined ? audioIndex : 0;
    const numPoints = Math.max(100, Math.min(10000, requestedPoints));
    const cacheKey = `${filePath}_${trackIndex}_${numPoints}`;

    const cached = getCache(cacheKey);
    if (cached) {
      return resolve(cached);
    }

    if (!fs.existsSync(ffmpegPath)) {
      return reject(new Error(`ffmpeg not found at ${ffmpegPath}`));
    }

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
          const peaks = new Float32Array(msg.peaksBuffer);
          setCache(cacheKey, peaks);
          resolve(peaks);
        } else if (msg.peaks) {
          const peaks = new Float32Array(msg.peaks);
          setCache(cacheKey, peaks);
          resolve(peaks);
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

      setCache(cacheKey, peaks);
      resolve(peaks);
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
  setCache
};
