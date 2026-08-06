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
    // hasSeenOnboarding -> true so the first-run tour never auto-opens mid-suite;
    // every other key behaves as before (false).
    getSetting: jest.fn(async (key) => key === 'hasSeenOnboarding'),
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

  // Drag-and-drop overlay regression: the overlay used to stay visible forever
  // after dragging a file in and dragging away without dropping, because the
  // hide listener lived on the overlay itself (pointer-events: none, so its
  // dragleave never fired). The fix tracks enter/leave depth on the stage.
  function dragEvent(type, dataTransfer, relatedTarget = null) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer, configurable: true });
    Object.defineProperty(ev, 'relatedTarget', { value: relatedTarget, configurable: true });
    return ev;
  }

  test('trim drop overlay hides when the drag leaves without dropping', () => {
    const stage = document.getElementById('trim-stage');
    const overlay = document.getElementById('trim-drop-overlay');
    const fileDT = { types: ['Files'], files: [] };

    // Enter with an OS file drag -> overlay shows
    stage.dispatchEvent(dragEvent('dragenter', fileDT));
    expect(overlay.style.display).toBe('flex');

    // Crossing a child boundary (leave + enter pair) keeps it visible
    stage.dispatchEvent(dragEvent('dragleave', fileDT, document.getElementById('ready-state')));
    stage.dispatchEvent(dragEvent('dragenter', fileDT));
    expect(overlay.style.display).toBe('flex');

    // Leaving the window entirely (no relatedTarget) hides it - the fix
    stage.dispatchEvent(dragEvent('dragleave', fileDT, null));
    expect(overlay.style.display).toBe('none');
  });

  test('merge drop overlays hide when the drag leaves without dropping', () => {
    document.getElementById('mode-merge-btn').click();
    const stage = document.getElementById('merge-stage');
    const overlay = document.getElementById('merge-drop-overlay');
    const fileDT = { types: ['Files'], files: [] };

    stage.dispatchEvent(dragEvent('dragenter', fileDT));
    expect(overlay.style.display).toBe('flex');

    stage.dispatchEvent(dragEvent('dragleave', fileDT, null));
    expect(overlay.style.display).toBe('none');
  });

  test('loop playback buttons exist in both transports and toggle active state', () => {
    const trimLoop = document.getElementById('trim-loop-btn');
    const mergeLoop = document.getElementById('merge-loop-btn');
    expect(trimLoop).toBeTruthy();
    expect(mergeLoop).toBeTruthy();

    expect(trimLoop.classList.contains('active')).toBe(false);
    trimLoop.click();
    expect(trimLoop.classList.contains('active')).toBe(true);
    trimLoop.click();
    expect(trimLoop.classList.contains('active')).toBe(false);

    expect(mergeLoop.classList.contains('active')).toBe(false);
    mergeLoop.click();
    expect(mergeLoop.classList.contains('active')).toBe(true);
    mergeLoop.click();
    expect(mergeLoop.classList.contains('active')).toBe(false);
  });

  test('shared export settings panel exists exactly once (no duplicate ids from the move)', () => {
    expect(document.querySelectorAll('#format-select').length).toBe(1);
    expect(document.querySelectorAll('#preset-select').length).toBe(1);
    expect(document.querySelectorAll('#resolution-select').length).toBe(1);
    expect(document.getElementById('export-merged-btn')).toBeTruthy();

    // Trim-only plan machinery (Calculate Plan) hides in Merge mode and returns on switch back.
    const calculateBtn = document.getElementById('calculate-btn');
    expect(calculateBtn.style.display).toBe('');
    document.getElementById('mode-merge-btn').click();
    expect(calculateBtn.style.display).toBe('none');
    document.getElementById('mode-trim-btn').click();
    expect(calculateBtn.style.display).toBe('');
  });

  test('timeline zoom controls exist and no-op safely before a file loads', () => {
    expect(document.getElementById('timeline-zoom-in')).toBeTruthy();
    expect(document.getElementById('timeline-zoom-out')).toBeTruthy();
    const readout = document.getElementById('timeline-zoom-readout');
    expect(readout.textContent).toBe('100%');
    // No file loaded -> timeline is null -> clicks must not throw and readout stays put
    document.getElementById('timeline-zoom-in').click();
    document.getElementById('timeline-zoom-out').click();
    readout.click();
    expect(readout.textContent).toBe('100%');
  });

  test('onboarding tour renders from Settings replay and completes once', () => {
    const modal = document.getElementById('onboarding-modal');
    const replay = document.getElementById('replay-onboarding-btn');
    expect(modal).toBeTruthy();
    expect(replay).toBeTruthy();

    // Replay opens the tour even though the first-run flag is already seen.
    replay.click();
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('onboarding-title').textContent.length).toBeGreaterThan(0);
    // First step is rendered: a visual + one dot per step (5 steps).
    expect(document.querySelector('#onboarding-visual svg')).toBeTruthy();
    expect(document.querySelectorAll('#onboarding-dots .onboarding-dot').length).toBe(5);

    // Paging forward through all 5 steps closes the tour and marks it seen.
    const next = document.getElementById('onboarding-next-btn');
    for (let i = 0; i < 5; i++) next.click();
    expect(modal.style.display).toBe('none');
    expect(window.clipSend.setSetting).toHaveBeenCalledWith('hasSeenOnboarding', true);
  });

  test('merge sidebar no longer forces full height so export settings stay visible', () => {
    document.getElementById('mode-merge-btn').click();
    const mergeSidebar = document.getElementById('merge-sidebar');
    // height:100% removed from markup and flex:1 no longer forced on switch
    expect(mergeSidebar.style.height).toBe('');
    expect(mergeSidebar.style.flex).toBe('');
    // The shared export panel follows the merge sidebar in the DOM flow
    const formatPanel = document.getElementById('format-select').closest('.panel');
    const sidebarContent = document.querySelector('.sidebar-content');
    const children = [...sidebarContent.children];
    expect(children.indexOf(formatPanel)).toBeGreaterThan(children.indexOf(mergeSidebar));
  });
});
