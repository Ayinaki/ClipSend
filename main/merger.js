const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildVideoCodecArgs, audioCodecFor, isHardwareEncoder } = require('./encoder-profiles');
const { _internals: { computeSizeLimitBitrate } } = require('./export-planner');

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
 * Build a per-clip trim plan from raw trim values.
 *
 * Pure helper (unit-testable). Returns one entry per input file with
 * normalized/clamped trim bounds and a `isTrimmed` flag. Trims that are
 * within 0.05s of the full range are treated as "no trim" so untouched
 * clips keep the fast lossless path.
 *
 * @param {string[]} filePaths       Ordered clip paths
 * @param {Array<{trimIn?:number, trimOut?:number}|null>|undefined} trims
 * @param {number[]} clipDurations   Probed durations aligned with filePaths
 * @returns {Array<{filePath:string, duration:number, trimIn:number, trimOut:number, trimDuration:number, isTrimmed:boolean}>}
 */
function normalizeTrimPlan(filePaths, trims, clipDurations) {
  return filePaths.map((fp, i) => {
    const duration = clipDurations && clipDurations[i] ? clipDurations[i] : 0;
    const t = trims && trims[i];
    const rawIn = t && typeof t.trimIn === 'number' ? t.trimIn : 0;
    const rawOut = t && typeof t.trimOut === 'number' ? t.trimOut : duration;
    const trimIn = Math.max(0, Math.min(rawIn, duration));
    const trimOut = Math.max(trimIn, Math.min(rawOut, duration));
    const trimDuration = trimOut - trimIn;
    const isTrimmed = trimIn > 0.05 || trimOut < duration - 0.05;
    return { filePath: fp, duration, trimIn, trimOut, trimDuration, isTrimmed };
  });
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
   * @param {Object}   [options]
   * @param {Array<{trimIn?:number, trimOut?:number}|null>} [options.trims] — per-clip trim ranges aligned with filePaths.
   *   When any clip has a meaningful trim, that clip is first re-encoded to a
   *   uniform temporary file (frame-consistent trim) before the concat step.
   * @returns {Promise<Object>}     { success, filePath, finalSizeMB, strategy }
   */
  async runMerge(filePaths, outputPath, onProgress, options = {}) {
    this.cancelled = false;
    const encoder = options.encoder || 'libx264';
    const trims = options.trims || [];

    const compat = await this.checkCompatibility(filePaths);
    const trimPlan = normalizeTrimPlan(filePaths, trims, compat.clips.map(c => c.duration));

    // Reject degenerate trim ranges before doing any work
    for (let i = 0; i < trimPlan.length; i++) {
      if (trimPlan[i].isTrimmed && trimPlan[i].trimDuration < 0.2) {
        throw new Error(
          `Clip ${i + 1} has an invalid trim range (${trimPlan[i].trimDuration.toFixed(2)}s) — make the selection longer.`
        );
      }
    }

    const trimmedTasks = trimPlan.filter(c => c.isTrimmed);
    const trimTotal = trimmedTasks.reduce((s, c) => s + c.trimDuration, 0);
    const outputTotal = trimPlan.reduce((s, c) => s + c.trimDuration, 0);
    const totalWork = trimTotal + outputTotal;
    const trimWeight = totalWork > 0 ? trimTotal / totalWork : 0;

    const tempFiles = [];
    let effectivePaths = filePaths.slice();
    let strategy;

    try {
      // Phase 1: trim pass — re-encode each trimmed clip to a uniform temp file
      if (trimmedTasks.length > 0) {
        let accumulated = 0;
        for (let i = 0; i < trimmedTasks.length; i++) {
          if (this.cancelled) {
            throw new Error('Merge cancelled by user.');
          }
          const task = trimmedTasks[i];
          const planIndex = trimPlan.indexOf(task);
          const label = `Trimming clip ${planIndex + 1}/${trimPlan.length}...`;

          if (onProgress) onProgress((accumulated / totalWork) * 100, label);

          // Register the temp path BEFORE encoding so a failure/cancel still cleans it up
          const tempPath = path.join(
            os.tmpdir(),
            `clipsend-merge-trim-${Date.now()}-${Math.floor(Math.random() * 100000)}.mp4`
          );
          tempFiles.push(tempPath);
          await this._trimClipToTempFile(task, tempPath, encoder, (pct) => {
            if (onProgress) {
              const done = accumulated + (pct / 100) * task.trimDuration;
              onProgress((done / totalWork) * 100, label);
            }
          });
          effectivePaths[planIndex] = tempPath;
          accumulated += task.trimDuration;
        }
      }

      // Phase 2: concat the effective file list (temps + untouched originals)
      const effCompat = await this.checkCompatibility(effectivePaths);
      const effTotalDuration = effCompat.clips.reduce((sum, c) => sum + c.duration, 0);
      const concatBase = trimWeight * 100;

      if (effCompat.compatible) {
        strategy = 'concat_demuxer';
        await this._runConcatDemuxer(effectivePaths, outputPath, effTotalDuration, (pct) => {
          if (onProgress) onProgress(concatBase + pct * (1 - trimWeight), 'Merging (lossless concat)...');
        });
      } else {
        strategy = 'concat_filter';
        await this._runConcatFilter(effectivePaths, effCompat.clips, outputPath, effTotalDuration, (pct) => {
          if (onProgress) onProgress(concatBase + pct * (1 - trimWeight), 'Merging (re-encoding)...');
        }, encoder, options.codec);
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
        reason: effCompat.reason || null,
        trimmedClips: trimmedTasks.length
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
    } finally {
      // Clean up trim temp files on success, failure, and cancellation
      for (const tmp of tempFiles) {
        try {
          if (fs.promises?.unlink) await fs.promises.unlink(tmp);
          else if (fs.unlinkSync) fs.unlinkSync(tmp);
        } catch (e) {
          /* ignore missing file */
        }
      }
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
  // Private: trim pass — re-encode a clip's trim range to a uniform temp file
  // =========================================================================

  /**
   * Re-encode the trimmed portion of a clip to a temporary MP4 so the final
   * concat step sees clean, frame-consistent input with uniform codecs.
   * @param {Object} task      — { filePath, trimIn, trimDuration } from the trim plan
   * @param {string} tempPath  — pre-registered temp output path
   * @returns {Promise<string>} temp file path
   */
  async _trimClipToTempFile(task, tempPath, encoder = 'libx264', onProgress) {
    // Temp trim files are always MP4/H.264 (they must stay stream-compatible
    // with the untouched source clips for the lossless concat step); the final
    // container/codec is applied later by postConvertMerged when needed.
    const videoCodecArgs = buildVideoCodecArgs({
      encoder,
      crfValue: 18,
      maxQuality: false,
      preset: encoder === 'libx264' ? 'fast' : undefined,
      pass: 0
    });

    const args = [
      '-y',
      '-ss', task.trimIn.toFixed(3),
      '-i', task.filePath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-t', task.trimDuration.toFixed(3),
      ...videoCodecArgs,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      tempPath
    ];

    if (onProgress) onProgress(0);

    await this._runProcess(args, task.trimDuration, onProgress);
    return tempPath;
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

  async _runConcatFilter(filePaths, clips, outputPath, totalDuration, onProgress, encoder = 'libx264', codec = 'h264') {
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

    // The concat-filter fallback normally writes an intermediate MP4 (the
    // final container/codec is applied by postConvertMerged when a conversion
    // is scheduled), so audio follows the mp4 path. The multi-segment trim
    // flow (skipConvert) instead pre-encodes segments in the final codec and
    // skips post-conversion, so its destination can be .webm — derive the
    // container from the output extension so the re-encode lands in the muxer
    // the output will actually use (VP9/Opus segments must not become H.264
    // into a .webm file). The video encoder itself is passed in codec-appropriate.
    const container = path.extname(outputPath).toLowerCase() === '.webm' ? 'webm' : 'mp4';
    const videoCodecArgs = buildVideoCodecArgs({
      encoder,
      crfValue: 18,
      maxQuality: false,
      preset: encoder === 'libx264' ? 'medium' : undefined,
      pass: 0
    });

    const args = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      ...videoCodecArgs,
      '-c:a', audioCodecFor(container),
      '-b:a', '192k',
      // Native opus (WebM audio) is marked experimental; -strict -2 is
      // required or the encoder refuses to open.
      ...(container === 'webm' ? ['-strict', '-2'] : []),
      ...(container === 'mp4' ? ['-movflags', '+faststart'] : []),
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

  _runProcess(args, totalDurationSec, onProgressUpdate, cwd) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(ffmpegPath)) {
        return reject(new Error(`ffmpeg not found at ${ffmpegPath}. Ensure binaries are bundled.`));
      }

      this.currentProcess = spawn(ffmpegPath, args, cwd ? { cwd } : undefined);
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

  // =========================================================================
  // Post-merge conversion — honors shared export settings (format / resolution
  // / target size) that the fast lossless merge path can't satisfy.
  // =========================================================================

  /**
   * Re-encode the merged file when the export settings ask for something other
   * than the default MP4 + native + no-size-cap output. Returns the final path
   * and size; the intermediate MP4 is removed.
   */
  async postConvertMerged(inputPath, { format = 'mp4', resolution = null, targetSizeMB = null, totalDurationSec = 0, codec = 'h264', encoder = null, finalPath = null, onProgress } = {}) {
    const isAv1 = codec === 'av1';
    const isVp9 = codec === 'vp9';
    // The container follows the format picker: mp4/webm for video (WebM+H.264
    // requests arrive here already remapped to VP9 by ipc-handlers via
    // codecForFormat), gif/mp3 for their own containers.
    const ext = format === 'gif' ? 'gif' : format === 'mp3' ? 'mp3' : format === 'webm' ? 'webm' : 'mp4';
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    // When the merge wrote an intermediate MP4 (non-MP4 formats), the caller
    // passes the real destination so the converted file lands under the name
    // the user picked, not the temp file's base name.
    const targetPath = finalPath || path.join(dir, `${base}.${ext}`);
    // In-place conversion needs a temp file (can't read and write the same path).
    const convertPath = targetPath === inputPath
      ? path.join(dir, `${base}.convert.${ext}`)
      : targetPath;

    // Optional scale filter for a non-native resolution.
    let scaleFilter = null;
    if (resolution) {
      const parts = String(resolution).toLowerCase().split('x');
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      if (w > 0 && h > 0) {
        scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
      }
    }

    if (format === 'gif') {
      const fpsFilter = 'fps=15';
      const preFilter = scaleFilter ? `${scaleFilter},${fpsFilter}` : fpsFilter;
      const palettePath = path.join(os.tmpdir(), `clipsend-palette-${Date.now()}.png`);
      try {
        // Pass 1: generate an optimized palette
        await this._runProcess(
          ['-y', '-i', inputPath, '-vf', `${preFilter},palettegen=stats_mode=diff`, palettePath],
          0, null
        );
        // Pass 2: apply the palette with dithering. preFilter always includes
        // fps=15 (with or without a scale filter), so the output stays at the
        // intended framerate instead of inheriting the source fps.
        const lavfi = `[0:v]${preFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`;
        await this._runProcess(
          ['-y', '-i', inputPath, '-i', palettePath, '-lavfi', lavfi, convertPath],
          0, onProgress
        );
      } finally {
        try {
          if (fs.promises?.unlink) await fs.promises.unlink(palettePath);
          else if (fs.unlinkSync) fs.unlinkSync(palettePath);
        } catch (e) {
          /* ignore missing palette */
        }
      }
    } else if (format === 'mp3') {
      await this._runProcess(
        ['-y', '-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', convertPath],
        totalDurationSec, onProgress
      );
    } else {
      // Video re-encode for non-native resolution, an explicit target size,
      // an AV1/VP9 codec switch, or a WebM container.
      const args = ['-y', '-i', inputPath];
      if (scaleFilter) args.push('-vf', scaleFilter);

      // ipc-handlers always passes a resolved encoder (hardware or CPU);
      // default to a CPU encoder per codec when absent. Previously the h264
      // branch hardcoded libx264, silently dropping hardware acceleration.
      const enc = encoder || (isAv1 ? 'libaom-av1' : isVp9 ? 'libvpx-vp9' : 'libx264');
      let videoBitrateKbps = null;
      if (targetSizeMB && totalDurationSec > 0) {
        // Same safety-margin + muxing-overhead math as the trim planner
        // (computeSizeLimitBitrate), so the merged file lands *under* the cap
        // instead of right on it. The naive targetSizeMB-based bitrate has no
        // headroom, and single-pass rate control reliably overshoots it.
        videoBitrateKbps = Math.max(
          64,
          Math.round(computeSizeLimitBitrate(targetSizeMB, totalDurationSec, 192))
        );
      }

      if (videoBitrateKbps) {
        // CPU encoders get a proper 2-pass encode so the size target is hit
        // accurately (same as the trim export path); hardware encoders can't
        // do 2-pass, so they stay single-pass VBR (still margin-buffered).
        if (!isHardwareEncoder(enc)) {
          // The x264-on-Windows backslash bug strikes again: the passlog
          // filename must be RELATIVE and the process cwd set to the output
          // directory (the same workaround encoder.js uses), or pass 2 fails
          // to find the stats file written by pass 1.
          const passLogName = `clipsend-pass-${Date.now()}`;
          const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
          try {
            // Pass 1: analysis only — no audio, discard the output.
            const pass1Args = ['-y', '-i', inputPath];
            if (scaleFilter) pass1Args.push('-vf', scaleFilter);
            pass1Args.push(
              ...buildVideoCodecArgs({ encoder: enc, videoBitrateKbps, maxQuality: false, pass: 1 }),
              '-an', '-f', 'null', '-passlogfile', passLogName, nullOutput
            );
            await this._runProcess(pass1Args, totalDurationSec, null, dir);

            // Pass 2: real encode with audio + faststart (MP4 only).
            const pass2Args = ['-y', '-i', inputPath];
            if (scaleFilter) pass2Args.push('-vf', scaleFilter);
            pass2Args.push(
              ...buildVideoCodecArgs({ encoder: enc, videoBitrateKbps, maxQuality: false, pass: 2 }),
              '-pix_fmt', 'yuv420p',
              '-c:a', audioCodecFor(ext), '-b:a', '192k'
            );
            // Native opus (WebM audio) is marked experimental; -strict -2 is
            // required or the encoder refuses to open.
            if (ext === 'webm') pass2Args.push('-strict', '-2');
            if (ext === 'mp4') pass2Args.push('-movflags', '+faststart');
            pass2Args.push('-passlogfile', passLogName, convertPath);
            await this._runProcess(pass2Args, totalDurationSec, onProgress, dir);
          } finally {
            try { await fs.promises.unlink(path.join(dir, `${passLogName}-0.log`)); } catch (e) { /* ignore */ }
            try { await fs.promises.unlink(path.join(dir, `${passLogName}-0.log.mbtree`)); } catch (e) { /* ignore */ }
          }
        } else {
          args.push(...buildVideoCodecArgs({ encoder: enc, videoBitrateKbps, maxQuality: false, pass: 0 }));
          args.push(
            '-pix_fmt', 'yuv420p',
            '-c:a', audioCodecFor(ext), '-b:a', '192k'
          );
          // Native opus (WebM audio) is marked experimental; -strict -2 is
          // required or the encoder refuses to open.
          if (ext === 'webm') args.push('-strict', '-2');
          // MP4 (H.264/AV1) benefits from faststart for fast playback.
          if (ext === 'mp4') args.push('-movflags', '+faststart');
          args.push(convertPath);
          await this._runProcess(args, totalDurationSec, onProgress);
        }
      } else {
        args.push(...buildVideoCodecArgs({
          encoder: enc,
          crfValue: isAv1 ? 35 : isVp9 ? 32 : 23,
          maxQuality: false,
          preset: enc === 'libx264' ? 'medium' : undefined,
          pass: 0
        }));
        args.push(
          '-pix_fmt', 'yuv420p',
          '-c:a', audioCodecFor(ext), '-b:a', '192k'
        );
        // Native opus (WebM audio) is marked experimental; -strict -2 is
        // required or the encoder refuses to open.
        if (ext === 'webm') args.push('-strict', '-2');
        // MP4 (H.264/AV1) benefits from faststart for fast playback.
        if (ext === 'mp4') args.push('-movflags', '+faststart');
        args.push(convertPath);
        await this._runProcess(args, totalDurationSec, onProgress);
      }
    }

    // Finalize: swap the converted file into place and drop the intermediate.
    if (convertPath !== targetPath) {
      try {
        if (fs.promises?.unlink) await fs.promises.unlink(inputPath);
        else if (fs.unlinkSync) fs.unlinkSync(inputPath);
      } catch (e) {
        /* ignore */
      }
      if (fs.promises?.rename) await fs.promises.rename(convertPath, targetPath);
      else fs.renameSync(convertPath, targetPath);
    } else if (targetPath !== inputPath) {
      try {
        if (fs.promises?.unlink) await fs.promises.unlink(inputPath);
        else if (fs.unlinkSync) fs.unlinkSync(inputPath);
      } catch (e) {
        /* ignore */
      }
    }

    const stats = await fs.promises.stat(targetPath);
    return {
      path: targetPath,
      sizeMB: parseFloat((stats.size / (1024 * 1024)).toFixed(2))
    };
  }
}

module.exports = { Merger, normalizeTrimPlan };
