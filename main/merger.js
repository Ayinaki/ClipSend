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

/**
 * Merger — handles multi-clip video concatenation via FFmpeg.
 *
 * Two strategies:
 *   1. FAST PATH — concat demuxer with -c copy (lossless, near-instant)
 *      Used when all clips share identical video codec, resolution, fps,
 *      pixel format, audio codec, sample rate, and channels.
 *
 *   2. FALLBACK PATH — concat filter with re-encoding (quality-preserving)
 *      Used when clips differ. Normalizes all streams to match the first clip's
 *      resolution, then encodes with libx264 CRF 18 + AAC.
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
   * Probe every clip and determine if they are compatible for lossless concat.
   * @param {string[]} filePaths  Ordered list of clip paths
   * @returns {Promise<Object>} { compatible, clips[], reason? }
   */
  async checkCompatibility(filePaths) {
    const clips = [];

    for (let i = 0; i < filePaths.length; i++) {
      try {
        const info = await this._probeClip(filePaths[i]);
        clips.push(info);
      } catch (err) {
        throw new Error(`Failed to probe clip ${i + 1} ("${path.basename(filePaths[i])}"): ${err.message}`);
      }
    }

    if (clips.length < 2) {
      throw new Error('At least 2 clips are required for merging.');
    }

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

      const stats = fs.statSync(outputPath);
      const sizeMB = stats.size / (1024 * 1024);

      return {
        success: true,
        filePath: outputPath,
        finalSizeMB: parseFloat(sizeMB.toFixed(2)),
        strategy,
        reason: compat.reason || null
      };

    } catch (err) {
      // Cleanup partial output
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
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
  // Private: probe a single clip
  // =========================================================================

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

      execFile(ffprobePath, args, { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`ffprobe error: ${error.message}`));
        }

        try {
          const data = JSON.parse(stdout);
          const videoStream = data.streams.find(s => s.codec_type === 'video');
          const audioStream = data.streams.find(s => s.codec_type === 'audio');

          if (!videoStream) {
            return reject(new Error('No video stream found'));
          }

          // Parse fps from r_frame_rate
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
    // Write temporary concat list file
    const listPath = path.join(os.tmpdir(), `merge-list-${Date.now()}.txt`);

    try {
      // FFmpeg concat demuxer requires forward slashes and single-quote escaping
      const lines = filePaths.map(fp => {
        const escaped = fp.replace(/\\/g, '/').replace(/'/g, "'\\''");
        return `file '${escaped}'`;
      });
      fs.writeFileSync(listPath, lines.join('\n'), 'utf8');

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
      // Cleanup list file
      if (fs.existsSync(listPath)) {
        try { fs.unlinkSync(listPath); } catch (e) { /* ignore */ }
      }
    }
  }

  // =========================================================================
  // Private: FALLBACK PATH — concat filter (re-encode)
  // =========================================================================

  async _runConcatFilter(filePaths, clips, outputPath, totalDuration, onProgress, encoder = 'libx264') {
    // Target resolution = first clip's resolution
    const targetW = clips[0].width;
    const targetH = clips[0].height;
    const targetFps = clips[0].fps;
    const n = filePaths.length;

    // Build input args
    const inputArgs = [];
    for (const fp of filePaths) {
      inputArgs.push('-i', fp);
    }

    // Build filter_complex
    // For each input: scale to target res (maintain aspect ratio + pad), set fps, set pixel format,
    // normalize audio to 44100 stereo
    const filterParts = [];
    const concatInputs = [];

    for (let i = 0; i < n; i++) {
      const hasAudio = clips[i].audioCodec !== null;

      // Video normalization
      filterParts.push(
        `[${i}:v:0]` +
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=${targetFps},` +
        `format=yuv420p,` +
        `setsar=1` +
        `[v${i}]`
      );

      // Audio normalization (generate silence if no audio stream)
      if (hasAudio) {
        filterParts.push(
          `[${i}:a:0]` +
          `aresample=44100,` +
          `aformat=sample_fmts=fltp:channel_layouts=stereo` +
          `[a${i}]`
        );
      } else {
        // Generate silent audio matching this clip's duration
        filterParts.push(
          `anullsrc=r=44100:cl=stereo:d=${clips[i].duration}[a${i}]`
        );
      }

      concatInputs.push(`[v${i}][a${i}]`);
    }

    // Concat filter
    filterParts.push(
      `${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv][outa]`
    );

    const filterComplex = filterParts.join('; ');

    // Build video codec args based on encoder
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
  // Private: spawn FFmpeg + progress parsing (same pattern as Encoder)
  // =========================================================================

  _runProcess(args, totalDurationSec, onProgressUpdate) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(ffmpegPath)) {
        return reject(new Error(`ffmpeg not found at ${ffmpegPath}. Ensure binaries are bundled.`));
      }

      this.currentProcess = spawn(ffmpegPath, args);
      let errorOutput = '';

      this.currentProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;

        // Parse time=HH:MM:SS.ms to calculate progress
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          const s = parseFloat(timeMatch[3]);
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
