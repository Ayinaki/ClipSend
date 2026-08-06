const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { initUpdater } = require('./updater');
const { createWindowStateManager } = require('./window-state');

// Disable OS hardware media key handling so multimedia keys don't trigger video playback
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// Identifies the app to Windows for taskbar progress + native notifications.
app.setAppUserModelId('com.clipsend.app');

const windowState = createWindowStateManager();

function createWindow() {
  const saved = windowState.load();
  const bounds = saved ? saved.bounds : null;

  const mainWindow = new BrowserWindow({
    width: (bounds && bounds.width) || 1500,
    height: (bounds && bounds.height) || 800,
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
    icon: path.join(__dirname, '..', 'build', 'icon.png')
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
  mainWindow.on('close', () => {
    clearTimeout(persistTimer);
    persist();
  });

  // Open DevTools for M0 to easily inspect things
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
