const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
let gifskiPath = path.join(__dirname, '..', 'bin', 'gifski.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  gifskiPath = gifskiPath.replace('app.asar', 'app.asar.unpacked');
}

/**
 * GifExporter — orchestrates FFmpeg y4m extraction and Gifski iterative encoding.
 */
class GifExporter {
  constructor() {
    this.currentProcess = null;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
    if (this.currentProcess) {
      try {
        this.currentProcess.kill('SIGKILL');
      } catch (e) {}
      this.currentProcess = null;
    }
  }

  /**
   * Extacts y4m and iteratively runs gifski
   */
  async runEncode(plan, outputPath, onProgress) {
    this.cancelled = false;
    const { clipDuration, singlePassArgs, targetSizeMB } = plan;

    // 1. Run FFmpeg to extract Y4M
    const y4mPath = outputPath + '.temp.y4m';
    if (onProgress) onProgress(0, 'Extracting frames...');
    
    // Add output path to singlePassArgs (which was built by export-planner)
    const extractArgs = [...singlePassArgs, '-y', y4mPath];
    
    await this._runFfmpeg(extractArgs, clipDuration, (pct) => {
      if (onProgress) onProgress(pct * 0.3, 'Extracting frames...');
    });

    if (this.cancelled) {
      if (fs.existsSync(y4mPath)) fs.unlinkSync(y4mPath);
      throw new Error('Export cancelled by user');
    }

    // 2. Descension Loop for Gifski
    let fps = 30;
    let quality = 90;
    let scale = 1.0;
    const maxBytes = (targetSizeMB || 10) * 1024 * 1024 * 0.95; // 5% safety margin

    let attempt = 1;
    let finalSize = 0;
    let success = false;

    while (attempt <= 8) {
      if (this.cancelled) break;
      if (onProgress) onProgress(-attempt, `Encoding GIF (Attempt ${attempt})...`);
      
      const attemptOutputPath = outputPath + `.attempt${attempt}.gif`;
      
      // Calculate scaled dimensions
      const targetWidth = Math.max(320, Math.round(plan.width * scale));
      
      const gifskiArgs = [
        '-o', attemptOutputPath,
        '-r', fps.toString(),
        '-Q', quality.toString(),
        '-W', targetWidth.toString(),
        y4mPath
      ];

      await this._runGifski(gifskiArgs);
      
      if (this.cancelled) {
        if (fs.existsSync(attemptOutputPath)) fs.unlinkSync(attemptOutputPath);
        break;
      }

      const stats = fs.statSync(attemptOutputPath);
      finalSize = stats.size;
      
      if (finalSize <= maxBytes || attempt === 8) {
        // Success or best effort! Rename to final
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(attemptOutputPath, outputPath);
        success = true;
        break;
      } else {
        // Failed, reduce params and loop
        fs.unlinkSync(attemptOutputPath);
        
        if (fps > 25) fps = 25;
        else if (fps > 24) fps = 24;
        else if (scale > 0.6) scale -= 0.15;
        else if (quality > 60) quality -= 15;
        else scale -= 0.1;
      }
      attempt++;
    }

    // Cleanup Y4M
    if (fs.existsSync(y4mPath)) fs.unlinkSync(y4mPath);

    if (this.cancelled) throw new Error('Export cancelled by user');

    const finalSizeMBString = (finalSize / (1024 * 1024)).toFixed(2);
    
    if (finalSize > maxBytes) {
      // We do not throw an error, we just return it with a warning property, 
      // but wait, `ipcMain.handle('export:start')` expects { success: true, warning: '...' }.
      // Let's return it like this so the caller knows it succeeded but with a warning.
      return {
        success: true,
        filePath: outputPath,
        finalSizeMB: finalSizeMBString,
        warning: `Could not reach target size. Exported at best-effort settings. Final size: ${finalSizeMBString} MB.`
      };
    }

    return {
      success: true,
      filePath: outputPath,
      finalSizeMB: finalSizeMBString
    };
  }

  _runFfmpeg(args, duration, onProgress) {
    return new Promise((resolve, reject) => {
      console.log('Spawning FFmpeg with args:', args);
      this.currentProcess = spawn(ffmpegPath, args);
      
      let stderrLog = '';
      
      this.currentProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderrLog += output;
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch && onProgress && duration > 0) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = (hours * 3600) + (minutes * 60) + seconds;
          const percent = Math.min((currentTime / duration) * 100, 100);
          onProgress(percent);
        }
      });

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (this.cancelled) return reject(new Error('Cancelled'));
        if (code !== 0) {
          const errMsg = `FFmpeg exited with code ${code}.\n\nFFmpeg Log:\n${stderrLog.slice(-1000)}`;
          const err = new Error(errMsg);
          err.ffmpegStderr = stderrLog;
          return reject(err);
        }
        resolve();
      });
    });
  }

  _runGifski(args) {
    return new Promise((resolve, reject) => {
      console.log('Spawning Gifski with args:', args);
      this.currentProcess = spawn(gifskiPath, args);
      let stderrLog = '';
      this.currentProcess.stderr.on('data', data => { stderrLog += data.toString(); });
      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (this.cancelled) return reject(new Error('Cancelled'));
        if (code !== 0) return reject(new Error(`Gifski exited with code ${code}.\n\nLog: ${stderrLog.slice(-500)}`));
        resolve();
      });
    });
  }
}

module.exports = new GifExporter();
