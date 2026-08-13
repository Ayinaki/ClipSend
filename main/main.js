const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { initUpdater } = require('./updater');
const { createWindowStateManager } = require('./window-state');
const { createTray } = require('./tray');

// Tray handle + quit flag: closing the window hides to the tray instead of
// quitting (unless the user chose Quit from the tray, which sets isQuitting).
let tray = null;
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});
// Windows logoff/shutdown fires 'session-end' before windows close; without
// this, the hide-to-tray close interception could block the shutdown.
app.on('session-end', () => {
  isQuitting = true;
});

// Disable OS hardware media key handling so multimedia keys don't trigger video playback
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// Identifies the app to Windows for taskbar progress + native notifications.
app.setAppUserModelId('com.clipsend.app');

const windowState = createWindowStateManager();

function createWindow() {
  const saved = windowState.load();
  const bounds = saved ? saved.bounds : null;

  const mainWindow = new BrowserWindow({
    // Fixed-size window (1500×800): the workbench layout (sidebar + stage +
    // timeline) is designed for exactly this size. Position and maximized
    // state persist across restarts, but the size itself never changes.
    width: 1500,
    height: 800,
    ...(bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      ? { x: bounds.x, y: bounds.y }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: false,
    resizable: false,
    backgroundColor: '#1e1e1e',
    // Multi-size .ico — Windows taskbar/titlebar pick the right size and are
    // less prone to icon-cache staleness than a single PNG.
    icon: path.join(__dirname, '..', 'build', 'icon.ico')
  });

  if (saved && saved.isMaximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  initUpdater(mainWindow);

  // Persist window position/size across restarts. Debounced on move/resize so
  // a maximized drag or rapid repositioning settles before we write; the final
  // bounds are always captured on close.
  let persistTimer = null;
  const persist = () => {
    if (mainWindow.isDestroyed()) return;
    // getNormalBounds always returns the window's normal (restored) bounds —
    // even while maximized or minimized (a minimized Windows window reports
    // off-screen coordinates from getBounds, which would be persisted).
    const b = mainWindow.getNormalBounds();
    windowState.save({ x: b.x, y: b.y, width: b.width, height: b.height }, mainWindow.isMaximized());
  };
  const schedulePersist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 400);
  };
  mainWindow.on('resize', schedulePersist);
  mainWindow.on('move', schedulePersist);
  mainWindow.on('close', (e) => {
    clearTimeout(persistTimer);
    persist();
    // With the tray available, closing the window hides it so exports keep
    // running and the app stays one click away. Quit from the tray (or
    // Windows shutdown) bypasses this and closes for real.
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Open DevTools for M0 to easily inspect things
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  tray = createTray(() => BrowserWindow.getAllWindows()[0] || null);

  app.on('activate', function () {
    // With hide-to-tray, a hidden window must be restored on dock click
    // (macOS) rather than recreated.
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (!win.isVisible()) win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
