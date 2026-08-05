/**
 * @jest-environment jsdom
 *
 * End-to-end smoke test: load the *built* esbuild bundle (renderer/dist/
 * app.bundle.js) against the real renderer/index.html in jsdom, with a
 * stubbed window.clipSend bridge, and confirm the app initializes without
 * throwing. This exercises the actual production artifact (modules wired
 * together by esbuild) rather than the individual modules.
 *
 * Run `npm run build:renderer` before running this suite.
 */
const fs = require('fs');
const path = require('path');

// Stub the preload bridge with the surface app.js uses during startup.
function makeClipSendStub() {
  const fn = () => Promise.resolve({});
  return {
    getVersion: jest.fn(async () => '1.8.18'),
    getAllSettings: jest.fn(async () => ({})),
    detectEncoders: jest.fn(async () => false),
    setSetting: jest.fn(async () => {}),
    getSetting: jest.fn(async () => false),
    getWaveformData: fn,
    generatePreviewRemux: fn,
    cleanupPreviewRemux: fn,
    openFile: fn,
    openSpecificFile: fn,
    openMultipleFiles: fn,
    openSpecificMultipleFiles: fn,
    calculatePlan: fn,
    startExport: fn,
    cancelExport: fn,
    startMerge: fn,
    onExportProgress: jest.fn(),
    onMergeProgress: jest.fn(),
    onUpdateAvailable: jest.fn(),
    onUpdateProgress: jest.fn(),
    onUpdateDownloaded: jest.fn(),
    onUpdateError: jest.fn(),
    onUpdateInstalledResult: jest.fn(),
    minimizeWindow: jest.fn(),
    closeWindow: jest.fn(),
    pickDirectory: fn,
    checkMergeCompat: fn,
    resolveMergeDestination: fn,
    cleanupFiles: fn,
    getTempPath: fn,
    showItemInFolder: jest.fn(),
    copyFileToClipboard: fn,
    getPathForFile: jest.fn(() => 'C:\\file.mp4'),
    submitFeedback: fn,
    openExternalUrl: jest.fn()
  };
}

// The build script (npm run build:renderer) emits a CJS copy of the bundle
// (app.bundle.cjs) alongside the ESM one. Requiring it executes the module's
// top-level `document.addEventListener('DOMContentLoaded', ...)` registration
// in the current jsdom document.
describe('built renderer bundle (smoke)', () => {
  beforeEach(() => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
    document.documentElement.innerHTML = html;

    window.clipSend = makeClipSendStub();

    // jsdom defines getContext but throws "Not implemented"; override it so
    // Timeline / MergePlayer / CropManager constructors don't crash on canvas
    // operations during startup.
    const fakeCtx = new Proxy({}, {
      get(target, prop) {
        if (prop === 'canvas') return target.canvas;
        if (typeof prop === 'string' && !(prop in target)) {
          target[prop] = () => {};
        }
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });
    window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
    window.console.error = jest.fn(); // silence jsdom's not-implemented noise
    if (!window.ResizeObserver) {
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      };
    }
    if (!('mediaSession' in navigator)) {
      Object.defineProperty(navigator, 'mediaSession', {
        value: { setActionHandler: jest.fn() },
        configurable: true
      });
    }

    const bundlePath = path.join(__dirname, '..', '..', 'renderer', 'dist', 'app.bundle.cjs');
    require(bundlePath);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  test('app initializes without throwing (title bar present)', () => {
    expect(document.querySelector('.titlebar')).not.toBeNull();
    expect(document.getElementById('export-estimate-bar')).not.toBeNull();
    expect(document.getElementById('settings-btn')).not.toBeNull();
  });

  test('registers the expected IPC subscriptions', () => {
    expect(window.clipSend.onExportProgress).toHaveBeenCalled();
    expect(window.clipSend.onMergeProgress).toHaveBeenCalled();
    expect(window.clipSend.onUpdateAvailable).toHaveBeenCalled();
    expect(window.clipSend.onUpdateProgress).toHaveBeenCalled();
  });

  test('settings and volume handlers are wired', () => {
    // open the settings modal via the title bar button
    document.getElementById('settings-btn').click();
    expect(document.getElementById('settings-modal').style.display).toBe('flex');
  });

  test('only one modal is visible at a time (no stacking)', () => {
    const modalIds = ['settings-modal', 'changelog-modal', 'feedback-modal', 'export-modal', 'warnings-modal', 'update-modal'];

    function visibleModals() {
      return modalIds.filter(id => document.getElementById(id).style.display === 'flex');
    }

    // Open settings, then changelog: settings must close.
    document.getElementById('settings-btn').click();
    expect(visibleModals()).toEqual(['settings-modal']);

    document.getElementById('changelog-btn').click();
    expect(visibleModals()).toEqual(['changelog-modal']);

    // Open feedback on top of changelog: changelog must close.
    document.getElementById('feedback-btn').click();
    expect(visibleModals()).toEqual(['feedback-modal']);

    // Escape closes everything (dispatch on body so it bubbles like a real keypress).
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(visibleModals()).toEqual([]);
  });
});
