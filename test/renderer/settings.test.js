/**
 * @jest-environment jsdom
 *
 * Tests for the settings controller: loading persisted settings, volume
 * state, and the settings modal wiring against a fake IPC api.
 */
const fs = require('fs');
const path = require('path');

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
      playbackMuted: false
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
    volumeSlider: document.getElementById('volume-slider'),
    muteBtn: document.getElementById('mute-btn'),
    mergeVolumeSlider: document.getElementById('merge-volume-slider'),
    mergeMuteBtn: document.getElementById('merge-mute-btn')
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
});
