const { ipcMain, BrowserWindow, app, shell } = require('electron');
const { spawn } = require('child_process');
const { openFileDialog, openMultipleFilesDialog, showSaveDialog, pickDirectoryDialog } = require('./file-manager');
const { probeFile, extractThumbnail, getCreatedThumbnails } = require('./probe-service');
const { calculatePlan } = require('./export-planner');
const { updateTaskbarProgress, clearTaskbarProgress, setTaskbarError, notifyExportComplete } = require('./taskbar');
const { Encoder } = require('./encoder');
const { Merger } = require('./merger');
const { pickEncoder, isHardwareEncoder, resolveCpuEncoder, detectAvailableEncoders, codecForFormat } = require('./encoder-profiles');
const { extractWaveform } = require('./waveform-service');
const gifExporter = require('./gif-exporter');
const { renderFilenameTemplate, buildTemplateVars } = require('./filename-template');
const Store = require('electron-store');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Default filename templates, kept in sync with the placeholders shown in the
// Settings modal (setting-filename-template-trim / -merge). `{name}` is the
// source base name for trims and "Merged Video" for merges.
const DEFAULT_TEMPLATE_TRIM = '{name} - Trimmed';
const DEFAULT_TEMPLATE_MERGE = 'Merged Video - {date}';

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

// Stderr fragments that indicate a hardware encoder failed to initialize
// (missing drivers, unsupported GPU, no VRAM, etc.). Any vendor's encoder
// (NVENC / QSV / AMF) failing like this triggers the CPU retry path.
const HW_ENCODER_FAILURE_PATTERNS = [
  'Could not open encoder',
  'Cannot load nvcuda.dll',
  'No capable devices found',
  'OpenEncodeSessionEx failed',
  'Initialize failed',
  'MFXVideoENCODE_Init',
  'Failed to initialize MFX',
  'MFX session',
  'mfx implementation',
  'libmfx',
  'AMF Error',
  'Unable to load AMF',
  'amfrt64.dll',
  'No hardware device',
  'hardware device'
];

function isHardwareEncoderFailure(encoderName, ffmpegStderr) {
  if (!isHardwareEncoder(encoderName) || !ffmpegStderr) return false;
  return HW_ENCODER_FAILURE_PATTERNS.some(p => ffmpegStderr.includes(p));
}

// Detect encoder capabilities once per session (the bundled FFmpeg's encoder
// list doesn't change at runtime) and share it between encoder:detect, the
// export fallback, and merge re-encode resolution.
let encoderCapsPromise = null;
function getEncoderCapabilities() {
  if (!encoderCapsPromise) {
    encoderCapsPromise = detectAvailableEncoders(ffmpegPath).catch(() => null);
  }
  return encoderCapsPromise;
}

app.on('will-quit', () => {
  activePreviews.forEach(tempPath => {
    fs.promises.unlink(tempPath).catch(() => {});
  });
  // Merge-clip thumbnails (thumb-*.jpg) are tracked by probe-service; remove
  // any that the renderer didn't already clean up on clip removal.
  getCreatedThumbnails().forEach(tempPath => {
    fs.promises.unlink(tempPath).catch(() => {});
  });
});

// Orphaned temp files (clipsend-*, thumb-*) only get cleaned on will-quit,
// which a hard crash or Task-Manager kill skips entirely — so leftovers can
// pile up in %TEMP% forever. Sweep anything older than a day at startup;
// the age gate keeps a second running instance's live files untouched.
const TEMP_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sweepOrphanedTempFiles() {
  const tempDir = app.getPath('temp');
  fs.readdir(tempDir, (err, entries) => {
    if (err) return;
    const now = Date.now();
    for (const entry of entries) {
      if (!/^(clipsend-|thumb-)/.test(entry)) continue;
      const fullPath = path.join(tempDir, entry);
      fs.stat(fullPath, (statErr, stats) => {
        if (statErr || !stats.isFile()) return;
        if (now - stats.mtimeMs > TEMP_SWEEP_MAX_AGE_MS) {
          fs.unlink(fullPath, () => {});
        }
      });
    }
  });
}

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

function finishExport(win, result, label, opts = {}) {
  if (!result || !result.success) {
    // A user-cancelled export isn't an error worth a red taskbar.
    if (result && result.cancelled) {
      clearTaskbarProgress(win);
      return;
    }
    setTaskbarError(win);
    return;
  }
  clearTaskbarProgress(win);
  // Multi-segment merged exports encode each segment to a temp file first
  // (clipsend-seg-*); only the final merged output deserves a toast, so the
  // renderer suppresses notifications for those intermediate steps.
  if (opts.notify !== false) {
    notifyExportComplete({ win, filePath: result.filePath, finalSizeMB: result.finalSizeMB, label });
  }
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
  sweepOrphanedTempFiles();

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
        const thumb = await extractThumbnail(filePath, tempDir);
        
        return {
          filePath,
          mediaInfo,
          thumbnailPath: thumb ? thumb.url : null,
          thumbnailTempPath: thumb ? thumb.tempPath : null,
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
        const thumb = await extractThumbnail(filePath, tempDir);
        
        return {
          filePath,
          mediaInfo,
          thumbnailPath: thumb ? thumb.url : null,
          thumbnailTempPath: thumb ? thumb.tempPath : null,
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
      const isWebm = plan.outputFormat === 'webm';
      // The container always follows the format picker: mp4/webm for video
      // (H.264/AV1 and VP9/AV1 respectively), gif/mp3 for their own formats.
      const ext = isGif ? '.gif' : isMp3 ? '.mp3' : isWebm ? '.webm' : '.mp4';
      // User-configurable filename template (Settings -> Filename Templates).
      // The plan carries codec/resolution/size, so all tokens are available
      // at naming time — even when the save dialog is bypassed by a default
      // export directory.
      const template = store.get('filenameTemplateTrim') || DEFAULT_TEMPLATE_TRIM;
      const vars = buildTemplateVars({
        name: parsedInput.name,
        codec: plan.codec,
        res: plan.width && plan.height ? `${plan.width}x${plan.height}` : null,
        sizeMB: plan.targetSizeMB != null ? plan.targetSizeMB : plan.estimatedSizeMB
      });
      const standardizedName = `${renderFilenameTemplate(template, vars)}${ext}`;
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
      const win = BrowserWindow.fromWebContents(event.sender);
      const throttledSend = createProgressThrottler((percent, status) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('export:progress', { percent, status });
        }
        updateTaskbarProgress(win, percent);
      });

      // Intermediate temp segments (multi-segment merged exports) must not
      // fire completion toasts — the final merged file is what matters.
      const isTempSegment = !!outputPath && path.basename(outputPath).startsWith('clipsend-seg-');

      if (plan.outputFormat === 'gif') {
        const result = await gifExporter.runEncode(plan, outputPath, throttledSend);
        finishExport(win, result, 'GIF', { notify: !isTempSegment });
        return result;
      } else {
        const result = await encoder.runEncode(plan, outputPath, throttledSend);
        finishExport(win, result, plan.outputFormat === 'mp3' ? 'MP3' : 'Trimmed clip', { notify: !isTempSegment });
        return result;
      }
    } catch (error) {
      if (isHardwareEncoderFailure(plan.encoder, error && error.ffmpegStderr)) {
        return { success: false, fallbackToCpu: true };
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      // The GIF exporter surfaces a user cancel by throwing 'Export cancelled
      // by user' (unlike the encoder, which returns a cancelled result).
      // Normalize it so a cancel clears the taskbar instead of painting the
      // red error state, and the renderer's graceful cancel path runs instead
      // of showing a failure alert.
      if (/cancell/i.test(String(error && error.message))) {
        clearTaskbarProgress(win);
        return { success: false, cancelled: true };
      }
      setTaskbarError(win);
      return { success: false, error: error.message, details: error.details };
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

  // The renderer passes the trim-mode source name so the trim filename
  // template applies to the merged multi-segment output too ({name} is the
  // source clip, not "Merged Video"), plus the picked format so the
  // extension matches (segments are pre-encoded in the final container).
  ipcMain.handle('merge:resolveDestination', async (event, vars = {}) => {
    const template = store.get('filenameTemplateTrim') || DEFAULT_TEMPLATE_TRIM;
    const base = renderFilenameTemplate(template, buildTemplateVars(vars));
    const fmt = vars.format === 'webm' ? 'webm' : vars.format === 'gif' ? 'gif' : vars.format === 'mp3' ? 'mp3' : 'mp4';
    const defaultName = `${base}.${fmt}`;
    const defaultExportDir = store.get('defaultExportDirectory');

    if (defaultExportDir && fs.existsSync(defaultExportDir)) {
      const targetPath = path.join(defaultExportDir, defaultName);
      return await getUniqueFilePath(targetPath);
    } else {
      return await showSaveDialog(defaultName);
    }
  });

  ipcMain.handle('merge:export', async (event, { filePaths, outputPath, trims, options = {} }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const sendMergeProgress = (percent, status) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('merge:progress', { percent, status });
      }
      updateTaskbarProgress(win, percent);
    };

    // Video codec: an explicit options.codec wins (the trim-mode multi-segment
    // path pre-encodes each segment in the final codec and only needs a pure
    // concat), otherwise the persisted setting applies. WebM cannot carry
    // H.264, so an H.264 request is remapped to VP9 for the final encode.
    const videoCodec = options.codec || store.get('videoCodec') || 'h264';

    // Shared export settings: format (mp4/webm/gif/mp3), non-native
    // resolution, and an explicit target size. The fast lossless merge path
    // is preserved unless one of these asks for a post-conversion. AV1 still
    // forces a post-conversion, but the container always follows the format
    // picker — AV1 muxes into MP4 (AAC) or WebM (Opus) as chosen.
    const postFormat = options.format === 'gif' || options.format === 'mp3' || options.format === 'webm'
      ? options.format
      : 'mp4';
    const postCodec = codecForFormat(postFormat, videoCodec);
    const wantsAv1 = postCodec === 'av1' && !options.skipConvert;
    const postResolution = options.resolution && options.resolution !== 'native' ? options.resolution : null;
    const postTargetSizeMB = options.targetSizeMB && options.targetSizeMB > 0 ? options.targetSizeMB : null;

    // Resolve the concrete encoders for the merge re-encode paths. The
    // intermediate merged MP4 always uses the H.264 family (fast, container-
    // consistent); the final container is produced by the post-convert step
    // with the codec-aware encoder (VP9 for WebM+H.264, AV1 when selected).
    const hwAccel = store.get('hwAccel') || 'auto';
    const caps = (await getEncoderCapabilities()) || {};
    const encoder = pickEncoder({ hwAccel, videoCodec: postCodec, encoders: caps });
    const mergeEncoder = pickEncoder({ hwAccel, videoCodec: 'h264', encoders: caps });
    const convertLabel = wantsAv1 ? `AV1 (${postFormat.toUpperCase()})` : postFormat.toUpperCase();

    const convertMerged = (enc) => merger.postConvertMerged(mergeOutputPath, {
      format: postFormat,
      resolution: postResolution,
      targetSizeMB: postTargetSizeMB,
      totalDurationSec: options.totalDurationSec || 0,
      codec: postCodec,
      encoder: enc,
      finalPath: outputPath,
      onProgress: (pct) => sendMergeProgress(Math.round(pct), `Converting to ${convertLabel}...`)
    });

    const applyPostConvert = async (result) => {
      if (result.success && (wantsAv1 || postFormat !== 'mp4' || postResolution || postTargetSizeMB)) {
        try {
          const converted = await convertMerged(encoder);
          result.filePath = converted.path;
          result.finalSizeMB = converted.sizeMB;
          result.strategy = `${result.strategy} + ${convertLabel} convert`;
        } catch (err) {
          // Cancelled mid-conversion: the merged file still exists, so surface
          // the merge as done rather than reporting a failure.
          if (/cancell/i.test(String(err.message))) return result;
          // The codec-aware encoder (e.g. av1_nvenc) is listed by every build
          // but can fail to initialize on GPUs that don't support it (pre-Ada
          // cards, older iGPUs). Fall back to the CPU encoder for this codec
          // — resolveCpuEncoder picks the one this FFmpeg actually ships
          // (libaom-av1 in the bundled build, or libsvtav1 if present).
          if (isHardwareEncoderFailure(encoder, err && err.ffmpegStderr)) {
            const converted = await convertMerged(resolveCpuEncoder(postCodec, caps));
            result.filePath = converted.path;
            result.finalSizeMB = converted.sizeMB;
            result.strategy = `${result.strategy} + ${convertLabel} convert (CPU)`;
            return result;
          }
          throw err;
        }
      }
      return result;
    };

    if (!outputPath) {
      const mergeTemplate = store.get('filenameTemplateMerge') || DEFAULT_TEMPLATE_MERGE;
      const mergeVars = buildTemplateVars({
        name: options.name || 'Merged Video',
        codec: postCodec,
        res: options.resolution && options.resolution !== 'native' ? options.resolution : null,
        sizeMB: options.targetSizeMB || null
      });
      const defaultName = `${renderFilenameTemplate(mergeTemplate, mergeVars)}.${postFormat}`;
      const defaultExportDir = store.get('defaultExportDirectory');
      if (defaultExportDir && fs.existsSync(defaultExportDir)) {
        const targetPath = path.join(defaultExportDir, defaultName);
        outputPath = await getUniqueFilePath(targetPath);
      } else {
        outputPath = await showSaveDialog(defaultName);
        if (!outputPath) return null; // Cancelled
      }
    }

    // When a post-conversion re-encodes into a non-MP4 container, the merge
    // itself must write an intermediate MP4 first: the concat output muxer is
    // chosen by the output extension, and the webm/gif/mp3 muxers reject
    // H.264/AAC streams (the merge always runs H.264 for speed). The
    // intermediate is converted to the final container below.
    const needsPostConvert = wantsAv1 || postFormat !== 'mp4' || postResolution || postTargetSizeMB;
    let mergeOutputPath = outputPath;
    let mergeTempFile = null;
    if (needsPostConvert && postFormat !== 'mp4') {
      mergeTempFile = path.join(os.tmpdir(), `clipsend-merge-${Date.now()}.mp4`);
      mergeOutputPath = mergeTempFile;
    }

    // On success postConvertMerged renames the intermediate into place; on
    // failure it may still exist, so drop it. One exception: a CANCEL mid-
    // conversion surfaces the merge as done with the intermediate as its
    // file — deleting it would leave the modal pointing at nothing, so keep
    // it under the destination name instead.
    const cleanupMergeTemp = (result) => {
      if (!mergeTempFile || !fs.existsSync(mergeTempFile)) return result;
      if (result && result.filePath === mergeTempFile) {
        try {
          fs.renameSync(mergeTempFile, outputPath);
          result.filePath = outputPath;
        } catch (e) { /* ignore */ }
      } else {
        try { fs.unlinkSync(mergeTempFile); } catch (e) { /* ignore */ }
      }
      return result;
    };

    try {
      const result = await merger.runMerge(filePaths, mergeOutputPath, sendMergeProgress, { encoder: mergeEncoder, trims, codec: 'h264' });
      const final = cleanupMergeTemp(await applyPostConvert(result));
      finishExport(win, final, 'Merged video');
      return final;
    } catch (error) {
      // If a hardware encoder failed during merge re-encode, retry with CPU
      if (isHardwareEncoderFailure(mergeEncoder, error && error.ffmpegStderr)) {
        try {
          const retryResult = await merger.runMerge(filePaths, mergeOutputPath, sendMergeProgress, { encoder: 'libx264', trims, codec: 'h264' });
          const retryFinal = cleanupMergeTemp(await applyPostConvert(retryResult));
          finishExport(win, retryFinal, 'Merged video');
          return retryFinal;
        } catch (retryError) {
          cleanupMergeTemp(null);
          setTaskbarError(win);
          return { success: false, error: retryError.message, details: retryError.details };
        }
      }
      cleanupMergeTemp(null);
      setTaskbarError(win);
      return { success: false, error: error.message, details: error.details };
    }
  });

  ipcMain.handle('merge:cancel', (event) => {
    merger.cancel();
    clearTaskbarProgress(BrowserWindow.fromWebContents(event.sender));
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
    console.log('[Encoder Detect] Probing bundled FFmpeg for hardware/AV1 encoders...');
    const caps = await getEncoderCapabilities();
    console.log('[Encoder Detect] Capabilities:', JSON.stringify(caps || {}));
    return caps || {
      nvenc: { h264: false, av1: false },
      qsv: { h264: false, av1: false },
      amf: { h264: false, av1: false },
      svtav1: false,
      libaom: false,
      libx264: false,
      vpx9: false,
      atempo: false
    };
  });

  ipcMain.handle('export:cancel', (event) => {
    encoder.cancel();
    gifExporter.cancel();
    clearTaskbarProgress(BrowserWindow.fromWebContents(event.sender));
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
  // Feedback is POSTed to a Cloudflare Worker proxy (serverless/feedback-
  // worker.js). The Discord webhook URL is a secret on the worker only — it
  // must never be baked into the installer. Replace the placeholder below
  // with the deployed worker URL (see serverless/README.md).
  const FEEDBACK_PROXY_URL = 'https://clipsend-feedback.ayinakidev.workers.dev';

  ipcMain.handle('submit-feedback', async (event, payload) => {
    try {
      if (FEEDBACK_PROXY_URL.includes('YOUR_WORKER_SUBDOMAIN')) {
        throw new Error('Feedback service is not configured yet.');
      }

      let { type, message, contact } = payload || {};

      if (!message || message.trim().length < 10) {
        throw new Error('Message too short — please add more detail.');
      }

      const response = await fetch(FEEDBACK_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: type || 'general',
          message: String(message).substring(0, 1000),
          contact: contact ? String(contact).substring(0, 100) : '',
          version: app.getVersion() || 'Unknown'
        })
      });

      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          detail = body.error || '';
        } catch (e) { /* non-JSON error body */ }
        throw new Error(detail || `Feedback service returned ${response.status}`);
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
