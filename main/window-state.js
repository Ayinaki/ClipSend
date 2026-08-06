/**
 * Window bounds persistence.
 *
 * Remembers the window's position/size and maximized state across restarts
 * via electron-store. A position is dropped (recentered by the OS) when it
 * falls outside every connected display, so an unplugged monitor never
 * strands the window off-screen.
 *
 * The electron store and the screen module are injected for tests (plain
 * Node has neither); the app calls createWindowStateManager() with no args.
 */

function isOnAnyDisplay(bounds, displays) {
  if (!displays || displays.length === 0) return true; // no display info -> trust
  return displays.some((d) => {
    const a = d.workArea;
    // Require a meaningful visible region (not a 1px sliver), so a mostly
    // off-screen restore gets recentered rather than stranded.
    const visibleW = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const visibleH = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return visibleW >= 100 && visibleH >= 50;
  });
}

function createWindowStateManager(store, screen) {
  // NOTE: the real store must use a name distinct from the settings store in
  // ipc-handlers.js ('config'). conf rewrites the entire config file from an
  // in-memory snapshot on every set, so two default-named stores would
  // silently clobber each other's keys (saving window state would wipe the
  // user's export settings and vice versa). Tests inject a fake store.
  const stateStore =
    store || new (require('electron-store'))({ name: 'window-state', defaults: { windowState: null } });

  // Resolved lazily inside load() — never at construction, which runs at
  // module load before the app is ready (the electron screen module is only
  // usable after the ready event; accessing it too early could throw).
  function getScreen() {
    if (screen) return screen;
    try {
      const mod = require('electron');
      return mod && mod.screen ? mod.screen : null;
    } catch (e) {
      return null;
    }
  }

  /** @returns {{ bounds: {x?:number,y?:number,width:number,height:number}, isMaximized: boolean } | null} */
  function load() {
    let saved;
    try {
      saved = stateStore.get('windowState');
    } catch (e) {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return null;

    const { x, y, width, height, isMaximized } = saved;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 400 || height < 300) return null;

    const bounds = { x, y, width, height };
    const screenRef = getScreen();
    if (Number.isFinite(x) && Number.isFinite(y) && screenRef && typeof screenRef.getAllDisplays === 'function') {
      let displays = [];
      try {
        displays = screenRef.getAllDisplays();
      } catch (e) {
        displays = [];
      }
      if (!isOnAnyDisplay(bounds, displays)) {
        // Monitor was disconnected or bounds are otherwise unreachable:
        // keep the size, let the window manager re-center.
        bounds.x = undefined;
        bounds.y = undefined;
      }
    }
    return { bounds, isMaximized: Boolean(isMaximized) };
  }

  function save(bounds, isMaximized) {
    try {
      stateStore.set('windowState', { ...bounds, isMaximized: Boolean(isMaximized) });
    } catch (e) {
      // A failing write (e.g. disk full) must never break window close.
    }
  }

  return { load, save, isOnAnyDisplay };
}

module.exports = { createWindowStateManager, isOnAnyDisplay };
