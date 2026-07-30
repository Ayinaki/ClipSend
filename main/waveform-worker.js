const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const fs = require('fs');

const { ffmpegPath, filePath, trackIndex, numPoints } = workerData;

if (!fs.existsSync(ffmpegPath)) {
  parentPort.postMessage({ error: `ffmpeg not found at ${ffmpegPath}` });
  process.exit(0);
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
const CHUNK_BUCKET_SIZE = 100;
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
    parentPort.postMessage({ peaks: null });
    return;
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

  parentPort.postMessage({ peaksBuffer: peaks.buffer }, [peaks.buffer]);
});

child.on('error', (err) => {
  parentPort.postMessage({ error: err.message });
});
