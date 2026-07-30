const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

const MAX_STDERR_BYTES = 16384; // 16KB rolling window
const TIME_BUFFER_MAX = 2048;   // 2KB progress regex buffer
const TIME_REGEX = /time=(\d+):(\d{2}):(\d{2}\.\d{2})/g;

/**
 * Encoder service — orchestrates the 2-pass FFmpeg execution.
 */
class Encoder {
  constructor() {
    this.currentProcess = null;
    this.cancelled = false;
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
        if (onProgress) onProgress(0, 'Encoding (CRF Mode)...');
        const passArgs = [...plan.singlePassArgs, outputPath];
        
        await this._runPass(passArgs, clipDuration, (pct) => {
          if (onProgress) onProgress(pct, 'Encoding (CRF Mode)...');
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
          const tail = fullErrText.split('\n').slice(-10).join('\n');
          const err = new Error(`FFmpeg exited with code ${code}. Error: ${tail}`);
          err.ffmpegStderr = fullErrText;
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
