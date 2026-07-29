const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
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

    // FFmpeg 2-pass creates a log file based on the -passlogfile arg or defaults to "ffmpeg2pass".
    // We run it in a temporary working directory to keep the root clean, or just use a unique prefix.
    const logPrefix = `ffmpeg2pass-${Date.now()}`;
    const logDir = path.dirname(outputPath);
    
    // x264 has a notorious bug on Windows where it mangles absolute paths due to backslash escaping.
    // To completely avoid this, we pass a purely relative filename to FFmpeg for the passlogfile,
    // and we set the Current Working Directory (cwd) of the FFmpeg process to logDir.
    const passLogName = logPrefix;

    try {


      // --- PASS 1 ---
      if (!plan.isSinglePass) {
        if (onProgress) onProgress(0, 'Pass 1/2: Analyzing...');
        const pass1Args = [...plan.pass1Args, '-passlogfile', passLogName, 'NUL'];
        
        await this._runPass(pass1Args, clipDuration, (pct) => {
          // Pass 1 represents 0-50% of total progress
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
          // Pass 2 represents 50-100% of total progress
          if (onProgress) onProgress(50 + (pct * 0.5), 'Pass 2/2: Encoding...');
        }, logDir);
      }

      if (this.cancelled) {
        throw new Error('Encoding cancelled by user.');
      }

      // Encode finished successfully.
      const stats = fs.statSync(outputPath);
      const sizeMB = stats.size / (1024 * 1024);

      // Cleanup pass logs
      this._cleanupLogs(logDir, logPrefix);

      return {
        success: true,
        filePath: outputPath,
        finalSizeMB: parseFloat(sizeMB.toFixed(2))
      };

    } catch (err) {
      // Cleanup logs and partial output on error/cancel
      this._cleanupLogs(logDir, logPrefix);
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
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
          const err = new Error(`FFmpeg exited with code ${code}. Error: ${errorOutput.split('\n').slice(-10).join('\n')}`);
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

  /**
   * Cleanup ffmpeg passlog files.
   */
  _cleanupLogs(logDir, logPrefix) {
    const log0 = path.join(logDir, `${logPrefix}-0.log`);
    const logMbtree = path.join(logDir, `${logPrefix}-0.log.mbtree`);
    
    if (fs.existsSync(log0)) {
      try { fs.unlinkSync(log0); } catch(e) {}
    }
    if (fs.existsSync(logMbtree)) {
      try { fs.unlinkSync(logMbtree); } catch(e) {}
    }
  }
}

module.exports = { Encoder };
