import { VideoPreview } from './video-preview.js';
import { ControlBar } from './control-bar.js';
import { Timeline } from './timeline.js';
import { MergePlayer } from './merge-player.js';
import CropManager from './crop-manager.js';
import { formatTimecode } from './utils/timecode.js';

document.addEventListener('DOMContentLoaded', () => {
  const openFileBtn = document.getElementById('open-file-btn');
  const initialState = document.getElementById('initial-state');
  const errorState = document.getElementById('error-state');
  const readyState = document.getElementById('ready-state');
  const probeDataDisplay = document.getElementById('probe-data');
  const errorMessageDisplay = document.getElementById('error-message');
  
  const appVersionSpan = document.getElementById('app-version');
  if (appVersionSpan && window.clipSend.getVersion) {
    window.clipSend.getVersion().then(version => {
      appVersionSpan.textContent = `v${version}`;
    });
  }
  
  const videoElement = document.getElementById('main-video');
  const controlBarElement = document.getElementById('control-bar');
  const timelineCanvas = document.getElementById('timeline-canvas');

  // Trim info display elements
  const trimInDisplay = document.getElementById('trim-in-display');
  const trimOutDisplay = document.getElementById('trim-out-display');
  const trimDurationDisplay = document.getElementById('trim-duration-display');
  const audioTrackSelect = document.getElementById('audio-track-select');

  let videoPreview = null;
  let controlBar = null;
  let timeline = null;
  let cropManager = new CropManager();
  let fps = 30;
  
  // App state to pass to export planner later
  const exportState = {
    selectedAudioTrackIndex: 0
  };

  function showState(stateElement) {
    [initialState, errorState, readyState].forEach(el => el.classList.remove('active'));
    stateElement.classList.add('active');
  }

  function populateAudioTracks(audioTracks) {
    audioTrackSelect.innerHTML = '';
    
    if (!audioTracks || audioTracks.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No audio tracks found';
      audioTrackSelect.appendChild(option);
      audioTrackSelect.disabled = true;
      return;
    }
    
    audioTrackSelect.disabled = false;
    
    audioTracks.forEach(track => {
      const option = document.createElement('option');
      // Use the audio ordinal to generate -map 0:a:<n> safely
      option.value = track.audioOrdinal;
      
      let label = `Track ${track.audioOrdinal + 1}: ${track.codec.toUpperCase()} (${track.channels}ch)`;
      if (track.language && track.language !== 'und') {
        label += ` [${track.language}]`;
      }
      if (track.title) {
        label += ` - ${track.title}`;
      }
      
      option.textContent = label;
      audioTrackSelect.appendChild(option);
    });
    
    // Default to first track
    exportState.selectedAudioTrackIndex = audioTracks[0].audioOrdinal;
    audioTrackSelect.value = exportState.selectedAudioTrackIndex;
  }
  
  let currentPreviewPath = null;

  async function loadPreviewRemux(inputPath, audioOrdinal) {
    if (!inputPath || audioOrdinal == null) return;
    
    const previewLoadingOverlay = document.getElementById('preview-loading-overlay');
    if (previewLoadingOverlay) previewLoadingOverlay.style.display = 'flex';
    
    // Save playback state
    const wasPlaying = videoPreview ? videoPreview.isPlaying() : false;
    const currentTime = videoElement.currentTime || 0;
    
    try {
      const result = await window.clipSend.generatePreviewRemux(inputPath, audioOrdinal);
      if (result.success) {
        const oldTempPath = currentPreviewPath;
        currentPreviewPath = result.tempPath;
        
        // Wait for loadedmetadata to restore state
        videoElement.addEventListener('loadedmetadata', () => {
          videoElement.currentTime = currentTime;
          if (wasPlaying) {
            videoPreview.play();
          } else if (currentTime > 0) {
            // Force a frame update when paused so the new source isn't blank
            videoPreview.pause();
          }
          if (previewLoadingOverlay) previewLoadingOverlay.style.display = 'none';
        }, { once: true });
        
        videoPreview.load(currentPreviewPath);
        
        if (oldTempPath) {
          window.clipSend.cleanupPreviewRemux(oldTempPath);
        }
      } else {
        console.error("Preview remux failed:", result.error);
        if (previewLoadingOverlay) previewLoadingOverlay.style.display = 'none';
      }
    } catch (err) {
      console.error("Preview remux error:", err);
      if (previewLoadingOverlay) previewLoadingOverlay.style.display = 'none';
    }
  }

  const waveformLoadingOverlay = document.getElementById('waveform-loading-overlay');

  async function loadWaveform(filePath, audioIndex) {
    if (!timeline) return;
    const showWaveformSetting = document.getElementById('setting-show-waveform');
    if (showWaveformSetting && !showWaveformSetting.checked) {
      timeline.setWaveformData(null);
      return;
    }
    if (waveformLoadingOverlay) waveformLoadingOverlay.style.display = 'flex';
    try {
      const data = await window.clipSend.getWaveformData(filePath, audioIndex);
      timeline.setWaveformData(data);
    } catch (err) {
      console.error('Waveform load error:', err);
      timeline.setWaveformData(null);
    } finally {
      if (waveformLoadingOverlay) waveformLoadingOverlay.style.display = 'none';
    }
  }

  audioTrackSelect.addEventListener('change', (e) => {
    exportState.selectedAudioTrackIndex = parseInt(e.target.value, 10);
    clearExportPlan();
    if (currentMediaInfo && currentMediaInfo.filePath) {
      loadPreviewRemux(currentMediaInfo.filePath, exportState.selectedAudioTrackIndex);
      loadWaveform(currentMediaInfo.filePath, exportState.selectedAudioTrackIndex);
    }
  });

  // --- Export Settings UI ---
  const presetSelect = document.getElementById('preset-select');
  const resolutionSelect = document.getElementById('resolution-select');
  const calculateBtn = document.getElementById('calculate-btn');
  const exportPlanDisplay = document.getElementById('export-plan-display');
  const planVbr = document.getElementById('plan-vbr');
  const planRes = document.getElementById('plan-res');
  const planSize = document.getElementById('plan-size');
  const exportBtn = document.getElementById('export-btn');
  const titlebarWarningBtn = document.getElementById('titlebar-warning-btn');
  const warningsModal = document.getElementById('warnings-modal');
  const closeWarningsBtn = document.getElementById('close-warnings-btn');
  const warningsModalContent = document.getElementById('warnings-modal-content');
  
  if (titlebarWarningBtn && warningsModal) {
    titlebarWarningBtn.addEventListener('click', () => {
      warningsModal.style.display = 'flex';
    });
  }
  if (closeWarningsBtn && warningsModal) {
    closeWarningsBtn.addEventListener('click', () => {
      warningsModal.style.display = 'none';
    });
  }
  if (warningsModal) {
    warningsModal.addEventListener('click', (e) => {
      if (e.target === warningsModal) warningsModal.style.display = 'none';
    });
  }
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const cancelBtn = document.getElementById('cancel-btn');

  let currentPlan = null;
  let currentMediaInfo = null;

  // Hardcode presets to match presets.js (normally we'd IPC this, but hardcoding for simplicity in UI)
  const presets = [
    { id: 'discord-free', label: '10 MB — Discord (Free)', sizeMB: 10, mode: 'size-limit' },
    { id: 'discord-nitro-basic', label: '50 MB — Discord (Nitro Basic)', sizeMB: 50, mode: 'size-limit' },
    { id: 'discord-nitro', label: '500 MB — Discord (Nitro)', sizeMB: 500, mode: 'size-limit' },
    { id: 'auto-crf', label: 'Auto (Best Quality)', mode: 'auto', crfValue: 19 }
  ];

  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    presetSelect.appendChild(opt);
  });
  
  // Set default to 10 MB Discord Free
  presetSelect.value = 'discord-free';

  function clearExportPlan() {
    currentPlan = null;
    exportPlanDisplay.style.display = 'none';
    showWarnings([]);
  }

  function populateResolutions(mediaInfo) {
    resolutionSelect.innerHTML = '';
    const nativeOpt = document.createElement('option');
    nativeOpt.value = 'native';
    nativeOpt.textContent = `Native (${mediaInfo.width}x${mediaInfo.height})`;
    resolutionSelect.appendChild(nativeOpt);

    const isPortrait = mediaInfo.height > mediaInfo.width;
    const shortEdge = Math.min(mediaInfo.width, mediaInfo.height);
    const longEdge = Math.max(mediaInfo.width, mediaInfo.height);
    
    const STANDARD_HEIGHTS = [
      { label: '1440p', size: 1440 },
      { label: '1080p', size: 1080 },
      { label: '720p', size: 720 },
      { label: '480p', size: 480 }
    ];

    STANDARD_HEIGHTS.forEach(preset => {
      if (preset.size < shortEdge) {
        const scale = preset.size / shortEdge;
        let newLong = Math.round(longEdge * scale);
        // Ensure even dimensions
        if (newLong % 2 !== 0) newLong -= 1;
        
        const w = isPortrait ? preset.size : newLong;
        const h = isPortrait ? newLong : preset.size;
        
        const opt = document.createElement('option');
        opt.value = `${w}x${h}`;
        opt.textContent = `${preset.label} (${w}x${h})`;
        resolutionSelect.appendChild(opt);
      }
    });

    resolutionSelect.value = 'native';
  }

  resolutionSelect.addEventListener('change', clearExportPlan);

  function showWarnings(warnings) {
    if (!warnings || warnings.length === 0) {
      if (titlebarWarningBtn) titlebarWarningBtn.style.display = 'none';
      if (warningsModalContent) warningsModalContent.innerHTML = '';
      return;
    }
    if (warningsModalContent) warningsModalContent.innerHTML = '';
    let renderedCount = 0;
    
    warnings.forEach(w => {
      // If any old string warnings somehow leak through, skip or convert them
      if (typeof w === 'string') {
        if (w.startsWith('Resolution: Native')) return;
        w = { id: 'legacy', title: 'Warning', body: w };
      }
      
      const div = document.createElement('div');
      div.className = 'warning-card';
      
      const iconSpan = document.createElement('span');
      iconSpan.className = 'warning-card-icon';
      iconSpan.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      `;
      
      const textDiv = document.createElement('div');
      textDiv.className = 'warning-card-text';
      
      const titleDiv = document.createElement('div');
      titleDiv.className = 'warning-card-title';
      titleDiv.textContent = w.title;
      
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'warning-card-body';
      bodyDiv.textContent = w.body;
      
      textDiv.appendChild(titleDiv);
      textDiv.appendChild(bodyDiv);
      
      div.appendChild(iconSpan);
      div.appendChild(textDiv);
      
      if (warningsModalContent) warningsModalContent.appendChild(div);
      renderedCount++;
    });
    
    if (titlebarWarningBtn) {
      titlebarWarningBtn.style.display = renderedCount > 0 ? 'inline-block' : 'none';
    }
  }

  const formatSelect = document.getElementById('format-select');
  if (formatSelect) {
    formatSelect.addEventListener('change', () => {
      clearExportPlan();
      const isGif = formatSelect.value === 'gif';
      const audioPanel = document.getElementById('audio-settings-panel');
      if (audioPanel) {
        if (isGif) {
          audioPanel.style.opacity = '0.5';
          audioPanel.style.pointerEvents = 'none';
        } else {
          audioPanel.style.opacity = '1';
          audioPanel.style.pointerEvents = 'auto';
        }
      }
    });
  }

  presetSelect.addEventListener('change', clearExportPlan);

  calculateBtn.addEventListener('click', async () => {
    if (!currentMediaInfo || !timeline) return;
    
    calculateBtn.disabled = true;
    calculateBtn.textContent = 'Calculating...';
    clearExportPlan();
    
    const presetId = presetSelect.value;
    const preset = presets.find(p => p.id === presetId);
    
    let manualResolution = null;
    if (resolutionSelect.value !== 'native') {
      const parts = resolutionSelect.value.split('x');
      manualResolution = {
        width: parseInt(parts[0], 10),
        height: parseInt(parts[1], 10)
      };
    }
    
    const settings = {
      mode: preset.mode || 'size-limit',
      targetSizeMB: preset.sizeMB,
      crfValue: preset.crfValue,
      selectedAudioTrackIndex: exportState.selectedAudioTrackIndex,
      hwAccel: document.getElementById('setting-hw-accel').value,
      hasNvenc: hasNvenc,
      manualResolution,
      disableAutoDownscale: document.getElementById('setting-disable-downscale').checked,
      crop: cropManager ? cropManager.getCropSettings() : { enable: false },
      outputFormat: document.getElementById('format-select') ? document.getElementById('format-select').value : 'mp4',
      maxQuality: await window.clipSend.getSetting('maxQuality')
    };

    try {
      const exportModeSelect = document.getElementById('export-mode-select');
      const exportMode = exportModeSelect ? exportModeSelect.value : 'separate';
      const segments = timeline.getSegments();
      
      let calcTrimIn = timeline.getTrimIn();
      let calcTrimOut = timeline.getTrimOut();
      
      if (segments.length > 1 && exportMode === 'merged') {
        calcTrimIn = 0;
        calcTrimOut = timeline.getTrimDuration();
      }

      const result = await window.clipSend.calculatePlan({
        mediaInfo: currentMediaInfo,
        trimIn: calcTrimIn,
        trimOut: calcTrimOut,
        settings
      });

      if (result.success) {
        currentPlan = result.plan;
        planRes.textContent = `${currentPlan.width}x${currentPlan.height}`;
        
        if (settings.mode === 'auto') {
          planVbr.textContent = `CRF ${currentPlan.crfValue}`;
          planSize.textContent = 'Variable (quality-based)';
        } else {
          planVbr.textContent = currentPlan.videoBitrateKbps + ' kbps';
          planSize.textContent = currentPlan.estimatedSizeMB + ' MB';
        }
        const allWarnings = [...(currentPlan.warnings || [])];
        if (currentMediaInfo.isVFR) {
          allWarnings.push({
            id: 'vfr',
            title: 'Variable Frame Rate detected',
            body: 'Source video has a Variable Frame Rate (VFR). Audio sync issues might occur in the exported clip.'
          });
        }
        if (settings.outputFormat === 'gif' && timeline.getTrimDuration() > 30 && settings.targetSizeMB <= 10) {
          allWarnings.push({
            id: 'gif_feasibility',
            title: 'GIF Feasibility Warning',
            body: `This clip may be too long (${Math.round(timeline.getTrimDuration())}s) to comfortably fit within ${settings.targetSizeMB}MB as a GIF. Consider trimming the clip shorter.`
          });
        }
        
        showWarnings(allWarnings);
        exportPlanDisplay.style.display = 'block';
      } else {
        showWarnings([{ id: 'error', title: 'Plan generation failed', body: result.error }]);
      }
    } catch (err) {
      showWarnings([{ id: 'error', title: 'Plan generation error', body: err.message }]);
    } finally {
      calculateBtn.disabled = false;
      calculateBtn.textContent = 'Calculate Plan';
    }
  });

  async function executeExportWithRetry(basePlan, fallback = false) {
    const exportModeSelect = document.getElementById('export-mode-select');
    const exportMode = exportModeSelect ? exportModeSelect.value : 'separate';
    const segments = timeline.getSegments().sort((a, b) => a.in - b.in);
    const isMulti = timeline.isMultiTrim && segments.length > 1;

    try {
      const hwAccel = fallback ? 'cpu' : (await window.clipSend.getSetting('hwAccel') || 'auto');
      const hasNvenc = !fallback && window.clipSend.getSetting('hasNvenc'); 
      const encoderName = basePlan.encoder || 'libx264';
      
      console.log('--- ENCODE START DIAGNOSTICS ---');
      console.log(`Hardware Acceleration Selected: ${hwAccel}`);
      console.log(`Encoder: ${encoderName}`);

      let mergedFinalDest = null;
      if (isMulti && exportMode === 'merged') {
        mergedFinalDest = await window.clipSend.resolveMergeDestination();
        if (!mergedFinalDest) {
          progressContainer.style.display = 'none';
          return;
        }
      }

      let generatedTempFiles = [];
      
      exportProgressState.isActive = true;
      exportProgressState.totalSegments = segments.length;
      exportProgressState.durations = segments.map(s => s.out - s.in);
      exportProgressState.totalDuration = exportProgressState.durations.reduce((sum, d) => sum + d, 0);
      exportProgressState.accumulatedDuration = 0;
      exportProgressState.segmentIndex = 0;

      let finalFilePath = null;
      let totalFinalSizeMB = 0;
      let finalWarnings = [];
      
      const doCleanup = async () => {
        if (generatedTempFiles.length > 0) {
          await window.clipSend.cleanupFiles(generatedTempFiles);
          generatedTempFiles = [];
        }
      };

      for (let i = 0; i < segments.length; i++) {
        exportProgressState.segmentIndex = i;
        const seg = segments[i];
        let segPlan = { ...basePlan, trimIn: seg.in, trimOut: seg.out, encoder: encoderName };
        
        if (isMulti) {
          const presetId = presetSelect.value;
          const preset = presets.find(p => p.id === presetId);
          
          let manualResolution = null;
          if (resolutionSelect && resolutionSelect.value !== 'native') {
            const parts = resolutionSelect.value.split('x');
            manualResolution = {
              width: parseInt(parts[0], 10),
              height: parseInt(parts[1], 10)
            };
          }
          
          let settings = {
            selectedAudioTrackIndex: exportState.selectedAudioTrackIndex,
            hwAccel: hwAccel,
            hasNvenc: encoderName === 'h264_nvenc',
            disableAutoDownscale: document.getElementById('setting-disable-downscale').checked,
            crop: cropManager ? cropManager.getCropSettings() : { enable: false },
            manualResolution: manualResolution,
            outputFormat: document.getElementById('format-select') ? document.getElementById('format-select').value : 'mp4',
            maxQuality: await window.clipSend.getSetting('maxQuality')
          };
          
          if (exportMode === 'separate') {
            settings.mode = preset.mode || 'size-limit';
            settings.targetSizeMB = preset.sizeMB;
            settings.crfValue = preset.crfValue;
          } else {
            // merged mode: force bitrate from the base plan
            if (basePlan.targetSizeMB === undefined) {
              settings.mode = 'auto';
              settings.crfValue = basePlan.crfValue;
            } else {
              settings.mode = 'custom';
              settings.customBitrateKbps = basePlan.videoBitrateKbps;
              settings.audioBitrateKbps = basePlan.audioBitrateKbps;
            }
          }
          
          console.log(`[Export] Calculating plan for segment ${i+1}/${segments.length}: in=${seg.in}, out=${seg.out}, mode=${settings.mode}`);
          
          const result = await window.clipSend.calculatePlan({
            mediaInfo: currentMediaInfo,
            trimIn: seg.in,
            trimOut: seg.out,
            settings
          });
          
          if (result.success) {
            segPlan = result.plan;
          } else {
            throw new Error(`Plan generation failed for segment ${i + 1}: ${result.error}`);
          }
        }
        
        let segOutputPath = null;
        if (isMulti && exportMode === 'merged') {
          const tempDir = await window.clipSend.getTempPath();
          segOutputPath = `${tempDir}\\clipsend-seg-${Date.now()}-${i}.mp4`;
          generatedTempFiles.push(segOutputPath);
        }

        const result = await window.clipSend.startExport({
          plan: segPlan,
          inputFilePath: currentMediaInfo.filePath,
          outputPath: segOutputPath
        });

        if (!result) {
          await doCleanup();
          progressContainer.style.display = 'none';
          exportProgressState.isActive = false;
          return;
        }

        if (result.cancelled) {
          await doCleanup();
          progressContainer.style.display = 'none';
          exportProgressState.isActive = false;
          return;
        } else if (result.fallbackToCpu) {
          await doCleanup();
          console.warn("NVENC failed to initialize, falling back to CPU encoding (libx264).");
          showWarnings(["NVENC failed to initialize. Retrying export with CPU encoding..."]);
          exportProgressState.isActive = false;
          await executeExportWithRetry(basePlan, true);
          return;
        } else if (!result.success) {
          await doCleanup();
          exportProgressState.isActive = false;
          throw new Error(result.error);
        }
        
        exportProgressState.accumulatedDuration += exportProgressState.durations[i];
        finalFilePath = result.filePath; 
        totalFinalSizeMB += parseFloat(result.finalSizeMB) || 0;
        if (result.warning) finalWarnings.push(result.warning);
      }
      
      exportProgressState.isActive = false;

      if (isMulti && exportMode === 'merged') {
        progressText.textContent = 'Merging...';
        
        // Ensure progress handles the merge phase? The merge API doesn't use the same progress emitter, 
        // but we can just let it sit at 100% or "Merging...".
        // Let's hook into onMergeProgress temporarily if needed, but it should be extremely fast if stream-copy.
        
        const mergeResult = await window.clipSend.startMerge(generatedTempFiles, mergedFinalDest);
        
        await doCleanup();
        
        if (!mergeResult) {
          progressContainer.style.display = 'none';
          return;
        }
        
        if (mergeResult.success) {
          showExportModal(mergeResult.filePath, mergeResult.finalSizeMB, finalWarnings.length > 0 ? finalWarnings : null, true);
        } else {
          throw new Error(mergeResult.error);
        }
      } else {
        // Single clip or Separate Clips
        // If Separate Clips, finalFilePath is just the LAST clip.
        // We can just show the modal for the directory or the last clip.
        showExportModal(finalFilePath, totalFinalSizeMB, finalWarnings.length > 0 ? finalWarnings : null, true);
      }
      
      progressContainer.style.display = 'none';

    } catch (err) {
      alert(`Export failed: ${err.message}`);
      progressContainer.style.display = 'none';
      exportProgressState.isActive = false;
    } finally {
      if (!fallback || (fallback && progressContainer.style.display === 'none')) {
        exportBtn.disabled = false;
        calculateBtn.disabled = false;
        presetSelect.disabled = false;
        if (typeof resolutionSelect !== 'undefined' && resolutionSelect) resolutionSelect.disabled = false;
      }
    }
  }

  const exportModal = document.getElementById('export-modal');
  const closeExportBtn = document.getElementById('close-export-btn');
  const exportOkBtn = document.getElementById('export-ok-btn');
  const exportOpenFolderBtn = document.getElementById('export-open-folder-btn');
  const exportCopyClipboardBtn = document.getElementById('export-copy-clipboard-btn');
  const exportSavedTo = document.getElementById('export-saved-to');
  const exportFinalSize = document.getElementById('export-final-size');

  let currentExportFilePath = null;

  function hideExportModal() {
    exportModal.style.display = 'none';
    currentExportFilePath = null;
  }

  if (closeExportBtn) closeExportBtn.addEventListener('click', hideExportModal);
  if (exportOkBtn) exportOkBtn.addEventListener('click', hideExportModal);
  if (exportModal) {
    exportModal.addEventListener('click', (e) => {
      if (e.target === exportModal) hideExportModal();
    });
  }

  if (exportOpenFolderBtn) {
    exportOpenFolderBtn.addEventListener('click', () => {
      if (currentExportFilePath) {
        window.clipSend.showItemInFolder(currentExportFilePath);
      }
    });
  }

  if (exportCopyClipboardBtn) {
    exportCopyClipboardBtn.addEventListener('click', async () => {
      if (!currentExportFilePath) return;
      
      exportCopyClipboardBtn.disabled = true;
      const originalText = exportCopyClipboardBtn.textContent;
      exportCopyClipboardBtn.textContent = 'Copying...';
      
      try {
        const result = await window.clipSend.copyFileToClipboard(currentExportFilePath);
        if (result.success) {
          exportCopyClipboardBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
          setTimeout(() => {
            exportCopyClipboardBtn.innerHTML = originalText;
            exportCopyClipboardBtn.disabled = false;
          }, 2000);
        } else {
          exportCopyClipboardBtn.textContent = 'Failed';
          setTimeout(() => {
            exportCopyClipboardBtn.textContent = originalText;
            exportCopyClipboardBtn.disabled = false;
          }, 2000);
          alert(`Copy failed: ${result.error}`);
        }
      } catch (err) {
        exportCopyClipboardBtn.textContent = 'Failed';
        setTimeout(() => {
          exportCopyClipboardBtn.textContent = originalText;
          exportCopyClipboardBtn.disabled = false;
        }, 2000);
        alert(`Copy failed: ${err.message}`);
      }
    });
  }

  function showExportModal(filePath, sizeMB, strategy = null, isTrimMode = false) {
    currentExportFilePath = filePath;
    if (exportSavedTo) exportSavedTo.textContent = `Saved to: ${filePath}`;
    if (exportFinalSize) exportFinalSize.textContent = `Final size: ${sizeMB} MB`;
    const strategyEl = document.getElementById('export-strategy');
    if (strategyEl) {
      if (strategy) {
        const text = strategy === 'concat_demuxer' ? 'Lossless fast merge' : 'Re-encoded (format mismatch)';
        strategyEl.textContent = `Strategy: ${text}`;
        strategyEl.style.display = 'block';
      } else {
        strategyEl.style.display = 'none';
      }
    }
    
    if (exportCopyClipboardBtn) {
      exportCopyClipboardBtn.style.display = isTrimMode ? 'block' : 'none';
    }

    if (exportModal) exportModal.style.display = 'flex';
  }

  exportBtn.addEventListener('click', async () => {
    if (!currentPlan) return;
    
    exportBtn.disabled = true;
    calculateBtn.disabled = true;
    presetSelect.disabled = true;
    if (typeof resolutionSelect !== 'undefined' && resolutionSelect) resolutionSelect.disabled = true;
    progressContainer.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    
    await executeExportWithRetry(currentPlan);
  });

  cancelBtn.addEventListener('click', () => {
    cancelBtn.disabled = true;
    window.clipSend.cancelExport();
  });

  let exportProgressState = {
    isActive: false,
    segmentIndex: 0,
    totalSegments: 1,
    durations: [],
    totalDuration: 0,
    accumulatedDuration: 0
  };

  window.clipSend.onExportProgress((data) => {
    let { percent, status } = data;
    
    if (exportProgressState.isActive && exportProgressState.totalSegments > 1) {
      const segDur = exportProgressState.durations[exportProgressState.segmentIndex];
      const percentOfTotal = (segDur / exportProgressState.totalDuration) * 100;
      const basePercent = (exportProgressState.accumulatedDuration / exportProgressState.totalDuration) * 100;
      percent = basePercent + (percent * (percentOfTotal / 100));
    }
    if (percent < 0) {
      progressFill.style.width = '100%';
      progressFill.style.opacity = '0.5';
      progressFill.style.animation = 'pulse 1.5s infinite';
      progressText.textContent = status || 'Processing...';
    } else {
      progressFill.style.opacity = '1';
      progressFill.style.animation = 'none';
      const rounded = Math.round(percent);
      progressFill.style.width = `${rounded}%`;
      progressText.textContent = status ? `${status} (${rounded}%)` : `${rounded}%`;
    }
    cancelBtn.disabled = false;
  });

  /** Update the trim info row beneath the timeline. */
  function updateTrimDisplay() {
    if (!timeline) return;
    trimInDisplay.textContent = formatTimecode(timeline.getTrimIn(), fps);
    trimOutDisplay.textContent = formatTimecode(timeline.getTrimOut(), fps);
    trimDurationDisplay.textContent = formatTimecode(timeline.getTrimDuration(), fps);
    
    const segments = timeline.getSegments();
    if (segments && segments.length > 1) {
      const multiExportModeContainer = document.getElementById('multi-export-mode-container');
      if (multiExportModeContainer) multiExportModeContainer.style.display = 'block';
    } else {
      const multiExportModeContainer = document.getElementById('multi-export-mode-container');
      if (multiExportModeContainer) multiExportModeContainer.style.display = 'none';
    }
    
    clearExportPlan(); // Plan is invalid if trim changes
  }

  const multiTrimEnable = document.getElementById('multi-trim-enable');
  if (multiTrimEnable) {
    multiTrimEnable.addEventListener('change', (e) => {
      if (timeline) {
        timeline.setMultiTrim(e.target.checked);
        updateTrimDisplay();
      }
    });
  }

  async function loadTrimFileFromResult(result) {
    if (!result) return;
    if (result.success) {
      currentMediaInfo = result.mediaInfo;
      fps = result.mediaInfo.frameRate || 30;
      
      populateAudioTracks(result.mediaInfo.audioTracks);
      populateResolutions(result.mediaInfo);
      
      presetSelect.value = 'discord-free';
      
      const multiTrimEnable = document.getElementById('multi-trim-enable');
      if (multiTrimEnable) {
        multiTrimEnable.checked = false;
        multiTrimEnable.disabled = false;
      }
      
      clearExportPlan();
      progressContainer.style.display = 'none';
      
      showState(readyState);

      if (!videoPreview) {
        videoPreview = new VideoPreview(
          videoElement,
          (time) => {
            if (controlBar) controlBar.updateTimecode(time);
            if (timeline) timeline.setPlayhead(time);
          }
        );
        
        videoPreview.onPlayStateChange((isPlaying) => {
          if (controlBar) controlBar.setPlayState(isPlaying);
        });
      }
      
      syncVolumeUI();
      
      if (!controlBar) {
        controlBar = new ControlBar(
          controlBarElement,
          fps,
          {
            onPlayToggle: () => videoPreview.togglePlay(),
            onSeek: (seconds) => {
              videoPreview.seekTo(seconds);
              if (timeline) timeline.setPlayhead(seconds);
            },
            onFrameStep: (frames) => videoPreview.frameStep(frames, fps),
            onJumpIn: () => {
              if (timeline) {
                const ti = timeline.getTrimIn();
                videoPreview.seekTo(ti);
                timeline.setPlayhead(ti);
                controlBar.updateTimecode(ti);
              }
            },
            onSetIn: () => {
              if (timeline) {
                timeline.setTrimIn(videoPreview.getCurrentTime());
                updateTrimDisplay();
              }
            },
            onStop: () => {
              videoPreview.pause();
            },
            onSetOut: () => {
              if (timeline) {
                timeline.setTrimOut(videoPreview.getCurrentTime());
                updateTrimDisplay();
              }
            },
            onJumpOut: () => {
              if (timeline) {
                const to = timeline.getTrimOut();
                videoPreview.seekTo(to);
                timeline.setPlayhead(to);
                controlBar.updateTimecode(to);
              }
            }
          }
        );
      } else {
        controlBar.fps = fps;
      }

      if (!timeline) {
        timeline = new Timeline(timelineCanvas, {
          onSeek: (seconds) => {
            videoPreview.pause();
            videoPreview.seekTo(seconds);
            controlBar.updateTimecode(seconds);
          },
          onSegmentChange: (segments, activeId) => {
            // Find active segment to update timecode to current edge if needed, but timeline handles that internally via onSeek.
            // We just need to update the trim display.
            updateTrimDisplay();
          }
        });
      }

      cropManager.reset(videoElement);

      loadPreviewRemux(result.mediaInfo.filePath, exportState.selectedAudioTrackIndex);
      loadWaveform(result.mediaInfo.filePath, exportState.selectedAudioTrackIndex);

      videoElement.addEventListener('loadedmetadata', () => {
        timeline.setDuration(videoElement.duration);
        updateTrimDisplay();
        if (cropManager) cropManager.onVideoLoaded();
      }, { once: true });

      controlBar.updateTimecode(0);
    } else {
      errorMessageDisplay.textContent = result.error;
      showState(errorState);
    }
  }

  openFileBtn.addEventListener('click', async () => {
    openFileBtn.disabled = true;
    openFileBtn.textContent = 'Probing...';
    
    try {
      const result = await window.clipSend.openFile();
      await loadTrimFileFromResult(result);
    } catch (err) {
      errorMessageDisplay.textContent = err.message;
      showState(errorState);
    } finally {
      openFileBtn.disabled = false;
      openFileBtn.textContent = 'Open File...';
    }
  });

  // --- Trim Drag and Drop ---
  const dropTrimStage = document.getElementById('trim-stage');
  const trimDropOverlay = document.getElementById('trim-drop-overlay');
  const dropModeTrimBtn = document.getElementById('mode-trim-btn');
  const ALLOWED_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi', 'webm'];

  dropTrimStage.addEventListener('dragenter', (e) => {
    if (!dropModeTrimBtn.classList.contains('active')) return;
    e.preventDefault();
    trimDropOverlay.style.display = 'flex';
  });

  dropTrimStage.addEventListener('dragover', (e) => {
    if (!dropModeTrimBtn.classList.contains('active')) return;
    e.preventDefault();
  });

  trimDropOverlay.addEventListener('dragleave', (e) => {
    e.preventDefault();
    trimDropOverlay.style.display = 'none';
  });

  dropTrimStage.addEventListener('drop', async (e) => {
    if (!dropModeTrimBtn.classList.contains('active')) return;
    e.preventDefault();
    trimDropOverlay.style.display = 'none';

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    let targetFile = null;
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        targetFile = file;
        break;
      }
    }

    if (!targetFile) {
      errorMessageDisplay.textContent = "Invalid file type. Please drop a valid video file (.mp4, .mkv, .mov, .avi, .webm).";
      showState(errorState);
      return;
    }

    if (files.length > 1) {
      console.log('Only the first file was loaded — Trim Mode supports one file at a time');
    }

    openFileBtn.disabled = true;
    openFileBtn.textContent = 'Probing...';
    
    try {
      const actualPath = window.clipSend.getPathForFile(targetFile);
      if (!actualPath) {
        throw new Error("Unable to resolve absolute file path from the dropped file. This may be due to Electron security restrictions.");
      }
      console.log("Resolved drop path:", actualPath);
      const result = await window.clipSend.openSpecificFile(actualPath);
      await loadTrimFileFromResult(result);
    } catch (err) {
      errorMessageDisplay.textContent = err.message;
      showState(errorState);
    } finally {
      openFileBtn.disabled = false;
      openFileBtn.textContent = 'Open File...';
    }
  });

  // --- Merge Drag and Drop ---
  const dropMergeStage = document.getElementById('merge-stage');
  const dropMergeSidebar = document.getElementById('merge-sidebar');
  const mergeDropOverlay = document.getElementById('merge-drop-overlay');
  const mergeSidebarDropOverlay = document.getElementById('merge-sidebar-drop-overlay');
  const dropModeMergeBtn = document.getElementById('mode-merge-btn');

  function showMergeDropOverlays() {
    if (mergeDropOverlay) mergeDropOverlay.style.display = 'flex';
    if (mergeSidebarDropOverlay) mergeSidebarDropOverlay.style.display = 'flex';
  }

  function hideMergeDropOverlays() {
    if (mergeDropOverlay) mergeDropOverlay.style.display = 'none';
    if (mergeSidebarDropOverlay) mergeSidebarDropOverlay.style.display = 'none';
  }

  function handleMergeDragEnter(e) {
    if (!dropModeMergeBtn.classList.contains('active')) return;
    e.preventDefault();
    showMergeDropOverlays();
  }

  function handleMergeDragOver(e) {
    if (!dropModeMergeBtn.classList.contains('active')) return;
    e.preventDefault();
  }

  function handleMergeDragLeave(e) {
    e.preventDefault();
    // We only hide if we're actually leaving the container boundaries, but
    // since we overlay both, hiding it here is safe.
    hideMergeDropOverlays();
  }

  async function handleMergeDrop(e) {
    if (!dropModeMergeBtn.classList.contains('active')) return;
    e.preventDefault();
    hideMergeDropOverlays();

    // Check if export is in progress by checking if addClipsBtn is disabled
    const addClipsBtn = document.getElementById('add-clips-btn');
    if (addClipsBtn && addClipsBtn.disabled && addClipsBtn.textContent !== 'Add Clips...') {
      console.log('Cannot add clips during export or probing');
      return;
    }

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const validPaths = [];
    let skippedCount = 0;

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        const actualPath = window.clipSend.getPathForFile(file);
        if (actualPath) {
          validPaths.push(actualPath);
        } else {
          skippedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      console.log(`${skippedCount} file(s) skipped — unsupported format or unresolvable path`);
    }

    if (validPaths.length === 0) {
      return; // No valid files dropped
    }

    if (addClipsBtn) {
      addClipsBtn.disabled = true;
      addClipsBtn.textContent = 'Probing...';
    }

    try {
      const result = await window.clipSend.openSpecificMultipleFiles(validPaths);
      if (result && result.success) {
        mergeClips.push(...result.clips);
        updateMergeUI();
      } else if (result && result.error) {
        alert('Error adding clips: ' + result.error);
      }
    } catch (err) {
      alert('Failed to add clips: ' + err.message);
    } finally {
      if (addClipsBtn) {
        addClipsBtn.disabled = false;
        addClipsBtn.textContent = 'Add Clips...';
      }
    }
  }

  [dropMergeStage, dropMergeSidebar].forEach(el => {
    if (el) {
      el.addEventListener('dragenter', handleMergeDragEnter);
      el.addEventListener('dragover', handleMergeDragOver);
      el.addEventListener('drop', handleMergeDrop);
    }
  });

  [mergeDropOverlay, mergeSidebarDropOverlay].forEach(el => {
    if (el) {
      el.addEventListener('dragleave', handleMergeDragLeave);
    }
  });


  // --- Window Controls ---
  document.getElementById('win-min')?.addEventListener('click', () => window.clipSend.minimizeWindow());
  document.getElementById('win-close')?.addEventListener('click', () => window.clipSend.closeWindow());

  // --- Settings Modal ---
  const settingsModal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const settingExportDir = document.getElementById('setting-export-dir');
  const browseExportDirBtn = document.getElementById('browse-export-dir-btn');
  const clearExportDirBtn = document.getElementById('clear-export-dir-btn');
  const settingHwAccel = document.getElementById('setting-hw-accel');
  const settingDisableDownscale = document.getElementById('setting-disable-downscale');
  const settingShowWaveform = document.getElementById('setting-show-waveform');
  const settingMaxQuality = document.getElementById('setting-max-quality');

  // Volume UI elements
  const volumeSlider = document.getElementById('volume-slider');
  const muteBtn = document.getElementById('mute-btn');
  const mergeVolumeSlider = document.getElementById('merge-volume-slider');
  const mergeMuteBtn = document.getElementById('merge-mute-btn');
  
  let storedVolume = 0.6;
  let isMutedState = false;
  let hasNvenc = false;

  function syncVolumeUI() {
    const effectiveVolume = isMutedState ? 0 : storedVolume;
    if (volumeSlider) volumeSlider.value = effectiveVolume;
    if (mergeVolumeSlider) mergeVolumeSlider.value = effectiveVolume;
    
    if (videoPreview) {
      videoPreview.setVolume(effectiveVolume);
      videoPreview.setMuted(false); 
    }
    // mergePlayer is declared at the top of app.js
    if (mergePlayer) {
      mergePlayer.setVolume(effectiveVolume);
      mergePlayer.setMuted(false);
    }
    
    const icon = (effectiveVolume === 0) ? '&#xE74F;' : '&#xE767;';
    if (muteBtn) muteBtn.innerHTML = icon;
    if (mergeMuteBtn) mergeMuteBtn.innerHTML = icon;
  }

  const handleVolumeInput = (e) => {
    const val = parseFloat(e.target.value);
    if (isMutedState) {
      isMutedState = false;
      window.clipSend.setSetting('playbackMuted', false);
    }
    storedVolume = val;
    syncVolumeUI();
  };

  volumeSlider?.addEventListener('input', handleVolumeInput);
  mergeVolumeSlider?.addEventListener('input', handleVolumeInput);

  const handleVolumeChange = () => {
    window.clipSend.setSetting('playbackVolume', storedVolume);
  };

  volumeSlider?.addEventListener('change', handleVolumeChange);
  mergeVolumeSlider?.addEventListener('change', handleVolumeChange);

  const handleMuteClick = () => {
    isMutedState = !isMutedState;
    // If they mute while slider is 0, storedVolume is 0. If they unmute, it restores to 0.
    window.clipSend.setSetting('playbackMuted', isMutedState);
    syncVolumeUI();
  };

  muteBtn?.addEventListener('click', handleMuteClick);
  mergeMuteBtn?.addEventListener('click', handleMuteClick);

  async function loadSettings() {
    const allSettings = await window.clipSend.getAllSettings();
    if (allSettings) {
      settingExportDir.value = allSettings.defaultExportDirectory || '';
      settingHwAccel.value = allSettings.hwAccel || 'auto';
      settingDisableDownscale.checked = allSettings.disableAutoDownscale === true;
      if (allSettings.showWaveform !== undefined) {
        if (settingShowWaveform) settingShowWaveform.checked = allSettings.showWaveform;
        if (timeline) timeline.setShowWaveform(allSettings.showWaveform);
      }
      if (allSettings.maxQuality !== undefined) {
        if (settingMaxQuality) settingMaxQuality.checked = allSettings.maxQuality;
      }
      
      if (allSettings.playbackVolume !== undefined) {
        storedVolume = Math.max(0, Math.min(1, Number(allSettings.playbackVolume)));
      }
      if (allSettings.playbackMuted !== undefined) {
        isMutedState = Boolean(allSettings.playbackMuted);
      }
    }
    syncVolumeUI();

    // Detect NVENC
    hasNvenc = await window.clipSend.detectEncoders();
    const nvencOption = document.querySelector('#setting-hw-accel option[value="nvenc"]');
    if (nvencOption && !hasNvenc) {
      nvencOption.disabled = true;
      nvencOption.textContent = 'NVIDIA (NVENC) - Not Detected';
      if (settingHwAccel.value === 'nvenc') {
        settingHwAccel.value = 'auto';
        window.clipSend.setSetting('hwAccel', 'auto');
      }
    }
  }
  loadSettings();

  settingsBtn?.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
  });

  closeSettingsBtn?.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  browseExportDirBtn?.addEventListener('click', async () => {
    const dir = await window.clipSend.pickDirectory();
    if (dir) {
      settingExportDir.value = dir;
      window.clipSend.setSetting('defaultExportDirectory', dir);
    }
  });

  clearExportDirBtn?.addEventListener('click', () => {
    settingExportDir.value = '';
    window.clipSend.setSetting('defaultExportDirectory', '');
  });

  settingHwAccel?.addEventListener('change', (e) => {
    window.clipSend.setSetting('hwAccel', e.target.value);
    clearExportPlan();
  });

  settingMaxQuality?.addEventListener('change', (e) => {
    window.clipSend.setSetting('maxQuality', e.target.checked);
    clearExportPlan();
  });

  settingDisableDownscale?.addEventListener('change', (e) => {
    window.clipSend.setSetting('disableAutoDownscale', e.target.checked);
    clearExportPlan();
  });

  settingShowWaveform?.addEventListener('change', (e) => {
    window.clipSend.setSetting('showWaveform', e.target.checked);
    if (timeline) {
      timeline.setShowWaveform(e.target.checked);
      if (e.target.checked && currentMediaInfo && currentMediaInfo.filePath && !timeline.waveformPeaks) {
        loadWaveform(currentMediaInfo.filePath, exportState.selectedAudioTrackIndex);
      }
    }
  });

  // --- Feedback ---
  const feedbackBtn = document.getElementById('feedback-btn');
  const feedbackModal = document.getElementById('feedback-modal');
  const closeFeedbackBtn = document.getElementById('close-feedback-btn');
  const cancelFeedbackBtn = document.getElementById('cancel-feedback-btn');
  const sendFeedbackBtn = document.getElementById('send-feedback-btn');
  const feedbackType = document.getElementById('feedback-type');
  const feedbackMessage = document.getElementById('feedback-message');
  const feedbackContact = document.getElementById('feedback-contact');
  const feedbackCharCount = document.getElementById('feedback-char-count');
  const feedbackStatus = document.getElementById('feedback-status');
  
  let lastFeedbackTime = 0;

  function closeFeedbackModal() {
    feedbackModal.style.display = 'none';
    feedbackStatus.textContent = '';
    feedbackMessage.value = '';
    feedbackContact.value = '';
    updateFeedbackUI();
  }

  function updateFeedbackUI() {
    const rawLen = feedbackMessage.value.length;
    const trimmedLen = feedbackMessage.value.trim().length;
    
    if (rawLen > 0 && trimmedLen < 10) {
      feedbackCharCount.textContent = `${rawLen} / 1000 (min 10)`;
      feedbackCharCount.style.color = 'var(--error-color)';
    } else {
      feedbackCharCount.textContent = `${rawLen} / 1000`;
      feedbackCharCount.style.color = 'rgba(255, 255, 255, 0.3)';
    }

    if (trimmedLen < 10 || rawLen > 1000) {
      sendFeedbackBtn.disabled = true;
    } else {
      sendFeedbackBtn.disabled = false;
    }
  }

  feedbackBtn?.addEventListener('click', () => {
    feedbackModal.style.display = 'flex';
    updateFeedbackUI();
  });

  closeFeedbackBtn?.addEventListener('click', closeFeedbackModal);
  cancelFeedbackBtn?.addEventListener('click', closeFeedbackModal);

  feedbackMessage?.addEventListener('input', updateFeedbackUI);

  sendFeedbackBtn?.addEventListener('click', async () => {
    const now = Date.now();
    if (now - lastFeedbackTime < 15000) {
      feedbackStatus.style.color = 'var(--error-color)';
      feedbackStatus.textContent = 'Please wait before sending more feedback.';
      return;
    }

    sendFeedbackBtn.disabled = true;
    feedbackStatus.style.color = 'var(--text-primary)';
    feedbackStatus.textContent = 'Sending...';

    const payload = {
      type: feedbackType.value,
      message: feedbackMessage.value,
      contact: feedbackContact.value
    };

    try {
      const result = await window.clipSend.submitFeedback(payload);
      if (result.success) {
        lastFeedbackTime = Date.now();
        feedbackStatus.style.color = 'var(--accent-color)';
        feedbackStatus.textContent = '✓ Thanks for your feedback!';
        setTimeout(() => {
          closeFeedbackModal();
        }, 1500);
      } else {
        sendFeedbackBtn.disabled = false;
        feedbackStatus.style.color = 'var(--error-color)';
        feedbackStatus.textContent = `Error: ${result.error}`;
      }
    } catch (err) {
      sendFeedbackBtn.disabled = false;
      feedbackStatus.style.color = 'var(--error-color)';
      feedbackStatus.textContent = `Error: ${err.message}`;
    }
  });

  feedbackModal?.addEventListener('click', (e) => {
    if (e.target === feedbackModal) closeFeedbackModal();
  });

  // --- Changelog ---
  const changelogBtn = document.getElementById('changelog-btn');
  const changelogModal = document.getElementById('changelog-modal');
  const closeChangelogBtn = document.getElementById('close-changelog-btn');
  const changelogContent = document.getElementById('changelog-content');

  function renderChangelog() {
    if (!window.changelogData) return;
    
    changelogContent.innerHTML = '';
    const timeline = document.createElement('div');
    timeline.className = 'timeline';

    window.changelogData.forEach(entry => {
      const entryDiv = document.createElement('div');
      entryDiv.className = 'timeline-entry';
      
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';
      
      const header = document.createElement('div');
      header.className = 'timeline-header';
      
      const version = document.createElement('div');
      version.className = 'timeline-version';
      version.textContent = entry.version;
      
      const date = document.createElement('div');
      date.className = 'timeline-date';
      date.textContent = entry.date;
      
      header.appendChild(version);
      header.appendChild(date);
      
      const changesList = document.createElement('ul');
      changesList.className = 'timeline-changes';
      
      entry.changes.forEach(change => {
        const li = document.createElement('li');
        li.textContent = change;
        changesList.appendChild(li);
      });
      
      entryDiv.appendChild(marker);
      entryDiv.appendChild(header);
      entryDiv.appendChild(changesList);
      timeline.appendChild(entryDiv);
    });
    
    changelogContent.appendChild(timeline);
  }

  function closeChangelogModal() {
    changelogModal.style.display = 'none';
  }

  changelogBtn?.addEventListener('click', () => {
    if (!changelogContent.querySelector('.timeline')) {
      renderChangelog();
    }
    changelogModal.style.display = 'flex';
  });

  closeChangelogBtn?.addEventListener('click', closeChangelogModal);

  changelogModal?.addEventListener('click', (e) => {
    if (e.target === changelogModal) closeChangelogModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (changelogModal && changelogModal.style.display === 'flex') {
        closeChangelogModal();
      }
      if (feedbackModal && feedbackModal.style.display === 'flex') {
        closeFeedbackModal();
      }
      const exportModal = document.getElementById('export-modal');
      if (exportModal && exportModal.style.display === 'flex') {
        exportModal.style.display = 'none';
      }
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal && settingsModal.style.display === 'flex') {
        settingsModal.style.display = 'none';
      }
    }
  });

  // --- Mode Toggle (Trim / Merge) ---
  const modeTrimBtn = document.getElementById('mode-trim-btn');
  const modeMergeBtn = document.getElementById('mode-merge-btn');
  const trimSidebar = document.getElementById('trim-sidebar');
  const mergeSidebar = document.getElementById('merge-sidebar');
  const trimStage = document.getElementById('trim-stage');
  const mergeStage = document.getElementById('merge-stage');

  modeTrimBtn?.addEventListener('click', () => {
    modeTrimBtn.classList.add('active');
    modeMergeBtn.classList.remove('active');
    trimSidebar.style.display = 'block';
    mergeSidebar.style.display = 'none';
    trimStage.style.display = 'flex';
    mergeStage.style.display = 'none';
    // Force resize to ensure timeline canvas renders correctly now that it's visible
    window.dispatchEvent(new Event('resize'));
  });

  modeMergeBtn?.addEventListener('click', () => {
    modeMergeBtn.classList.add('active');
    modeTrimBtn.classList.remove('active');
    mergeSidebar.style.display = 'flex';
    mergeSidebar.style.flexDirection = 'column';
    mergeSidebar.style.flex = '1';
    trimSidebar.style.display = 'none';
    mergeStage.style.display = 'flex';
    trimStage.style.display = 'none';
    // Force resize to ensure scrubber canvas renders correctly now that it's visible
    window.dispatchEvent(new Event('resize'));
  });

  // --- Merge Mode Logic ---
  let mergeClips = [];
  const mergeClipList = document.getElementById('merge-clip-list');
  const mergeTimelineStrip = document.getElementById('merge-timeline-strip');
  const mergeTotalDuration = document.getElementById('merge-total-duration');
  const exportMergedBtn = document.getElementById('export-merged-btn');
  const mergeEmptyStage = document.getElementById('merge-empty-stage');
  const mergeVideoEl = document.getElementById('merge-video');
  const mergePlayBtn = document.getElementById('merge-play-btn');
  const mergeClipIndicator = document.getElementById('merge-clip-indicator');
  let currentMergeMode = false; // tracks which mode is active for keyboard shortcuts

  // Instantiate MergePlayer
  const mergePlayer = new MergePlayer({
    videoElement: document.getElementById('merge-video'),
    preloadElement: document.getElementById('merge-preload-video'),
    scrubberCanvas: document.getElementById('merge-scrubber-canvas'),
    timecodeDisplay: document.getElementById('merge-timecode'),
    onPlayStateChange: (isPlaying) => {
      if (mergePlayBtn) {
        mergePlayBtn.innerHTML = isPlaying ? '&#xE769;' : '&#xE768;';
        mergePlayBtn.title = isPlaying ? 'Pause' : 'Play';
      }
      // Update clip indicator
      if (mergeClipIndicator && mergeClips.length > 0) {
        mergeClipIndicator.textContent = `Clip ${mergePlayer.currentClipIndex + 1} / ${mergeClips.length}`;
      }
    },
    onClipChange: (index) => {
      if (mergeTimelineStrip) {
        const blocks = mergeTimelineStrip.querySelectorAll('.merge-timeline-block');
        blocks.forEach((block, i) => {
          if (i === index) block.classList.add('active-clip');
          else block.classList.remove('active-clip');
        });
      }
      if (mergeClipIndicator && mergeClips.length > 0) {
        mergeClipIndicator.textContent = `Clip ${index + 1} / ${mergeClips.length}`;
      }
    }
  });

  mergePlayBtn?.addEventListener('click', () => mergePlayer.togglePlay());

  // Track mode for keyboard shortcuts
  modeTrimBtn?.addEventListener('click', () => { currentMergeMode = false; });
  modeMergeBtn?.addEventListener('click', () => { currentMergeMode = true; });

  function updateMergeUI() {
    // 0. Toggle empty state vs video visibility
    if (mergeEmptyStage && mergeVideoEl) {
      if (mergeClips.length === 0) {
        mergeEmptyStage.style.display = 'flex';
        mergeVideoEl.style.display = 'none';
      } else {
        mergeEmptyStage.style.display = 'none';
        mergeVideoEl.style.display = 'block';
      }
    }

    // 1. Clip List
    if (!mergeClipList) return;
    mergeClipList.innerHTML = '';
    
    if (mergeClips.length === 0) {
      mergeClipList.innerHTML = `
        <div id="merge-empty-list" class="drop-zone-hint" style="display: flex; justify-content: center; align-items: center; height: 100%; flex-direction: column; text-align: center;">
          <span class="icon" style="font-family: 'Segoe MDL2 Assets', sans-serif; font-size: 24px; margin-bottom: 8px; color: var(--text-secondary);">&#xE8E5;</span>
          <span style="color: var(--text-secondary); font-size: 13px;">Drag & drop clips here<br>or click Add Clips</span>
        </div>`;
    } else {
      mergeClips.forEach((clip, index) => {
        const item = document.createElement('div');
        item.className = 'merge-clip-item';
        
        const img = document.createElement('img');
        if (clip.thumbnailPath) img.src = clip.thumbnailPath;
        
        const info = document.createElement('div');
        info.className = 'merge-clip-info';
        
        const title = document.createElement('div');
        title.className = 'merge-clip-filename';
        const parsedPath = clip.filePath.split('\\').pop().split('/').pop();
        title.textContent = parsedPath;
        title.title = parsedPath;
        
        const meta = document.createElement('div');
        meta.className = 'merge-clip-meta';
        
        const min = Math.floor(clip.mediaInfo.duration / 60).toString().padStart(2, '0');
        const sec = Math.floor(clip.mediaInfo.duration % 60).toString().padStart(2, '0');
        const durStr = `${min}:${sec}`;
        
        meta.textContent = `${durStr} • ${clip.mediaInfo.width}x${clip.mediaInfo.height}`;
        
        info.appendChild(title);
        info.appendChild(meta);
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'merge-clip-remove';
        removeBtn.innerHTML = '&#xE8BB;';
        removeBtn.title = 'Remove';
        removeBtn.onclick = () => {
          mergePlayer.removeClipAtIndex(index);
          mergeClips.splice(index, 1);
          updateMergeUI();
        };
        
        item.appendChild(img);
        item.appendChild(info);
        item.appendChild(removeBtn);
        mergeClipList.appendChild(item);
      });
    }

    // 2. Timeline Strip
    if (!mergeTimelineStrip) return;
    mergeTimelineStrip.innerHTML = '';
    let totalDur = 0;
    mergeClips.forEach(c => totalDur += c.mediaInfo.duration);
    
    if (mergeClips.length === 0) {
      mergeTimelineStrip.innerHTML = `
        <div id="merge-empty-timeline" style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; border: 2px dashed var(--panel-border); border-radius: 6px;">
          <span style="color: var(--text-secondary);">Timeline will appear here</span>
        </div>`;
      if (mergeTotalDuration) mergeTotalDuration.textContent = `Total: 00:00`;
    } else {
      const totalH = Math.floor(totalDur / 3600);
      const totalM = Math.floor((totalDur % 3600) / 60).toString().padStart(2, '0');
      const totalS = Math.floor(totalDur % 60).toString().padStart(2, '0');
      const totalDurStr = totalH > 0 ? `${totalH}:${totalM}:${totalS}` : `${totalM}:${totalS}`;
      
      if (mergeTotalDuration) mergeTotalDuration.textContent = `Total: ${totalDurStr}`;
      
      mergeClips.forEach((clip, index) => {
        const block = document.createElement('div');
        block.className = 'merge-timeline-block';
        if (index === mergePlayer.currentClipIndex) {
          block.classList.add('active-clip');
        }
        if (clip.thumbnailPath) {
          block.style.backgroundImage = `url("${clip.thumbnailPath}")`;
        }
        
        const flexRatio = clip.mediaInfo.duration;
        block.style.flexGrow = flexRatio;
        block.style.flexBasis = '0';
        block.style.minWidth = '60px';
        block.style.flexShrink = '0';
        
        const durLabel = document.createElement('div');
        durLabel.className = 'merge-timeline-duration';
        
        const minTl = Math.floor(clip.mediaInfo.duration / 60).toString().padStart(2, '0');
        const secTl = Math.floor(clip.mediaInfo.duration % 60).toString().padStart(2, '0');
        durLabel.textContent = `${minTl}:${secTl}`;
        
        block.appendChild(durLabel);
        
        // Drag and Drop
        block.draggable = true;
        block.dataset.index = index;
        
        block.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', index);
          e.dataTransfer.effectAllowed = 'move';
        });
        
        block.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = block.getBoundingClientRect();
          const mid = rect.left + rect.width / 2;
          if (e.clientX < mid) {
            block.classList.add('drag-over-left');
            block.classList.remove('drag-over-right');
          } else {
            block.classList.add('drag-over-right');
            block.classList.remove('drag-over-left');
          }
        });
        
        block.addEventListener('dragleave', () => {
          block.classList.remove('drag-over-left', 'drag-over-right');
        });
        
        block.addEventListener('drop', (e) => {
          e.preventDefault();
          block.classList.remove('drag-over-left', 'drag-over-right');
          const draggedIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (isNaN(draggedIdx) || draggedIdx === index) return;
          
          const rect = block.getBoundingClientRect();
          const mid = rect.left + rect.width / 2;
          let targetIdx = index;
          if (e.clientX > mid) targetIdx++;
          
          if (draggedIdx < targetIdx) targetIdx--;
          
          const [movedItem] = mergeClips.splice(draggedIdx, 1);
          mergeClips.splice(targetIdx, 0, movedItem);
          
          updateMergeUI();
        });
        
        mergeTimelineStrip.appendChild(block);
      });
    }

    // 3. Export button state
    if (exportMergedBtn) exportMergedBtn.disabled = mergeClips.length < 2;

    // 4. Clip indicator
    if (mergeClipIndicator) {
      mergeClipIndicator.textContent = mergeClips.length > 0
        ? `Clip ${mergePlayer.currentClipIndex + 1} / ${mergeClips.length}`
        : '';
    }

    // 5. Sync player with current clip list
    mergePlayer.setClips(mergeClips);
  }

  const addClipsBtn = document.getElementById('add-clips-btn');
  addClipsBtn?.addEventListener('click', async () => {
    addClipsBtn.disabled = true;
    addClipsBtn.textContent = 'Probing...';
    try {
      const result = await window.clipSend.openMultipleFiles();
      if (result && result.success) {
        mergeClips.push(...result.clips);
        updateMergeUI();
      } else if (result && result.error) {
        alert('Error adding clips: ' + result.error);
      }
    } catch (e) {
      alert('Failed to add clips: ' + e.message);
    } finally {
      addClipsBtn.disabled = false;
      addClipsBtn.textContent = 'Add Clips...';
    }
  });

  // Merge mode export logic
  const mergeWarningsContainer = document.getElementById('merge-warnings');
  const mergeProgressContainer = document.getElementById('merge-progress-container');
  const mergeProgressFill = document.getElementById('merge-progress-fill');
  const mergeProgressText = document.getElementById('merge-progress-text');
  const mergeCancelBtn = document.getElementById('merge-cancel-btn');

  function showMergeWarnings(warnings) {
    if (!mergeWarningsContainer) return;
    if (!warnings || warnings.length === 0) {
      mergeWarningsContainer.style.display = 'none';
      return;
    }
    mergeWarningsContainer.innerHTML = '';
    warnings.forEach(w => {
      const div = document.createElement('div');
      div.className = 'warning-card';
      
      const iconSpan = document.createElement('span');
      iconSpan.className = 'warning-card-icon';
      iconSpan.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      `;
      
      const textDiv = document.createElement('div');
      textDiv.className = 'warning-card-text';
      
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'warning-card-body';
      bodyDiv.textContent = w;
      
      textDiv.appendChild(bodyDiv);
      
      div.appendChild(iconSpan);
      div.appendChild(textDiv);
      
      mergeWarningsContainer.appendChild(div);
    });
    mergeWarningsContainer.style.display = 'block';
  }

  exportMergedBtn?.addEventListener('click', async () => {
    if (mergeClips.length < 2) return;

    exportMergedBtn.disabled = true;
    addClipsBtn.disabled = true;
    showMergeWarnings([]);

    try {
      const filePaths = mergeClips.map(c => c.filePath);
      
      // 1. Pre-export compatibility check
      const compatCheck = await window.clipSend.checkMergeCompat(filePaths);
      if (compatCheck && compatCheck.success) {
        if (!compatCheck.compatible) {
          showMergeWarnings([`Clips have different formats — merge will re-encode (slower). Reason: ${compatCheck.reason}`]);
        }
      } else if (compatCheck && !compatCheck.success) {
        alert(`Failed to check compatibility: ${compatCheck.error}`);
        exportMergedBtn.disabled = false;
        addClipsBtn.disabled = false;
        return;
      }

      // 2. Start Export
      mergeProgressContainer.style.display = 'flex';
      mergeProgressFill.style.width = '0%';
      mergeProgressText.textContent = '0%';
      mergeCancelBtn.disabled = false;

      const result = await window.clipSend.startMerge(filePaths);
      
      if (!result) {
        // Cancelled via save dialog
        mergeProgressContainer.style.display = 'none';
        exportMergedBtn.disabled = false;
        addClipsBtn.disabled = false;
        return;
      }

      if (result.success) {
        showExportModal(result.filePath, result.finalSizeMB, result.strategy, false);
      } else if (result.cancelled) {
        // Suppress
      } else {
        alert(`Merge failed: ${result.error}`);
      }

    } catch (e) {
      alert(`Merge failed: ${e.message}`);
    } finally {
      mergeProgressContainer.style.display = 'none';
      // Enable buttons again
      exportMergedBtn.disabled = mergeClips.length < 2;
      addClipsBtn.disabled = false;
    }
  });

  mergeCancelBtn?.addEventListener('click', () => {
    mergeCancelBtn.disabled = true;
    window.clipSend.cancelMerge();
  });

  window.clipSend.onMergeProgress((data) => {
    const { percent, status } = data;
    const rounded = Math.round(percent);
    if (mergeProgressFill) mergeProgressFill.style.width = `${rounded}%`;
    if (mergeProgressText) mergeProgressText.textContent = `${rounded}%`;
    if (mergeCancelBtn) mergeCancelBtn.disabled = false;
  });

  // Initial call to set empty states correctly
  updateMergeUI();

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in the timecode field
    if (e.target.getAttribute('contenteditable') === 'true') return;

    if (currentMergeMode) {
      // Merge mode shortcuts
      if (mergeClips.length === 0) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          mergePlayer.togglePlay();
          break;
      }
    } else {
      // Trim mode shortcuts
      if (!videoPreview || !timeline) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          videoPreview.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          videoPreview.frameStep(-1, fps);
          break;
        case 'ArrowRight':
          e.preventDefault();
          videoPreview.frameStep(1, fps);
          break;
      }
    }
  });
});
