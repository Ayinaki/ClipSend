const { isNewerVersion, buildInstallerScript } = require('../main/updater');

const SCRIPT_OPTS = {
  currentPid: 12345,
  installerPath: 'C:\\Users\\test\\AppData\\Local\\Temp\\ClipSend-Setup-v1.8.15.exe',
  currentExecPath: 'C:\\Users\\test\\AppData\\Local\\Programs\\ClipSend\\ClipSend.exe',
  logPath: 'C:\\Users\\test\\AppData\\Roaming\\ClipSend\\updater.log',
  resultFile: 'C:\\Users\\test\\AppData\\Roaming\\ClipSend\\installer-result.json'
};

describe('buildInstallerScript', () => {
  test('passes --updated before /S so NSIS runs the update flow, not a fresh install', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain("-ArgumentList '--updated','/S'");
  });

  test('relaunches the app VISIBLY (no -WindowStyle Hidden on the app relaunch)', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    // The silent installer itself may be hidden, but the app relaunch must be visible.
    expect(script).toContain('Start-Process -FilePath $currentExec');
    expect(script).not.toMatch(/Start-Process -FilePath \$currentExec[^\n]*-WindowStyle Hidden/);
  });

  test('only relaunches when the installer succeeded AND the exe was replaced', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain('if (($code -eq 0) -and $replaced) {');
  });

  test('polls for the installed exe to be replaced (NSIS bootstrap stub exits early)', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain('$pollDeadline = (Get-Date).AddSeconds(120)');
    expect(script).toContain('$exeNow.LastWriteTimeUtc -gt $beforeWrite');
  });

  test('writes a machine-readable result file that records success = code 0 AND replaced', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain('success = (($code -eq 0) -and $replaced)');
    expect(script).toContain('Set-Content -Path $resFile');
  });

  test('does NOT delete installer-result.json during self-cleanup (next launch reads it)', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toMatch(/Remove-Item .*\$MyInvocation\.MyCommand\.Path/);
    expect(script).not.toMatch(/Remove-Item[^\n]*\$resFile/);
  });

  test('embeds the current PID and escapes single quotes in paths', () => {
    const script = buildInstallerScript({
      ...SCRIPT_OPTS,
      installerPath: "C:\\Temp\\O'Brien\\setup.exe",
      currentPid: 9999
    });
    expect(script).toContain('$pidVal = 9999');
    expect(script).toContain("$installer = 'C:\\Temp\\O''Brien\\setup.exe'");
  });

  test('bounded wait for old process exit (never hangs forever)', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain('$deadline = (Get-Date).AddSeconds(60)');
  });

  test('guards against duplicate launch when the installer auto-runs the app', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain('$alreadyRunning = Get-Process');
    expect(script).toContain('skipping relaunch to avoid a duplicate instance');
  });

  test('writes updater.log entries via the Write-UpdaterLog helper', () => {
    const script = buildInstallerScript(SCRIPT_OPTS);
    expect(script).toContain('function Write-UpdaterLog');
    expect(script).toContain('Add-Content -Path $logFile');
  });
});

describe('updater semver comparison', () => {
  test('correctly identifies newer patch versions', () => {
    expect(isNewerVersion('1.5.6', '1.5.7')).toBe(true);
    expect(isNewerVersion('v1.5.6', 'v1.5.7')).toBe(true);
  });

  test('correctly identifies newer minor and major versions', () => {
    expect(isNewerVersion('1.5.6', '1.6.0')).toBe(true);
    expect(isNewerVersion('1.5.6', '2.0.0')).toBe(true);
  });

  test('returns false when current version is equal or newer', () => {
    expect(isNewerVersion('1.5.6', '1.5.6')).toBe(false);
    expect(isNewerVersion('1.6.0', '1.5.6')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('logUpdater logger helper', () => {
  const fs = require('fs');
  const path = require('path');
  const { logUpdater } = require('../main/updater');

  test('writes timestamped logs without throwing', () => {
    expect(() => {
      logUpdater('Test update message');
      logUpdater('Test error message', new Error('Mock update error'));
    }).not.toThrow();

    const logPath = path.join(process.cwd(), 'updater.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      expect(content).toContain('Test update message');
      expect(content).toContain('Mock update error');
      try { fs.unlinkSync(logPath); } catch (e) {}
    }
  });
});
