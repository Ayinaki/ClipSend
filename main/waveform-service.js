const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

/**
 * Bounded LRU Cache for Waveforms (max 50 entries)
 */
const MAX_CACHE_SIZE = 50;
const waveformCache = new Map();

function setCache(key, value) {
  if (waveformCache.has(key)) {
    waveformCache.delete(key);
  } else if (waveformCache.size >= MAX_CACHE_SIZE) {
    const firstKey = waveformCache.keys().next().value;
    waveformCache.delete(firstKey);
  }
  waveformCache.set(key, value);
}

function getCache(key) {
  if (!waveformCache.has(key)) return null;
  const value = waveformCache.get(key);
  waveformCache.delete(key);
  waveformCache.set(key, value);
  return value;
}

/**
 * Extract waveform peaks from an audio track.
 * Returns a Float32Array directly for zero-copy IPC transmission.
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
      '-i', filePath,
      '-map', `0:a:${trackIndex}`,
      '-ac', '1',
      '-ar', '8000',
      '-f', 's16le',
      '-'
    ];

    const child = spawn(ffmpegPath, args);
    const chunks = [];
    let totalBytes = 0;

    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
    });

    child.stderr.on('data', () => {
      // Ignore stderr
    });

    child.on('close', (code) => {
      if (totalBytes === 0) {
        return resolve(null);
      }

      // Single buffer allocation
      const rawData = Buffer.concat(chunks, totalBytes);
      const samples = new Int16Array(rawData.buffer, rawData.byteOffset, Math.floor(rawData.byteLength / 2));
      
      if (samples.length === 0) {
        return resolve(null);
      }

      const samplesPerPoint = Math.max(1, Math.floor(samples.length / numPoints));
      const peaks = new Float32Array(numPoints);

      for (let i = 0; i < numPoints; i++) {
        const start = i * samplesPerPoint;
        const end = Math.min(start + samplesPerPoint, samples.length);
        let max = 0;
        for (let j = start; j < end; j++) {
          const val = Math.abs(samples[j]);
          if (val > max) max = val;
        }
        peaks[i] = max / 32768.0; // normalize to 0.0-1.0
      }

      // Cache & return Float32Array directly (zero-copy IPC)
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
}

function getCacheSize() {
  return waveformCache.size;
}

module.exports = {
  extractWaveform,
  clearCache,
  getCacheSize
};
