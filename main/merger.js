const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}
let ffprobePath = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
if (ffprobePath.includes('app.asar')) {
  ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}

const MAX_STDERR_BYTES = 16384; // 16KB rolling window
const TIME_BUFFER_MAX = 2048;   // 2KB progress regex buffer
const PROBE_CONCURRENCY = 3;    // Bounded probing limit

const MAX_PROBE_CACHE_SIZE = 100;
const probeCache = new Map();

function setProbeCache(key, value) {
  if (probeCache.has(key)) {
    probeCache.delete(key);
  } else if (probeCache.size >= MAX_PROBE_CACHE_SIZE) {
    const firstKey = probeCache.keys().next().value;
    probeCache.delete(firstKey);
  }
  probeCache.set(key, value);
}

function getProbeCache(key) {
  if (!probeCache.has(key)) return null;
  const value = probeCache.get(key);
  probeCache.delete(key);
  probeCache.set(key, value);
  return value;
}

/**
 * Helper to run async tasks with a concurrency cap
 */
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Merger — handles multi-clip video concatenation via FFmpeg.
 */
class Merger {
  constructor() {
    this.currentProcess = null;
    this.cancelled = false;
  }

  // =========================================================================
  // Public: compatibility check
  // =========================================================================

  /**
   * Probe every clip with bounded concurrency and determine compatibility.
   * @param {string[]} filePaths  Ordered list of clip paths
   * @returns {Promise<Object>} { compatible, clips[], reason? }
   */
  async checkCompatibility(filePaths) {
    if (!filePaths || filePaths.length < 2) {
      throw new Error('At least 2 clips are required for merging.');
    }

    // Bounded parallel probing (concurrency limit = 3)
    const clips = await mapConcurrent(filePaths, PROBE_CONCURRENCY, async (fp, i) => {
      try {
        return await this._probeClipCached(fp);
      } catch (err) {
        throw new Error(`Failed to probe clip ${i + 1} ("${path.basename(fp)}"): ${err.message}`);
      }
    });

    // Compare all clips against the first
    const ref = clips[0];
    let compatible = true;
    let reason = null;

    for (let i = 1; i < clips.length; i++) {
      const c = clips[i];
      if (c.videoCodec !== ref.videoCodec) {
        compatible = false;
        reason = `Video codec mismatch: clip 1 uses ${ref.videoCodec}, clip ${i + 1} uses ${c.videoCodec}`;
        break;
      }
      if (c.width !== ref.width || c.height !== ref.height) {
        compatible = false;
        reason = `Resolution mismatch: clip 1 is ${ref.width}x${ref.height}, clip ${i + 1} is ${c.width}x${c.height}`;
        break;
      }
      if (c.fps !== ref.fps) {
        compatible = false;
        reason = `Frame rate mismatch: clip 1 is ${ref.fps}fps, clip ${i + 1} is ${c.fps}fps`;
        break;
      }
      if (c.pixFmt !== ref.pixFmt) {
        compatible = false;
        reason = `Pixel format mismatch: clip 1 uses ${ref.pixFmt}, clip ${i + 1} uses ${c.pixFmt}`;
        break;
      }
      if (c.audioCodec !== ref.audioCodec) {
        compatible = false;
        reason = `Audio codec mismatch: clip 1 uses ${ref.audioCodec}, clip ${i + 1} uses ${c.audioCodec}`;
        break;
      }
      if (c.audioSampleRate !== ref.audioSampleRate) {
        compatible = false;
        reason = `Audio sample rate mismatch: clip 1 is ${ref.audioSampleRate}Hz, clip ${i + 1} is ${c.audioSampleRate}Hz`;
        break;
      }
      if (c.audioChannels !== ref.audioChannels) {
        compatible = false;
        reason = `Audio channel count mismatch: clip 1 has ${ref.audioChannels}ch, clip ${i + 1} has ${c.audioChannels}ch`;
        break;
      }
    }

    return { compatible, clips, reason };
  }

  // =========================================================================
  // Public: merge export
  // =========================================================================

  /**
   * Run the merge.
   * @param {string[]} filePaths    Ordered clip paths
   * @param {string}   outputPath   Output file path
   * @param {Function} onProgress   (percent, statusString) => void
   * @returns {Promise<Object>}     { success, filePath, finalSizeMB, strategy }
   */
  async runMerge(filePaths, outputPath, onProgress, options = {}) {
    this.cancelled = false;
    const encoder = options.encoder || 'libx264';

    const compat = await this.checkCompatibility(filePaths);
    const totalDuration = compat.clips.reduce((sum, c) => sum + c.duration, 0);

    let strategy;

    try {
      if (compat.compatible) {
        strategy = 'concat_demuxer';
        await this._runConcatDemuxer(filePaths, outputPath, totalDuration, onProgress);
      } else {
        strategy = 'concat_filter';
        await this._runConcatFilter(filePaths, compat.clips, outputPath, totalDuration, onProgress, encoder);
      }

      if (this.cancelled) {
        throw new Error('Merge cancelled by user.');
      }

      const getStat = fs.promises?.stat ? fs.promises.stat : (p) => Promise.resolve(fs.statSync(p));
      const stats = await getStat(outputPath);
      const sizeMB = stats.size / (1024 * 1024);

      return {
        success: true,
        filePath: outputPath,
        finalSizeMB: parseFloat(sizeMB.toFixed(2)),
        strategy,
        reason: compat.reason || null
      };

    } catch (err) {
      try {
        if (fs.promises?.unlink) await fs.promises.unlink(outputPath);
        else if (fs.unlinkSync) fs.unlinkSync(outputPath);
      } catch (e) {
        /* ignore missing file */
      }

      if (this.cancelled) {
        return { success: false, cancelled: true, strategy };
      }
      throw err;
    }
  }

  /**
   * Cancel the current merge process.
   */
  cancel() {
    this.cancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill('SIGKILL');
    }
  }

  // =========================================================================
  // Private: cached clip probe
  // =========================================================================

  async _probeClipCached(filePath) {
    try {
      const stats = await fs.promises.stat(filePath);
      const cacheKey = `${filePath}_${stats.mtimeMs}_${stats.size}`;

      const cached = getProbeCache(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await this._probeClip(filePath);
      setProbeCache(cacheKey, result);
      return result;
    } catch (e) {
      return await this._probeClip(filePath);
    }
  }

  _probeClip(filePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(ffprobePath)) {
        return reject(new Error(`ffprobe not found at ${ffprobePath}`));
      }

      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        filePath
      ];

      execFile(ffprobePath, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const errSnippet = stderr ? `: ${stderr.slice(-200)}` : '';
          return reject(new Error(`ffprobe error: ${error.message}${errSnippet}`));
        }

        try {
          const data = JSON.parse(stdout);
          const videoStream = data.streams.find(s => s.codec_type === 'video');
          const audioStream = data.streams.find(s => s.codec_type === 'audio');

          if (!videoStream) {
            return reject(new Error('No video stream found'));
          }

          let fps = 30;
          if (videoStream.r_frame_rate) {
            const parts = videoStream.r_frame_rate.split('/');
            if (parts.length === 2) {
              const num = parseInt(parts[0], 10);
              const den = parseInt(parts[1], 10);
              if (den > 0) fps = Math.round((num / den) * 100) / 100;
            }
          }

          resolve({
            filePath,
            duration: parseFloat(data.format.duration) || 0,
            videoCodec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            fps,
            pixFmt: videoStream.pix_fmt || 'yuv420p',
            audioCodec: audioStream ? audioStream.codec_name : null,
            audioSampleRate: audioStream ? parseInt(audioStream.sample_rate, 10) : null,
            audioChannels: audioStream ? audioStream.channels : null,
            audioChannelLayout: audioStream ? (audioStream.channel_layout || null) : null
          });

        } catch (parseError) {
          reject(new Error('Failed to parse ffprobe output'));
        }
      });
    });
  }

  // =========================================================================
  // Private: FAST PATH — concat demuxer (-c copy)
  // =========================================================================

  async _runConcatDemuxer(filePaths, outputPath, totalDuration, onProgress) {
    const listPath = path.join(os.tmpdir(), `merge-list-${Date.now()}.txt`);

    try {
      const lines = filePaths.map(fp => {
        const escaped = fp.replace(/\\/g, '/').replace(/'/g, "'\\''");
        return `file '${escaped}'`;
      });
      await fs.promises.writeFile(listPath, lines.join('\n'), 'utf8');

      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        outputPath
      ];

      if (onProgress) onProgress(0, 'Merging (lossless concat)...');

      await this._runProcess(args, totalDuration, (pct) => {
        if (onProgress) onProgress(pct, 'Merging (lossless concat)...');
      });

    } finally {
      try {
        await fs.promises.unlink(listPath);
      } catch (e) {
        /* ignore missing file */
      }
    }
  }

  // =========================================================================
  // Private: FALLBACK PATH — concat filter (re-encode)
  // =========================================================================

  async _runConcatFilter(filePaths, clips, outputPath, totalDuration, onProgress, encoder = 'libx264') {
    const targetW = clips[0].width;
    const targetH = clips[0].height;
    const targetFps = clips[0].fps;
    const n = filePaths.length;

    const inputArgs = [];
    for (const fp of filePaths) {
      inputArgs.push('-i', fp);
    }

    const filterParts = [];
    const concatInputs = [];

    for (let i = 0; i < n; i++) {
      const hasAudio = clips[i].audioCodec !== null;

      filterParts.push(
        `[${i}:v:0]` +
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=${targetFps},` +
        `format=yuv420p,` +
        `setsar=1` +
        `[v${i}]`
      );

      if (hasAudio) {
        filterParts.push(
          `[${i}:a:0]` +
          `aresample=44100,` +
          `aformat=sample_fmts=fltp:channel_layouts=stereo` +
          `[a${i}]`
        );
      } else {
        filterParts.push(
          `anullsrc=r=44100:cl=stereo:d=${clips[i].duration}[a${i}]`
        );
      }

      concatInputs.push(`[v${i}][a${i}]`);
    }

    filterParts.push(
      `${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv][outa]`
    );

    const filterComplex = filterParts.join('; ');

    let videoCodecArgs;
    if (encoder === 'h264_nvenc') {
      videoCodecArgs = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '18', '-b:v', '0'];
    } else {
      videoCodecArgs = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'];
    }

    const args = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      ...videoCodecArgs,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath
    ];

    if (onProgress) onProgress(0, 'Merging (re-encoding)...');

    await this._runProcess(args, totalDuration, (pct) => {
      if (onProgress) onProgress(pct, 'Merging (re-encoding)...');
    });
  }

  // =========================================================================
  // Private: spawn FFmpeg + progress parsing
  // =========================================================================

  _runProcess(args, totalDurationSec, onProgressUpdate) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(ffmpegPath)) {
        return reject(new Error(`ffmpeg not found at ${ffmpegPath}. Ensure binaries are bundled.`));
      }

      this.currentProcess = spawn(ffmpegPath, args);
      let errorOutput = '';
      let timeBuffer = '';

      this.currentProcess.stderr.on('data', (data) => {
        const text = data.toString();
        
        // 1. Rolling 16KB stderr window
        errorOutput += text;
        if (errorOutput.length > MAX_STDERR_BYTES) {
          errorOutput = errorOutput.slice(errorOutput.length - MAX_STDERR_BYTES);
        }

        // 2. Cross-chunk progress regex matching (2KB trailing buffer)
        timeBuffer += text;
        if (timeBuffer.length > TIME_BUFFER_MAX) {
          timeBuffer = timeBuffer.slice(timeBuffer.length - TIME_BUFFER_MAX);
        }

        const timeMatches = [...timeBuffer.matchAll(/time=(\d+):(\d{2}):(\d{2}\.\d{2})/g)];
        if (timeMatches.length > 0) {
          const lastMatch = timeMatches[timeMatches.length - 1];
          const h = parseInt(lastMatch[1], 10);
          const m = parseInt(lastMatch[2], 10);
          const s = parseFloat(lastMatch[3]);
          const currentSec = (h * 3600) + (m * 60) + s;

          if (totalDurationSec > 0) {
            let pct = (currentSec / totalDurationSec) * 100;
            pct = Math.min(100, Math.max(0, pct));
            if (onProgressUpdate) onProgressUpdate(pct);
          }
        }
      });

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (this.cancelled) {
          reject(new Error('Cancelled'));
        } else if (code !== 0) {
          const lastLines = errorOutput.split('\n').slice(-10).join('\n');
          const err = new Error(`FFmpeg exited with code ${code}.\n${lastLines}`);
          err.ffmpegStderr = errorOutput;
          reject(err);
        } else {
          resolve();
        }
      });

      this.currentProcess.on('error', (err) => {
        this.currentProcess = null;
        reject(err);
      });
    });
  }
}

module.exports = { Merger };
