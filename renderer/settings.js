// Settings & playback state: the settings modal (directory, video codec, hw
// accel, max quality, waveform toggle), volume slider/mute state, and encoder
// capability detection (NVENC / QSV / AMF / AV1 availability from the bundled
// FFmpeg). All app-level side effects (players, timeline, plan invalidation,
// IPC) are injected via the `context` object so this module is testable in
// jsdom with a fake api and no Electron bridge.

import { openModal, closeModal } from './utils/modals.js';
import { ICON_VOLUME, ICON_VOLUME_MUTED } from './utils/icons.js';
import { refreshAllSelects } from './utils/dropdown.js';
import { fadeTheme } from './utils/theme-fade.js';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  bindingToValue,
  bindingLabel,
  valueToBinding,
  eventToBinding,
  shouldIgnoreCaptureEvent
} from './utils/keymap.js';

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
 * @param {(overrides: object) => void} [context.onShortcutsApplied] - app applies remapped keys to the dispatch
 */
export function createSettingsController(context) {
  const { api, elements, timeline, onEncodersDetected, onNvencDetected, onPlanInvalidated, onShowWaveformChange, onApplyVolumeToPlayers, onShortcutsApplied } = context;

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
    theme,
    font,
    filenameTemplateTrim,
    filenameTemplateMerge,
    volumeSlider,
    muteBtn,
    mergeVolumeSlider,
    mergeMuteBtn,
    shortcutsBtn,
    shortcutsModal,
    shortcutsCloseBtn,
    shortcutsDoneBtn,
    shortcutsResetBtn,
    shortcutsList
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

    // Same SVG icon family as the transport bar (icons.js), swapped between
    // speaker+arc (audible) and speaker+X (muted).
    const icon = (effectiveVolume === 0) ? ICON_VOLUME_MUTED : ICON_VOLUME;
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

  /**
   * Resolve a theme choice to the concrete light/dark value. 'auto' follows
   * the OS prefers-color-scheme; when matchMedia is unavailable (old
   * environments, tests) it resolves to dark — the app's historical default.
   */
  function resolveTheme(value) {
    if (value === 'light') return 'light';
    if (value === 'auto') {
      try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) {
          return 'light';
        }
      } catch (e) { /* fall through to dark */ }
    }
    return 'dark';
  }

  /** Apply the chosen theme to the document root (dark is the fallback).
      Dispatches 'themechange' when the value actually changes so canvas
      surfaces (timeline, merge scrubber) redraw with the new palette. */
  function applyTheme(value) {
    const themeValue = resolveTheme(value);
    const prev = document.documentElement.dataset.theme;
    // Fade only real changes — prev is undefined on the very first apply
    // (startup), so there's no flash at launch. The outgoing color is
    // captured BEFORE the swap so the wash fades the old theme out over the
    // new one.
    if (prev !== undefined && prev !== themeValue) {
      const oldColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim();
      fadeTheme(oldColor);
    }
    document.documentElement.dataset.theme = themeValue;
    if (prev !== themeValue) {
      document.dispatchEvent(new CustomEvent('themechange'));
    }
    return themeValue;
  }

  /** Apply the chosen font to the document root. 'default' removes the
      override so the app uses its standard UI font; 'opendyslexic' swaps
      --font-family via the html[data-font] rule. Dispatches 'fontchange'
      when the value actually changes so canvas surfaces (timeline, merge
      scrubber) redraw their text in the new face. */
  function applyFont(value) {
    const fontValue = value === 'opendyslexic' ? 'opendyslexic' : 'default';
    const prev = document.documentElement.dataset.font;
    if (fontValue === 'opendyslexic') {
      document.documentElement.dataset.font = 'opendyslexic';
    } else if (prev !== undefined) {
      delete document.documentElement.dataset.font;
    }
    if (prev !== fontValue) {
      document.dispatchEvent(new CustomEvent('fontchange'));
    }
    return fontValue;
  }

  // While Auto is selected, live-follow the OS theme (Windows light/dark
  // mode) instead of only applying it at startup. matchMedia listeners are
  // guarded for environments without matchMedia (e.g. jsdom tests).
  let systemThemeQuery = null;
  try {
    if (typeof window.matchMedia === 'function') {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }
  } catch (e) { /* no matchMedia */ }
  if (systemThemeQuery && typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', () => {
      if (theme && theme.value === 'auto') applyTheme('auto');
    });
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
      // Theme + filename templates are plain text/select settings. 'auto'
      // follows the OS; anything unrecognized falls back to dark.
      const themeValue = ['auto', 'light', 'dark'].includes(allSettings.theme) ? allSettings.theme : 'dark';
      applyTheme(themeValue);
      if (theme) theme.value = themeValue;
      // Accessibility font: anything unrecognized falls back to the default.
      const fontValue = allSettings.fontFamily === 'opendyslexic' ? 'opendyslexic' : 'default';
      applyFont(fontValue);
      if (font) font.value = fontValue;
      if (filenameTemplateTrim) filenameTemplateTrim.value = allSettings.filenameTemplateTrim || '{name} - Trimmed';
      if (filenameTemplateMerge) filenameTemplateMerge.value = allSettings.filenameTemplateMerge || 'Merged Video - {date}';
      if (allSettings.playbackVolume !== undefined) {
        storedVolume = Math.max(0, Math.min(1, Number(allSettings.playbackVolume)));
      }
      if (allSettings.playbackMuted !== undefined) {
        isMutedState = Boolean(allSettings.playbackMuted);
      }
      // Shortcut overrides ({action: 'ctrl+KeyZ'}) reach the keydown dispatch
      // at startup; the editor rows also get their stored values if the user
      // has already opened the editor this session. No change events are
      // dispatched here (see the refreshAllSelects note below).
      if (onShortcutsApplied) onShortcutsApplied(allSettings.shortcuts || {});
      if (shortcutRowsBuilt) applyShortcutValues(allSettings.shortcuts || {});
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

    // The writes above (codec, theme, hwAccel) are plain property assignments
    // that dispatch no 'change', so re-render every custom dropdown label to
    // match — otherwise the button shows its HTML default until reopened.
    refreshAllSelects();
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

    if (theme) {
      theme.addEventListener('change', (e) => {
        applyTheme(e.target.value);
        api.setSetting('theme', e.target.value);
      });
    }

    if (font) {
      font.addEventListener('change', (e) => {
        applyFont(e.target.value);
        api.setSetting('fontFamily', e.target.value);
      });
    }

    // Filename templates persist on input blur (typing + leaving the field);
    // the main process reads them at export time.
    if (filenameTemplateTrim) {
      filenameTemplateTrim.addEventListener('change', (e) => {
        api.setSetting('filenameTemplateTrim', e.target.value.trim());
      });
    }
    if (filenameTemplateMerge) {
      filenameTemplateMerge.addEventListener('change', (e) => {
        api.setSetting('filenameTemplateMerge', e.target.value.trim());
      });
    }

    // --- Keyboard shortcut editor ---
    if (shortcutsBtn && shortcutsModal) {
      shortcutsBtn.addEventListener('click', openShortcutEditor);
    }
    if (shortcutsCloseBtn && shortcutsModal) {
      shortcutsCloseBtn.addEventListener('click', () => { stopRecording(); closeModal(shortcutsModal); });
    }
    if (shortcutsDoneBtn && shortcutsModal) {
      shortcutsDoneBtn.addEventListener('click', () => { stopRecording(); closeModal(shortcutsModal); });
    }
    if (shortcutsModal) {
      shortcutsModal.addEventListener('click', (e) => {
        if (e.target === shortcutsModal) { stopRecording(); closeModal(shortcutsModal); }
      });
    }
    if (shortcutsResetBtn) {
      shortcutsResetBtn.addEventListener('click', () => {
        for (const action of ACTIONS) {
          shortcutValues[action.id] = bindingToValue(DEFAULT_BINDINGS[action.id]);
        }
        stopRecording();
        renderAllShortcutLabels();
        persistShortcuts();
      });
    }
    // The editor's capture listener is global: any keydown while a row is
    // recording rebinds that action. The app's own dispatch ignores keydowns
    // while this modal is open, so nothing else fires underneath.
    document.addEventListener('keydown', handleRecordKeydown);

    if (volumeSlider) volumeSlider.addEventListener('input', handleVolumeInput);
    if (mergeVolumeSlider) mergeVolumeSlider.addEventListener('input', handleVolumeInput);
    if (volumeSlider) volumeSlider.addEventListener('change', handleVolumeChange);
    if (mergeVolumeSlider) mergeVolumeSlider.addEventListener('change', handleVolumeChange);
    if (muteBtn) muteBtn.addEventListener('click', handleMuteClick);
    if (mergeMuteBtn) mergeMuteBtn.addEventListener('click', handleMuteClick);
  }

  // --- Keyboard shortcut editor (capture-based) ---
  // Each action gets a key button; clicking it arms recording and the next
  // non-modifier keypress (or combo) becomes the binding. No dropdowns — the
  // user presses the key they want instead of hunting through a menu.
  const shortcutKeyBtns = {};  // action id -> its key button
  const shortcutValues = {};   // action id -> binding value ('' = unbound)
  let shortcutRowsBuilt = false;
  let recordingAction = null;
  let recordingBtn = null;
  let conflictTimer = null;

  function renderShortcutLabel(action) {
    const btn = shortcutKeyBtns[action];
    if (!btn) return;
    const label = bindingLabel(valueToBinding(shortcutValues[action] || ''));
    btn.textContent = label || 'None';
    btn.classList.remove('recording', 'conflict');
  }

  function renderAllShortcutLabels() {
    for (const action of ACTIONS) renderShortcutLabel(action.id);
  }

  /** Build one row per remappable action (label + key button). */
  function buildShortcutRows() {
    if (shortcutRowsBuilt || !shortcutsList) return;
    shortcutRowsBuilt = true;
    for (const action of ACTIONS) {
      shortcutValues[action.id] = bindingToValue(DEFAULT_BINDINGS[action.id]);
      const row = document.createElement('div');
      row.className = 'shortcut-edit-row';
      const label = document.createElement('span');
      label.className = 'shortcut-edit-label';
      label.textContent = action.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shortcut-key-btn';
      btn.dataset.action = action.id;
      btn.title = `Click to change the key for ${action.label}`;
      row.appendChild(label);
      row.appendChild(btn);
      shortcutsList.appendChild(row);
      shortcutKeyBtns[action.id] = btn;
    }
    renderAllShortcutLabels();
    // Clicking a key button starts (or cancels) recording for that action.
    shortcutsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.shortcut-key-btn');
      if (!btn) return;
      if (recordingAction === btn.dataset.action) stopRecording();
      else startRecording(btn.dataset.action);
    });
  }

  function startRecording(action) {
    stopRecording(); // restores the previous row if we're switching
    const btn = shortcutKeyBtns[action];
    if (!btn) return;
    recordingAction = action;
    recordingBtn = btn;
    recordingBtn.classList.add('recording');
    recordingBtn.textContent = 'Press a key\u2026';
    // Blur so a later Space keyup can't re-trigger the button.
    recordingBtn.blur();
  }

  function stopRecording() {
    clearTimeout(conflictTimer);
    conflictTimer = null;
    if (recordingBtn) {
      renderShortcutLabel(recordingBtn.dataset.action);
      recordingBtn = null;
    }
    recordingAction = null;
  }

  /** Flash an in-button conflict message, then return to recording. */
  function showConflict(otherAction) {
    clearTimeout(conflictTimer);
    recordingBtn.classList.remove('recording');
    recordingBtn.classList.add('conflict');
    recordingBtn.textContent = `Used by ${otherAction.label}`;
    conflictTimer = setTimeout(() => {
      if (recordingAction && recordingBtn) {
        recordingBtn.classList.remove('conflict');
        recordingBtn.classList.add('recording');
        recordingBtn.textContent = 'Press a key\u2026';
      }
    }, 1600);
  }

  /** The other action currently holding a value, or null when it's free. */
  function findConflict(action, value) {
    if (!value) return null;
    for (const other of ACTIONS) {
      if (other.id !== action && shortcutValues[other.id] === value) return other;
    }
    return null;
  }

  /** Global capture: the next valid keydown while recording rebinds. */
  function handleRecordKeydown(e) {
    if (!recordingAction || !recordingBtn) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stopRecording();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      shortcutValues[recordingAction] = '';
      stopRecording();
      persistShortcuts();
      return;
    }
    if (shouldIgnoreCaptureEvent(e)) return;
    const value = bindingToValue(eventToBinding(e));
    e.preventDefault();
    const conflict = findConflict(recordingAction, value);
    if (conflict) {
      showConflict(conflict);
      return;
    }
    shortcutValues[recordingAction] = value;
    stopRecording();
    persistShortcuts();
  }

  /** The current {action: value} map from the editor's key buttons. Every
      action is included so 'None' ('' — explicitly unbound) survives
      persistence; mergeBindings treats a missing action as default and
      '' as unbound. */
  function collectShortcutOverrides() {
    return { ...shortcutValues };
  }

  /** Persist the editor state and push it to the app's keydown dispatch. */
  function persistShortcuts() {
    const overrides = collectShortcutOverrides();
    api.setSetting('shortcuts', overrides);
    if (onShortcutsApplied) onShortcutsApplied(overrides);
  }

  /** Load stored values into the buttons (falling back to defaults). */
  function applyShortcutValues(overrides) {
    if (!shortcutRowsBuilt) return;
    for (const action of ACTIONS) {
      const stored = overrides && overrides[action.id];
      // A missing action means "not overridden" → default. '' (None) is a
      // valid stored value meaning "explicitly unbound"; malformed values
      // also fall back to the default.
      if (stored === undefined || stored === null) {
        shortcutValues[action.id] = bindingToValue(DEFAULT_BINDINGS[action.id]);
        continue;
      }
      const value = String(stored);
      shortcutValues[action.id] = (value === '' || valueToBinding(value))
        ? value
        : bindingToValue(DEFAULT_BINDINGS[action.id]);
    }
    stopRecording();
    renderAllShortcutLabels();
  }

  async function openShortcutEditor() {
    stopRecording();
    buildShortcutRows();
    const all = await api.getAllSettings();
    applyShortcutValues((all && all.shortcuts) || {});
    if (shortcutsModal) openModal(shortcutsModal);
  }

  wire();
  return { load, getPlaybackState, syncVolumeUI, applyDetection };
}
