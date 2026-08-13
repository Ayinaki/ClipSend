/**
 * @jest-environment jsdom
 *
 * Tests for the settings controller: loading persisted settings, volume
 * state, and the settings modal wiring against a fake IPC api.
 */
const fs = require('fs');
const path = require('path');

// The fade transition is a visual effect exercised by its own test file;
// here it's a spy so the settings tests verify WHEN it fires, not how.
jest.mock('../../renderer/utils/theme-fade.js', () => ({
  fadeTheme: jest.fn(),
  hasActiveFade: jest.fn(() => false)
}));
const { fadeTheme } = require('../../renderer/utils/theme-fade.js');

const { createSettingsController } = require('../../renderer/settings.js');

function loadAppDom() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
  document.documentElement.innerHTML = html;
  return document;
}

function makeApi(overrides = {}) {
  const calls = { setSetting: [] };
  return {
    calls,
    getAllSettings: jest.fn(async () => ({
      defaultExportDirectory: 'C:\\Exports',
      hwAccel: 'auto',
      videoCodec: 'h264',
      disableAutoDownscale: false,
      showWaveform: true,
      maxQuality: false,
      playbackVolume: 0.8,
      playbackMuted: false,
      shortcuts: {}
    })),
    detectEncoders: jest.fn(async () => ({
      nvenc: { h264: true, av1: true },
      qsv: { h264: true, av1: false },
      amf: { h264: false, av1: false },
      svtav1: true,
      libx264: true
    })),
    setSetting: jest.fn((key, value) => { calls.setSetting.push([key, value]); }),
    pickDirectory: jest.fn(async () => 'C:\\NewDir'),
    ...overrides
  };
}

function makeElements() {
  return {
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
  };
}

describe('settings controller', () => {
  let els;
  let api;
  let timeline;

  beforeEach(() => {
    loadAppDom();
    els = makeElements();
    api = makeApi();
    timeline = { setShowWaveform: jest.fn() };
    // innerHTML on <html> does not touch attributes of the element itself, so
    // a data-theme left by a previous test would survive into this one. Reset
    // to the true boot state so theme tests start deterministic.
    document.documentElement.removeAttribute('data-theme');
    fadeTheme.mockClear();
  });

  test('load() populates fields from persisted settings', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    expect(els.exportDir.value).toBe('C:\\Exports');
    expect(els.hwAccel.value).toBe('auto');
    expect(els.disableDownscale.checked).toBe(false);
    expect(els.showWaveform.checked).toBe(true);
    expect(els.maxQuality.checked).toBe(false);
  });

  test('load() applies playback volume and notifies players', async () => {
    const onApplyVolumeToPlayers = jest.fn();
    const settings = createSettingsController({
      api, elements: els, timeline, onApplyVolumeToPlayers
    });
    await settings.load();

    // 0.8 restored from settings, applied via the player callback
    expect(onApplyVolumeToPlayers).toHaveBeenCalledWith(0.8, false);
    expect(els.volumeSlider.value).toBe('0.8');
    expect(settings.getPlaybackState().volume).toBe(0.8);
  });

  test('volume slider input updates volume and persists on change', async () => {
    const onApplyVolumeToPlayers = jest.fn();
    const settings = createSettingsController({
      api, elements: els, timeline, onApplyVolumeToPlayers
    });
    await settings.load();

    els.volumeSlider.value = '0.35';
    els.volumeSlider.dispatchEvent(new Event('input'));
    expect(settings.getPlaybackState().volume).toBe(0.35);
    expect(onApplyVolumeToPlayers).toHaveBeenLastCalledWith(0.35, false);

    els.volumeSlider.dispatchEvent(new Event('change'));
    expect(api.calls.setSetting).toContainEqual(['playbackVolume', 0.35]);
  });

  test('mute button toggles muted state and persists', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.muteBtn.dispatchEvent(new Event('click'));
    expect(settings.getPlaybackState().muted).toBe(true);
    expect(api.calls.setSetting).toContainEqual(['playbackMuted', true]);

    els.muteBtn.dispatchEvent(new Event('click'));
    expect(settings.getPlaybackState().muted).toBe(false);
  });

  test('open and close buttons toggle the modal', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.openBtn.click();
    expect(els.modal.style.display).toBe('flex');

    els.closeBtn.click();
    expect(els.modal.style.display).toBe('none');
  });

  test('browse sets the export directory and persists it', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.browseBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(els.exportDir.value).toBe('C:\\NewDir');
    expect(api.calls.setSetting).toContainEqual(['defaultExportDirectory', 'C:\\NewDir']);
  });

  test('clear resets the export directory', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.clearBtn.click();
    expect(els.exportDir.value).toBe('');
    expect(api.calls.setSetting).toContainEqual(['defaultExportDirectory', '']);
  });

  test('hw accel change persists and invalidates the plan', async () => {
    const onPlanInvalidated = jest.fn();
    const settings = createSettingsController({ api, elements: els, timeline, onPlanInvalidated });
    await settings.load();

    els.hwAccel.value = 'qsv';
    els.hwAccel.dispatchEvent(new Event('change'));

    expect(api.calls.setSetting).toContainEqual(['hwAccel', 'qsv']);
    expect(onPlanInvalidated).toHaveBeenCalledTimes(1);
  });

  test('video codec change persists and invalidates the plan', async () => {
    const onPlanInvalidated = jest.fn();
    const settings = createSettingsController({ api, elements: els, timeline, onPlanInvalidated });
    await settings.load();

    els.videoCodec.value = 'av1';
    els.videoCodec.dispatchEvent(new Event('change'));

    expect(api.calls.setSetting).toContainEqual(['videoCodec', 'av1']);
    expect(onPlanInvalidated).toHaveBeenCalledTimes(1);
  });

  test('theme load applies the data-theme attribute and populates the select', async () => {
    api = makeApi({ getAllSettings: jest.fn(async () => ({ theme: 'light' })) });
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(els.theme.value).toBe('light');
  });

  test('theme change applies the attribute immediately and persists', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.theme.value = 'light';
    els.theme.dispatchEvent(new Event('change'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(api.calls.setSetting).toContainEqual(['theme', 'light']);
  });

  test('theme change starts the fade; the startup apply does not', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();
    // The very first apply (startup) must not animate — prev is undefined.
    expect(fadeTheme).not.toHaveBeenCalled();

    els.theme.value = 'light';
    els.theme.dispatchEvent(new Event('change'));

    expect(fadeTheme).toHaveBeenCalledTimes(1);
    expect(typeof fadeTheme.mock.calls[0][0]).toBe('string'); // outgoing bg color
  });

  test('re-selecting the current theme does not start a fade', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.theme.value = 'dark';
    els.theme.dispatchEvent(new Event('change')); // already dark after load

    expect(fadeTheme).not.toHaveBeenCalled();
  });

  test('font load applies the data-font attribute and populates the select', async () => {
    api = makeApi({ getAllSettings: jest.fn(async () => ({ fontFamily: 'opendyslexic' })) });
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    expect(document.documentElement.dataset.font).toBe('opendyslexic');
    expect(els.font.value).toBe('opendyslexic');
  });

  test('font change applies the attribute immediately and persists', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.font.value = 'opendyslexic';
    els.font.dispatchEvent(new Event('change'));

    expect(document.documentElement.dataset.font).toBe('opendyslexic');
    expect(api.calls.setSetting).toContainEqual(['fontFamily', 'opendyslexic']);
  });

  test('font change dispatches fontchange only when the value changes', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    const listener = jest.fn();
    document.addEventListener('fontchange', listener);

    els.font.value = 'opendyslexic';
    els.font.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-selecting the same value must not re-dispatch (no pointless redraws).
    els.font.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledTimes(1);

    // Back to default removes the attribute and dispatches once.
    els.font.value = 'default';
    els.font.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.font).toBeUndefined();

    document.removeEventListener('fontchange', listener);
  });



  test('theme change dispatches themechange only when the value changes', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    const listener = jest.fn();
    document.addEventListener('themechange', listener);

    els.theme.value = 'light';
    els.theme.dispatchEvent(new Event('change'));
    // Canvas surfaces (timeline, merge scrubber) redraw on this event.
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-selecting the same value must not re-dispatch (no pointless redraws).
    els.theme.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledTimes(1);

    document.removeEventListener('themechange', listener);
  });

  test('auto theme resolves to the OS preference and persists as auto', async () => {
    const originalMatchMedia = window.matchMedia;
    // Simulate an OS in light mode: the '(prefers-color-scheme: light)' query matches.
    window.matchMedia = jest.fn((query) => ({
      matches: query.includes('light'),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));
    try {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      els.theme.value = 'auto';
      els.theme.dispatchEvent(new Event('change'));

      expect(document.documentElement.dataset.theme).toBe('light');
      expect(api.calls.setSetting).toContainEqual(['theme', 'auto']);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test('auto theme with a dark OS preference resolves to dark', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
    try {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      els.theme.value = 'auto';
      els.theme.dispatchEvent(new Event('change'));

      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test('persisted auto setting is restored and applied at load', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn((query) => ({
      matches: query.includes('dark'),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));
    try {
      api = makeApi({ getAllSettings: jest.fn(async () => ({ theme: 'auto' })) });
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      expect(els.theme.value).toBe('auto');
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test('filename templates persist trimmed values on change', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    els.filenameTemplateTrim.value = '  {name} [x]  ';
    els.filenameTemplateTrim.dispatchEvent(new Event('change'));
    expect(api.calls.setSetting).toContainEqual(['filenameTemplateTrim', '{name} [x]']);

    els.filenameTemplateMerge.value = 'Join - {date}';
    els.filenameTemplateMerge.dispatchEvent(new Event('change'));
    expect(api.calls.setSetting).toContainEqual(['filenameTemplateMerge', 'Join - {date}']);
  });

  test('waveform toggle notifies the app callback', async () => {
    const onShowWaveformChange = jest.fn();
    const settings = createSettingsController({
      api, elements: els, timeline, onShowWaveformChange
    });
    await settings.load();

    els.showWaveform.checked = false;
    els.showWaveform.dispatchEvent(new Event('change'));

    expect(api.calls.setSetting).toContainEqual(['showWaveform', false]);
    expect(onShowWaveformChange).toHaveBeenCalledWith(false);
  });

  test('disables vendor options whose encoder was not detected', async () => {
    api = makeApi({ detectEncoders: jest.fn(async () => ({
      nvenc: { h264: false, av1: false },
      qsv: { h264: false, av1: false },
      amf: { h264: false, av1: false },
      svtav1: true,
      libx264: true
    })) });
    const onEncodersDetected = jest.fn();
    const settings = createSettingsController({
      api, elements: els, timeline, onEncodersDetected
    });
    await settings.load();

    for (const value of ['nvenc', 'qsv', 'amf']) {
      const opt = document.querySelector(`#setting-hw-accel option[value="${value}"]`);
      expect(opt.disabled).toBe(true);
      expect(opt.textContent).toContain('Not Detected');
    }
    expect(onEncodersDetected).toHaveBeenCalledWith(expect.objectContaining({ nvenc: expect.any(Object) }));
  });

  test('keeps vendor options enabled when detected and restores labels', async () => {
    const settings = createSettingsController({ api, elements: els, timeline });
    await settings.load();

    const nvencOption = document.querySelector('#setting-hw-accel option[value="nvenc"]');
    const qsvOption = document.querySelector('#setting-hw-accel option[value="qsv"]');
    const amfOption = document.querySelector('#setting-hw-accel option[value="amf"]');
    expect(nvencOption.disabled).toBe(false);
    expect(nvencOption.textContent).toBe('NVIDIA (NVENC)');
    expect(qsvOption.disabled).toBe(false);
    expect(qsvOption.textContent).toBe('Intel (QSV)');
    expect(amfOption.disabled).toBe(true); // amf.h264 + amf.av1 both false
    expect(amfOption.textContent).toBe('AMD (AMF) - Not Detected');
  });

  describe('keyboard shortcut editor', () => {
    const SHORTCUT_ACTIONS = [
      'playPause', 'frameBack', 'frameForward', 'setIn', 'setOut',
      'jumpIn', 'jumpOut', 'undo', 'redo', 'showShortcuts'
    ];
    // bindingLabel renders of the defaults
    const DEFAULT_LABELS = {
      playPause: 'Space', frameBack: '\u2190', frameForward: '\u2192',
      setIn: 'I', setOut: 'O', jumpIn: 'Home', jumpOut: 'End',
      undo: 'Ctrl+Z', redo: 'Ctrl+Y', showShortcuts: 'Shift+/'
    };

    function getKeyBtn(action) {
      return document.querySelector(`#shortcut-editor-list .shortcut-key-btn[data-action="${action}"]`);
    }

    function pressKey(code, opts = {}) {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        code,
        key: opts.key || code,
        ctrlKey: !!opts.ctrl,
        shiftKey: !!opts.shift,
        altKey: !!opts.alt,
        bubbles: true,
        cancelable: true
      }));
    }

    async function openEditor() {
      els.shortcutsBtn.click();
      await new Promise((r) => setTimeout(r, 0)); // openShortcutEditor awaits getAllSettings
    }

    test('opens from Settings and builds one key button per action with defaults', async () => {
      const onShortcutsApplied = jest.fn();
      const settings = createSettingsController({
        api, elements: els, timeline, onShortcutsApplied
      });
      await settings.load();

      await openEditor();

      expect(els.shortcutsModal.style.display).toBe('flex');
      const btns = document.querySelectorAll('#shortcut-editor-list .shortcut-key-btn');
      expect(btns.length).toBe(SHORTCUT_ACTIONS.length);
      for (const action of SHORTCUT_ACTIONS) {
        expect(getKeyBtn(action)).toBeTruthy();
        expect(getKeyBtn(action).textContent).toBe(DEFAULT_LABELS[action]);
      }
      // load() notified the app with the (empty) overrides
      expect(onShortcutsApplied).toHaveBeenCalledWith({});
    });

    test('capturing the next keypress rebinds, persists, and notifies the app', async () => {
      const onShortcutsApplied = jest.fn();
      const settings = createSettingsController({
        api, elements: els, timeline, onShortcutsApplied
      });
      await settings.load();

      await openEditor();

      getKeyBtn('setIn').click();
      expect(getKeyBtn('setIn').textContent).toBe('Press a key\u2026');
      pressKey('KeyJ');

      expect(getKeyBtn('setIn').textContent).toBe('J');
      expect(getKeyBtn('setIn').classList.contains('recording')).toBe(false);
      const lastCall = api.calls.setSetting[api.calls.setSetting.length - 1];
      expect(lastCall[0]).toBe('shortcuts');
      expect(lastCall[1].setIn).toBe('KeyJ');
      expect(onShortcutsApplied).toHaveBeenLastCalledWith(expect.objectContaining({ setIn: 'KeyJ' }));
    });

    test('a key already bound by another action is rejected, recording stays armed', async () => {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      await openEditor();
      const setSettingCalls = api.calls.setSetting.length;

      getKeyBtn('setIn').click();
      pressKey('KeyO'); // KeyO is Set Out point's default

      const btn = getKeyBtn('setIn');
      expect(btn.textContent).toBe('Used by Set Out point');
      expect(btn.classList.contains('conflict')).toBe(true);
      expect(api.calls.setSetting.length).toBe(setSettingCalls); // nothing persisted

      // Still recording — the next valid key is accepted.
      pressKey('KeyJ');
      expect(getKeyBtn('setIn').textContent).toBe('J');
      expect(api.calls.setSetting[api.calls.setSetting.length - 1][1].setIn).toBe('KeyJ');
    });

    test('Esc cancels without persisting; Delete clears the binding to None', async () => {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      await openEditor();

      // Esc while recording: label unchanged, nothing persisted.
      getKeyBtn('setIn').click();
      pressKey('Escape');
      expect(getKeyBtn('setIn').textContent).toBe('I');

      // Delete while recording: unbound.
      getKeyBtn('setIn').click();
      pressKey('Delete');
      expect(getKeyBtn('setIn').textContent).toBe('None');
      expect(api.calls.setSetting[api.calls.setSetting.length - 1][1].setIn).toBe('');
    });

    test('modifier-only keydowns never rebind', async () => {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      await openEditor();

      getKeyBtn('setOut').click();
      pressKey('ShiftLeft');
      expect(getKeyBtn('setOut').textContent).toBe('Press a key\u2026'); // still recording
      pressKey('KeyO', { shift: true }); // Shift+O is a valid combo
      expect(getKeyBtn('setOut').textContent).toBe('Shift+O');
      expect(api.calls.setSetting[api.calls.setSetting.length - 1][1].setOut).toBe('shift+KeyO');
    });

    test('clicking the same button again cancels recording', async () => {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      await openEditor();

      getKeyBtn('setOut').click();
      expect(getKeyBtn('setOut').textContent).toBe('Press a key\u2026');
      getKeyBtn('setOut').click();
      expect(getKeyBtn('setOut').textContent).toBe('O');
    });

    test('Reset to Defaults restores every binding and persists', async () => {
      const settings = createSettingsController({ api, elements: els, timeline });
      await settings.load();

      await openEditor();

      getKeyBtn('setIn').click();
      pressKey('KeyJ');

      els.shortcutsResetBtn.click();

      for (const action of SHORTCUT_ACTIONS) {
        expect(getKeyBtn(action).textContent).toBe(DEFAULT_LABELS[action]);
      }
      const lastCall = api.calls.setSetting[api.calls.setSetting.length - 1];
      expect(lastCall[0]).toBe('shortcuts');
      expect(lastCall[1].setIn).toBe('KeyI');
    });

    test('load() applies persisted overrides to the dispatch callback and the buttons', async () => {
      const onShortcutsApplied = jest.fn();
      const overridesApi = makeApi({
        getAllSettings: jest.fn(async () => ({
          shortcuts: { setIn: 'KeyJ', frameForward: '' }
        }))
      });
      const settings = createSettingsController({
        api: overridesApi, elements: els, timeline, onShortcutsApplied
      });
      await settings.load();

      expect(onShortcutsApplied).toHaveBeenCalledWith({ setIn: 'KeyJ', frameForward: '' });

      // Opening the editor afterwards shows the persisted values
      await openEditor();
      expect(getKeyBtn('setIn').textContent).toBe('J');
      expect(getKeyBtn('frameForward').textContent).toBe('None');
    });
  });
});
