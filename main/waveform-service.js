const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

// In-memory cache: "filePath_audioIndex" -> Float32Array (or Array)
const waveformCache = new Map();

function extractWaveform(filePath, audioIndex) {
  return new Promise((resolve, reject) => {
    // Default to track 0 if undefined
    const trackIndex = audioIndex !== undefined ? audioIndex : 0;
    const cacheKey = `${filePath}_${trackIndex}`;

    if (waveformCache.has(cacheKey)) {
      return resolve(waveformCache.get(cacheKey));
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
    let rawData = Buffer.alloc(0);

    child.stdout.on('data', (chunk) => {
      rawData = Buffer.concat([rawData, chunk]);
    });

    child.stderr.on('data', () => {
      // Ignore stderr
    });

    child.on('close', (code) => {
      if (rawData.length === 0) {
        // No audio data or extraction failed (e.g. no audio track)
        return resolve(null);
      }

      // We generate a fixed number of peaks (e.g., 2000 points)
      // This is enough resolution for any reasonable canvas width.
      const numPoints = 2000;
      const samples = new Int16Array(rawData.buffer, rawData.byteOffset, rawData.byteLength / 2);
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
      
      const peaksArray = Array.from(peaks);
      waveformCache.set(cacheKey, peaksArray);
      resolve(peaksArray);
    });

    child.on('error', (err) => {
      resolve(null); // fail gracefully
    });
  });
}

function clearCache() {
  waveformCache.clear();
}

module.exports = {
  extractWaveform,
  clearCache
};
