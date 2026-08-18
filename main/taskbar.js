const path = require('path');

/**
 * Taskbar + notification helpers for exports.
 *
 * All functions are safe to call with a destroyed/closed window and no-op
 * gracefully in environments without Electron (which is why unit tests can
 * exercise them in plain Node).
 */

// Per-window pending auto-clear timers (set by setTaskbarError). Cancelled by
// any progress update or explicit clear so a stale timer can never wipe the
// progress bar of a *new* export started within the error window.
const pendingClears = new WeakMap();

function cancelPendingClear(win) {
  if (!win) return;
  const timer = pendingClears.get(win);
  if (timer) {
    clearTimeout(timer);
    pendingClears.delete(win);
  }
}

/**
 * Reflect export progress on the Windows taskbar icon.
 * percent is 0-100; negative values (used by the GIF descension loop's
 * "Encoding GIF (Attempt X)..." phases) render an indeterminate marquee.
 */
function updateTaskbarProgress(win, percent) {
  if (!win || win.isDestroyed()) return;
  cancelPendingClear(win); // a progress tick means a fresh export is running
  try {
    if (percent == null || !Number.isFinite(percent) || percent < 0) {
      win.setProgressBar(0, { mode: 'indeterminate' });
    } else {
      win.setProgressBar(Math.min(Math.max(percent, 0), 100) / 100);
    }
  } catch (e) {
    // Window may be closing mid-export; nothing useful to do.
  }
}

/** Remove the taskbar progress indicator entirely. */
function clearTaskbarProgress(win) {
  if (!win || win.isDestroyed()) return;
  cancelPendingClear(win);
  try {
    win.setProgressBar(-1);
  } catch (e) { /* ignore */ }
}

/**
 * Show the red "error" taskbar state (Windows) and auto-clear it after a few
 * seconds. The auto-clear is cancelled by the next progress update, so a new
 * export started immediately after a failure is never wiped mid-run.
 */
function setTaskbarError(win, clearAfterMs = 5000) {
  if (!win || win.isDestroyed()) return;
  cancelPendingClear(win);
  try {
    win.setProgressBar(1, { mode: 'error' });
  } catch (e) { /* ignore */ }
  const timer = setTimeout(() => clearTaskbarProgress(win), clearAfterMs);
  pendingClears.set(win, timer);
}

/**
 * Fire a native completion notification. Clicking it brings the app window
 * back to the foreground. No-ops when notifications are unsupported (e.g.
 * running under plain Node in tests) or when the app window already has focus
 * (the in-app Export Complete modal is visible, so a toast would be noise).
 */
function notifyExportComplete({ win, filePath, finalSizeMB, label }) {
  // electron is required lazily, inside the try, so this module still loads
  // under plain Node in tests: require('electron') throws on a runner whose
  // binary is missing (it tries to self-download). Same pattern as updater.js.
  let Notification = null;
  try {
    ({ Notification } = require('electron'));
  } catch (e) {
    // Not running under Electron; notifications are unavailable.
  }
  if (!Notification || !Notification.isSupported || !Notification.isSupported()) return;
  if (win && !win.isDestroyed() && win.isFocused && win.isFocused()) return;
  try {
    const name = filePath ? path.basename(filePath) : 'file';
    const size = finalSizeMB ? ` (${finalSizeMB} MB)` : '';
    const notification = new Notification({
      title: `${label || 'Export'} ready`,
      body: name + size
    });
    notification.on('click', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
    notification.show();
  } catch (e) {
    // Notifications can be unavailable (session/OS state); never break an export.
  }
}

module.exports = {
  updateTaskbarProgress,
  clearTaskbarProgress,
  setTaskbarError,
  notifyExportComplete
};
