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
    detectEncoders: jest.fn(async () => ({
      nvenc: { h264: false, av1: false },
      qsv: { h264: false, av1: false },
      amf: { h264: false, av1: false },
      svtav1: true,
      libx264: true
    })),
    setSetting: jest.fn(async () => {}),
    // hasSeenOnboarding -> true so the first-run tour never auto-opens mid-suite;
    // every other key behaves as before (false).
    getSetting: jest.fn(async (key) => key === 'hasSeenOnboarding'),
    getWaveformData: fn,
    generatePreviewRemux: fn,
    cleanupPreviewRemux: fn,
    openFile: fn,
    openSpecificFile: fn,
    openMultipleFiles: jest.fn(async () => ({})),
    openSpecificMultipleFiles: fn,
    calculatePlan: fn,
    startExport: fn,
    cancelExport: fn,
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
    checkMergeCompat: jest.fn(async () => ({})),
    startMerge: jest.fn(async () => ({})),
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
    const modalIds = ['settings-modal', 'changelog-modal', 'feedback-modal', 'export-modal', 'warnings-modal', 'update-modal', 'shortcuts-modal', 'error-modal'];

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
    // First step is rendered: a visual + one dot per step (6 steps).
    expect(document.querySelector('#onboarding-visual svg')).toBeTruthy();
    expect(document.querySelectorAll('#onboarding-dots .onboarding-dot').length).toBe(6);

    // Paging forward through all 6 steps closes the tour and marks it seen.
    const next = document.getElementById('onboarding-next-btn');
    for (let i = 0; i < 6; i++) next.click();
    expect(modal.style.display).toBe('none');
    expect(window.clipSend.setSetting).toHaveBeenCalledWith('hasSeenOnboarding', true);
  });

  test('shortcuts modal opens via the ? key and help button, highlights the active mode, and closes', () => {
    const modal = document.getElementById('shortcuts-modal');
    const helpBtn = document.getElementById('help-btn');
    expect(modal).toBeTruthy();
    expect(helpBtn).toBeTruthy();

    // ? opens it (Trim is the default mode -> Trim section highlighted)
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { shiftKey: true, code: 'Slash', bubbles: true }));
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('shortcuts-trim-section').classList.contains('active')).toBe(true);
    expect(document.getElementById('shortcuts-merge-section').classList.contains('active')).toBe(false);

    // Close via the close button (idempotent across accumulated listeners)
    document.getElementById('close-shortcuts-btn').click();
    expect(modal.style.display).toBe('none');

    // The title-bar help button reopens it
    helpBtn.click();
    expect(modal.style.display).toBe('flex');

    // In Merge mode, the Merge section gets highlighted
    document.getElementById('mode-merge-btn').click();
    document.getElementById('close-shortcuts-btn').click();
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { shiftKey: true, code: 'Slash', bubbles: true }));
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('shortcuts-merge-section').classList.contains('active')).toBe(true);
    expect(document.getElementById('shortcuts-trim-section').classList.contains('active')).toBe(false);
  });

  test('crop preset pills exist and track the active preset', () => {
    const pills = document.querySelectorAll('.crop-preset-pill');
    expect(pills.length).toBe(5);
    expect(document.getElementById('crop-recenter-btn')).toBeTruthy();
    // Free is active by default
    expect(document.querySelector('.crop-preset-pill[data-preset="none"]').getAttribute('aria-pressed')).toBe('true');
    // Clicking a preset marks it active without throwing (no video loaded)
    document.querySelector('.crop-preset-pill[data-preset="9:16"]').click();
    expect(document.querySelector('.crop-preset-pill[data-preset="9:16"]').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.crop-preset-pill[data-preset="none"]').getAttribute('aria-pressed')).toBe('false');
  });

  test('sidebar collapsible panels act as an accordion (Cropping closes Audio Settings)', () => {
    const audioPanel = document.getElementById('audio-settings-panel');
    const cropPanel = document.getElementById('cropping-settings-panel');
    const audioHeader = audioPanel.querySelector('.collapsible-header');
    const cropHeader = cropPanel.querySelector('.collapsible-header');

    // Initial state: Audio expanded, Cropping collapsed.
    expect(audioPanel.classList.contains('collapsed')).toBe(false);
    expect(cropPanel.classList.contains('collapsed')).toBe(true);

    // Opening Cropping must collapse Audio so Export Settings stays visible.
    cropHeader.click();
    expect(cropPanel.classList.contains('collapsed')).toBe(false);
    expect(audioPanel.classList.contains('collapsed')).toBe(true);
    // Expanded content falls back to the stylesheet (inline display cleared);
    // collapsed content is hidden inline.
    expect(cropPanel.querySelector(':scope > .panel-content').style.display).toBe('');
    expect(audioPanel.querySelector(':scope > .panel-content').style.display).toBe('none');

    // Opening Audio again collapses Cropping.
    audioHeader.click();
    expect(audioPanel.classList.contains('collapsed')).toBe(false);
    expect(cropPanel.classList.contains('collapsed')).toBe(true);
  });

  test('merge compatibility warnings surface in the title-bar warnings badge', async () => {
    await loadMergeClips();
    window.clipSend.checkMergeCompat.mockResolvedValue({
      success: true,
      compatible: false,
      reason: 'Frame rate mismatch: clip 1 is 60fps, clip 2 is 120fps'
    });
    window.clipSend.startMerge.mockResolvedValue({
      success: true,
      filePath: 'C:\\merged.mp4',
      finalSizeMB: 4.2,
      strategy: 'concat_filter'
    });

    const warningBtn = document.getElementById('titlebar-warning-btn');
    const countEl = document.getElementById('titlebar-warning-count');
    expect(warningBtn.style.display).toBe('none');

    document.getElementById('export-merged-btn').click();
    await flushAsync();

    // Merge warnings go to the same title-bar warnings section as trim plan
    // warnings: badge + modal content (the sidebar box was removed).
    expect(warningBtn.style.display).not.toBe('none');
    expect(countEl.textContent).toBe('1');
    expect(document.getElementById('warnings-modal-content').textContent).toContain('merge will re-encode');
    expect(document.getElementById('warnings-modal-content').textContent).toContain('Frame rate mismatch');

    // Switching to Trim hides merge warnings (no stale badge across modes).
    document.getElementById('mode-trim-btn').click();
    expect(warningBtn.style.display).toBe('none');
  });

  test('failed merge surfaces through the in-app error modal (no blocking alert)', async () => {
    const modal = document.getElementById('error-modal');
    expect(modal).toBeTruthy();

    await loadMergeClips();
    window.clipSend.checkMergeCompat.mockResolvedValue({ success: true, compatible: true });
    window.clipSend.startMerge.mockResolvedValue({
      success: false,
      error: 'boom',
      details: 'ffmpeg tail'
    });

    document.getElementById('export-merged-btn').click();
    await flushAsync();

    // The failure must render in the app's own modal, with the raw ffmpeg
    // tail available under "Technical details" — never a native alert.
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('error-modal-title').textContent).toBe('Merge failed');
    expect(document.getElementById('error-modal-message').textContent).toBe('boom');
    expect(document.getElementById('error-modal-details').style.display).toBe('block');
    expect(document.getElementById('error-modal-details-text').textContent).toBe('ffmpeg tail');

    // OK dismisses it and the export button re-enables.
    document.getElementById('error-modal-ok-btn').click();
    expect(modal.style.display).toBe('none');
    expect(document.getElementById('export-merged-btn').disabled).toBe(false);
  });

  test('merge estimate row exists and hides with no clips', async () => {
    document.getElementById('mode-merge-btn').click();
    const estimate = document.getElementById('merge-estimate');
    expect(estimate).toBeTruthy();
    expect(estimate.style.display).toBe('none');
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

  // Merge timeline block gestures: a plain click must seek to the exact
  // position clicked (not drag the clip around), and a drag past a small
  // threshold reorders. This replaced the old native HTML5 drag on the whole
  // block, which hijacked simple clicks and only jumped to the clip start.
  function flushAsync() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function pointerEvent(type, clientX, pointerId = 1) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.clientX = clientX;
    ev.clientY = 30;
    ev.button = 0;
    ev.pointerId = pointerId;
    return ev;
  }

  /** Load two clips through the mocked bridge so merge blocks render. */
  async function loadMergeClips() {
    window.clipSend.openMultipleFiles.mockResolvedValue({
      success: true,
      clips: [
        { filePath: 'C:\\replay-a.mp4', thumbnailPath: '', mediaInfo: { duration: 60, width: 1920, height: 1080 } },
        { filePath: 'C:\\replay-b.mp4', thumbnailPath: '', mediaInfo: { duration: 30, width: 1920, height: 1080 } }
      ]
    });
    document.getElementById('mode-merge-btn').click();
    document.getElementById('add-clips-btn').click();
    await flushAsync();

    // Simulate layout geometry (jsdom computes none): strip at origin, 12px
    // padding-left, 200px blocks with a 6px gap.
    const strip = document.getElementById('merge-timeline-strip');
    Object.defineProperty(strip, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 430, bottom: 60, width: 430, height: 60 }),
      configurable: true
    });
    Object.defineProperty(strip, 'scrollLeft', { value: 0, configurable: true });
    Object.defineProperty(strip, 'scrollWidth', { value: 430, configurable: true });
    strip.querySelectorAll('.merge-timeline-block').forEach((b, i) => {
      Object.defineProperty(b, 'offsetLeft', { value: 12 + i * 206, configurable: true });
      Object.defineProperty(b, 'offsetWidth', { value: 200, configurable: true });
    });
    return strip;
  }

  test('merge blocks: a plain click seeks to the exact position clicked', async () => {
    await loadMergeClips();
    const strip = document.getElementById('merge-timeline-strip');
    const blocks = strip.querySelectorAll('.merge-timeline-block');
    expect(blocks.length).toBe(2);

    // Click block 2 (starts at global 60s) halfway in -> seek to 75s
    // (60s + half of the 30s clip).
    const clickX = 218 + 100;
    blocks[1].dispatchEvent(pointerEvent('pointerdown', clickX));
    window.dispatchEvent(pointerEvent('pointerup', clickX));

    expect(document.getElementById('merge-timecode').textContent).toBe('01:15 / 01:30');
    expect(document.getElementById('merge-clip-indicator').textContent).toBe('Clip 2 / 2');
    expect(blocks[1].classList.contains('active-clip')).toBe(true);
    expect(blocks[0].classList.contains('active-clip')).toBe(false);
  });

  test('merge blocks: dragging past the threshold reorders instead of seeking', async () => {
    await loadMergeClips();
    const strip = document.getElementById('merge-timeline-strip');
    let blocks = strip.querySelectorAll('.merge-timeline-block');

    // Press block 1, move well past the 6px threshold, release after block 2.
    blocks[0].dispatchEvent(pointerEvent('pointerdown', 12 + 100));
    window.dispatchEvent(pointerEvent('pointermove', 12 + 100 + 40));
    expect(blocks[0].classList.contains('dragging')).toBe(true);
    window.dispatchEvent(pointerEvent('pointerup', 430));
    await flushAsync();

    blocks = strip.querySelectorAll('.merge-timeline-block');
    const labels = [...blocks].map(b => b.querySelector('.merge-timeline-duration').textContent);
    // 30s clip first, 60s clip second: the reorder happened, not a seek.
    expect(labels[0]).toBe('0:30');
    expect(labels[1]).toBe('1:00');
    // Ghost/caret state fully cleaned up after the gesture.
    blocks.forEach(b => {
      expect(b.classList.contains('dragging')).toBe(false);
      expect(b.classList.contains('drag-over-left')).toBe(false);
      expect(b.classList.contains('drag-over-right')).toBe(false);
    });
  });
});
