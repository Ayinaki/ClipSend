// System tray: quick access to the app, the last export folder, and Quit.
//
// Windows does not support dragging files onto a tray icon, so the "drop
// anywhere in the window" flow remains the primary way to load clips into the
// app. The tray keeps ClipSend reachable while its window is hidden, and opens
// the folder exports are written to.
const { app, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');

/**
 * Create the tray icon. Returns null if the tray can't be created (e.g. the
 * icon is missing), in which case the window keeps its normal close-to-quit
 * behaviour.
 *
 * @param {() => import('electron').BrowserWindow | null} getWindow
 *   Resolves the main window lazily (it may not exist yet at tray creation).
 */
function createTray(getWindow) {
  // .ico picks the closest embedded size; resize forces the 16px tray slot.
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'));
  if (icon.isEmpty()) return null;
  icon = icon.resize({ width: 16, height: 16 });

  const tray = new Tray(icon);
  tray.setToolTip('ClipSend');

  const showWindow = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    win.focus();
  };

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open ClipSend',
      click: showWindow
    },
    {
      label: 'Open Last Export Folder',
      click: () => {
        showWindow();
        // Read the settings store fresh on every click (read-only here — a
        // long-lived second instance would serve a stale snapshot). A missing
        // folder just focuses the window.
        try {
          const readStore = new Store();
          const dir = readStore.get('defaultExportDirectory');
          if (typeof dir === 'string' && dir) {
            shell.openPath(dir);
          }
        } catch (err) {
          console.error('[Tray] Could not read export directory:', err);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit ClipSend',
      click: () => app.quit()
    }
  ]));

  // Left-click toggles the window (single click on Windows).
  tray.on('click', () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      showWindow();
    }
  });

  return tray;
}

module.exports = { createTray };
