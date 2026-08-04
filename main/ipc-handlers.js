const { ipcMain, BrowserWindow, app, shell } = require('electron');
const { spawn } = require('child_process');
const { openFileDialog, openMultipleFilesDialog, showSaveDialog, pickDirectoryDialog } = require('./file-manager');
const { probeFile, extractThumbnail } = require('./probe-service');
const { calculatePlan } = require('./export-planner');
const { Encoder } = require('./encoder');
const { Merger } = require('./merger');
const { extractWaveform } = require('./waveform-service');
const gifExporter = require('./gif-exporter');
const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

const store = new Store({
  defaults: {
    maxQuality: true
  }
});
let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}
const activePreviews = new Set();

app.on('will-quit', () => {
  activePreviews.forEach(tempPath => {
    fs.promises.unlink(tempPath).catch(() => {});
  });
});

async function getUniqueFilePath(basePath) {
  try {
    await fs.promises.access(basePath);
  } catch (e) {
    return basePath;
  }

  const parsed = path.parse(basePath);
  let counter = 1;
  while (true) {
    const candidatePath = path.join(parsed.dir, `${parsed.name} (${counter})${parsed.ext}`);
    try {
      await fs.promises.access(candidatePath);
      counter++;
    } catch (e) {
      return candidatePath;
    }
  }
}

const encoder = new Encoder();
const merger = new Merger();

function createProgressThrottler(sendFn, minIntervalMs = 100) {
  let lastTime = 0;
  let lastPercent = -1;
  return (percent, status) => {
    const now = Date.now();
    if (now - lastTime >= minIntervalMs || Math.abs(percent - lastPercent) >= 1.0 || percent >= 100) {
      lastTime = now;
      lastPercent = percent;
      sendFn(percent, status);
    }
  };
}

async function limitConcurrentSettled(items, concurrencyLimit, fn) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        const value = await fn(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:openFile', async () => {
    const filePath = await openFileDialog();
    if (!filePath) return null;
    
    try {
      const mediaInfo = await probeFile(filePath);
      return { success: true, filePath, mediaInfo };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dialog:openSpecificFile', async (event, filePath) => {
    if (!filePath) return null;
    try {
      const mediaInfo = await probeFile(filePath);
      return { success: true, filePath, mediaInfo };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dialog:openSpecificMultipleFiles', async (event, filePaths) => {
    if (!filePaths || filePaths.length === 0) return null;
    
    try {
      const tempDir = app.getPath('temp');
      const settled = await limitConcurrentSettled(filePaths, 3, async (filePath) => {
        const mediaInfo = await probeFile(filePath);
        const thumbnailPath = await extractThumbnail(filePath, tempDir);
        
        return {
          filePath,
          mediaInfo,
          thumbnailPath,
          id: `clip-${Date.now()}-${Math.floor(Math.random() * 10000)}`
        };
      });

      const clips = settled
        .filter(res => res.status === 'fulfilled' && res.value)
        .map(res => res.value);

      if (clips.length === 0) {
        const firstErr = settled.find(r => r.status === 'rejected')?.reason?.message || 'Failed to open files.';
        return { success: false, error: firstErr };
      }

      return { success: true, clips };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dialog:openMultipleFiles', async () => {
    const filePaths = await openMultipleFilesDialog();
    if (!filePaths || filePaths.length === 0) return null;
    
    try {
      const tempDir = app.getPath('temp');
      const settled = await limitConcurrentSettled(filePaths, 3, async (filePath) => {
        const mediaInfo = await probeFile(filePath);
        const thumbnailPath = await extractThumbnail(filePath, tempDir);
        
        return {
          filePath,
          mediaInfo,
          thumbnailPath,
          id: `clip-${Date.now()}-${Math.floor(Math.random() * 10000)}`
        };
      });

      const clips = settled
        .filter(res => res.status === 'fulfilled' && res.value)
        .map(res => res.value);

      if (clips.length === 0) {
        const firstErr = settled.find(r => r.status === 'rejected')?.reason?.message || 'Failed to open files.';
        return { success: false, error: firstErr };
      }

      return { success: true, clips };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('preview:remux', (event, { inputPath, audioOrdinal }) => {
    return new Promise((resolve) => {
      const tempDir = app.getPath('temp');
      const tempName = `clipsend-preview-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp4`;
      const tempPath = path.join(tempDir, tempName);

      const args = [
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', `0:a:${audioOrdinal}`,
        '-c', 'copy',
        tempPath
      ];

      const ffmpeg = spawn(ffmpegPath, args);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          activePreviews.add(tempPath);
          resolve({ success: true, tempPath });
        } else {
          resolve({ success: false, error: `FFmpeg exited with code ${code}` });
        }
      });

      ffmpeg.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  });

  ipcMain.handle('preview:cleanup', (event, tempPath) => {
    if (tempPath && activePreviews.has(tempPath)) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        activePreviews.delete(tempPath);
      } catch (err) {
        console.error('Failed to cleanup temp preview:', err);
      }
    }
  });

  ipcMain.handle('util:getTempPath', () => app.getPath('temp'));

  ipcMain.handle('util:cleanupFiles', (event, filePaths) => {
    if (!Array.isArray(filePaths)) return;
    for (const p of filePaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (err) {
        console.error('Failed to cleanup file:', p, err);
      }
    }
  });

  // --- Waveform ---
  ipcMain.handle('waveform:get', async (event, { filePath, audioIndex }) => {
    try {
      return await extractWaveform(filePath, audioIndex);
    } catch (err) {
      console.error('Waveform extraction failed:', err);
      return null;
    }
  });

  ipcMain.handle('export:calculatePlan', (event, { mediaInfo, trimIn, trimOut, settings }) => {
    try {
      const plan = calculatePlan(mediaInfo, trimIn, trimOut, settings);
      return { success: true, plan };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:start', async (event, { plan, inputFilePath, outputPath }) => {
    if (!outputPath) {
      const parsedInput = path.parse(inputFilePath);
      const isGif = plan.outputFormat === 'gif';
      const isMp3 = plan.outputFormat === 'mp3';
      const ext = isGif ? '.gif' : isMp3 ? '.mp3' : '.mp4';
      const standardizedName = `${parsedInput.name} - Trimmed${ext}`;
      const defaultExportDir = store.get('defaultExportDirectory');

      if (defaultExportDir && fs.existsSync(defaultExportDir)) {
        const targetPath = path.join(defaultExportDir, standardizedName);
        outputPath = await getUniqueFilePath(targetPath);
      } else {
        outputPath = await showSaveDialog(standardizedName);
        if (!outputPath) return null; // Cancelled
      }
    }

    try {
      const throttledSend = createProgressThrottler((percent, status) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('export:progress', { percent, status });
        }
      });

      if (plan.outputFormat === 'gif') {
        const result = await gifExporter.runEncode(plan, outputPath, throttledSend);
        return result;
      } else {
        const result = await encoder.runEncode(plan, outputPath, throttledSend);
        return result;
      }
    } catch (error) {
      if (plan.encoder === 'h264_nvenc' && error.ffmpegStderr) {
        const errText = error.ffmpegStderr;
        if (
          errText.includes('Could not open encoder') ||
          errText.includes('Cannot load nvcuda.dll') ||
          errText.includes('No capable devices found') ||
          errText.includes('OpenEncodeSessionEx failed') ||
          errText.includes('Initialize failed')
        ) {
          return { success: false, fallbackToCpu: true };
        }
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:get', (event, key) => store.get(key));

  // --- Merge handlers ---

  ipcMain.handle('merge:checkCompat', async (event, { filePaths }) => {
    try {
      const result = await merger.checkCompatibility(filePaths);
      return {
        success: true,
        compatible: result.compatible,
        reason: result.reason || null,
        clipCount: result.clips.length,
        totalDuration: result.clips.reduce((sum, c) => sum + c.duration, 0)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('merge:resolveDestination', async () => {
    const defaultName = `Merged Video - ${new Date().toISOString().slice(0,10)}.mp4`;
    const defaultExportDir = store.get('defaultExportDirectory');

    if (defaultExportDir && fs.existsSync(defaultExportDir)) {
      const targetPath = path.join(defaultExportDir, defaultName);
      return await getUniqueFilePath(targetPath);
    } else {
      return await showSaveDialog(defaultName);
    }
  });

  ipcMain.handle('merge:export', async (event, { filePaths, outputPath }) => {
    if (!outputPath) {
      const defaultName = `Merged Video - ${new Date().toISOString().slice(0,10)}.mp4`;
      const defaultExportDir = store.get('defaultExportDirectory');
      if (defaultExportDir && fs.existsSync(defaultExportDir)) {
        const targetPath = path.join(defaultExportDir, defaultName);
        outputPath = await getUniqueFilePath(targetPath);
      } else {
        outputPath = await showSaveDialog(defaultName);
        if (!outputPath) return null; // Cancelled
      }
    }

    // Resolve encoder preference for merge re-encode path
    const hwAccel = store.get('hwAccel') || 'auto';
    let encoder = 'libx264';
    if (hwAccel === 'nvenc' || hwAccel === 'auto') {
      // Quick check if NVENC is available
      try {
        const { exec } = require('child_process');
        const available = await new Promise((resolve) => {
          exec(`"${ffmpegPath}" -encoders`, (error, stdout) => {
            if (error) return resolve(false);
            resolve(stdout.includes('h264_nvenc'));
          });
        });
        if (available) encoder = 'h264_nvenc';
      } catch (e) {
        // Stay with libx264
      }
    }

    try {
      const result = await merger.runMerge(filePaths, outputPath, (percent, status) => {
        event.sender.send('merge:progress', { percent, status });
      }, { encoder });
      return result;
    } catch (error) {
      // If NVENC failed during merge re-encode, retry with CPU
      if (encoder === 'h264_nvenc' && error.ffmpegStderr) {
        const errText = error.ffmpegStderr;
        if (
          errText.includes('Could not open encoder') ||
          errText.includes('Cannot load nvcuda.dll') ||
          errText.includes('No capable devices found') ||
          errText.includes('OpenEncodeSessionEx failed') ||
          errText.includes('Initialize failed')
        ) {
          try {
            const retryResult = await merger.runMerge(filePaths, outputPath, (percent, status) => {
              event.sender.send('merge:progress', { percent, status });
            }, { encoder: 'libx264' });
            return retryResult;
          } catch (retryError) {
            return { success: false, error: retryError.message };
          }
        }
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('merge:cancel', () => {
    merger.cancel();
  });
  
  ipcMain.handle('settings:set', (event, key, value) => {
    store.set(key, value);
    return true;
  });
  
  ipcMain.handle('settings:getAll', () => store.store);
  
  ipcMain.handle('dialog:pickDirectory', async () => {
    return await pickDirectoryDialog();
  });

  ipcMain.handle('encoder:detect', async () => {
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      const path = require('path');
      let localFfmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
      
      // Explicitly point to unpacked asar if packaged to be absolutely safe
      if (localFfmpegPath.includes('app.asar')) {
        localFfmpegPath = localFfmpegPath.replace('app.asar', 'app.asar.unpacked');
      }

      console.log(`[NVENC Detect] Running: ${localFfmpegPath} -encoders`);
      
      execFile(localFfmpegPath, ['-encoders'], (error, stdout, stderr) => {
        if (error) {
          console.error(`[NVENC Detect] Error running ffmpeg:`, error);
          console.error(`[NVENC Detect] stderr:`, stderr);
          resolve(false);
          return;
        }
        resolve(stdout.includes('h264_nvenc'));
      });
    });
  });

  ipcMain.handle('export:cancel', () => {
    encoder.cancel();
    gifExporter.cancel();
  });

  ipcMain.handle('shell:showItemInFolder', (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('clipboard:copyFile', async (event, filePath) => {
    try {
      const { exec } = require('child_process');
      const resolvedPath = path.resolve(filePath);
      
      const escapedPath = resolvedPath.replace(/'/g, "''");
      const psCommand = `Set-Clipboard -LiteralPath '${escapedPath}'`;
      
      await new Promise((resolve, reject) => {
        exec(`powershell -command "${psCommand}"`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      return { success: true };
    } catch (error) {
      console.error('Failed to copy file to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // --- Feedback ---
  ipcMain.handle('submit-feedback', async (event, payload) => {
    try {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        throw new Error('Discord webhook URL is not configured.');
      }

      let { type, message, contact } = payload;
      
      if (!message || message.trim().length < 10) {
        throw new Error('Message too short — please add more detail.');
      }
      
      if (message.length > 1000) {
        message = message.substring(0, 1000) + '...';
      }

      let color = 0x808080; // Gray for general
      let titleEmoji = '💬';
      let typeName = 'General Feedback';

      if (type === 'bug') {
        color = 0xFF4444; // Red
        titleEmoji = '🐛';
        typeName = 'Bug Report';
      } else if (type === 'feature') {
        color = 0x44AAFF; // Blue
        titleEmoji = '💡';
        typeName = 'Feature Request';
      }

      const embed = {
        author: {
          name: 'New Feedback Submission'
        },
        title: `${titleEmoji} ${typeName}`,
        description: message,
        color: color,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'ClipSend Feedback'
        },
        fields: [
          {
            name: 'App Version',
            value: app.getVersion() || 'Unknown',
            inline: true
          }
        ]
      };

      if (contact && contact.trim().length > 0) {
        embed.fields.push({
          name: 'Submitted by',
          value: contact.substring(0, 100), // Enforce length limit
          inline: true
        });
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ embeds: [embed] })
      });

      if (!response.ok) {
        throw new Error(`Discord API returned ${response.status} ${response.statusText}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Feedback submission failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('shell:openExternal', (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });
}

module.exports = { registerIpcHandlers };
