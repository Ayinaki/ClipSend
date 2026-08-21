import { VideoPreview } from './video-preview.js';
import { ControlBar } from './control-bar.js';
import { Timeline } from './timeline.js';
import { MergePlayer } from './merge-player.js';
import CropManager from './crop-manager.js';
import { formatTimecode } from './utils/timecode.js';
import { createEstimateBar, createProgressUI, createWarningsUI, initWindowControls, initTitlebarActions, initTitlebarTooltips } from './titlebar.js';
import { createSettingsController } from './settings.js';
import { buildPlanWarnings, isTrimPastVideoEnd } from './export-flow.js';
import { openModal, closeModal, closeAllModals } from './utils/modals.js';
import { toast, clearToasts } from './utils/toast.js';
import { createOnboardingController } from './onboarding.js';
import { createUndoManager } from './utils/undo-manager.js';
import { enhanceAllSelects } from './utils/dropdown.js';
import { ICON_PLAY, ICON_PAUSE } from './utils/icons.js';
import { DEFAULT_BINDINGS, matchAction, bindingLabel, valueToBinding } from './utils/keymap.js';
import { sanitizeReleaseNotes } from './utils/release-notes.js';

document.addEventListener('DOMContentLoaded', () => {
  // Replace native <select> controls with custom dropdowns before anything
  // reads them: the native Windows popup can't be themed, so every dropdown
  // would otherwise open as a stock OS menu. The native selects stay in the
  // DOM as the value/options source — all existing getElementById reads,
  // option population, and change listeners keep working untouched.
  enhanceAllSelects();

  // Disable browser media session action handlers so hardware media keys do not trigger video playback
  if ('mediaSession' in navigator) {
    ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward'].forEach(action => {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch (e) {}
    });
  }

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
  // Crop edits: snapshot for undo before each mutation, invalidate the plan
  // after it (the plan embeds crop coordinates, so it must be recalculated).
  cropManager.on('change-start', () => recordUndo('Edit crop')).on('change', clearExportPlan);
  let fps = 30;
  
  // App state to pass to export planner later
  const exportState = {
    selectedAudioTrackIndex: 0,
    playbackSpeed: 1 // 0.5x-3x playback/export speed (1 = normal)
  };

  // --- Undo/redo history (trim trims, multi-trim segments, crop, merge ops) ---
  // One undo history per editor mode: Trim and Merge are separate projects,
  // and a shared stack would let one mode's entries block (or mutate) the
  // other's history. Each manager only ever holds its own mode's snapshots.
  const undoHistory = {
    trim: createUndoManager(50),
    merge: createUndoManager(50)
  };
  const activeUndo = () => undoHistory[currentMergeMode ? 'merge' : 'trim'];
  const captureCurrentState = () => (currentMergeMode ? captureMergeState() : captureTrimState());

  function cloneMergeClips(clips) {
    return (clips || []).map(c => {
      const copy = { ...c };
      if (c.mediaInfo) {
        copy.mediaInfo = {
          ...c.mediaInfo,
          audioTracks: (c.mediaInfo.audioTracks || []).map(t => ({ ...t }))
        };
      }
      return copy;
    });
  }

  /** Snapshot the current edit state so undo/redo can restore it later. */
  function captureTrimState() {
    return {
      mode: 'trim',
      label: 'Edit trim',
      segments: timeline ? timeline.getSegments() : [],
      activeSegmentId: timeline ? timeline.activeSegmentId : null,
      multiTrim: timeline ? timeline.isMultiTrim : false,
      crop: cropManager ? cropManager.getCropSettings() : { enable: false }
    };
  }

  function captureMergeState() {
    return {
      mode: 'merge',
      label: 'Edit clips',
      clips: cloneMergeClips(mergeClips),
      currentClipIndex: mergePlayer ? mergePlayer.currentClipIndex : 0
    };
  }

  /** Push the pre-edit state onto the undo stack (call BEFORE mutating). */
  function recordUndo(label) {
    if (exportProgressState && exportProgressState.isActive) return;
    activeUndo().push(captureCurrentState());
  }

  /** Restore a snapshot captured by captureTrimState/captureMergeState. */
  function applySnapshot(snap) {
    if (!snap) return;
    if (snap.mode === 'trim') {
      if (timeline) timeline.restoreState(snap);
      if (cropManager) cropManager.applyCropState(snap.crop);
      updateTrimDisplay(); // re-reads trims + clears the stale plan
    } else if (snap.mode === 'merge') {
      mergeClips = cloneMergeClips(snap.clips);
      if (mergePlayer) {
        mergePlayer.currentClipIndex = Math.max(0, Math.min(snap.currentClipIndex || 0, Math.max(0, mergeClips.length - 1)));
      }
      updateMergeUI();
      showMergeWarnings([]); // the warning names clip indices; they may be stale now
    }
  }

  // Each mode has its own history (see undoHistory above), so no mode guard
  // is needed — undo/redo only ever touch the active mode's snapshots.
  function undo() {
    const mgr = activeUndo();
    const peek = mgr.peekUndo();
    if (!peek) {
      toast('Nothing to undo');
      return;
    }
    // Pass the current state so undo can store it for redo — redo must
    // restore the edited state, not re-apply the pre-edit one.
    const snap = mgr.undo(captureCurrentState());
    applySnapshot(snap);
    toast(`Undid: ${snap.label || 'edit'}`);
  }

  function redo() {
    const mgr = activeUndo();
    const peek = mgr.peekRedo();
    if (!peek) {
      toast('Nothing to redo');
      return;
    }
    const snap = mgr.redo(captureCurrentState());
    applySnapshot(snap);
    toast(`Redid: ${snap.label || 'edit'}`);
  }

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
  const exportBtn = document.getElementById('export-btn');

  const estimateBar = createEstimateBar({
    bar: document.getElementById('export-estimate-bar'),
    vbrLabel: document.getElementById('plan-vbr-label'),
    vbr: document.getElementById('plan-vbr'),
    res: document.getElementById('plan-res'),
    resItem: document.getElementById('plan-res-item'),
    size: document.getElementById('plan-size')
  });

  const progressUI = createProgressUI({
    container: document.getElementById('progress-container'),
    fill: document.getElementById('progress-fill'),
    text: document.getElementById('progress-text'),
    cancelBtn: document.getElementById('cancel-btn')
  });

  const warningsUI = createWarningsUI({
    button: document.getElementById('titlebar-warning-btn'),
    modal: document.getElementById('warnings-modal'),
    closeBtn: document.getElementById('close-warnings-btn'),
    content: document.getElementById('warnings-modal-content'),
    countEl: document.getElementById('titlebar-warning-count')
  });

  let currentPlan = null;
  let lastPlanOptions = null; // options used for the last shown plan (re-shown after a mode switch back to Trim)
  let lastWarnings = [];      // warnings tied to the last shown plan
  let lastMergeWarnings = []; // warnings tied to the merge clips (titlebar badge/modal in Merge mode)
  let currentMediaInfo = null;
  let loopEnabled = false;   // loop playback toggle (trim mode)

  const customSizeInputContainer = document.getElementById('custom-size-input-container');
  const customSizeInput = document.getElementById('custom-size-input');

  // Hardcode presets to match presets.js (normally we'd IPC this, but hardcoding for simplicity in UI)
  const presets = [
    { id: 'discord-free', label: '20 MB - Discord (Free)', sizeMB: 20, mode: 'size-limit' },
    { id: 'discord-nitro-basic', label: '50 MB - Discord (Nitro Basic)', sizeMB: 50, mode: 'size-limit' },
    { id: 'discord-nitro', label: '500 MB - Discord (Nitro)', sizeMB: 500, mode: 'size-limit' },
    { id: 'custom-size', label: 'Custom Target Size', mode: 'size-limit', isCustom: true },
    { id: 'auto-crf', label: 'Auto (Best Quality)', mode: 'auto', crfValue: 19 }
  ];

  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    presetSelect.appendChild(opt);
  });
  
  // Set default to 20 MB Discord Free
  presetSelect.value = 'discord-free';

  presetSelect.addEventListener('change', () => {
    clearExportPlan();
    const selectedPreset = presets.find(p => p.id === presetSelect.value);
    if (selectedPreset && selectedPreset.isCustom) {
      if (customSizeInputContainer) customSizeInputContainer.style.display = 'block';
    } else {
      if (customSizeInputContainer) customSizeInputContainer.style.display = 'none';
    }
    updateMergeEstimate();
  });

  customSizeInput?.addEventListener('input', () => {
    clearExportPlan();
    updateMergeEstimate();
  });

  function clearExportPlan() {
    currentPlan = null;
    estimateBar.hide();
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
    lastWarnings = warnings || [];
    // Only trim-mode warnings claim the title-bar badge while in Trim mode;
    // merge warnings take over while in Merge mode (mode switches restore the
    // right set in updateExportPanelForMode).
    if (!currentMergeMode) warningsUI.show(lastWarnings);
  }

  // --- Non-blocking error dialog ---
  // window.alert() is a native modal that is known to leave Electron's
  // frameless windows unresponsive after dismissal, and it can't show the
  // raw ffmpeg tail behind an error. All error paths route through this
  // in-app modal instead (same overlay manager as every other dialog).
  const errorModal = document.getElementById('error-modal');
  const errorModalTitle = document.getElementById('error-modal-title');
  const errorModalMessage = document.getElementById('error-modal-message');
  const errorModalDetails = document.getElementById('error-modal-details');
  const errorModalDetailsText = document.getElementById('error-modal-details-text');
  const closeErrorModalBtn = document.getElementById('close-error-modal-btn');
  const errorModalOkBtn = document.getElementById('error-modal-ok-btn');

  function showErrorDialog(message, { title = 'Error', details = '' } = {}) {
    if (!errorModal) {
      alert(message); // last-resort fallback (no modal in DOM)
      return;
    }
    if (errorModalTitle) errorModalTitle.textContent = title;
    if (errorModalMessage) errorModalMessage.textContent = message;
    if (errorModalDetails && errorModalDetailsText) {
      const hasDetails = !!(details && details.trim());
      errorModalDetails.style.display = hasDetails ? 'block' : 'none';
      if (hasDetails) {
        errorModalDetailsText.textContent = details;
        // Expanded by default so the raw tail is visible even when the
        // message is a short summary (e.g. "FFmpeg exited with code 69.").
        errorModalDetails.open = true;
      }
    }
    openModal(errorModal);
  }
  function closeErrorDialog() {
    closeModal(errorModal);
  }
  closeErrorModalBtn?.addEventListener('click', closeErrorDialog);
  errorModalOkBtn?.addEventListener('click', closeErrorDialog);
  errorModal?.addEventListener('click', (e) => {
    if (e.target === errorModal) closeErrorDialog();
  });

  const formatSelect = document.getElementById('format-select');
  if (formatSelect) {
    formatSelect.addEventListener('change', () => {
      clearExportPlan();
      updateMergeEstimate();
      const format = formatSelect.value;
      const isGif = format === 'gif';
      const isMp3 = format === 'mp3';
      const audioPanel = document.getElementById('audio-settings-panel');
      if (audioPanel) {
        // GIF is video-only; MP3 is audio-only. Both still allow track selection for MP3.
        if (isGif) {
          audioPanel.style.opacity = '0.5';
          audioPanel.style.pointerEvents = 'none';
        } else {
          audioPanel.style.opacity = '1';
          audioPanel.style.pointerEvents = 'auto';
        }
      }
      // Target size / resolution don't apply to audio-only exports
      if (presetSelect) presetSelect.disabled = isMp3;
      if (resolutionSelect) resolutionSelect.disabled = isMp3;
      if (customSizeInputContainer) customSizeInputContainer.style.display = 'none';
      const multiExportModeContainer = document.getElementById('multi-export-mode-container');
      if (multiExportModeContainer) {
        if (isMp3) {
          multiExportModeContainer.style.display = 'none';
        } else if (timeline && timeline.getSegments() && timeline.getSegments().length > 1) {
          multiExportModeContainer.style.display = 'block';
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
    
    const selectedFormat = formatSelect ? formatSelect.value : 'mp4';
    const isMp3 = selectedFormat === 'mp3';

    const presetId = presetSelect.value;
    const preset = presets.find(p => p.id === presetId);
    
    let targetSizeMB = preset ? preset.sizeMB : 20;
    let mode = preset ? (preset.mode || 'size-limit') : 'size-limit';

    if (preset && preset.isCustom && !isMp3) {
      const customVal = parseFloat(customSizeInput ? customSizeInput.value : '');
      if (isNaN(customVal) || customVal <= 0) {
        showErrorDialog('Please enter a valid target size in MB (greater than 0).', { title: 'Invalid target size' });
        calculateBtn.disabled = false;
        calculateBtn.textContent = 'Calculate Plan';
        return;
      }
      targetSizeMB = customVal;
      mode = 'size-limit';
    }
    
    let manualResolution = null;
    if (resolutionSelect.value !== 'native') {
      const parts = resolutionSelect.value.split('x');
      manualResolution = {
        width: parseInt(parts[0], 10),
        height: parseInt(parts[1], 10)
      };
    }
    
    const settings = {
      mode: mode,
      targetSizeMB: targetSizeMB,
      crfValue: preset ? preset.crfValue : undefined,
      selectedAudioTrackIndex: exportState.selectedAudioTrackIndex,
      hwAccel: document.getElementById('setting-hw-accel').value,
      videoCodec: currentVideoCodec(),
      encoders: encoderCaps,
      manualResolution,
      disableAutoDownscale: document.getElementById('setting-disable-downscale').checked,
      crop: cropManager ? cropManager.getCropSettings() : { enable: false },
      outputFormat: document.getElementById('format-select') ? document.getElementById('format-select').value : 'mp4',
      maxQuality: await window.clipSend.getSetting('maxQuality'),
      playbackSpeed: exportState.playbackSpeed
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
        lastPlanOptions = { isMp3, outputFormat: settings.outputFormat, mode: settings.mode };
        estimateBar.show(currentPlan, lastPlanOptions);
        const allWarnings = buildPlanWarnings(currentPlan, {
          isVFR: currentMediaInfo.isVFR,
          outputFormat: settings.outputFormat,
          trimDuration: timeline.getTrimDuration(),
          targetSizeMB: settings.targetSizeMB,
          trimIn: calcTrimIn,
          videoDuration: currentMediaInfo.videoDuration,
          duration: currentMediaInfo.duration
        });
        showWarnings(allWarnings);
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
    const segments = timeline.getSegments().sort((a, b) => a.in - b.in);
    const isMulti = timeline.isMultiTrim && segments.length > 1;
    const isMp3 = basePlan.outputFormat === 'mp3';
    // MP3 exports have no merge step — each segment (if any) becomes its own file
    const exportMode = isMp3 ? 'separate' : (exportModeSelect ? exportModeSelect.value : 'separate');

    try {
      const hwAccel = fallback ? 'cpu' : (await window.clipSend.getSetting('hwAccel') || 'auto');
      const encoderName = fallback ? 'libx264' : (basePlan.encoder || 'libx264');
      
      console.log('--- ENCODE START DIAGNOSTICS ---');
      console.log(`Hardware Acceleration Selected: ${hwAccel}`);
      console.log(`Encoder: ${encoderName}`);

      let mergedFinalDest = null;
      if (isMulti && exportMode === 'merged' && !isMp3) {
        // Pass the source clip's context so the trim filename template can
        // render ({name}, {res}, {size}, {codec}) for the merged file name.
        mergedFinalDest = await window.clipSend.resolveMergeDestination({
          name: currentMediaInfo
            ? currentMediaInfo.filePath.split('\\').pop().split('/').pop().replace(/\.[^.]+$/, '')
            : 'Merged Video',
          codec: basePlan && basePlan.codec,
          res: basePlan && basePlan.width && basePlan.height ? `${basePlan.width}x${basePlan.height}` : null,
          sizeMB: basePlan && (basePlan.targetSizeMB != null ? basePlan.targetSizeMB : basePlan.estimatedSizeMB),
          // The segments are pre-encoded in the picked container, so the
          // merged destination must carry the same extension (.webm for WebM)
          // for the concat muxer to pick the right container.
          format: basePlan && basePlan.outputFormat
        });
        if (!mergedFinalDest) {
          progressUI.hide();
          return;
        }
        // Segments and the final merge follow the format picker (WebM segments
        // pre-encode as VP9/Opus webm; AV1-in-MP4 stays MP4).
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

      // Hoisted so the merge phase below can read the last segment's plan:
      // declared inside the loop it is out of scope after it, and referencing
      // it there throws "segPlan is not defined" (this broke every multi-trim
      // merged export, WebM and MP4 alike). All segments are pre-encoded with
      // the same settings, so the final segment's plan represents the whole
      // set's format and codec.
      let segPlan = null;

      for (let i = 0; i < segments.length; i++) {
        exportProgressState.segmentIndex = i;
        const seg = segments[i];
        segPlan = { ...basePlan, trimIn: seg.in, trimOut: seg.out, encoder: encoderName };
        
        // Re-plan per segment for multi-trim, and also on a hardware-encoder
        // CPU fallback: the original plan's args still point at the failed
        // hardware encoder, so rebuilding them with hwAccel='cpu' is what
        // actually makes the retry use libx264/libsvtav1.
        if (isMulti || fallback) {
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
            videoCodec: currentVideoCodec(),
            encoders: encoderCaps,
            disableAutoDownscale: document.getElementById('setting-disable-downscale').checked,
            crop: cropManager ? cropManager.getCropSettings() : { enable: false },
            manualResolution: manualResolution,
            outputFormat: document.getElementById('format-select') ? document.getElementById('format-select').value : 'mp4',
            maxQuality: await window.clipSend.getSetting('maxQuality'),
            playbackSpeed: exportState.playbackSpeed
          };
          
          if (fallback) {
            // Rebuild the original plan's mode from the plan itself.
            if (basePlan.crfValue !== undefined) {
              settings.mode = 'auto';
              settings.crfValue = basePlan.crfValue;
            } else if (isMp3) {
              settings.mode = 'size-limit';
              settings.targetSizeMB = 10;
            } else if (basePlan.targetSizeMB !== undefined) {
              settings.mode = 'size-limit';
              settings.targetSizeMB = basePlan.targetSizeMB;
            } else {
              settings.mode = 'custom';
              settings.customBitrateKbps = basePlan.videoBitrateKbps;
              settings.audioBitrateKbps = basePlan.audioBitrateKbps;
            }
          } else if (isMp3) {
            // MP3 is audio-only — target size / bitrate split doesn't apply
            settings.mode = 'size-limit';
            settings.targetSizeMB = 10;
          } else if (exportMode === 'separate') {
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
        if (isMulti && exportMode === 'merged' && !isMp3) {
          const tempDir = await window.clipSend.getTempPath();
          // Segments are pre-encoded in the picked container (WebM segments
          // must not be named .mp4 — ffmpeg picks the output muxer from the
          // extension, and VP9/Opus can't mux into MP4).
          const segExt = segPlan.outputFormat === 'webm' ? 'webm' : 'mp4';
          segOutputPath = `${tempDir}\\clipsend-seg-${Date.now()}-${i}.${segExt}`;
          generatedTempFiles.push(segOutputPath);
        }

        const result = await window.clipSend.startExport({
          plan: segPlan,
          inputFilePath: currentMediaInfo.filePath,
          outputPath: segOutputPath
        });

        if (!result) {
          await doCleanup();
          progressUI.hide();
          exportProgressState.isActive = false;
          return;
        }

        if (result.cancelled) {
          await doCleanup();
          progressUI.hide();
          exportProgressState.isActive = false;
          return;
        } else if (result.fallbackToCpu) {
          await doCleanup();
          console.warn("Hardware encoder failed to initialize; retrying with CPU encoding.");
          showWarnings(["Hardware encoding failed to initialize. Retrying export with CPU encoding..."]);
          exportProgressState.isActive = false;
          await executeExportWithRetry(basePlan, true);
          return;
        } else if (!result.success) {
          await doCleanup();
          exportProgressState.isActive = false;
          const exportErr = new Error(result.error);
          if (result.details) exportErr.details = result.details;
          throw exportErr;
        }
        
        exportProgressState.accumulatedDuration += exportProgressState.durations[i];
        finalFilePath = result.filePath; 
        totalFinalSizeMB += parseFloat(result.finalSizeMB) || 0;
        if (result.warning) finalWarnings.push(result.warning);
      }
      
      exportProgressState.isActive = false;

      if (isMulti && exportMode === 'merged' && !isMp3) {
        progressUI.setStatus('Merging...');
        // Route the titlebar cancel to the merge pipeline during this phase
        // too (the same mergeExportActive flag the merge-mode export uses).
        mergeExportActive = true;
        // Segments are pre-encoded in the final codec/container, so the merge
        // must know them: the concat-filter fallback re-encodes in that codec
        // (H.264 can't mux into a .webm destination), and the handler must not
        // schedule a redundant post-conversion on top of the already-final
        // segments (skipConvert).
        const mergeResult = await window.clipSend.startMerge(generatedTempFiles, mergedFinalDest, [], {
          skipConvert: true,
          format: segPlan.outputFormat,
          codec: segPlan.codec
        });
        mergeExportActive = false;
        
        await doCleanup();
        
        if (!mergeResult) {
          progressUI.hide();
          return;
        }
        
        if (mergeResult.success) {
          showExportModal(mergeResult.filePath, mergeResult.finalSizeMB, mergeResult.strategy || null, true, finalWarnings);
        } else {
          const mergeErr = new Error(mergeResult.error);
          if (mergeResult.details) mergeErr.details = mergeResult.details;
          throw mergeErr;
        }
      } else {
        // Single clip or Separate Clips
        // If Separate Clips, finalFilePath is just the LAST clip.
        // We can just show the modal for the directory or the last clip.
        showExportModal(finalFilePath, totalFinalSizeMB, null, true, finalWarnings);
      }
      
      progressUI.hide();

    } catch (err) {
      showErrorDialog(err.message, { title: 'Export failed', details: err.details });
      progressUI.hide();
      exportProgressState.isActive = false;
    } finally {
      if (!fallback || !progressUI.isVisible()) {
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
    closeModal(exportModal);
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
          toast('Copied to clipboard', 'success');
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
          showErrorDialog(`Copy failed: ${result.error}`, { title: 'Copy failed' });
        }
      } catch (err) {
        exportCopyClipboardBtn.textContent = 'Failed';
        setTimeout(() => {
          exportCopyClipboardBtn.textContent = originalText;
          exportCopyClipboardBtn.disabled = false;
        }, 2000);
        showErrorDialog(`Copy failed: ${err.message}`, { title: 'Copy failed' });
      }
    });
  }

  function showExportModal(filePath, sizeMB, mergeStrategy = null, withCopyButton = false, warnings = []) {
    currentExportFilePath = filePath;
    if (exportSavedTo) exportSavedTo.textContent = `Saved to: ${filePath}`;
    if (exportFinalSize) exportFinalSize.textContent = `Final size: ${sizeMB} MB`;
    const warningsEl = document.getElementById('export-warnings');
    if (warningsEl) {
      if (warnings && warnings.length > 0) {
        // Warnings are one-line strings, plain text (never HTML) — e.g. a
        // size-cap miss from the retry loop or the GIF best-effort export.
        warningsEl.textContent = '';
        for (const w of warnings) {
          const line = document.createElement('div');
          line.textContent = String(w);
          warningsEl.appendChild(line);
        }
        warningsEl.style.display = 'flex';
      } else {
        warningsEl.style.display = 'none';
      }
    }
    const strategyEl = document.getElementById('export-strategy');
    if (strategyEl) {
      if (mergeStrategy && typeof mergeStrategy === 'string') {
        const text = mergeStrategy === 'concat_demuxer' ? 'Lossless fast merge' : 'Re-encoded (format mismatch)';
        strategyEl.textContent = `Strategy: ${text}`;
        strategyEl.style.display = 'block';
      } else {
        strategyEl.style.display = 'none';
      }
    }
    
    // The Copy-to-Clipboard button is shown for trim exports AND merge
    // exports (clipboard:copyFile works on any exported file).
    if (exportCopyClipboardBtn) {
      exportCopyClipboardBtn.style.display = withCopyButton ? 'block' : 'none';
    }

    if (exportModal) openModal(exportModal);
  }

  initTitlebarActions({
    exportBtn,
    cancelBtn: document.getElementById('cancel-btn'),
    onStartExport: async () => {
      if (!currentPlan) return;

      // Fail fast when the trim starts past the end of the video track: the
      // encode would produce zero video frames and die with a cryptic ffmpeg
      // error (audio-outlasts-video files). The predicate is gated on the
      // video track being meaningfully shorter than the container, so a trim
      // to the very end of a normal file is never wrongly blocked.
      if (currentMediaInfo && timeline && isTrimPastVideoEnd(timeline.getTrimIn(), currentMediaInfo.videoDuration, currentMediaInfo.duration)) {
        showErrorDialog('The trim In point is past the end of the video track, so this export would contain no video. Move the trim In earlier or pick a shorter range, then try again.', { title: 'Export has no video frames' });
        return;
      }

      exportBtn.disabled = true;
      calculateBtn.disabled = true;
      presetSelect.disabled = true;
      if (typeof resolutionSelect !== 'undefined' && resolutionSelect) resolutionSelect.disabled = true;
      // Swap the estimate cluster out for the progress cluster
      estimateBar.hide();
      progressUI.show();
      progressUI.setPercent(0);

      await executeExportWithRetry(currentPlan);
    },
    onCancel: () => {
      progressUI.disableCancel();
      // A merge export is cancelled through the merge pipeline (which handles
      // per-clip trim temp files + concat), not the encoder cancel.
      if (mergeExportActive) {
        window.clipSend.cancelMerge();
      } else {
        window.clipSend.cancelExport();
      }
    }
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
    progressUI.setPercent(percent, status);
    progressUI.enableCancel();
  });

  /** Update the trim info row beneath the timeline. */
  function updateTrimDisplay() {
    if (!timeline) return;
    trimInDisplay.textContent = formatTimecode(timeline.getTrimIn(), fps);
    trimOutDisplay.textContent = formatTimecode(timeline.getTrimOut(), fps);
    trimDurationDisplay.textContent = formatTimecode(timeline.getTrimDuration(), fps);
    
    const segments = timeline.getSegments();
    const multiExportModeContainer = document.getElementById('multi-export-mode-container');
    const currentFormat = formatSelect ? formatSelect.value : 'mp4';
    if (multiExportModeContainer) {
      // MP3 exports each segment as its own file, so the merged option doesn't apply
      multiExportModeContainer.style.display = (segments && segments.length > 1 && currentFormat !== 'mp3') ? 'block' : 'none';
    }

    // Timeline header: total duration vs kept (trimmed) duration
    const trimTimelineInfo = document.getElementById('trim-timeline-info');
    if (trimTimelineInfo) {
      const total = timeline.duration || 0;
      const trimmed = timeline.getTrimDuration();
      const isTrimmed = segments && (segments.length > 1 || trimmed < total - 0.05);
      trimTimelineInfo.textContent = isTrimmed
        ? `${formatTrimDur(total)} \u2022 Trimmed ${formatTrimDur(trimmed)}`
        : formatTrimDur(total);
    }

    // Segment indicator (multi-trim only)
    const segIndicator = document.getElementById('trim-segment-indicator');
    if (segIndicator) {
      if (segments && segments.length > 1) {
        const active = timeline.getActiveSegment();
        const idx = segments.findIndex(s => s.id === active.id) + 1;
        segIndicator.textContent = `Segment ${idx} / ${segments.length}`;
        segIndicator.style.display = 'inline-block';
      } else {
        segIndicator.style.display = 'none';
      }
    }
    
    clearExportPlan(); // Plan is invalid if trim changes
  }

  const multiTrimEnable = document.getElementById('multi-trim-enable');
  if (multiTrimEnable) {
    multiTrimEnable.addEventListener('change', (e) => {
      if (timeline) {
        recordUndo('Toggle multi-trim');
        timeline.setMultiTrim(e.target.checked);
        updateTrimDisplay();
      }
    });
  }

  const trimResetBtn = document.getElementById('trim-reset-btn');
  trimResetBtn?.addEventListener('click', () => {
    if (!timeline) return;
    recordUndo('Reset trim');
    timeline.resetAll();
    // Reset also exits multi-trim so the checkbox and timeline agree
    if (multiTrimEnable) {
      multiTrimEnable.checked = false;
      timeline.setMultiTrim(false);
    }
    updateTrimDisplay();
    toast('Trims reset to the full clip', 'success');
  });

  async function loadTrimFileFromResult(result) {
    if (!result) return;
    if (result.success) {
      currentMediaInfo = result.mediaInfo;
      fps = result.mediaInfo.frameRate || 30;

      // A new source file starts a fresh edit session — no history to undo
      // into. Both modes reset so neither carries stale snapshots across.
      undoHistory.trim.clear();
      undoHistory.merge.clear();
      
      populateAudioTracks(result.mediaInfo.audioTracks);
      populateResolutions(result.mediaInfo);
      
      presetSelect.value = 'discord-free';
      
      const multiTrimEnable = document.getElementById('multi-trim-enable');
      if (multiTrimEnable) {
        multiTrimEnable.checked = false;
        multiTrimEnable.disabled = false;
      }
      
      clearExportPlan();
      progressUI.hide();
      
      showState(readyState);

      if (!videoPreview) {
        videoPreview = new VideoPreview(
          videoElement,
          (time) => {
            if (controlBar) controlBar.updateTimecode(time);
            if (timeline) timeline.setPlayhead(time);
            // Loop playback: when the playhead crosses the trim out-point
            // while playing, jump back to the in-point and keep going. Gated
            // on isPlaying so scrubbing/frame-stepping near the end doesn't
            // yank a paused playhead, and on a minimum range so a tiny trim
            // can't thrash the seek.
            if (loopEnabled && timeline) {
              const ti = timeline.getTrimIn();
              const to = timeline.getTrimOut();
              if (to - ti > 0.1 && videoPreview.isPlaying() && time >= to - 0.05) {
                videoPreview.seekTo(ti);
              }
            }
          }
        );
        
        videoPreview.onPlayStateChange((isPlaying) => {
          if (controlBar) controlBar.setPlayState(isPlaying);
          if (timeline) timeline.setPlaying(isPlaying);
        });

        // Loop the trimmed range (or full video when untrimmed) on natural end.
        videoElement.addEventListener('ended', () => {
          if (loopEnabled && timeline) {
            const ti = timeline.getTrimIn();
            videoElement.currentTime = ti;
            videoElement.play();
          }
        });
      }
      
      settings.syncVolumeUI();
      
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
            onJumpIn: () => trimJumpIn(),
            onSetIn: () => trimSetIn(),

            onSetOut: () => trimSetOut(),
            onJumpOut: () => trimJumpOut()
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
          },
          onZoomChange: (percent) => {
            const readout = document.getElementById('timeline-zoom-readout');
            if (readout) readout.textContent = `${percent}%`;
          },
          onBeforeEdit: () => recordUndo('Edit trim')
        });
      }

      cropManager.reset(videoElement);

      const trimTimelineTitle = document.getElementById('trim-timeline-title');
      if (trimTimelineTitle && result.mediaInfo && result.mediaInfo.filePath) {
        const name = result.mediaInfo.filePath.split('\\').pop().split('/').pop();
        trimTimelineTitle.textContent = name;
        trimTimelineTitle.title = name;
      }

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

  // The empty-state "Browse" card button is an alias for the sidebar button.
  document.getElementById('empty-open-btn')?.addEventListener('click', () => openFileBtn.click());

  // --- Trim Drag and Drop ---
  const dropTrimStage = document.getElementById('trim-stage');
  const trimDropOverlay = document.getElementById('trim-drop-overlay');
  const dropModeTrimBtn = document.getElementById('mode-trim-btn');
  const ALLOWED_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi', 'webm'];

  // Depth counter: dragenter/dragleave bubble, so moving between the stage's
  // children fires spurious dragleaves. Counting entries keeps the overlay
  // visible until the drag truly leaves the stage - instead of staying stuck
  // forever when the user drags away without dropping. (The overlay itself
  // has pointer-events: none, so its own dragleave can never fire.)
  let trimDragDepth = 0;

  /** True when the drag carries OS files (vs. the app's own block reorders). */
  function isFileDrag(e) {
    return !!(e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'));
  }

  dropTrimStage.addEventListener('dragenter', (e) => {
    if (!dropModeTrimBtn.classList.contains('active')) return;
    if (!isFileDrag(e)) return; // ignore internal drags (e.g. block reorder)
    e.preventDefault();
    trimDragDepth++;
    trimDropOverlay.style.display = 'flex';
  });

  dropTrimStage.addEventListener('dragover', (e) => {
    if (!dropModeTrimBtn.classList.contains('active')) return;
    e.preventDefault();
  });

  dropTrimStage.addEventListener('dragleave', () => {
    trimDragDepth = Math.max(0, trimDragDepth - 1);
    if (trimDragDepth === 0) trimDropOverlay.style.display = 'none';
  });

  dropTrimStage.addEventListener('drop', async (e) => {
    if (!dropModeTrimBtn.classList.contains('active')) return;
    e.preventDefault();
    trimDragDepth = 0;
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

  // Shared depth counter across both merge zones (same reasoning as the trim
  // drop zone: a counter is the only reliable way to know the drag really
  // left instead of crossing a child or zone boundary).
  let mergeDragDepth = 0;

  function handleMergeDragEnter(e) {
    if (!dropModeMergeBtn.classList.contains('active')) return;
    if (!isFileDrag(e)) return; // ignore internal drags (e.g. block reorder)
    e.preventDefault();
    mergeDragDepth++;
    showMergeDropOverlays();
  }

  function handleMergeDragOver(e) {
    if (!dropModeMergeBtn.classList.contains('active')) return;
    e.preventDefault();
  }

  function handleMergeDragLeave() {
    mergeDragDepth = Math.max(0, mergeDragDepth - 1);
    if (mergeDragDepth === 0) hideMergeDropOverlays();
  }

  async function handleMergeDrop(e) {
    if (!dropModeMergeBtn.classList.contains('active')) return;
    e.preventDefault();
    mergeDragDepth = 0;
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
        recordUndo('Add clips');
        mergeClips.push(...result.clips);
        // New clips can change compatibility (and the warning names indices).
        showMergeWarnings([]);
        updateMergeUI();
        const n = result.clips.length;
        toast(`Added ${n} clip${n === 1 ? '' : 's'}`, 'success');
      } else if (result && result.error) {
        showErrorDialog('Error adding clips: ' + result.error, { title: 'Error adding clips' });
      }
    } catch (err) {
      showErrorDialog('Failed to add clips: ' + err.message, { title: 'Failed to add clips' });
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
      el.addEventListener('dragleave', handleMergeDragLeave);
      el.addEventListener('drop', handleMergeDrop);
    }
  });

  // Safety net 1: if an internal drag ends or is cancelled while an overlay
  // is showing, reset both drop overlays.
  window.addEventListener('dragend', () => {
    trimDragDepth = 0;
    mergeDragDepth = 0;
    if (trimDropOverlay) trimDropOverlay.style.display = 'none';
    hideMergeDropOverlays();
  });

  // Safety net 2: OS file drags never fire dragend in the page, so an Esc
  // cancel (or a missed final dragleave) could leave a counter > 0. A
  // document-level dragleave with no relatedTarget only happens when the
  // drag leaves the window entirely - reset there too.
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget) return;
    trimDragDepth = 0;
    mergeDragDepth = 0;
    if (trimDropOverlay) trimDropOverlay.style.display = 'none';
    hideMergeDropOverlays();
  });


  // --- Window Controls ---
  initWindowControls({
    minBtn: document.getElementById('win-min'),
    closeBtn: document.getElementById('win-close'),
    api: window.clipSend
  });

  // --- Custom animated tooltips (replaces native title bubbles) ---
  initTitlebarTooltips(document);

  // --- Settings Modal & Playback State ---
  // Detected encoder capabilities ({ nvenc/qsv/amf: {h264, av1}, ... }); fed
  // into every calculatePlan call so the planner picks a working encoder.
  let encoderCaps = {};

  /** The user's selected video codec ('h264' | 'av1') from the Settings modal. */
  function currentVideoCodec() {
    const el = document.getElementById('setting-video-codec');
    return el && el.value === 'av1' ? 'av1' : 'h264';
  }

  const settings = createSettingsController({
    api: window.clipSend,
    elements: {
      modal: document.getElementById('settings-modal'),
      openBtn: document.getElementById('settings-btn'),
      closeBtn: document.getElementById('close-settings-btn'),
      exportDir: document.getElementById('setting-export-dir'),
      browseBtn: document.getElementById('browse-export-dir-btn'),
      clearBtn: document.getElementById('clear-export-dir-btn'),
      hwAccel: document.getElementById('setting-hw-accel'),
      videoCodec: document.getElementById('setting-video-codec'),
      disableDownscale: document.getElementById('setting-disable-downscale'),
      showWaveform: document.getElementById('setting-show-waveform'),
      maxQuality: document.getElementById('setting-max-quality'),
      theme: document.getElementById('setting-theme'),
      font: document.getElementById('setting-font'),
      filenameTemplateTrim: document.getElementById('setting-filename-template-trim'),
      filenameTemplateMerge: document.getElementById('setting-filename-template-merge'),
      volumeSlider: document.getElementById('volume-slider'),
      muteBtn: document.getElementById('mute-btn'),
      mergeVolumeSlider: document.getElementById('merge-volume-slider'),
      mergeMuteBtn: document.getElementById('merge-mute-btn'),
      shortcutsBtn: document.getElementById('setting-shortcuts-btn'),
      shortcutsModal: document.getElementById('shortcut-editor-modal'),
      shortcutsCloseBtn: document.getElementById('shortcut-editor-close-btn'),
      shortcutsDoneBtn: document.getElementById('shortcut-editor-done-btn'),
      shortcutsResetBtn: document.getElementById('shortcut-reset-btn'),
      shortcutsList: document.getElementById('shortcut-editor-list')
    },
    timeline,
    onShortcutsApplied: applyShortcutOverrides,
    onEncodersDetected: (caps) => { encoderCaps = caps || {}; },
    onPlanInvalidated: clearExportPlan,
    onShowWaveformChange: (checked) => {
      if (timeline) {
        timeline.setShowWaveform(checked);
        if (checked && currentMediaInfo && currentMediaInfo.filePath && !timeline.waveformPeaks) {
          loadWaveform(currentMediaInfo.filePath, exportState.selectedAudioTrackIndex);
        }
      }
    },
    onApplyVolumeToPlayers: (volume, muted) => {
      if (videoPreview) {
        videoPreview.setVolume(volume);
        videoPreview.setMuted(muted);
      }
      if (mergePlayer) {
        mergePlayer.setVolume(volume);
        mergePlayer.setMuted(muted);
      }
    }
  });

  // --- Keyboard shortcut remapping ---
  // The active binding map starts as the defaults and is updated whenever
  // Settings persists an override (startup load + live editor changes). The
  // help modal's kbd labels are re-rendered from it so users see their real
  // keys, not the defaults.
  const activeBindings = Object.fromEntries(
    Object.entries(DEFAULT_BINDINGS).map(([key, binding]) => [key, { ...binding }])
  );
  function renderShortcutsModal() {
    document.querySelectorAll('[data-shortcut-action]').forEach((kbd) => {
      const binding = activeBindings[kbd.dataset.shortcutAction];
      kbd.textContent = binding ? bindingLabel(binding) : '';
    });
  }
  function applyShortcutOverrides(overrides) {
    for (const [action, value] of Object.entries(overrides || {})) {
      if (activeBindings[action] === undefined) continue; // unknown action
      const binding = valueToBinding(value);
      if (binding) activeBindings[action] = binding;
      else delete activeBindings[action]; // 'None' unbinds the action
    }
    renderShortcutsModal();
  }

  settings.load();

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
    closeModal(feedbackModal);
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
    openModal(feedbackModal);
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

  const openGithubIssueBtn = document.getElementById('open-github-issue-btn');
  openGithubIssueBtn?.addEventListener('click', () => {
    if (window.clipSend.openExternalUrl) {
      window.clipSend.openExternalUrl('https://github.com/Ayinaki/ClipSend/issues/new/choose');
    }
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
    closeModal(changelogModal);
  }

  changelogBtn?.addEventListener('click', () => {
    if (!changelogContent.querySelector('.timeline')) {
      renderChangelog();
    }
    openModal(changelogModal);
  });

  closeChangelogBtn?.addEventListener('click', closeChangelogModal);

  changelogModal?.addEventListener('click', (e) => {
    if (e.target === changelogModal) closeChangelogModal();
  });

  // --- Onboarding (first-run tour) ---
  const onboarding = createOnboardingController({
    api: window.clipSend,
    elements: {
      modal: document.getElementById('onboarding-modal'),
      closeBtn: document.getElementById('onboarding-close-btn'),
      skipBtn: document.getElementById('onboarding-skip-btn'),
      prevBtn: document.getElementById('onboarding-prev-btn'),
      nextBtn: document.getElementById('onboarding-next-btn'),
      dots: document.getElementById('onboarding-dots'),
      stepTitle: document.getElementById('onboarding-title'),
      stepBody: document.getElementById('onboarding-copy'),
      stepVisual: document.getElementById('onboarding-visual')
    }
  });
  onboarding.init();

  // The tour is never lost to a skipped first run: replay it from Settings.
  document.getElementById('replay-onboarding-btn')?.addEventListener('click', () => onboarding.show());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // --- Collapsible sidebar panels (accordion) ---
  // Audio Settings and Cropping are collapsible; opening one collapses the
  // other so a tall section (Cropping with its presets) can't push the Export
  // Settings panel below the fold of the sidebar.
  document.querySelector('.sidebar-content')?.addEventListener('click', (e) => {
    const header = e.target.closest('.collapsible-header');
    if (!header) return;
    const panel = header.parentElement;
    const content = header.nextElementSibling;
    const chevron = header.querySelector('.chevron');
    if (!content || !chevron) return;
    const opening = panel.classList.contains('collapsed');
    // Close every other collapsible panel in the same sidebar column.
    panel.parentElement.querySelectorAll('.panel.collapsible').forEach(other => {
      if (other === panel) return;
      other.classList.add('collapsed');
      const otherContent = other.querySelector(':scope > .panel-content');
      if (otherContent) otherContent.style.display = 'none';
      const otherChevron = other.querySelector('.collapsible-header .chevron');
      if (otherChevron) otherChevron.innerHTML = '&#xE70E;';
    });
    panel.classList.toggle('collapsed', !opening);
    // Expanding clears the inline style so the stylesheet's display:flex on
    // .panel-content applies (block vs flex is invisible for stacked children,
    // but keeping the sheet's layout wins for any future flex-dependent child).
    content.style.display = opening ? '' : 'none';
    chevron.innerHTML = opening ? '&#xE70D;' : '&#xE70E;';
  });

  // --- Mode Toggle (Trim / Merge) ---
  const modeTrimBtn = document.getElementById('mode-trim-btn');
  const modeMergeBtn = document.getElementById('mode-merge-btn');
  const trimSidebar = document.getElementById('trim-sidebar');
  const mergeSidebar = document.getElementById('merge-sidebar');
  const trimStage = document.getElementById('trim-stage');
  const mergeStage = document.getElementById('merge-stage');

  /** Replay the fade/slide transition when a stage becomes visible. */
  function animateStage(el) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.style.animation = 'none';
    void el.offsetWidth; // restart the CSS animation
    el.style.animation = 'stage-in 0.18s ease-out';
  }

  modeTrimBtn?.addEventListener('click', () => {
    currentMergeMode = false;
    modeTrimBtn.classList.add('active');
    modeMergeBtn.classList.remove('active');
    trimSidebar.style.display = 'block';
    mergeSidebar.style.display = 'none';
    trimStage.style.display = 'flex';
    mergeStage.style.display = 'none';
    animateStage(trimStage);
    clearToasts(); // stale toasts from the other mode shouldn't linger
    updateExportPanelForMode();
    // Force resize to ensure timeline canvas renders correctly now that it's visible
    window.dispatchEvent(new Event('resize'));
  });

  modeMergeBtn?.addEventListener('click', () => {
    currentMergeMode = true;
    modeMergeBtn.classList.add('active');
    modeTrimBtn.classList.remove('active');
    updateExportPanelForMode();
    mergeSidebar.style.display = 'flex';
    mergeSidebar.style.flexDirection = 'column';
    trimSidebar.style.display = 'none';
    mergeStage.style.display = 'flex';
    trimStage.style.display = 'none';
    animateStage(mergeStage);
    clearToasts();
    // Force resize to ensure scrubber canvas renders correctly now that it's visible
    window.dispatchEvent(new Event('resize'));
  });

  // --- Merge Mode Logic ---
  let mergeClips = [];
  const mergeClipList = document.getElementById('merge-clip-list');
  const mergeTimelineStrip = document.getElementById('merge-timeline-strip');
  const exportMergedBtn = document.getElementById('export-merged-btn');
  const mergeEmptyStage = document.getElementById('merge-empty-stage');
  const mergeVideoEl = document.getElementById('merge-video');
  const mergePlayBtn = document.getElementById('merge-play-btn');
  const mergeClipIndicator = document.getElementById('merge-clip-indicator');
  let currentMergeMode = false; // tracks which mode is active for keyboard shortcuts

  // Reorder drag helpers: a shared insertion caret element that shows exactly
  // where the dragged block will land, plus a ghosted block while dragging.
  let mergeDropIndicator = null;
  function ensureDropIndicator() {
    if (!mergeDropIndicator) {
      mergeDropIndicator = document.createElement('div');
      mergeDropIndicator.className = 'merge-drop-indicator';
    }
    mergeTimelineStrip.appendChild(mergeDropIndicator); // re-attach after strip rebuilds
  }
  function positionDropIndicator(x) {
    if (!mergeDropIndicator) return;
    mergeDropIndicator.style.left = `${x}px`;
    mergeDropIndicator.classList.add('visible');
  }
  function hideDropIndicator() {
    if (mergeDropIndicator) mergeDropIndicator.classList.remove('visible');
  }

  // --- Block gestures: click = seek, drag = reorder ---
  // Native HTML5 drag made the whole block draggable, so a plain click (or a
  // tiny mouse jiggle while aiming) hijacked into a reorder — and a click only
  // ever jumped to the clip's trim start, never the position clicked. Blocks
  // now use pointer events: a click (no movement past a small threshold)
  // seeks to the exact position clicked, and a drag reorders with the same
  // insertion caret. Trim handles keep their own mousedown gesture and are
  // excluded in the block's pointerdown handler.
  const MERGE_DRAG_THRESHOLD_PX = 6;
  let blockDrag = null; // { block, index, startX, startY, active, pointerId }

  function clearBlockDragClasses() {
    mergeTimelineStrip.querySelectorAll('.merge-timeline-block').forEach(b =>
      b.classList.remove('dragging', 'drag-over-left', 'drag-over-right'));
    hideDropIndicator();
  }

  /** Abort a gesture (pointercancel, window blur, Esc) without seeking. */
  function cancelBlockDrag() {
    if (!blockDrag) return;
    blockDrag = null;
    clearBlockDragClasses();
  }

  /** Finish a gesture: reorder if it became a drag, otherwise seek. */
  function endBlockDrag(e) {
    if (!blockDrag) return;
    const drag = blockDrag;
    blockDrag = null;
    clearBlockDragClasses();

    if (!drag.active) {
      // Plain click: seek to the exact position clicked, mapped through the
      // clip's trim window (same mapping as the scrubber, so both surfaces
      // land on the same frame). Keep playing if the sequence was playing.
      const globalSec = mergePlayer.globalSecondsForClientX(e.clientX);
      mergePlayer.seekToGlobal(globalSec, mergePlayer.isPlaying);
      updateMergeTrimDisplay();
      return;
    }

    // Reorder drag: insert at the slot under the release point.
    const targetIdx = mergeSlotFromClientX(e.clientX).index;
    let idx = targetIdx;
    if (drag.index < idx) idx--;
    if (idx !== drag.index) {
      recordUndo('Reorder clips');
      const [movedItem] = mergeClips.splice(drag.index, 1);
      mergeClips.splice(idx, 0, movedItem);
      // Reordering can change compatibility (the warning names clip indices),
      // so drop any stale badge from the previous clip order.
      showMergeWarnings([]);
      updateMergeUI();
    }
  }

  window.addEventListener('pointermove', (e) => {
    if (!blockDrag || (e.pointerId ?? 0) !== blockDrag.pointerId) return;
    const dx = e.clientX - blockDrag.startX;
    const dy = e.clientY - blockDrag.startY;
    if (!blockDrag.active) {
      // Crossing the threshold turns the press into a reorder drag.
      if (Math.hypot(dx, dy) < MERGE_DRAG_THRESHOLD_PX) return;
      blockDrag.active = true;
      blockDrag.block.classList.add('dragging');
      ensureDropIndicator();
      positionDropIndicator(blockDrag.block.offsetLeft);
    }
    // Edge auto-scroll: keep dragging past the visible edge working. Native
    // HTML5 drag scrolled the horizontally-scrollable strip for free; a
    // pointer drag needs it explicitly. The scrubber area stays aligned via
    // MergePlayer's scroll-sync.
    const stripRect = mergeTimelineStrip.getBoundingClientRect();
    const EDGE_ZONE = 40;
    const SCROLL_STEP = 12;
    if (e.clientX < stripRect.left + EDGE_ZONE) {
      mergeTimelineStrip.scrollLeft = Math.max(0, mergeTimelineStrip.scrollLeft - SCROLL_STEP);
    } else if (e.clientX > stripRect.right - EDGE_ZONE) {
      const maxScroll = (mergeTimelineStrip.scrollWidth || 0) - (mergeTimelineStrip.clientWidth || 0);
      mergeTimelineStrip.scrollLeft = Math.min(maxScroll, mergeTimelineStrip.scrollLeft + SCROLL_STEP);
    }

    // The caret follows the slot under the cursor (gaps and trailing space
    // included, matching the old strip-level dragover behavior).
    const slot = mergeSlotFromClientX(e.clientX);
    clearBlockDragClasses();
    blockDrag.block.classList.add('dragging');
    const target = mergeTimelineStrip.querySelectorAll('.merge-timeline-block')[slot.index];
    if (target && target !== blockDrag.block) {
      const rect = target.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      target.classList.add(before ? 'drag-over-left' : 'drag-over-right');
    }
    positionDropIndicator(slot.x);
  });

  window.addEventListener('pointerup', (e) => {
    if (!blockDrag || (e.pointerId ?? 0) !== blockDrag.pointerId) return;
    endBlockDrag(e);
  });

  window.addEventListener('pointercancel', cancelBlockDrag);
  window.addEventListener('blur', cancelBlockDrag);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && blockDrag) cancelBlockDrag();
  });

  // Dragging onto the strip's gaps or trailing empty space means "insert at
  // that slot" (a natural move-to-end gesture): the caret follows the cursor
  // there too, and dropping inserts/appends at the computed slot.
  function mergeSlotFromClientX(clientX) {
    const blocks = mergeTimelineStrip.querySelectorAll('.merge-timeline-block');
    if (!blocks.length) return { index: 0, x: 12 };
    let index = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const rect = blocks[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) { index = i; break; }
    }
    if (index >= blocks.length) {
      const last = blocks[blocks.length - 1];
      return { index, x: last.offsetLeft + last.offsetWidth + 3 };
    }
    return { index, x: blocks[index].offsetLeft };
  }

  // (OS file drops are handled by the merge stage/sidebar overlay handlers
  // via bubbling — the strip no longer registers its own internal-reorder
  // dragover/drop, which the pointer-based block gestures replaced.)

  // Instantiate MergePlayer
  const mergePlayer = new MergePlayer({
    videoElement: document.getElementById('merge-video'),
    preloadElement: document.getElementById('merge-preload-video'),
    scrubberCanvas: document.getElementById('merge-scrubber-canvas'),
    timecodeDisplay: document.getElementById('merge-timecode'),
    onPlayStateChange: (isPlaying) => {
      if (mergePlayBtn) {
        mergePlayBtn.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
        mergePlayBtn.title = isPlaying ? 'Pause (Space)' : 'Play (Space)';
      }
      // Update clip indicator
      if (mergeClipIndicator && mergeClips.length > 0) {
        mergeClipIndicator.textContent = `Clip ${mergePlayer.currentClipIndex + 1} / ${mergeClips.length}`;
      }
      updateMergeTrimDisplay();
    },
    onClipChange: (index) => {
      if (mergeTimelineStrip) {
        const blocks = mergeTimelineStrip.querySelectorAll('.merge-timeline-block');
        blocks.forEach((block, i) => {
          if (i === index) block.classList.add('active-clip');
          else block.classList.remove('active-clip');
        });
        // Keep the active block in view when the timeline is scrolled
        const activeBlock = blocks[index];
        if (activeBlock && typeof activeBlock.scrollIntoView === 'function') {
          try {
            activeBlock.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
          } catch (e) { /* jsdom-safe */ }
        }
      }
      if (mergeClipIndicator && mergeClips.length > 0) {
        mergeClipIndicator.textContent = `Clip ${index + 1} / ${mergeClips.length}`;
      }
      updateMergeTrimDisplay();
    }
  });

  mergePlayBtn?.addEventListener('click', () => mergePlayer.togglePlay());

  // Track mode for keyboard shortcuts
  // The shared Export Settings panel is mostly trim machinery (plan estimate,
  // multi-trim output mode); hide those bits while in Merge mode so they can't
  // show a stale trim plan or an irrelevant "Output Mode" dropdown.
  function updateExportPanelForMode() {
    const isMerge = currentMergeMode;
    if (calculateBtn) calculateBtn.style.display = isMerge ? 'none' : '';
    // The title-bar plan (and its warnings) belongs to Trim mode. Hiding it on
    // a switch to Merge stops a stale trim plan from lingering above the merge
    // stage; switching back restores it if a plan still exists.
    if (isMerge) {
      estimateBar.hide();
      warningsUI.show(lastMergeWarnings);
    } else if (currentPlan && lastPlanOptions) {
      estimateBar.show(currentPlan, lastPlanOptions);
      warningsUI.show(lastWarnings);
    } else {
      // No trim plan -> no badge; otherwise stale merge warnings would linger.
      warningsUI.show([]);
    }
    const mec = document.getElementById('multi-export-mode-container');
    if (mec) {
      if (isMerge) {
        mec.style.display = 'none';
      } else {
        const isMp3 = formatSelect ? formatSelect.value === 'mp3' : false;
        const hasMultiSegments = !!(timeline && timeline.getSegments && timeline.getSegments().length > 1);
        mec.style.display = (!isMp3 && hasMultiSegments) ? 'block' : 'none';
      }
    }
  }

  function updateMergeUI() {
    // Normalize per-clip trims (defaults to the full clip)
    mergeClips.forEach(c => {
      if (typeof c.trimIn !== 'number') c.trimIn = 0;
      if (typeof c.trimOut !== 'number') c.trimOut = (c.mediaInfo && c.mediaInfo.duration) || 0;
    });
    // The output-size estimate must follow clip add/remove/reorder too; it
    // starts hidden and is only refreshed by preset/trim/format hooks.
    updateMergeEstimate();

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
    const clipListHeader = document.getElementById('merge-clip-list-header');
    if (clipListHeader) {
      clipListHeader.textContent = mergeClips.length > 0 ? `Clip List (${mergeClips.length})` : 'Clip List';
    }
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
        
        const indexBadge = document.createElement('span');
        indexBadge.className = 'merge-clip-index';
        indexBadge.textContent = index + 1;
        
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
        
        // Show the trim range when this clip is trimmed
        const fullDur = clip.mediaInfo.duration;
        const tIn = typeof clip.trimIn === 'number' ? clip.trimIn : 0;
        const tOut = typeof clip.trimOut === 'number' ? clip.trimOut : fullDur;
        if (tIn > 0.05 || tOut < fullDur - 0.05) {
          meta.textContent += ` • ✂ ${formatTrimDur(tIn)}-${formatTrimDur(tOut)}`;
        }
        // Full info on hover (the line itself may be ellipsized)
        meta.title = meta.textContent;
        
        info.appendChild(title);
        info.appendChild(meta);
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'merge-clip-remove';
        removeBtn.innerHTML = '&#xE8BB;';
        removeBtn.title = 'Remove';
        removeBtn.onclick = () => {
          const removed = mergeClips[index];
          recordUndo('Remove clip');
          mergePlayer.removeClipAtIndex(index);
          mergeClips.splice(index, 1);
          // Note: the thumbnail temp file is intentionally left in place —
          // undo may restore this clip, and its thumbnail must still exist.
          // The main process cleans thumbnails on quit and sweeps stale ones
          // at startup, so removed clips don't linger forever.
          // The compatibility warning described a different clip set — clear it.
          showMergeWarnings([]);
          updateMergeUI();
          toast('Clip removed');
        };
        
        item.appendChild(indexBadge);
        item.appendChild(img);
        item.appendChild(info);
        item.appendChild(removeBtn);
        mergeClipList.appendChild(item);
      });
    }

    // 2. Timeline Strip
    if (!mergeTimelineStrip) return;
    mergeTimelineStrip.innerHTML = '';
    
    if (mergeClips.length === 0) {
      mergeTimelineStrip.innerHTML = `
        <div id="merge-empty-timeline" style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; border: 2px dashed var(--panel-border); border-radius: 6px;">
          <span style="color: var(--text-secondary);">Timeline will appear here</span>
        </div>`;
    } else {
      mergeClips.forEach((clip, index) => {
        const full = (clip.mediaInfo && clip.mediaInfo.duration) || 0;
        const tin = typeof clip.trimIn === 'number' ? Math.max(0, Math.min(clip.trimIn, full)) : 0;
        const tout = typeof clip.trimOut === 'number' ? Math.max(0, Math.min(clip.trimOut, full)) : full;
        const dur = mergePlayer.getClipDuration(clip);
        const inPct = full > 0 ? (tin / full) * 100 : 0;
        const outPct = full > 0 ? (tout / full) * 100 : 100;
        const isTrimmed = tin > 0.05 || tout < full - 0.05;

        const block = document.createElement('div');
        block.className = 'merge-timeline-block';
        if (index === mergePlayer.currentClipIndex) {
          block.classList.add('active-clip');
        }
        if (clip.thumbnailPath) {
          block.style.backgroundImage = `url("${clip.thumbnailPath}")`;
        }
        
        // Blocks are sized by the clip's FULL source duration so the timeline
        // stays fixed in place — trims are shown as dimmed regions inside the
        // block instead of resizing it (which would shift every later clip).
        const flexRatio = Math.max(full, 0.01);
        block.style.flexGrow = flexRatio;
        block.style.flexBasis = '0';
        // Generous min width keeps thumbnails usable with many clips; the strip
        // scrolls horizontally instead of squashing blocks into nothing.
        block.style.minWidth = '120px';
        block.style.flexShrink = '0';
        
        // Trim dim overlays + draggable handles
        const dimLeft = document.createElement('div');
        dimLeft.className = 'merge-trim-dim merge-trim-dim-left';
        dimLeft.style.left = '0';
        dimLeft.style.width = `${inPct}%`;
        
        const dimRight = document.createElement('div');
        dimRight.className = 'merge-trim-dim merge-trim-dim-right';
        dimRight.style.right = '0';
        dimRight.style.width = `${Math.max(0, 100 - outPct)}%`;
        
        // Bright window outlining exactly the kept (exported) portion, so it's
        // obvious where the crop is. Hidden when the clip isn't trimmed.
        const keepWin = document.createElement('div');
        keepWin.className = 'merge-trim-keep';
        keepWin.style.left = `${inPct}%`;
        keepWin.style.width = `${Math.max(0, outPct - inPct)}%`;
        if (!isTrimmed) keepWin.style.display = 'none';
        
        const handleIn = document.createElement('div');
        handleIn.className = 'merge-trim-handle merge-trim-handle-in';
        handleIn.style.left = `${inPct}%`;
        handleIn.title = 'Drag to set trim in';
        
        const handleOut = document.createElement('div');
        handleOut.className = 'merge-trim-handle merge-trim-handle-out';
        handleOut.style.left = `${outPct}%`;
        handleOut.title = 'Drag to set trim out';
        
        handleIn.addEventListener('mousedown', (e) => beginTrimDrag(e, block, clip, 'in'));
        handleOut.addEventListener('mousedown', (e) => beginTrimDrag(e, block, clip, 'out'));
        
        const indexChip = document.createElement('span');
        indexChip.className = 'merge-timeline-index';
        indexChip.textContent = index + 1;
        indexChip.title = `Clip ${index + 1} of ${mergeClips.length}`;
        
        const durLabel = document.createElement('div');
        durLabel.className = 'merge-timeline-duration';
        durLabel.textContent = isTrimmed ? `✂ ${formatTrimDur(dur)}` : formatTrimDur(dur);
        
        block.appendChild(dimLeft);
        block.appendChild(dimRight);
        block.appendChild(keepWin);
        block.appendChild(handleIn);
        block.appendChild(handleOut);
        block.appendChild(indexChip);
        block.appendChild(durLabel);
        
        // Pointer gesture: a plain click seeks to the exact position clicked
        // within this clip; dragging past a small threshold reorders the
        // clip. (Native HTML5 drag on the whole block hijacked simple clicks
        // and only ever jumped to the clip's trim start.)
        block.dataset.index = index;
        block.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return; // primary button only
          if (e.target.closest && e.target.closest('.merge-trim-handle')) return; // trim handles own their gesture
          e.preventDefault();
          blockDrag = {
            block, index,
            startX: e.clientX, startY: e.clientY,
            active: false,
            pointerId: e.pointerId ?? 0
          };
          // Capture the pointer so the gesture survives the cursor leaving
          // the block (or window) mid-drag.
          if (typeof block.setPointerCapture === 'function') {
            try { block.setPointerCapture(blockDrag.pointerId); } catch (err) {}
          }
        });
        
        mergeTimelineStrip.appendChild(block);
      });
    }

    // 3. Export button state
    if (exportMergedBtn) exportMergedBtn.disabled = mergeClips.length < 2;

    // 4. Clip indicator (hidden entirely when no clips are loaded, so the
    //    chip doesn't render as an empty box)
    if (mergeClipIndicator) {
      if (mergeClips.length > 0) {
        mergeClipIndicator.textContent = `Clip ${mergePlayer.currentClipIndex + 1} / ${mergeClips.length}`;
        mergeClipIndicator.style.display = '';
      } else {
        mergeClipIndicator.textContent = '';
        mergeClipIndicator.style.display = 'none';
      }
    }

    // 5. Sync player with current clip list
    mergePlayer.setClips(mergeClips);
    updateMergeTrimDisplay();
  }

  // --- Merge trim helpers ---

  /** Format seconds as m:ss for the merge trim readout. */
  function formatTrimDur(seconds) {
    const s = Math.max(0, seconds || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  /** Update the In / Out / Dur readout for the active clip. */
  function updateMergeTrimDisplay() {
    updateMergeEstimate();
    const inEl = document.getElementById('merge-trim-in');
    const outEl = document.getElementById('merge-trim-out');
    const durEl = document.getElementById('merge-trim-dur');
    const clip = mergeClips[mergePlayer.currentClipIndex];
    if (!clip) {
      if (inEl) inEl.textContent = '0:00';
      if (outEl) outEl.textContent = '0:00';
      if (durEl) durEl.textContent = '0:00';
      return;
    }
    const full = clip.mediaInfo.duration;
    const tin = typeof clip.trimIn === 'number' ? clip.trimIn : 0;
    const tout = typeof clip.trimOut === 'number' ? clip.trimOut : full;
    if (inEl) inEl.textContent = formatTrimDur(tin);
    if (outEl) outEl.textContent = formatTrimDur(tout);
    if (durEl) durEl.textContent = formatTrimDur(tout - tin);
  }

  /** Update a block's dim overlays/handles/duration label without rebuilding. */
  function applyTrimOverlay(blockEl, clip) {
    const full = (clip.mediaInfo && clip.mediaInfo.duration) || 0;
    const tin = typeof clip.trimIn === 'number' ? Math.max(0, Math.min(clip.trimIn, full)) : 0;
    const tout = typeof clip.trimOut === 'number' ? Math.max(0, Math.min(clip.trimOut, full)) : full;
    const inPct = full > 0 ? (tin / full) * 100 : 0;
    const outPct = full > 0 ? (tout / full) * 100 : 100;
    const dur = Math.max(0, tout - tin);

    const dimL = blockEl.querySelector('.merge-trim-dim-left');
    const dimR = blockEl.querySelector('.merge-trim-dim-right');
    const keep = blockEl.querySelector('.merge-trim-keep');
    const hIn = blockEl.querySelector('.merge-trim-handle-in');
    const hOut = blockEl.querySelector('.merge-trim-handle-out');
    const label = blockEl.querySelector('.merge-timeline-duration');

    const isTrimmed = tin > 0.05 || tout < full - 0.05;

    if (dimL) dimL.style.width = `${inPct}%`;
    if (dimR) dimR.style.width = `${Math.max(0, 100 - outPct)}%`;
    if (keep) {
      keep.style.display = isTrimmed ? 'block' : 'none';
      keep.style.left = `${inPct}%`;
      keep.style.width = `${Math.max(0, outPct - inPct)}%`;
    }
    if (hIn) hIn.style.left = `${inPct}%`;
    if (hOut) hOut.style.left = `${outPct}%`;
    if (label) {
      label.textContent = isTrimmed ? `✂ ${formatTrimDur(dur)}` : formatTrimDur(dur);
      label.title = isTrimmed ? `Trim ${formatTrimDur(tin)} - ${formatTrimDur(tout)}` : '';
    }
  }

  /** Start dragging a block's trim handle. Live-updates overlays, commits on mouseup. */
  function beginTrimDrag(e, blockEl, clip, edge) {
    e.preventDefault();
    e.stopPropagation();
    recordUndo('Edit clip trim');
    const full = (clip.mediaInfo && clip.mediaInfo.duration) || 0;
    const rect = blockEl.getBoundingClientRect();

    const onMove = (ev) => {
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const sec = frac * full;
      if (edge === 'in') {
        const tOut = typeof clip.trimOut === 'number' ? clip.trimOut : full;
        clip.trimIn = Math.max(0, Math.min(sec, tOut - 0.5));
      } else {
        const tIn = typeof clip.trimIn === 'number' ? clip.trimIn : 0;
        clip.trimOut = Math.min(full, Math.max(sec, tIn + 0.5));
      }
      applyTrimOverlay(blockEl, clip);
      updateMergeTrimDisplay();
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      mergePlayer.setClips(mergeClips);
      updateMergeUI();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // --- Trim set-in/out & jump helpers (shared with the I/O keyboard shortcuts) ---
  function trimSetIn() {
    if (!timeline || !videoPreview) return;
    recordUndo('Edit trim');
    timeline.setTrimIn(videoPreview.getCurrentTime());
    updateTrimDisplay();
    toast(`In set to ${formatTimecode(timeline.getTrimIn(), fps)}`);
  }

  function trimSetOut() {
    if (!timeline || !videoPreview) return;
    recordUndo('Edit trim');
    timeline.setTrimOut(videoPreview.getCurrentTime());
    updateTrimDisplay();
    toast(`Out set to ${formatTimecode(timeline.getTrimOut(), fps)}`);
  }

  function trimJumpIn() {
    if (!timeline || !videoPreview || !controlBar) return;
    const ti = timeline.getTrimIn();
    videoPreview.seekTo(ti);
    timeline.setPlayhead(ti);
    controlBar.updateTimecode(ti);
  }

  function trimJumpOut() {
    if (!timeline || !videoPreview || !controlBar) return;
    const to = timeline.getTrimOut();
    videoPreview.seekTo(to);
    timeline.setPlayhead(to);
    controlBar.updateTimecode(to);
  }

  // --- Loop playback toggle (Trim) ---
  const trimLoopBtn = document.getElementById('trim-loop-btn');
  function setTrimLoop(on) {
    loopEnabled = on;
    trimLoopBtn?.classList.toggle('active', on);
    trimLoopBtn?.setAttribute('title', on ? 'Loop on - click to disable' : 'Loop playback (I / O to set range)');
    toast(on ? 'Loop on - plays the trimmed range' : 'Loop off', on ? 'success' : undefined);
  }
  trimLoopBtn?.addEventListener('click', () => setTrimLoop(!loopEnabled));

  // --- Playback speed (applies to preview AND the export plan) ---
  const speedSelect = document.getElementById('speed-select');
  function setPlaybackSpeed(speed) {
    exportState.playbackSpeed = Number(speed) || 1;
    if (videoPreview) videoPreview.setPlaybackRate(exportState.playbackSpeed);
    // Share the knob with the merge preview so speeds match across modes
    // (merge EXPORTS stay at normal speed — the knob lives in the trim bar).
    const mvEl = document.getElementById('merge-video');
    const mpEl = document.getElementById('merge-preload-video');
    if (mvEl) mvEl.playbackRate = exportState.playbackSpeed;
    if (mpEl) mpEl.playbackRate = exportState.playbackSpeed;
  }
  speedSelect?.addEventListener('change', (e) => {
    setPlaybackSpeed(e.target.value);
    clearExportPlan(); // plan bitrates/durations change with speed
  });

  // --- Timeline zoom controls (Ctrl+wheel on the canvas, +/- buttons, click readout to reset) ---
  const zoomInBtn = document.getElementById('timeline-zoom-in');
  const zoomOutBtn = document.getElementById('timeline-zoom-out');
  const zoomReadout = document.getElementById('timeline-zoom-readout');
  zoomInBtn?.addEventListener('click', () => { if (timeline) timeline.zoomBy(1.5); });
  zoomOutBtn?.addEventListener('click', () => { if (timeline) timeline.zoomBy(1 / 1.5); });
  zoomReadout?.addEventListener('click', () => { if (timeline) timeline.resetView(); });

  // --- Merge trim transport buttons ---
  const mergeSetInBtn = document.getElementById('merge-set-in-btn');
  const mergeSetOutBtn = document.getElementById('merge-set-out-btn');
  const mergeJumpInBtn = document.getElementById('merge-jump-in-btn');
  const mergeJumpOutBtn = document.getElementById('merge-jump-out-btn');
  const mergeResetTrimBtn = document.getElementById('merge-reset-trim-btn');

  // Named helpers shared by the transport buttons and the I/O keyboard shortcuts.
  function mergeSetTrimIn() {
    const idx = mergePlayer.currentClipIndex;
    const clip = mergeClips[idx];
    if (!clip) return;
    const full = clip.mediaInfo.duration;
    const tout = typeof clip.trimOut === 'number' ? clip.trimOut : full;
    const cur = mergeVideoEl.currentTime || 0;
    const tin = Math.max(0, Math.min(cur, tout - 0.5));
    recordUndo('Set clip trim');
    mergePlayer.setTrimForClip(idx, tin, tout);
    updateMergeUI();
    toast(`In set to ${formatTrimDur(mergeClips[idx].trimIn)}`, 'success');
  }

  function mergeSetTrimOut() {
    const idx = mergePlayer.currentClipIndex;
    const clip = mergeClips[idx];
    if (!clip) return;
    const full = clip.mediaInfo.duration;
    const tin = typeof clip.trimIn === 'number' ? clip.trimIn : 0;
    const cur = mergeVideoEl.currentTime || 0;
    const tout = Math.min(full, Math.max(cur, tin + 0.5));
    recordUndo('Set clip trim');
    mergePlayer.setTrimForClip(idx, tin, tout);
    updateMergeUI();
    toast(`Out set to ${formatTrimDur(mergeClips[idx].trimOut)}`, 'success');
  }

  function mergeJumpTrimIn() {
    const idx = mergePlayer.currentClipIndex;
    if (!mergeClips[idx] || !mergePlayer.boundaries[idx]) return;
    mergePlayer.seekToGlobal(mergePlayer.boundaries[idx].start);
  }

  function mergeJumpTrimOut() {
    const idx = mergePlayer.currentClipIndex;
    const b = mergePlayer.boundaries[idx];
    if (!mergeClips[idx] || !b) return;
    mergePlayer.seekToGlobal(Math.max(b.start, b.end - 0.01));
  }

  mergeSetInBtn?.addEventListener('click', mergeSetTrimIn);
  mergeSetOutBtn?.addEventListener('click', mergeSetTrimOut);
  mergeJumpInBtn?.addEventListener('click', mergeJumpTrimIn);
  mergeJumpOutBtn?.addEventListener('click', mergeJumpTrimOut);

  // --- Loop playback toggle (Merge) ---
  const mergeLoopBtn = document.getElementById('merge-loop-btn');
  function setMergeLoop(on) {
    mergePlayer.setLoop(on);
    mergeLoopBtn?.classList.toggle('active', on);
    mergeLoopBtn?.setAttribute('title', on ? 'Loop on - click to disable' : 'Loop playback (I / O to set range)');
    toast(on ? 'Loop on - repeats the merged sequence' : 'Loop off', on ? 'success' : undefined);
  }
  mergeLoopBtn?.addEventListener('click', () => setMergeLoop(!mergePlayer.loop));

  mergeResetTrimBtn?.addEventListener('click', () => {
    const idx = mergePlayer.currentClipIndex;
    const clip = mergeClips[idx];
    if (!clip) return;
    recordUndo('Reset clip trim');
    mergePlayer.setTrimForClip(idx, 0, clip.mediaInfo.duration);
    updateMergeUI();
    toast('Trim reset for this clip', 'success');
  });

  const addClipsBtn = document.getElementById('add-clips-btn');
  addClipsBtn?.addEventListener('click', async () => {
    addClipsBtn.disabled = true;
    addClipsBtn.textContent = 'Probing...';
    try {
      const result = await window.clipSend.openMultipleFiles();
      if (result && result.success) {
        recordUndo('Add clips');
        mergeClips.push(...result.clips);
        // New clips can change compatibility (and the warning names indices).
        showMergeWarnings([]);
        updateMergeUI();
        const n = result.clips.length;
        toast(`Added ${n} clip${n === 1 ? '' : 's'}`, 'success');
      } else if (result && result.error) {
        showErrorDialog('Error adding clips: ' + result.error, { title: 'Error adding clips' });
      }
    } catch (e) {
      showErrorDialog('Failed to add clips: ' + e.message, { title: 'Failed to add clips' });
    } finally {
      addClipsBtn.disabled = false;
      addClipsBtn.textContent = 'Add Clips...';
    }
  });

  // The empty-stage "Add Clips" card button is an alias for the sidebar button.
  document.getElementById('merge-empty-open-btn')?.addEventListener('click', () => addClipsBtn?.click());

  // Merge mode export logic
  // True while a merge export runs — the titlebar cancel button routes to
  // cancelMerge() instead of cancelExport() during that window.
  let mergeExportActive = false;

  // Merge warnings live in the same title-bar warnings badge/modal as the
  // trim-mode plan warnings — one canonical place to look. Kept separate from
  // lastWarnings so a mode switch restores the right set.
  function showMergeWarnings(warnings) {
    lastMergeWarnings = warnings || [];
    warningsUI.show(lastMergeWarnings);
  }

  // Live estimate of the merged output size, shown under Export Merged Video.
  // Size-capped presets report the target; the default lossless merge sums the
  // source sizes scaled by each clip's kept trim.
  const mergeEstimateEl = document.getElementById('merge-estimate');
  const mergeEstimateValue = document.getElementById('merge-estimate-value');

  function updateMergeEstimate() {
    if (!mergeEstimateEl || !mergeEstimateValue) return;
    if (mergeClips.length === 0) {
      mergeEstimateEl.style.display = 'none';
      return;
    }
    const fmt = formatSelect ? formatSelect.value : 'mp4';
    if (fmt !== 'mp4') { // GIF/MP3 re-encode; can't predict from source sizes
      mergeEstimateEl.style.display = 'none';
      return;
    }
    // Size-capped preset -> the encoder aims for that size. The selected
    // preset always applies to merge exports (the dropdown is shared and
    // visible, so what you see is what you get); "Auto (Best Quality)"
    // (mode 'auto') keeps the lossless merge path.
    const exportPreset = presets.find(p => p.id === (presetSelect ? presetSelect.value : ''));
    let cappedMB = null;
    if (exportPreset) {
      if (exportPreset.isCustom) {
        const v = parseFloat(customSizeInput ? customSizeInput.value : '');
        if (!isNaN(v) && v > 0) cappedMB = v;
      } else if (exportPreset.mode === 'size-limit') {
        cappedMB = exportPreset.sizeMB;
      }
    }
    if (cappedMB) {
      mergeEstimateValue.textContent = `≈ ${cappedMB} MB (target)`;
      mergeEstimateEl.style.display = 'flex';
      return;
    }
    // Lossless merge: sum of the probed source sizes (already in memory from
    // probeFile -> mediaInfo.fileSize), scaled by each clip's kept trim.
    // Fully synchronous - no IPC, debounce, or staleness guard needed.
    let totalBytes = 0;
    let clipsWithSize = 0;
    mergeClips.forEach(c => {
      const fileSize = Number(c.mediaInfo && c.mediaInfo.fileSize) || 0;
      if (fileSize > 0) clipsWithSize++;
      const dur = (c.mediaInfo && c.mediaInfo.duration) || 0;
      const keep = (typeof c.trimIn === 'number' && typeof c.trimOut === 'number' && dur > 0)
        ? Math.min(1, Math.max(0, (c.trimOut - c.trimIn) / dur))
        : 1;
      totalBytes += fileSize * keep;
    });
    if (clipsWithSize === 0) {
      // No clip reported a usable size (probe parse edge) - hide rather than
      // show a misleading "≈ 0.0 MB" readout.
      mergeEstimateEl.style.display = 'none';
      return;
    }
    const mb = totalBytes / (1024 * 1024);
    mergeEstimateValue.textContent = mb >= 100
      ? `≈ ${Math.round(mb)} MB (lossless)`
      : `≈ ${mb.toFixed(1)} MB (lossless)`;
    mergeEstimateEl.style.display = 'flex';
  }

  exportMergedBtn?.addEventListener('click', async () => {
    if (mergeClips.length < 2) return;

    exportMergedBtn.disabled = true;
    addClipsBtn.disabled = true;
    showMergeWarnings([]);

    try {
      const filePaths = mergeClips.map(c => c.filePath);
      
      // 1. Pre-export compatibility check
      const mergeWarns = [];
      const compatCheck = await window.clipSend.checkMergeCompat(filePaths);
      if (compatCheck && compatCheck.success) {
        if (!compatCheck.compatible) {
          mergeWarns.push({ id: 'merge-reencode', title: 'Merge will re-encode', body: `Clips have different formats - merge will re-encode (slower). Reason: ${compatCheck.reason}` });
        }
      } else if (compatCheck && !compatCheck.success) {
        showErrorDialog(compatCheck.error, { title: 'Failed to check compatibility' });
        exportMergedBtn.disabled = false;
        addClipsBtn.disabled = false;
        return;
      }

      // 1b. Pre-flight: a clip whose trim In starts at/past the end of its
      // video track contributes zero frames to the merge (the music-file
      // shape: audio outlasts the video). That fails mid-encode with a cryptic
      // ffmpeg error, so catch it here and let the user fix the trim first.
      const noVideoClips = mergeClips.filter(c => {
        const info = c.mediaInfo || {};
        return isTrimPastVideoEnd(typeof c.trimIn === 'number' ? c.trimIn : 0, info.videoDuration, info.duration);
      });
      if (noVideoClips.length > 0) {
        noVideoClips.forEach(c => {
          const name = (c.filePath || '').split('\\').pop().split('/').pop();
          mergeWarns.push({ id: 'merge-no-video', title: 'Clip has no video frames', body: `Clip "${name}" is trimmed to start after its video track ends — it has no video frames to merge. Move its trim In earlier.` });
        });
        showMergeWarnings(mergeWarns);
        showErrorDialog('One or more clips are trimmed to start after their video track ends, so the merge would contain no video. Move each clip\'s trim In earlier and try again.', { title: 'Merge has no video frames' });
        exportMergedBtn.disabled = false;
        addClipsBtn.disabled = false;
        return;
      }

      if (mergeWarns.length > 0) showMergeWarnings(mergeWarns);

      // 2. Start Export — pass per-clip trims so each clip is trimmed before
      // merging. Progress uses the same titlebar cluster as trim exports.
      mergeExportActive = true;
      progressUI.show();
      progressUI.setPercent(0, 'Merging...');
      progressUI.disableCancel();

      const trims = mergeClips.map(c => ({
        trimIn: typeof c.trimIn === 'number' ? c.trimIn : 0,
        trimOut: typeof c.trimOut === 'number' ? c.trimOut : (c.mediaInfo && c.mediaInfo.duration) || 0
      }));

      // Export settings from the shared panel. The selected preset always
      // applies (the dropdown is visible); "Auto (Best Quality)" (mode
      // 'auto') keeps the lossless fast merge path.
      const exportFormat = formatSelect ? formatSelect.value : 'mp4';
      const exportResolution = resolutionSelect ? resolutionSelect.value : 'native';
      const exportPreset = presets.find(p => p.id === (presetSelect ? presetSelect.value : ''));
      let exportTargetSizeMB = null;
      if (exportPreset) {
        if (exportPreset.isCustom) {
          const v = parseFloat(customSizeInput ? customSizeInput.value : '');
          if (!isNaN(v) && v > 0) exportTargetSizeMB = v;
        } else if (exportPreset.mode === 'size-limit') {
          exportTargetSizeMB = exportPreset.sizeMB;
        }
      }

      const result = await window.clipSend.startMerge(filePaths, undefined, trims, {
        format: exportFormat,
        resolution: exportResolution,
        targetSizeMB: exportTargetSizeMB,
        totalDurationSec: mergePlayer.totalDuration || 0
      });
      
      if (!result) {
        // Cancelled via save dialog
        progressUI.hide();
        exportMergedBtn.disabled = false;
        addClipsBtn.disabled = false;
        return;
      }

      if (result.success) {
        // The shared export modal hides its Copy button unless asked — merged
        // files paste into Discord/Slack/Explorer just like trim exports, so
        // offer the same copy affordance here. A best-effort size-cap miss
        // (merge retry loop) surfaces as a modal warning.
        showExportModal(result.filePath, result.finalSizeMB, result.strategy, true, result.warning ? [result.warning] : []);
      } else if (result.cancelled) {
        // Suppress
      } else {
        showErrorDialog(result.error, { title: 'Merge failed', details: result.details });
      }

    } catch (e) {
      showErrorDialog(e.message, { title: 'Merge failed', details: e.details });
    } finally {
      mergeExportActive = false;
      progressUI.hide();
      // Enable buttons again
      exportMergedBtn.disabled = mergeClips.length < 2;
      addClipsBtn.disabled = false;
    }
  });

  window.clipSend.onMergeProgress((data) => {
    const { percent, status } = data;
    // Drive the shared titlebar progress cluster (same as trim exports).
    progressUI.setPercent(percent, status);
    progressUI.enableCancel();
  });

  // Initial call to set empty states correctly
  updateMergeUI();

  // --- Auto Updater UI ---
  const updateBadgeBtn = document.getElementById('update-badge-btn');
  const updateBadgeText = document.getElementById('update-badge-text');
  const updateModal = document.getElementById('update-modal');
  const closeUpdateModalBtn = document.getElementById('close-update-modal-btn');
  const updateLaterBtn = document.getElementById('update-later-btn');
  const startUpdateBtn = document.getElementById('start-update-btn');
  const updateModalVersionInfo = document.getElementById('update-modal-version-info');
  const updateNotesContainer = document.getElementById('update-notes-container');
  const updateProgressSection = document.getElementById('update-progress-section');
  const updateProgressStatus = document.getElementById('update-progress-status');
  const updateProgressPercent = document.getElementById('update-progress-percent');
  const updateProgressBarFill = document.getElementById('update-progress-bar-fill');

  let activeUpdateData = null;

  if (window.clipSend.onUpdateAvailable) {
    window.clipSend.onUpdateAvailable((info) => {
      activeUpdateData = info;
      if (updateBadgeBtn) {
        if (updateBadgeText) updateBadgeText.textContent = `Update (${info.version})`;
        updateBadgeBtn.style.display = 'inline-flex';
      }
    });
  }

  function openUpdateModal() {
    if (!activeUpdateData) return;
    if (updateModalVersionInfo) {
      updateModalVersionInfo.textContent = `A new version of ClipSend (${activeUpdateData.version}) is available. Current version is ${activeUpdateData.currentVersion || ''}.`;
    }
    if (updateNotesContainer) {
      // GitHub release notes arrive as HTML; render a sanitized subset so the
      // changelog looks like a changelog instead of a wall of markup text.
      const notesHtml = sanitizeReleaseNotes(activeUpdateData.releaseNotes);
      if (notesHtml) {
        updateNotesContainer.innerHTML = notesHtml;
      } else {
        updateNotesContainer.textContent = 'No release notes provided.';
      }
    }
    if (updateProgressSection) updateProgressSection.style.display = 'none';
    if (startUpdateBtn) {
      startUpdateBtn.disabled = false;
      const span = startUpdateBtn.querySelector('span');
      if (span) span.textContent = 'Download & Install';
    }
    if (updateLaterBtn) updateLaterBtn.disabled = false;
    openModal(updateModal);
  }

  updateBadgeBtn?.addEventListener('click', openUpdateModal);
  closeUpdateModalBtn?.addEventListener('click', () => {
    if (updateModal) closeModal(updateModal);
  });
  updateLaterBtn?.addEventListener('click', () => {
    if (updateModal) closeModal(updateModal);
  });

  // Changelog links (mentions, PR numbers, compare URLs) must open in the
  // default browser — navigating the app window to GitHub would strand the
  // user on a webpage with no way back into the app.
  updateNotesContainer?.addEventListener('click', (e) => {
    const anchor = e.target.closest ? e.target.closest('a') : null;
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute('href');
    if (href && window.clipSend.openExternalUrl) {
      window.clipSend.openExternalUrl(href);
    }
  });

  startUpdateBtn?.addEventListener('click', async () => {
    if (!activeUpdateData) return;
    if (startUpdateBtn) {
      startUpdateBtn.disabled = true;
      const span = startUpdateBtn.querySelector('span');
      if (span) span.textContent = 'Downloading...';
    }
    if (updateLaterBtn) updateLaterBtn.disabled = true;
    if (updateProgressSection) updateProgressSection.style.display = 'flex';

    try {
      await window.clipSend.downloadAndInstallUpdate();
    } catch (err) {
      if (updateProgressStatus) updateProgressStatus.textContent = `Error: ${err.message}`;
      if (startUpdateBtn) {
        startUpdateBtn.disabled = false;
        const span = startUpdateBtn.querySelector('span');
        if (span) span.textContent = 'Retry Download';
      }
      if (updateLaterBtn) updateLaterBtn.disabled = false;
    }
  });

  if (window.clipSend.onUpdateProgress) {
    window.clipSend.onUpdateProgress((data) => {
      const pct = data.percent || 0;
      if (updateProgressPercent) updateProgressPercent.textContent = `${pct}%`;
      if (updateProgressBarFill) updateProgressBarFill.style.transform = `scaleX(${pct / 100})`;
      const mbDownloaded = (data.downloadedBytes / (1024 * 1024)).toFixed(1);
      const mbTotal = (data.totalBytes / (1024 * 1024)).toFixed(1);
      if (updateProgressStatus) {
        updateProgressStatus.textContent = `Downloading update (${mbDownloaded} MB / ${mbTotal} MB)...`;
      }
    });
  }

  if (window.clipSend.onUpdateDownloaded) {
    window.clipSend.onUpdateDownloaded(() => {
      if (updateProgressStatus) updateProgressStatus.textContent = 'Download complete! Launching installer to finish the update...';
      if (updateProgressPercent) updateProgressPercent.textContent = '100%';
      if (updateProgressBarFill) updateProgressBarFill.style.transform = 'scaleX(1)';
    });
  }

  if (window.clipSend.onUpdateError) {
    window.clipSend.onUpdateError((errMsg) => {
      if (updateProgressStatus) updateProgressStatus.textContent = `Update Error: ${errMsg}`;
      if (startUpdateBtn) {
        startUpdateBtn.disabled = false;
        const span = startUpdateBtn.querySelector('span');
        if (span) span.textContent = 'Retry Download';
      }
      if (updateLaterBtn) updateLaterBtn.disabled = false;
    });
  }

  // Surface the previous install attempt's outcome (read from update-attempt.json on startup).
  if (window.clipSend.onUpdateInstalledResult) {
    window.clipSend.onUpdateInstalledResult((result) => {
      const ok = result && result.success === true;
      if (updateProgressStatus) {
        updateProgressStatus.textContent = ok
          ? `Update ${result.version || ''} installed successfully.`
          : `Update ${result && result.version ? result.version : ''} was not applied on the last attempt. Check the updater log for details.`;
        updateProgressStatus.style.color = ok ? 'var(--success-color)' : 'var(--error-color)';
      }
      if (updateProgressPercent) updateProgressPercent.textContent = ok ? '100%' : '0%';
      if (updateProgressBarFill) updateProgressBarFill.style.width = ok ? '100%' : '0%';
      if (updateProgressSection) updateProgressSection.style.display = 'flex';
      openModal(updateModal);
    });
  }

  // --- Keyboard shortcuts help (?) ---
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const closeShortcutsBtn = document.getElementById('close-shortcuts-btn');
  const shortcutsTrim = document.getElementById('shortcuts-trim-section');
  const shortcutsMerge = document.getElementById('shortcuts-merge-section');

  function toggleShortcutsModal() {
    if (!shortcutsModal) return;
    if (shortcutsModal.style.display !== 'none') {
      closeModal(shortcutsModal);
      return;
    }
    // Highlight the section matching the active mode.
    if (shortcutsTrim) shortcutsTrim.classList.toggle('active', !currentMergeMode);
    if (shortcutsMerge) shortcutsMerge.classList.toggle('active', currentMergeMode);
    openModal(shortcutsModal);
  }
  document.getElementById('help-btn')?.addEventListener('click', toggleShortcutsModal);
  closeShortcutsBtn?.addEventListener('click', () => closeModal(shortcutsModal));
  shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) closeModal(shortcutsModal);
  });

  // --- Keyboard shortcuts ---
  // No hardcoded switch here: keydown maps to an action via the remappable
  // keymap (renderer/utils/keymap.js), so Settings → Keyboard Shortcuts can
  // move any action to a new key. The help modal (? ) reflects the live map.
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in the timecode field or a form control
    const target = e.target;
    if (target.getAttribute && target.getAttribute('contenteditable') === 'true') return;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    // While the shortcut editor is open, its dropdowns own the keyboard —
    // remapping I to something else must not set a trim point underneath.
    const editorModal = document.getElementById('shortcut-editor-modal');
    if (editorModal && editorModal.style.display === 'flex') return;

    const action = matchAction(e, activeBindings);
    if (!action) return;

    // Global actions work in both modes, before any mode guard.
    switch (action) {
      case 'showShortcuts':
        e.preventDefault();
        toggleShortcutsModal();
        return;
      case 'undo':
        e.preventDefault();
        undo();
        return;
      case 'redo':
        e.preventDefault();
        redo();
        return;
    }

    // Holding the play key fires repeated keydown; don't flip play/pause
    // on every repeat.
    if (action === 'playPause' && e.repeat) return;

    if (currentMergeMode) {
      // Merge mode shortcuts
      if (mergeClips.length === 0) return;
      switch (action) {
        case 'playPause':
          e.preventDefault();
          mergePlayer.togglePlay();
          return;
        case 'setIn':
          e.preventDefault();
          mergeSetTrimIn();
          return;
        case 'setOut':
          e.preventDefault();
          mergeSetTrimOut();
          return;
        case 'jumpIn':
          e.preventDefault();
          mergeJumpTrimIn();
          return;
        case 'jumpOut':
          e.preventDefault();
          mergeJumpTrimOut();
          return;
      }
    } else {
      // Trim mode shortcuts
      if (!videoPreview || !timeline) return;
      switch (action) {
        case 'playPause':
          e.preventDefault();
          videoPreview.togglePlay();
          return;
        case 'frameBack':
          e.preventDefault();
          videoPreview.frameStep(-1, fps);
          return;
        case 'frameForward':
          e.preventDefault();
          videoPreview.frameStep(1, fps);
          return;
        case 'setIn':
          e.preventDefault();
          trimSetIn();
          return;
        case 'setOut':
          e.preventDefault();
          trimSetOut();
          return;
        case 'jumpIn':
          e.preventDefault();
          trimJumpIn();
          return;
        case 'jumpOut':
          e.preventDefault();
          trimJumpOut();
          return;
      }
    }
  });
});
