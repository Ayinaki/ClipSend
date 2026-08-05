const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('clipSend', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openSpecificFile: (filePath) => ipcRenderer.invoke('dialog:openSpecificFile', filePath),
  openMultipleFiles: () => ipcRenderer.invoke('dialog:openMultipleFiles'),
  openSpecificMultipleFiles: (filePaths) => ipcRenderer.invoke('dialog:openSpecificMultipleFiles', filePaths),
  
  // Export Planner & Execution
  calculatePlan: (args) => ipcRenderer.invoke('export:calculatePlan', args),
  startExport: (args) => ipcRenderer.invoke('export:start', args),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (callback) => {
    ipcRenderer.on('export:progress', (event, data) => callback(data));
  },

  // Merge Export
  checkMergeCompat: (filePaths) => ipcRenderer.invoke('merge:checkCompat', { filePaths }),
  resolveMergeDestination: () => ipcRenderer.invoke('merge:resolveDestination'),
  startMerge: (filePaths, outputPath, trims) => ipcRenderer.invoke('merge:export', { filePaths, outputPath, trims }),
  cancelMerge: () => ipcRenderer.invoke('merge:cancel'),
  onMergeProgress: (callback) => {
    ipcRenderer.on('merge:progress', (event, data) => callback(data));
  },

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  detectEncoders: () => ipcRenderer.invoke('encoder:detect'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  copyFileToClipboard: (filePath) => ipcRenderer.invoke('clipboard:copyFile', filePath),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Preview Remux
  generatePreviewRemux: (inputPath, audioOrdinal) => ipcRenderer.invoke('preview:remux', { inputPath, audioOrdinal }),
  cleanupPreviewRemux: (tempPath) => ipcRenderer.invoke('preview:cleanup', tempPath),
  cleanupFiles: (filePaths) => ipcRenderer.invoke('util:cleanupFiles', filePaths),
  getTempPath: () => ipcRenderer.invoke('util:getTempPath'),

  // Waveform
  getWaveformData: (filePath, audioIndex) => ipcRenderer.invoke('waveform:get', { filePath, audioIndex }),

  // Feedback
  submitFeedback: (payload) => ipcRenderer.invoke('submit-feedback', payload),

  // Auto Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('updater:downloadAndInstall'),
  onUpdateAvailable: (callback) => ipcRenderer.on('updater:available', (event, data) => callback(data)),
  onUpdateProgress: (callback) => ipcRenderer.on('updater:progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('updater:downloaded', (event, data) => callback(data)),
  onUpdateError: (callback) => ipcRenderer.on('updater:error', (event, data) => callback(data)),
  onUpdateInstalledResult: (callback) => ipcRenderer.on('updater:installedResult', (event, data) => callback(data))
});
