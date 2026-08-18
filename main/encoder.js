const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { buildDiscountedPlan, MAX_SIZE_RETRIES, SIZE_RETRY_FACTOR } = require('./export-planner');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

const MAX_STDERR_BYTES = 16384; // 16KB rolling window
const TIME_BUFFER_MAX = 2048;   // 2KB progress regex buffer
const TIME_REGEX = /time=(\d+):(\d{2}):(\d{2}\.\d{2})/g;


/**
 * Translate a failed ffmpeg run into a human-readable message plus a raw
 * technical tail. Raw stderr dumps are hard to act on (e.g. a bare
 * "frame= 0 ... Conversion failed!"), so the common failure modes get a
 * plain-language explanation while the tail is still attached for the
 * technical-details view in the UI.
 *
 * @param {number} code - ffmpeg's non-zero exit code
 * @param {string} stderr - the full accumulated stderr text
 * @returns {{ message: string, details: string }}
 */
function translateFfmpegError(code, stderr) {
  const tail = stderr.split('\n').slice(-10).join('\n');

  // Zero video frames encoded while the run still proceeded. This is the
  // classic music-file shape: the container/audio is longer than the video
  // track (often a short cover-art video), so a trim that starts at or past
  // the video's end encodes nothing and dies with a bare "Conversion failed!".
  // The marker text varies by ffmpeg version (video:0KiB breakdown vs. the
  // newer "Nothing was written" line), so match frame= 0 together with any
  // no-packets/could-not-open-encoder marker.
  const zeroFrames = /frame=\s*0/.test(stderr);
  const noVideoWritten = /video:0KiB/.test(stderr)
    || /Nothing was written into output file/.test(stderr)
    || /Could not open encoder before EOF/.test(stderr);
  if (zeroFrames && noVideoWritten) {
    return {
      message: 'The export range has no video frames to encode — the video track is shorter than the trim window (common for music files, where the audio outlasts the video). Move the trim In point earlier or pick a shorter range, then try again.',
      details: stderr.split('\n').slice(-12).join('\n')
    };
  }

  // Generic path: the message stays a clean summary (the modal shows the raw
  // tail under "Technical details"), consistent with the translated branch.
  return {
    message: `FFmpeg exited with code ${code}.`,
    details: tail
  };
}

/**
 * Encoder service — orchestrates the 2-pass FFmpeg execution.
 */
class Encoder {
  constructor() {
    this.currentProcess = null;
    this.cancelled = false;
  }

  /**
   * Run the encode, then check the produced file against the plan's size
   * target. If it overshot and a discount can still help, re-encode with a
   * progressively lower bitrate (up to MAX_SIZE_RETRIES attempts total),
   * keeping the smallest file produced. If the last attempt still cannot
   * fit, the result carries a `warning` instead of failing the export.
   *
   * Only size-limit video plans participate: quality/CRF mode has no target,
   * GIF has its own descension loop, MP3 size is not video-bitrate-driven,
   * and intermediate multi-segment files carry no targetSizeMB at all.
   *
   * @param {Object} plan The export plan containing pass1Args and pass2Args.
   * @param {string} outputPath The final destination file path.
   * @param {Function} onProgress Callback for progress: (percent, statusString) => void
   * @returns {Promise<Object>} Success result with filePath and finalSizeMB
   */
  async runEncodeWithSizeRetry(plan, outputPath, onProgress) {
    const targetMB = plan && plan.targetSizeMB;
    const isSizeCapped = targetMB != null && targetMB > 0
      && plan.crfValue === undefined
      && plan.outputFormat !== 'gif'
      && plan.outputFormat !== 'mp3';

    let result = await this.runEncode(plan, outputPath, onProgress);
    if (!result || !result.success || !isSizeCapped || result.finalSizeMB <= targetMB) {
      return result;
    }

    let currentPlan = plan;
    let best = result;
    for (let attempt = 2; attempt <= MAX_SIZE_RETRIES; attempt++) {
      // A cancel landed between attempts (no process running to kill, and
      // runEncode resets this.cancelled on entry) — honor it now.
      if (this.cancelled) return { success: false, cancelled: true };

      const discounted = buildDiscountedPlan(currentPlan, SIZE_RETRY_FACTOR);
      if (!discounted) break;
      currentPlan = discounted;

      // Encode each retry to a temp sibling so a failed or cancelled attempt
      // can never destroy the best file produced so far; promote it only
      // once the encode actually succeeded.
      const attemptPath = `${outputPath}.retry${attempt}`;
      if (onProgress) {
        onProgress(-attempt, `Retry ${attempt}/${MAX_SIZE_RETRIES}: lowering bitrate to fit ${targetMB} MB...`);
      }

      try {
        const retryResult = await this.runEncode(discounted, attemptPath, onProgress);
        if (!retryResult || !retryResult.success) {
          // Cancelled or failed: keep the previous best. runEncode already
          // removed the partial attempt file.
          if (retryResult && retryResult.cancelled) return retryResult;
          break;
        }
        if (fs.promises?.rename) await fs.promises.rename(attemptPath, outputPath);
        else fs.renameSync(attemptPath, outputPath);
        retryResult.filePath = outputPath;
        best = retryResult;
        if (best.finalSizeMB <= targetMB) break;
      } catch (err) {
        try {
          if (fs.promises?.unlink) await fs.promises.unlink(attemptPath);
          else if (fs.unlinkSync) fs.unlinkSync(attemptPath);
        } catch (e) { /* ignore */ }
        break;
      }
    }

    if (best.finalSizeMB > targetMB) {
      best.warning = `The export finished at ${best.finalSizeMB} MB, over the ${targetMB} MB target. ClipSend re-encoded it at a lower bitrate, but it still could not fit. Try trimming more or choosing a smaller target.`;
    }
    return best;
  }

  /**
   * Run the 2-pass encoding process based on the generated plan.
   * 
   * @param {Object} plan The export plan containing pass1Args and pass2Args.
   * @param {string} outputPath The final destination file path.
   * @param {Function} onProgress Callback for progress: (percent, statusString) => void
   * @returns {Promise<Object>} Success result with filePath and finalSizeMB
   */
  async runEncode(plan, outputPath, onProgress) {
    this.cancelled = false;
    const { clipDuration } = plan;

    const logPrefix = `ffmpeg2pass-${Date.now()}`;
    const logDir = path.dirname(outputPath);
    const passLogName = logPrefix;

    try {
      // --- PASS 1 ---
      if (!plan.isSinglePass) {
        if (onProgress) onProgress(0, 'Pass 1/2: Analyzing...');
        const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const pass1Args = [...plan.pass1Args, '-passlogfile', passLogName, nullOutput];
        
        await this._runPass(pass1Args, clipDuration, (pct) => {
          if (onProgress) onProgress(pct * 0.5, 'Pass 1/2: Analyzing...');
        }, logDir);

        if (this.cancelled) {
          throw new Error('Encoding cancelled by user.');
        }
      }

      // --- PASS 2 or SINGLE PASS ---
      if (plan.isSinglePass) {
        const singlePassLabel = plan.outputFormat === 'mp3' ? 'Encoding Audio...' : 'Encoding (CRF Mode)...';
        if (onProgress) onProgress(0, singlePassLabel);
        const passArgs = [...plan.singlePassArgs, outputPath];
        
        await this._runPass(passArgs, clipDuration, (pct) => {
          if (onProgress) onProgress(pct, singlePassLabel);
        }, logDir);
      } else {
        if (onProgress) onProgress(50, 'Pass 2/2: Encoding...');
        const pass2Args = [...plan.pass2Args, '-passlogfile', passLogName, outputPath];
        
        await this._runPass(pass2Args, clipDuration, (pct) => {
          if (onProgress) onProgress(50 + (pct * 0.5), 'Pass 2/2: Encoding...');
        }, logDir);
      }

      if (this.cancelled) {
        throw new Error('Encoding cancelled by user.');
      }

      // Encode finished successfully.
      const getStat = fs.promises?.stat ? fs.promises.stat : (p) => Promise.resolve(fs.statSync(p));
      const stats = await getStat(outputPath);
      const sizeMB = stats.size / (1024 * 1024);

      // Async cleanup pass logs
      await this._cleanupLogs(logDir, logPrefix);

      return {
        success: true,
        filePath: outputPath,
        finalSizeMB: parseFloat(sizeMB.toFixed(2))
      };

    } catch (err) {
      // Async cleanup logs and partial output on error/cancel
      await this._cleanupLogs(logDir, logPrefix);
      try {
        if (fs.promises?.unlink) {
          await fs.promises.unlink(outputPath);
        } else if (fs.unlinkSync) {
          fs.unlinkSync(outputPath);
        }
      } catch (e) {
        /* ignore missing file */
      }
      
      if (this.cancelled) {
        return { success: false, cancelled: true };
      }
      throw err;
    }
  }

  /**
   * Cancel the current encoding process.
   */
  cancel() {
    this.cancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill('SIGKILL');
    }
  }

  /**
   * Internal pass runner. Spawns FFmpeg, parses stderr for time=... to report progress.
   */
  _runPass(args, totalDurationSec, onProgressUpdate, cwd) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(ffmpegPath)) {
        return reject(new Error(`ffmpeg not found at ${ffmpegPath}. Ensure binaries are bundled.`));
      }

      this.currentProcess = spawn(ffmpegPath, args, { cwd });
      const stderrChunks = [];
      let stderrBytesTotal = 0;
      let timeBuffer = '';
      let lastProgressTs = 0;
      let lastProgressPct = -1;

      this.currentProcess.stderr.on('data', (data) => {
        const text = data.toString();
        
        // 1. Ring buffer for stderr chunks to avoid repeated string concatenation allocations
        stderrChunks.push(text);
        stderrBytesTotal += text.length;
        while (stderrBytesTotal > MAX_STDERR_BYTES && stderrChunks.length > 1) {
          const removed = stderrChunks.shift();
          stderrBytesTotal -= removed.length;
        }

        // 2. Cross-chunk progress regex matching (2KB trailing buffer)
        timeBuffer += text;
        if (timeBuffer.length > TIME_BUFFER_MAX) {
          timeBuffer = timeBuffer.slice(timeBuffer.length - TIME_BUFFER_MAX);
        }

        TIME_REGEX.lastIndex = 0;
        let lastMatch = null;
        let match;
        while ((match = TIME_REGEX.exec(timeBuffer)) !== null) {
          lastMatch = match;
        }

        if (lastMatch && onProgressUpdate) {
          const h = parseInt(lastMatch[1], 10);
          const m = parseInt(lastMatch[2], 10);
          const s = parseFloat(lastMatch[3]);
          const currentSec = (h * 3600) + (m * 60) + s;
          
          if (totalDurationSec > 0) {
            let pct = (currentSec / totalDurationSec) * 100;
            pct = Math.min(100, Math.max(0, pct));
            
            const now = Date.now();
            if (now - lastProgressTs >= 200 || Math.abs(pct - lastProgressPct) >= 1.0 || pct >= 100) {
              lastProgressTs = now;
              lastProgressPct = pct;
              onProgressUpdate(pct);
            }
          }
        }
      });

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (this.cancelled) {
          reject(new Error('Cancelled'));
        } else if (code !== 0) {
          const fullErrText = stderrChunks.join('');
          const translated = translateFfmpegError(code, fullErrText);
          const err = new Error(translated.message);
          err.ffmpegStderr = fullErrText;
          err.details = translated.details;
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

  /**
   * Async cleanup of ffmpeg passlog files.
   */
  async _cleanupLogs(logDir, logPrefix) {
    const log0 = path.join(logDir, `${logPrefix}-0.log`);
    const logMbtree = path.join(logDir, `${logPrefix}-0.log.mbtree`);
    
    try {
      if (fs.promises?.unlink) await fs.promises.unlink(log0);
      else if (fs.unlinkSync) fs.unlinkSync(log0);
    } catch (e) {}

    try {
      if (fs.promises?.unlink) await fs.promises.unlink(logMbtree);
      else if (fs.unlinkSync) fs.unlinkSync(logMbtree);
    } catch (e) {}
  }
}

module.exports = { Encoder };
