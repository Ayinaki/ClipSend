const { dialog } = require('electron');

async function openFileDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Video File',
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (canceled || filePaths.length === 0) {
    return null;
  }

  return filePaths[0];
}

async function openMultipleFilesDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Video Files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (canceled || filePaths.length === 0) {
    return null;
  }

  return filePaths;
}

async function showSaveDialog(defaultPath) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Exported Video',
    defaultPath: defaultPath,
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] }
    ]
  });

  if (canceled || !filePath) {
    return null;
  }
  return filePath;
}

async function pickDirectoryDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Default Export Directory',
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
}

module.exports = { openFileDialog, openMultipleFilesDialog, showSaveDialog, pickDirectoryDialog };
