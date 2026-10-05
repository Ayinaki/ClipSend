/**
 * @jest-environment jsdom
 *
 * Unit tests for CropManager's crop-box math (renderer/crop-manager.js) — the
 * one feature module that had no test file. These cover the parts that decide
 * what pixels the export crops: aspect-ratio presets, the even-dimension
 * guarantee, centering, and the undo snapshot round trip.
 *
 * CropManager's constructor reads a handful of fixed element ids and installs a
 * ResizeObserver (absent in jsdom), so the DOM is built here and the observer
 * stubbed.
 */
// Default export: the esbuild CJS transform exposes it under `.default`.
const CropManager = require('../../renderer/crop-manager.js').default;

/** Build the minimum DOM CropManager's constructor reaches for. */
function mountDom() {
  document.body.innerHTML = `
    <video id="main-video"></video>
    <div id="crop-overlay-container"><div id="crop-box"></div></div>
    <input type="checkbox" id="crop-enable">
    <div id="crop-controls"></div>
    <button id="crop-recenter-btn"></button>
    <div id="crop-preset-pills">
      <button class="crop-preset-pill" data-preset="none"></button>
      <button class="crop-preset-pill" data-preset="16:9"></button>
      <button class="crop-preset-pill" data-preset="9:16"></button>
      <button class="crop-preset-pill" data-preset="1:1"></button>
      <button class="crop-preset-pill" data-preset="4:3"></button>
    </div>
  `;
}

/** Give the video element the read-only media geometry jsdom does not set. */
function setVideoSize(video, width, height) {
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
  Object.defineProperty(video, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'clientHeight', { value: height, configurable: true });
}

function makeManager(width, height) {
  mountDom();
  const manager = new CropManager();
  setVideoSize(manager.video, width, height);
  manager.isEnabled = true;
  manager.enableCheckbox.checked = true;
  return manager;
}

describe('CropManager preset math', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  test('16:9 on a 16:9 source keeps the full frame', () => {
    const manager = makeManager(1920, 1080);
    manager._applyPreset('16:9');
    expect(manager.cropNative).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(manager.lockedAspectRatio).toBeCloseTo(16 / 9, 6);
  });

  test('9:16 on a landscape source fits height and centers horizontally', () => {
    const manager = makeManager(1920, 1080);
    manager._applyPreset('9:16');
    // 1080 * 9/16 = 607.5 -> 608 after the even-pixel floor, centered.
    expect(manager.cropNative.w).toBe(608);
    expect(manager.cropNative.h).toBe(1080);
    expect(manager.cropNative.x).toBe(Math.floor((1920 - 608) / 2));
    expect(manager.cropNative.y).toBe(0);
  });

  test('1:1 takes the short edge and centers both axes', () => {
    const manager = makeManager(1920, 1080);
    manager._applyPreset('1:1');
    expect(manager.cropNative).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });

  test('every preset keeps even dimensions on an odd-sized source', () => {
    const manager = makeManager(1281, 721);
    for (const preset of ['16:9', '9:16', '1:1', '4:3']) {
      manager._applyPreset(preset);
      expect(manager.cropNative.w % 2).toBe(0);
      expect(manager.cropNative.h % 2).toBe(0);
    }
  });

  test("preset 'none' clears the aspect lock but leaves the box", () => {
    const manager = makeManager(1920, 1080);
    manager._applyPreset('1:1');
    const boxed = { ...manager.cropNative };
    manager._applyPreset('none');
    expect(manager.lockedAspectRatio).toBeNull();
    expect(manager.cropNative).toEqual(boxed);
  });

  test('a preset emits change-start before change (undo capture order)', () => {
    const manager = makeManager(1920, 1080);
    const order = [];
    manager.on('change-start', () => order.push('start'));
    manager.on('change', () => order.push('change'));
    manager._applyPreset('16:9');
    expect(order).toEqual(['start', 'change']);
  });

  test('an oversized crop target can never exceed the source', () => {
    const manager = makeManager(640, 480);
    manager._applyPreset('9:16');
    expect(manager.cropNative.w).toBeLessThanOrEqual(640);
    expect(manager.cropNative.h).toBeLessThanOrEqual(480);
    expect(manager.cropNative.x).toBeGreaterThanOrEqual(0);
    expect(manager.cropNative.y).toBeGreaterThanOrEqual(0);
  });
});

describe('CropManager state snapshot', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  test('getCropSettings reports enable, preset, ratio and box', () => {
    const manager = makeManager(1920, 1080);
    manager._applyPreset('4:3');
    const settings = manager.getCropSettings();
    expect(settings.enable).toBe(true);
    expect(settings.preset).toBe('4:3');
    expect(settings.ratio).toBeCloseTo(4 / 3, 6);
    expect(settings.w).toBe(manager.cropNative.w);
    expect(settings.h).toBe(manager.cropNative.h);
  });

  test('applyCropState restores a snapshot (undo round trip)', () => {
    const manager = makeManager(1920, 1080);
    manager._applyPreset('1:1');
    const snapshot = manager.getCropSettings();

    manager._applyPreset('16:9');
    expect(manager.cropNative.w).toBe(1920);

    manager.applyCropState(snapshot);
    expect(manager.getCropSettings()).toEqual(snapshot);
    expect(manager.activePreset).toBe('1:1');
    expect(manager.lockedAspectRatio).toBe(1);
  });

  test('applyCropState with a disabled crop hides the overlay controls', () => {
    const manager = makeManager(1920, 1080);
    manager.applyCropState({ enable: false, x: 0, y: 0, w: 100, h: 100 });
    expect(manager.isEnabled).toBe(false);
    expect(manager.enableCheckbox.checked).toBe(false);
    expect(manager.container.style.display).toBe('none');
  });
});
