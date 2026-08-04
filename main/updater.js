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

/**
 * Build the PowerShell relauncher script that:
 *   1. Waits for the current app process (PID) to exit completely.
 *   2. Runs the downloaded NSIS installer silently in UPDATE mode (--updated /S).
 *   3. Polls the installed exe until it is actually replaced (NSIS stub exits early).
 *   4. Relaunches the app VISIBLY (no -WindowStyle Hidden).
 *   5. Writes installer-result.json and self-deletes.
 *
 * @param {Object} opts
 * @param {number} opts.currentPid
 * @param {string} opts.installerPath
 * @param {string} opts.currentExecPath
 * @param {string} opts.logPath
 * @param {string} opts.resultFile
 * @returns {string} PowerShell script content.
 */
function buildInstallerScript({ currentPid, installerPath, currentExecPath, logPath, resultFile }) {
  const psEscape = (s) => String(s).replace(/'/g, "''");
  return `
$pidVal = ${Number(currentPid)}
$installer = '${psEscape(installerPath)}'
$currentExec = '${psEscape(currentExecPath)}'
$logFile = '${psEscape(logPath)}'
$resFile = '${psEscape(resultFile)}'

function Write-UpdaterLog([string]$msg) {
  try { Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] $msg" } catch {}
}

# 1. Wait for the old process to exit completely (bounded so we never hang forever)
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 200
}
Start-Sleep -Seconds 1

# 2. Record pre-update exe metadata so we can detect when it is replaced
$beforeWrite = $null
$beforeSize = -1
$exeBefore = Get-Item -LiteralPath $currentExec -ErrorAction SilentlyContinue
if ($exeBefore) {
  $beforeWrite = $exeBefore.LastWriteTimeUtc
  $beforeSize = $exeBefore.Length
}

# 3. Run the installer silently in UPDATE mode.
#    NSIS: /S = silent, --updated = update flow (electron-updater passes this first).
$code = -1
$installError = $null
try {
  $p = Start-Process -FilePath $installer -ArgumentList '--updated','/S' -WindowStyle Hidden -Wait -PassThru
  $code = if ($null -eq $p) { 0 } else { $p.ExitCode }
  Write-UpdaterLog "Installer process completed with exit code $code."
} catch {
  $installError = $_.Exception.Message
  Write-UpdaterLog "Installer failed to run: $installError"
}

# 4. NSIS is a bootstrap stub: the main process can exit before files are replaced.
#    Poll the installed exe until it changes (or a 120s timeout) before relaunching.
$replaced = $false
$pollDeadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $pollDeadline) {
  Start-Sleep -Milliseconds 500
  $exeNow = Get-Item -LiteralPath $currentExec -ErrorAction SilentlyContinue
  if ($exeNow) {
    if ($null -ne $beforeWrite -and $exeNow.LastWriteTimeUtc -gt $beforeWrite) { $replaced = $true; break }
    if ($beforeSize -ge 0 -and $exeNow.Length -ne $beforeSize) { $replaced = $true; break }
  }
}

# 5. Write machine-readable result for the next launch to surface
$resObj = @{
  exitCode = $code
  replaced = $replaced
  timestamp = (Get-Date -Format o)
  installerPath = $installer
  success = (($code -eq 0) -and $replaced)
}
if ($installError) { $resObj.error = $installError }
try { $resObj | ConvertTo-Json | Set-Content -Path $resFile -Encoding utf8 } catch {}

# 6. Relaunch the app visibly (never -WindowStyle Hidden) so the update is noticed.
#    Guard: if the NSIS installer already auto-ran the new build (oneClick
#    runAfterFinish), don't spawn a duplicate instance.
if (($code -eq 0) -and $replaced) {
  Start-Sleep -Seconds 1
  $exeName = [System.IO.Path]::GetFileName($currentExec)
  $alreadyRunning = Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($exeName)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $currentExec }
  if (-not $alreadyRunning) {
    try {
      if (Test-Path $currentExec) {
        Start-Process -FilePath $currentExec
        Write-UpdaterLog "Relaunched app: $currentExec"
      }
    } catch {
      Write-UpdaterLog "Failed to relaunch app: $_"
    }
  } else {
    Write-UpdaterLog "App already running after install — skipping relaunch to avoid a duplicate instance."
  }
} else {
  Write-UpdaterLog "Update not applied (code=$code, replaced=$replaced) — app will not be relaunched."
}

# 7. Self-cleanup (leave installer-result.json in place — the next launch reads it)
Start-Sleep -Seconds 2
try { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue } catch {}
`;
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
    logUpdater(`Download finished. File size: ${downloadedBytes} bytes (Expected: ${totalBytes} bytes).`);

    if (totalBytes > 0 && downloadedBytes !== totalBytes) {
      logUpdater(`Warning: Downloaded byte size (${downloadedBytes}) differs from Content-Length header (${totalBytes}).`);
    }

    const logPath = path.join(app ? app.getPath('userData') : process.cwd(), 'updater.log');

    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:downloaded', { installerPath, logPath });
    }

    // Launch NSIS silent installer via a temporary .ps1 script or cmd.exe fallback (Windows platform)
    setTimeout(() => {
      try {
        if (process.platform !== 'win32') {
          logUpdater(`Non-Windows platform (${process.platform}) detected. Automatic installer execution skipped.`);
          return;
        }

        const currentExecPath = process.execPath;
        const currentPid = process.pid;
        const resultFile = path.join(app ? app.getPath('userData') : process.cwd(), 'installer-result.json');

        logUpdater(`Preparing update relauncher for PID ${currentPid}, execPath: "${currentExecPath}", installerPath: "${installerPath}"`);

        // PowerShell script content — waits for PID to exit, runs installer in
        // update mode (--updated) silently (/S), waits for files to be replaced,
        // relaunches the app visibly, and self-deletes.
        //
        // Key details:
        //  - NSIS installers are bootstrap stubs: the main .exe may exit before
        //    the real install finishes, so Start-Process -Wait alone is not
        //    enough. We poll the target exe's write time / size to confirm the
        //    new build actually replaced the old one before relaunching.
        //  - Without --updated, the NSIS installer runs a fresh-install flow
        //    which can fail to update an existing installation (and won't
        //    relaunch the app on success). electron-updater always passes it.
        //  - The app must be relaunched VISIBLY — -WindowStyle Hidden makes the
        //    window never appear, which users report as "the app never reopens".
        const psScript = buildInstallerScript({
          currentPid,
          installerPath,
          currentExecPath,
          logPath,
          resultFile
        });

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
          // Quote the installer path for cmd start (handles spaces), and pass
          // --updated so the NSIS installer runs the update flow, not fresh install.
          const quotedPath = `"${installerPath}"`;
          const cmdFallback = spawn('cmd.exe', ['/C', 'start', '""', quotedPath, '/S', '--updated'], {
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
      } catch (err) {
        logUpdater('Updater relauncher callback failed', err);
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('updater:error', { error: 'Updater relauncher failed', details: String(err), logPath });
        }
      }
    }, 1000);

    return { success: true, installerPath, logPath };

  } catch (err) {
    isDownloading = false;
    logUpdater('Download or install failed', err);
    const logPath = path.join(app ? app.getPath('userData') : process.cwd(), 'updater.log');
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('updater:error', { error: err.message, logPath });
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

  // Check if a previous installer result file exists
  try {
    const resultFile = path.join(app ? app.getPath('userData') : process.cwd(), 'installer-result.json');
    if (fs.existsSync(resultFile)) {
      const raw = fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''); // strip UTF-8 BOM (PowerShell 5.1 writes one)
      const resultData = JSON.parse(raw);
      logUpdater(`Read installer result from previous update: ${JSON.stringify(resultData)}`);
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('updater:installedResult', resultData);
      }
      fs.unlinkSync(resultFile);
    }
  } catch (e) {
    logUpdater('Failed processing installer-result.json on start:', e);
  }

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
  logUpdater,
  buildInstallerScript
};
