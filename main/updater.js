const { app, ipcMain } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_OWNER = 'Ayinaki';
const REPO_NAME = 'ClipSend';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

let updateInfo = null;
let activeDownloadReq = null;
let isDownloading = false;
let mainWindowRef = null;

function isNewerVersion(current, latest) {
  const c = current.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const l = latest.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'ClipSend-App',
        'Accept': 'application/json',
        ...headers
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      resolve(res);
    });

    req.on('error', reject);
  });
}

function fetchJson(url) {
  return fetchUrl(url).then(res => {
    return new Promise((resolve, reject) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
  });
}

async function checkForUpdates() {
  try {
    const data = await fetchJson(GITHUB_API_URL);
    const latestVersion = data.tag_name || data.name || '';
    const currentVersion = app.getVersion();

    if (!latestVersion || !isNewerVersion(currentVersion, latestVersion)) {
      updateInfo = null;
      return { available: false, currentVersion, latestVersion };
    }

    // Find Windows installer asset (.exe)
    const exeAsset = (data.assets || []).find(a => a.name.endsWith('.exe'));
    if (!exeAsset) {
      return { available: false, currentVersion, latestVersion, error: 'No Windows installer asset found in release.' };
    }

    updateInfo = {
      version: latestVersion,
      currentVersion,
      releaseNotes: data.body || 'No release notes provided.',
      downloadUrl: exeAsset.browser_download_url,
      sizeBytes: exeAsset.size,
      publishedAt: data.published_at
    };

    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:available', updateInfo);
    }

    return { available: true, updateInfo };
  } catch (err) {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:error', err.message);
    }
    return { available: false, error: err.message };
  }
}

async function downloadAndInstallUpdate() {
  if (!updateInfo || !updateInfo.downloadUrl) {
    throw new Error('No update available to download.');
  }

  if (isDownloading) {
    return { status: 'already_downloading' };
  }

  isDownloading = true;
  const tempDir = app.getPath('temp');
  const installerPath = path.join(tempDir, `ClipSend-Setup-${updateInfo.version}.exe`);

  try {
    const res = await fetchUrl(updateInfo.downloadUrl);
    const totalBytes = parseInt(res.headers['content-length'] || String(updateInfo.sizeBytes || 0), 10);
    let downloadedBytes = 0;
    let startTime = Date.now();

    const fileStream = fs.createWriteStream(installerPath);

    await new Promise((resolve, reject) => {
      activeDownloadReq = res;

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const elapsed = (Date.now() - startTime) / 1000;
        const speedBytesPerSec = elapsed > 0 ? downloadedBytes / elapsed : 0;
        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('updater:progress', {
            percent,
            downloadedBytes,
            totalBytes,
            speedBytesPerSec
          });
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve(installerPath));
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(installerPath); } catch (e) {}
        reject(err);
      });

      res.on('error', (err) => {
        try { fs.unlinkSync(installerPath); } catch (e) {}
        reject(err);
      });
    });

    isDownloading = false;

    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:downloaded', { installerPath });
    }

    // Launch NSIS silent installer after waiting for current process PID to exit, then relaunch updated app
    setTimeout(() => {
      const currentExecPath = process.execPath;
      const currentPid = process.pid;
      const psCommand = `while (Get-Process -Id ${currentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }; Start-Process -FilePath "${installerPath}" -ArgumentList "/S" -Wait; if (Test-Path "${currentExecPath}") { Start-Process -FilePath "${currentExecPath}" }`;

      const relauncher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCommand], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      relauncher.unref();

      app.quit();
    }, 1000);

    return { success: true, installerPath };

  } catch (err) {
    isDownloading = false;
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:error', err.message);
    }
    throw err;
  }
}

function initUpdater(mainWindow) {
  mainWindowRef = mainWindow;

  ipcMain.handle('updater:check', async () => {
    return await checkForUpdates();
  });

  ipcMain.handle('updater:downloadAndInstall', async () => {
    return await downloadAndInstallUpdate();
  });

  // Automatic background update check on app start after 3 seconds
  setTimeout(() => {
    checkForUpdates().catch(() => {});
  }, 3000);
}

module.exports = {
  initUpdater,
  checkForUpdates,
  downloadAndInstallUpdate,
  isNewerVersion
};
