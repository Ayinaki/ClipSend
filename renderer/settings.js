// Settings & playback state: the settings modal (directory, video codec, hw
// accel, max quality, waveform toggle), volume slider/mute state, and encoder
// capability detection (NVENC / QSV / AMF / AV1 availability from the bundled
// FFmpeg). All app-level side effects (players, timeline, plan invalidation,
// IPC) are injected via the `context` object so this module is testable in
// jsdom with a fake api and no Electron bridge.

import { openModal, closeModal } from './utils/modals.js';

const DEFAULT_VOLUME = 0.6;

// Vendor option metadata for the Hardware Acceleration select. A vendor is
// usable when the detected FFmpeg ships its H.264 encoder (every hardware
// vendor also implies the AV1 sibling when supported by the GPU).
const HW_VENDORS = [
  { value: 'nvenc', label: 'NVIDIA (NVENC)' },
  { value: 'qsv', label: 'Intel (QSV)' },
  { value: 'amf', label: 'AMD (AMF)' }
];

/**
 * Create the settings controller.
 *
 * @param {object} context
 * @param {object} context.api - window.clipSend IPC bridge
 * @param {object} context.elements - DOM element references
 * @param {object} [context.timeline] - Timeline instance (waveform toggle)
 * @param {(caps: object) => void} [context.onEncodersDetected] - resolved capability map
 * @param {() => void} [context.onPlanInvalidated] - clear the export plan
 * @param {(checked: boolean) => void} [context.onShowWaveformChange] - app applies to timeline + reloads waveform
 * @param {(volume: number, muted: boolean) => void} [context.onApplyVolumeToPlayers]
 */
export function createSettingsController(context) {
  const { api, elements, timeline, onEncodersDetected, onNvencDetected, onPlanInvalidated, onShowWaveformChange, onApplyVolumeToPlayers } = context;

  const {
    modal,
    openBtn,
    closeBtn,
    exportDir,
    browseBtn,
    clearBtn,
    hwAccel,
    videoCodec,
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
  let encoderCaps = null;

  function getPlaybackState() {
    return {
      volume: storedVolume,
      muted: isMutedState,
      hasNvenc: !!(encoderCaps && encoderCaps.nvenc && encoderCaps.nvenc.h264)
    };
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

  /** Mark each vendor option disabled + relabeled when its encoder is absent. */
  function applyDetection(caps) {
    encoderCaps = caps && typeof caps === 'object' ? caps : null;
    if (onEncodersDetected) onEncodersDetected(encoderCaps || {});
    // Legacy callback compatibility (boolean NVENC availability).
    if (onNvencDetected) onNvencDetected(!!(encoderCaps && encoderCaps.nvenc && encoderCaps.nvenc.h264));

    if (!hwAccel) return;
    for (const vendor of HW_VENDORS) {
      const opt = hwAccel.querySelector(`option[value="${vendor.value}"]`);
      if (!opt) continue;
      const vendorCaps = encoderCaps ? encoderCaps[vendor.value] : null;
      const available = !!(vendorCaps && (vendorCaps.h264 || vendorCaps.av1));
      opt.disabled = !available;
      opt.textContent = available ? vendor.label : `${vendor.label} - Not Detected`;
    }

    // A persisted vendor choice that is no longer available resets to Auto.
    if (hwAccel.value !== 'auto' && hwAccel.value !== 'cpu') {
      const opt = hwAccel.querySelector(`option[value="${hwAccel.value}"]`);
      if (opt && opt.disabled) {
        hwAccel.value = 'auto';
        api.setSetting('hwAccel', 'auto');
      }
    }
  }

  async function load() {
    const allSettings = await api.getAllSettings();
    if (allSettings) {
      if (exportDir) exportDir.value = allSettings.defaultExportDirectory || '';
      if (hwAccel) hwAccel.value = allSettings.hwAccel || 'auto';
      if (videoCodec) videoCodec.value = allSettings.videoCodec === 'av1' ? 'av1' : 'h264';
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

    // Detect encoder capabilities (NVENC / QSV / AMF / software AV1).
    let caps = null;
    try {
      caps = await api.detectEncoders();
    } catch (e) {
      caps = null;
    }
    applyDetection(caps);
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

    if (videoCodec) {
      videoCodec.addEventListener('change', (e) => {
        api.setSetting('videoCodec', e.target.value);
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
  return { load, getPlaybackState, syncVolumeUI, applyDetection };
}
