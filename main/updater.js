const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Auto-Updater (electron-updater)
//
// Previous iterations of this module hand-rolled the update flow: HTTP
// download of the installer from the GitHub release + a PowerShell script that
// waited on the process PID, ran the NSIS installer with `--updated /S`,
// polled for file replacement and relaunched the app. That pipeline repeatedly
// failed in the field (update reached 100%, app closed, installer never
// applied, app never reopened). The fragile parts were:
//   - PowerShell process orchestration (Start-Process -Wait quirks, PS 5.1
//     argument passing, script execution policy).
//   - Waiting on `process.pid` alone, which races Electron's helper processes.
//   - No download integrity verification and no elevation handling.
//
// electron-updater is the maintained module built for this exact stack
// (electron-builder NSIS installers published to GitHub Releases with
// latest.yml + blockmap). It spawns the installer directly (no PowerShell),
// verifies the download against the sha512 in latest.yml, uses the bundled
// elevate.exe when a per-machine install requires admin rights, and performs
// quitAndInstall correctly. This module now simply wraps it while preserving
// the existing IPC surface used by the renderer.
// ---------------------------------------------------------------------------

let mainWindowRef = null;
let lastCheckState = null; // 'available' | 'not-available'

// electron-updater is required lazily so this module can be loaded (and unit
// tested) in environments where the packaged electron runtime is absent.
function getAutoUpdater() {
  // eslint-disable-next-line global-require
  return require('electron-updater').autoUpdater;
}

function getUserDataDir() {
  if (app && typeof app.getPath === 'function') {
    try {
      return app.getPath('userData');
    } catch (e) {
      // fall through
    }
  }
  return process.cwd();
}

function getAppVersion() {
  if (app && typeof app.getVersion === 'function') {
    try {
      return app.getVersion();
    } catch (e) {
      // fall through
    }
  }
  return null;
}

function logUpdater(message, error = null) {
  try {
    const logPath = path.join(getUserDataDir(), 'updater.log');
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

function isNewerVersion(current, latest) {
  const c = String(current).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const l = String(latest).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

function sendToRenderer(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Update-attempt marker
// ---------------------------------------------------------------------------
// electron-updater has no built-in way to tell the user "the last install
// failed" on the next launch. We write a small marker before quitAndInstall;
// on the next startup we compare the marked version against the running
// version and surface the outcome through the existing updater:installedResult
// channel (used by the update modal).

const updateAttemptMarkerPath = () => path.join(getUserDataDir(), 'update-attempt.json');

function computeUpdateApplied(markerVersion, currentVersion) {
  return Boolean(markerVersion && currentVersion && markerVersion === currentVersion);
}

function writeUpdateAttemptMarker(version) {
  try {
    fs.writeFileSync(
      updateAttemptMarkerPath(),
      JSON.stringify({ version, timestamp: new Date().toISOString() }),
      'utf8'
    );
    logUpdater(`Wrote update-attempt marker for version ${version}.`);
  } catch (e) {
    logUpdater('Failed to write update-attempt marker:', e);
  }
}

function processUpdateAttemptMarker() {
  try {
    const p = updateAttemptMarkerPath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); // strip UTF-8 BOM
    const marker = JSON.parse(raw);
    fs.unlinkSync(p);

    const current = getAppVersion();
    const applied = computeUpdateApplied(marker.version, current);
    logUpdater(`Update attempt for ${marker.version}: applied=${applied} (current=${current}).`);
    sendToRenderer('updater:installedResult', { success: applied, version: marker.version });
  } catch (e) {
    logUpdater('Failed processing update-attempt marker on start:', e);
    // A malformed marker would otherwise be reprocessed (and re-logged) every
    // startup — remove it so the failure is reported once.
    try { fs.unlinkSync(updateAttemptMarkerPath()); } catch (cleanupErr) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// electron-updater wiring
// ---------------------------------------------------------------------------

function normalizeReleaseNotes(notes) {
  if (!notes) return 'No release notes provided.';
  if (Array.isArray(notes)) {
    return notes.map(n => (n && n.note) || '').filter(Boolean).join('\n\n') || 'No release notes provided.';
  }
  return String(notes);
}

function wireUpdaterEvents() {
  const autoUpdater = getAutoUpdater();

  autoUpdater.autoDownload = false;
  autoUpdater.logger = {
    info: (m) => logUpdater(`[info] ${m}`),
    warn: (m) => logUpdater(`[warn] ${m}`),
    error: (m) => logUpdater(`[error] ${m}`),
    debug: (m) => logUpdater(`[debug] ${m}`)
  };

  autoUpdater.on('update-available', (info) => {
    lastCheckState = 'available';
    logUpdater(`Update available: ${info && info.version}`);
    sendToRenderer('updater:available', {
      version: info && info.version,
      currentVersion: getAppVersion(),
      releaseNotes: normalizeReleaseNotes(info && info.releaseNotes),
      publishedAt: info && info.releaseDate
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    lastCheckState = 'not-available';
    logUpdater(`No update available. Latest known: ${info && info.version}`);
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:progress', {
      percent: Math.round(progress.percent || 0),
      downloadedBytes: progress.transferred || 0,
      totalBytes: progress.total || 0,
      speedBytesPerSec: progress.bytesPerSecond || 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logUpdater(`Update downloaded (${info && info.version}). Launching installer...`);
    writeUpdateAttemptMarker(info && info.version);
    sendToRenderer('updater:downloaded', { version: info && info.version });

    // Give the renderer a moment to render the "launching installer" state
    // before the app closes.
    setTimeout(() => {
      try {
        // isSilent = false, isForceRunAfter = true — quit, show the NSIS
        // installer window and let the user complete the update manually
        // (SmartScreen warnings can be clicked through), then relaunch the
        // app once the install finishes.
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        logUpdater('quitAndInstall failed', err);
        sendToRenderer('updater:error', String((err && err.message) || err));
      }
    }, 1000);
  });

  autoUpdater.on('error', (err) => {
    logUpdater('Auto-updater error', err);
    sendToRenderer('updater:error', String((err && err.message) || err));
  });
}

// ---------------------------------------------------------------------------
// Public API (same IPC surface as before)
// ---------------------------------------------------------------------------

async function checkForUpdates() {
  try {
    logUpdater('Checking for updates...');
    const result = await getAutoUpdater().checkForUpdates();
    const latestVersion = (result && result.updateInfo && result.updateInfo.version) || null;
    logUpdater(`Check finished. Latest: ${latestVersion}, available: ${lastCheckState === 'available'}`);
    return {
      available: lastCheckState === 'available',
      currentVersion: getAppVersion(),
      latestVersion
    };
  } catch (err) {
    logUpdater('Error checking for updates', err);
    sendToRenderer('updater:error', String((err && err.message) || err));
    return { available: false, error: (err && err.message) || String(err) };
  }
}

async function downloadAndInstallUpdate() {
  try {
    logUpdater('Downloading update...');
    await getAutoUpdater().downloadUpdate();
    // 'update-downloaded' fires on completion and triggers quitAndInstall.
    return { success: true };
  } catch (err) {
    logUpdater('Download failed', err);
    sendToRenderer('updater:error', String((err && err.message) || err));
    throw err;
  }
}

function initUpdater(mainWindow) {
  mainWindowRef = mainWindow;
  wireUpdaterEvents();
  processUpdateAttemptMarker();

  // Keep the IPC surface the renderer already uses.
  ipcMain.handle('updater:check', async () => checkForUpdates());
  ipcMain.handle('updater:downloadAndInstall', async () => downloadAndInstallUpdate());

  // Automatic background update check shortly after startup.
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
  // Exported for tests
  computeUpdateApplied,
  writeUpdateAttemptMarker,
  processUpdateAttemptMarker
};
