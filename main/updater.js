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

function logUpdater(message, error = null) {
  try {
    const logDir = app ? app.getPath('userData') : process.cwd();
    const logPath = path.join(logDir, 'updater.log');
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] ${message}\n`;
    if (error) {
      line += `[${timestamp}] ERROR: ${error.stack || error.message || error}\n`;
    }
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (e) {
    console.error('Failed writing to updater.log:', e);
  }
}

async function checkForUpdates() {
  try {
    logUpdater('Checking for updates...');
    const data = await fetchJson(GITHUB_API_URL);
    const latestVersion = data.tag_name || data.name || '';
    const currentVersion = app.getVersion();

    if (!latestVersion || !isNewerVersion(currentVersion, latestVersion)) {
      updateInfo = null;
      logUpdater(`No new updates. Current: ${currentVersion}, Latest: ${latestVersion}`);
      return { available: false, currentVersion, latestVersion };
    }

    // Find Windows installer asset (.exe)
    const exeAsset = (data.assets || []).find(a => a.name.endsWith('.exe'));
    if (!exeAsset) {
      logUpdater(`New version ${latestVersion} available, but no .exe asset found.`);
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

    logUpdater(`Update available: ${latestVersion} (Url: ${exeAsset.browser_download_url}, Size: ${exeAsset.size} bytes)`);

    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:available', updateInfo);
    }

    return { available: true, updateInfo };
  } catch (err) {
    logUpdater('Error checking for updates', err);
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:error', err.message);
    }
    return { available: false, error: err.message };
  }
}

async function downloadAndInstallUpdate() {
  if (!updateInfo || !updateInfo.downloadUrl) {
    const err = new Error('No update available to download.');
    logUpdater('downloadAndInstallUpdate failed', err);
    throw err;
  }

  if (isDownloading) {
    return { status: 'already_downloading' };
  }

  isDownloading = true;
  const tempDir = app.getPath('temp');
  const installerPath = path.join(tempDir, `ClipSend-Setup-${updateInfo.version}.exe`);

  logUpdater(`Starting update download: ${updateInfo.downloadUrl} -> ${installerPath}`);

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
    logUpdater(`Download finished successfully. File size: ${downloadedBytes} bytes.`);

    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:downloaded', { installerPath });
    }

    // Launch NSIS silent installer via a temporary .ps1 script or cmd.exe fallback
    setTimeout(() => {
      const currentExecPath = process.execPath;
      const currentPid = process.pid;

      logUpdater(`Preparing update relauncher for PID ${currentPid}, execPath: "${currentExecPath}", installerPath: "${installerPath}"`);

      // PowerShell script content — waits for PID to exit, runs installer silently, relaunch app, self-deletes
      const psScript = `
$pidVal = ${currentPid}
$installer = '${installerPath.replace(/'/g, "''")}'
$currentExec = '${currentExecPath.replace(/'/g, "''")}'

# Wait for original process to exit completely
while (Get-Process -Id $pidVal -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
Start-Sleep -Seconds 1

# Run installer silently (NSIS: /S)
try {
  Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait
} catch {
  try {
    Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden
  } catch {}
}

Start-Sleep -Seconds 1

# Attempt to relaunch the app executable
try {
  if (Test-Path $currentExec) {
    Start-Process -FilePath $currentExec -WindowStyle Hidden
  }
} catch {}

# Self-cleanup
try { Remove-Item -LiteralPath (Get-Item $MyInvocation.MyCommand.Path) -Force } catch {}
`;

      const psPath = path.join(app.getPath('temp'), `clipsend-updater-${Date.now()}.ps1`);
      let psWritten = false;

      try {
        fs.writeFileSync(psPath, psScript, { encoding: 'utf8' });
        psWritten = true;
        logUpdater(`Successfully wrote updater script to "${psPath}"`);
      } catch (writeErr) {
        logUpdater(`Failed to write .ps1 script to "${psPath}". Attempting cmd.exe fallback.`, writeErr);
      }

      if (psWritten) {
        try {
          const relauncher = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle', 'Hidden',
            '-ExecutionPolicy', 'Bypass',
            '-File', psPath
          ], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });
          relauncher.unref();
          logUpdater('Successfully spawned PowerShell relauncher process. Quitting app now.');
          app.quit();
          return;
        } catch (spawnErr) {
          logUpdater('Failed to spawn powershell.exe relauncher. Attempting cmd.exe fallback.', spawnErr);
        }
      }

      // Fallback: try to start installer directly via cmd.exe
      try {
        logUpdater('Executing cmd.exe fallback for installer...');
        const cmdFallback = spawn('cmd.exe', ['/C', 'start', '""', `"${installerPath}"`, '/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        cmdFallback.unref();
        logUpdater('cmd.exe fallback spawned successfully.');
      } catch (cmdErr) {
        logUpdater('cmd.exe fallback failed as well.', cmdErr);
      }

      app.quit();
    }, 1000);

    return { success: true, installerPath };

  } catch (err) {
    isDownloading = false;
    logUpdater('Download or install failed', err);
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
  isNewerVersion,
  logUpdater
};
