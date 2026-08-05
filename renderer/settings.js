// Settings & playback state: the settings modal (directory, hw accel,
// max quality, waveform toggle), volume slider/mute state, and NVENC
// detection. All app-level side effects (players, timeline, plan
// invalidation, IPC) are injected via the `context` object so this module
// is testable in jsdom with a fake api and no Electron bridge.

import { openModal, closeModal } from './utils/modals.js';

const DEFAULT_VOLUME = 0.6;

/**
 * Create the settings controller.
 *
 * @param {object} context
 * @param {object} context.api - window.clipSend IPC bridge
 * @param {object} context.elements - DOM element references
 * @param {object} [context.timeline] - Timeline instance (waveform toggle)
 * @param {(hasNvenc: boolean) => void} [context.onNvencDetected]
 * @param {() => void} [context.onPlanInvalidated] - clear the export plan
 * @param {(checked: boolean) => void} [context.onShowWaveformChange] - app applies to timeline + reloads waveform
 * @param {(volume: number, muted: boolean) => void} [context.onApplyVolumeToPlayers]
 */
export function createSettingsController(context) {
  const { api, elements, timeline, onNvencDetected, onPlanInvalidated, onShowWaveformChange, onApplyVolumeToPlayers } = context;

  const {
    modal,
    openBtn,
    closeBtn,
    exportDir,
    browseBtn,
    clearBtn,
    hwAccel,
    disableDownscale,
    showWaveform,
    maxQuality,
    volumeSlider,
    muteBtn,
    mergeVolumeSlider,
    mergeMuteBtn
  } = elements || {};

  let storedVolume = DEFAULT_VOLUME;
  let isMutedState = false;
  let hasNvenc = false;

  function getPlaybackState() {
    return { volume: storedVolume, muted: isMutedState, hasNvenc };
  }

  function syncVolumeUI() {
    const effectiveVolume = isMutedState ? 0 : storedVolume;
    if (volumeSlider) volumeSlider.value = effectiveVolume;
    if (mergeVolumeSlider) mergeVolumeSlider.value = effectiveVolume;

    if (onApplyVolumeToPlayers) onApplyVolumeToPlayers(effectiveVolume, false);

    const icon = (effectiveVolume === 0) ? '&#xE74F;' : '&#xE767;';
    if (muteBtn) muteBtn.innerHTML = icon;
    if (mergeMuteBtn) mergeMuteBtn.innerHTML = icon;
  }

  function handleVolumeInput(e) {
    const val = parseFloat(e.target.value);
    if (isMutedState) {
      isMutedState = false;
      api.setSetting('playbackMuted', false);
    }
    storedVolume = val;
    syncVolumeUI();
  }

  function handleVolumeChange() {
    api.setSetting('playbackVolume', storedVolume);
  }

  function handleMuteClick() {
    isMutedState = !isMutedState;
    api.setSetting('playbackMuted', isMutedState);
    syncVolumeUI();
  }

  async function load() {
    const allSettings = await api.getAllSettings();
    if (allSettings) {
      if (exportDir) exportDir.value = allSettings.defaultExportDirectory || '';
      if (hwAccel) hwAccel.value = allSettings.hwAccel || 'auto';
      if (disableDownscale) disableDownscale.checked = allSettings.disableAutoDownscale === true;
      if (allSettings.showWaveform !== undefined) {
        if (showWaveform) showWaveform.checked = allSettings.showWaveform;
        if (timeline) timeline.setShowWaveform(allSettings.showWaveform);
      }
      if (allSettings.maxQuality !== undefined) {
        if (maxQuality) maxQuality.checked = allSettings.maxQuality;
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
    hasNvenc = await api.detectEncoders();
    if (onNvencDetected) onNvencDetected(hasNvenc);
    const nvencOption = document.querySelector('#setting-hw-accel option[value="nvenc"]');
    if (nvencOption && !hasNvenc) {
      nvencOption.disabled = true;
      nvencOption.textContent = 'NVIDIA (NVENC) - Not Detected';
      if (hwAccel && hwAccel.value === 'nvenc') {
        hwAccel.value = 'auto';
        api.setSetting('hwAccel', 'auto');
      }
    }
  }

  function wire() {
    if (openBtn && modal) openBtn.addEventListener('click', () => { openModal(modal); });
    if (closeBtn && modal) closeBtn.addEventListener('click', () => { closeModal(modal); });

    if (browseBtn && exportDir) {
      browseBtn.addEventListener('click', async () => {
        const dir = await api.pickDirectory();
        if (dir) {
          exportDir.value = dir;
          api.setSetting('defaultExportDirectory', dir);
        }
      });
    }

    if (clearBtn && exportDir) {
      clearBtn.addEventListener('click', () => {
        exportDir.value = '';
        api.setSetting('defaultExportDirectory', '');
      });
    }

    if (hwAccel) {
      hwAccel.addEventListener('change', (e) => {
        api.setSetting('hwAccel', e.target.value);
        if (onPlanInvalidated) onPlanInvalidated();
      });
    }

    if (maxQuality) {
      maxQuality.addEventListener('change', (e) => {
        api.setSetting('maxQuality', e.target.checked);
        if (onPlanInvalidated) onPlanInvalidated();
      });
    }

    if (disableDownscale) {
      disableDownscale.addEventListener('change', (e) => {
        api.setSetting('disableAutoDownscale', e.target.checked);
        if (onPlanInvalidated) onPlanInvalidated();
      });
    }

    if (showWaveform) {
      showWaveform.addEventListener('change', (e) => {
        api.setSetting('showWaveform', e.target.checked);
        if (onShowWaveformChange) onShowWaveformChange(e.target.checked);
      });
    }

    if (volumeSlider) volumeSlider.addEventListener('input', handleVolumeInput);
    if (mergeVolumeSlider) mergeVolumeSlider.addEventListener('input', handleVolumeInput);
    if (volumeSlider) volumeSlider.addEventListener('change', handleVolumeChange);
    if (mergeVolumeSlider) mergeVolumeSlider.addEventListener('change', handleVolumeChange);
    if (muteBtn) muteBtn.addEventListener('click', handleMuteClick);
    if (mergeMuteBtn) mergeMuteBtn.addEventListener('click', handleMuteClick);
  }

  wire();
  return { load, getPlaybackState, syncVolumeUI };
}
