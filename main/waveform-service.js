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

/**
 * Extract waveform peaks using streaming intermediate bucket processing.
 *
 * Instead of accumulating millions of raw PCM bytes in memory, incoming audio
 * is reduced on-the-fly into 80 peaks/sec intermediate buckets (98%+ memory reduction).
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

    // Intermediate streaming peak bucket (1 peak per 100 samples @ 8000Hz = 80 peaks/sec)
    const CHUNK_BUCKET_SIZE = 100;
    const intermediatePeaks = [];
    let leftoverBuffer = Buffer.alloc(0);
    let currentBucketMax = 0;
    let currentBucketSamples = 0;

    child.stdout.on('data', (chunk) => {
      let data = chunk;
      if (leftoverBuffer.length > 0) {
        data = Buffer.concat([leftoverBuffer, chunk]);
        leftoverBuffer = Buffer.alloc(0);
      }

      // 16-bit mono = 2 bytes per sample
      const sampleCount = Math.floor(data.length / 2);
      const remainder = data.length % 2;

      if (remainder > 0) {
        leftoverBuffer = data.slice(data.length - remainder);
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

    child.stderr.on('data', () => {
      // Ignore stderr
    });

    child.on('close', (code) => {
      if (currentBucketSamples > 0) {
        intermediatePeaks.push(currentBucketMax / 32768.0);
      }

      if (intermediatePeaks.length === 0) {
        return resolve(null);
      }

      // Resample intermediate peaks into exact numPoints
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
