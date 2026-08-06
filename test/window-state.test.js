const { createWindowStateManager, isOnAnyDisplay } = require('../main/window-state');

function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (k) => (k in data ? data[k] : null),
    set: (k, v) => { data[k] = v; }
  };
}

function fakeScreen(displays) {
  return { getAllDisplays: () => displays };
}

const SINGLE_1080P = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];

describe('isOnAnyDisplay', () => {
  test('true when bounds overlap a display', () => {
    expect(isOnAnyDisplay({ x: 100, y: 100, width: 800, height: 600 }, SINGLE_1080P)).toBe(true);
  });

  test('false when bounds are fully off-screen', () => {
    expect(isOnAnyDisplay({ x: 5000, y: 5000, width: 800, height: 600 }, SINGLE_1080P)).toBe(false);
  });

  test('false when only a 1px sliver is visible (would be stranded)', () => {
    // Window parked mostly off the right edge: 1px of the window is on-screen.
    expect(isOnAnyDisplay({ x: 1919, y: 100, width: 800, height: 600 }, SINGLE_1080P)).toBe(false);
  });

  test('true when a substantial portion is visible', () => {
    expect(isOnAnyDisplay({ x: 1500, y: 100, width: 800, height: 600 }, SINGLE_1080P)).toBe(true);
  });

  test('trusts bounds when no display info is available', () => {
    expect(isOnAnyDisplay({ x: 9999, y: 9999, width: 800, height: 600 }, [])).toBe(true);
  });
});

describe('window state manager', () => {
  test('load returns null when nothing was saved', () => {
    const mgr = createWindowStateManager(fakeStore(), fakeScreen(SINGLE_1080P));
    expect(mgr.load()).toBeNull();
  });

  test('load restores saved bounds and maximized flag', () => {
    const store = fakeStore({
      windowState: { x: 120, y: 60, width: 1280, height: 720, isMaximized: true }
    });
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    expect(mgr.load()).toEqual({
      bounds: { x: 120, y: 60, width: 1280, height: 720 },
      isMaximized: true
    });
  });

  test('drops off-screen coordinates but keeps size', () => {
    const store = fakeStore({
      windowState: { x: 9999, y: 9999, width: 1280, height: 720, isMaximized: false }
    });
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    const loaded = mgr.load();
    expect(loaded.bounds.x).toBeUndefined();
    expect(loaded.bounds.y).toBeUndefined();
    expect(loaded.bounds.width).toBe(1280);
    expect(loaded.bounds.height).toBe(720);
  });

  test('drops a mostly-off-screen position (sliver) but keeps size', () => {
    const store = fakeStore({
      windowState: { x: 1919, y: 100, width: 1280, height: 720, isMaximized: false }
    });
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    const loaded = mgr.load();
    expect(loaded.bounds.x).toBeUndefined();
    expect(loaded.bounds.width).toBe(1280);
  });

  test('rejects degenerate saved sizes', () => {
    const store = fakeStore({ windowState: { x: 0, y: 0, width: 100, height: 100, isMaximized: false } });
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    expect(mgr.load()).toBeNull();
  });

  test('rejects non-numeric saved sizes', () => {
    const store = fakeStore({ windowState: { width: 'wide', height: 720 } });
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    expect(mgr.load()).toBeNull();
  });

  test('save persists bounds and maximized state', () => {
    const store = fakeStore();
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    mgr.save({ x: 10, y: 20, width: 1500, height: 800 }, false);
    expect(store.get('windowState')).toEqual({
      x: 10, y: 20, width: 1500, height: 800, isMaximized: false
    });
  });

  test('round-trips a full lifecycle', () => {
    const store = fakeStore();
    const mgr = createWindowStateManager(store, fakeScreen(SINGLE_1080P));
    mgr.save({ x: 300, y: 150, width: 1440, height: 900 }, true);
    expect(mgr.load()).toEqual({
      bounds: { x: 300, y: 150, width: 1440, height: 900 },
      isMaximized: true
    });
  });
});
