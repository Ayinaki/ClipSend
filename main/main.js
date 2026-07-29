const { app, BrowserWindow } = require('electron');
const path = require('path');
const dotenvPath = app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '..', '.env');
require('dotenv').config({ path: dotenvPath });
const { registerIpcHandlers } = require('./ipc-handlers');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 800,
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

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  
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
