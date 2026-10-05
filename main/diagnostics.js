const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Diagnostics report — the contents of the "Export diagnostics" support file.
 *
 * WHY a flat text report: the feedback dialog lets a user describe a problem,
 * but without the version, the FFmpeg build, and the last export's stderr the
 * maintainer is guessing. A single readable .txt is pasteable into an issue or
 * a Discord message and needs no zip dependency (the app ships no archiver and
 * deliberately keeps its dependency list tiny).
 *
 * This module must stay loadable WITHOUT Electron: tests require it directly,
 * and a `require('electron')` at module scope would break them. Everything the
 * runtime has to provide (app, store, paths) is passed in as arguments.
 */

// Cap any single long block (encoders dump, stderr tail) so one noisy field
// cannot bury the rest of the report.
const MAX_BLOCK_LINES = 200;
// The updater log grows without bound; only the tail is relevant to a failure.
const UPDATER_LOG_TAIL_LINES = 60;
// ffmpeg -version is a handful of lines but be explicit rather than implicit.
const FFMPEG_VERSION_LINES = 40;
// A single ffmpeg -encoders / -version call should never hang the export flow.
const CAPTURE_TIMEOUT_MS = 8000;

const NONE = '(none)';
const UNAVAILABLE = '(unavailable)';

/** Render a scalar as text, turning empty/null/undefined into an honest label. */
function text(value) {
  if (value === null || value === undefined) return NONE;
  const s = String(value);
  return s.trim() === '' ? NONE : s;
}

/** Pretty-print an object for the report; never throws, never prints undefined. */
function jsonBlock(value) {
  if (value === null || value === undefined) return NONE;
  try {
    const rendered = JSON.stringify(value, null, 2);
    return rendered === undefined ? NONE : rendered;
  } catch (e) {
    // Circular structures and exotic values land here rather than crashing the
    // whole report; the user still gets their other diagnostics.
    return UNAVAILABLE;
  }
}

/**
 * Trim a multi-line block to `maxLines`, keeping the head and noting how much
 * was dropped. Newlines are normalized so a CRLF source does not double-count.
 */
function boundedBlock(value, maxLines = MAX_BLOCK_LINES) {
  if (value === null || value === undefined) return NONE;
  const raw = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (raw === '') return NONE;
  const lines = raw.split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  const kept = lines.slice(0, maxLines);
  kept.push(`... (truncated ${lines.length - maxLines} more lines)`);
  return kept.join('\n');
}

/**
 * Keep the LAST `maxLines` of a block. Logs and stderr are read from the end
 * (the failure is at the bottom), so truncating them from the top would throw
 * away exactly the part that explains the problem.
 */
function boundedBlockEnd(value, maxLines = MAX_BLOCK_LINES) {
  if (value === null || value === undefined) return NONE;
  const raw = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (raw === '') return NONE;
  const lines = raw.split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  const dropped = lines.length - maxLines;
  const kept = lines.slice(lines.length - maxLines);
  return [`... (truncated ${dropped} earlier lines)`, ...kept].join('\n');
}

/** ISO timestamp for the header; invalid/missing input falls back to "now". */
function toIsoString(value) {
  try {
    const d = value instanceof Date ? value : (value ? new Date(value) : new Date());
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

/** YYYYMMDD-HHMMSS in local time, used in the export filename. */
function formatStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Build the report body. Pure: no I/O, no Electron, no clock reads beyond the
 * default timestamp — so tests can pin every value.
 *
 * @param {Object} [parts]
 * @returns {string}
 */
function buildDiagnosticsReport(parts = {}) {
  const p = parts && typeof parts === 'object' ? parts : {};
  const out = [];

  out.push('ClipSend diagnostics');
  out.push(`Generated: ${toIsoString(p.generatedAt)}`);
  out.push('');

  out.push('-- App --');
  out.push(`Version: ${text(p.appVersion)}`);
  out.push(`Electron: ${text(p.electronVersion)}`);
  out.push(`Chromium: ${text(p.chromeVersion)}`);
  out.push(`Packaged: ${p.isPackaged === true ? 'yes' : p.isPackaged === false ? 'no' : NONE}`);
  out.push('');

  out.push('-- System --');
  out.push(`Platform: ${text(p.platform)}`);
  out.push(`Architecture: ${text(p.arch)}`);
  out.push(`OS release: ${text(p.osRelease)}`);
  out.push('');

  out.push('-- Encoders --');
  out.push(jsonBlock(p.encoderCaps));
  out.push('');

  out.push('-- FFmpeg version --');
  out.push(boundedBlock(p.ffmpegVersion, FFMPEG_VERSION_LINES));
  out.push('');

  out.push('-- FFmpeg encoders --');
  out.push(boundedBlock(p.ffmpegEncoders));
  out.push('');

  out.push('-- Settings --');
  out.push(jsonBlock(p.settings));
  out.push('');

  out.push('-- Updater log (tail) --');
  out.push(boundedBlockEnd(p.updaterLogTail, UPDATER_LOG_TAIL_LINES));
  out.push('');

  out.push('-- Last export stderr --');
  out.push(boundedBlockEnd(p.lastExportStderr));
  out.push('');

  return out.join('\n');
}

/** Run a bundled binary and capture stdout, degrading to (unavailable). */
function runCapture(file, args) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { maxBuffer: 8 * 1024 * 1024, timeout: CAPTURE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        const out = stdout ? String(stdout).trim() : '';
        if (error) {
          // A partially captured dump is still more useful than nothing.
          resolve(out || UNAVAILABLE);
          return;
        }
        resolve(out || UNAVAILABLE);
      });
    } catch (e) {
      resolve(UNAVAILABLE);
    }
  });
}

/** Last `maxLines` lines of a log file, or (unavailable) when unreadable. */
async function readTail(logPath, maxLines) {
  if (!logPath) return UNAVAILABLE;
  try {
    const readFile = fs.promises && fs.promises.readFile
      ? fs.promises.readFile
      : (p) => Promise.resolve(fs.readFileSync(p, 'utf8'));
    const content = await readFile(logPath, 'utf8');
    const lines = String(content).replace(/\r\n/g, '\n').split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch (e) {
    return UNAVAILABLE;
  }
}

/** Temp directory from the Electron app when available, else the OS temp dir. */
function resolveTempDir(app) {
  try {
    if (app && typeof app.getPath === 'function') {
      const dir = app.getPath('temp');
      if (dir) return dir;
    }
  } catch (e) {
    /* fall through to os.tmpdir() */
  }
  return os.tmpdir();
}

/** Persisted settings snapshot for the report, tolerating either store shape. */
function readSettings(store) {
  try {
    if (store && store.store && typeof store.store === 'object') return store.store;
    if (store && typeof store.get === 'function') return store.get();
  } catch (e) {
    /* ignore */
  }
  return null;
}

/**
 * Gather the report and write it to a timestamped .txt in the temp directory.
 *
 * `writeFile` is injected so the happy path is testable without touching disk;
 * production callers omit it and get fs.promises.writeFile.
 *
 * @param {Object} [opts]
 * @param {(filePath: string, content: string) => Promise<void>} [opts.writeFile]
 * @param {string} [opts.ffmpegPath]
 * @param {{store?: object, get?: Function}} [opts.store]
 * @param {{getVersion?: Function, getPath?: Function, isPackaged?: boolean}} [opts.app]
 * @param {string} [opts.logPath]
 * @param {object} [opts.encoderCaps]
 * @param {string} [opts.lastExportStderr]
 * @returns {Promise<{success: true, filePath: string, content: string} | {success: false, error: string}>}
 */
async function collectDiagnostics(opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const { ffmpegPath, store, app, logPath, encoderCaps, lastExportStderr } = options;

  try {
    const writeFile = options.writeFile
      || ((filePath, content) => fs.promises.writeFile(filePath, content, 'utf8'));

    const [ffmpegVersion, ffmpegEncoders, updaterLogTail] = await Promise.all([
      ffmpegPath ? runCapture(ffmpegPath, ['-version']) : Promise.resolve(UNAVAILABLE),
      ffmpegPath ? runCapture(ffmpegPath, ['-encoders']) : Promise.resolve(UNAVAILABLE),
      readTail(logPath, UPDATER_LOG_TAIL_LINES)
    ]);

    const content = buildDiagnosticsReport({
      appVersion: app && typeof app.getVersion === 'function' ? safeCall(() => app.getVersion()) : null,
      electronVersion: safeCall(() => process.versions && process.versions.electron),
      chromeVersion: safeCall(() => process.versions && process.versions.chrome),
      platform: process.platform,
      arch: process.arch,
      osRelease: safeCall(() => `${os.type()} ${os.release()}`),
      isPackaged: app ? app.isPackaged : undefined,
      encoderCaps: encoderCaps || null,
      settings: readSettings(store),
      ffmpegVersion,
      ffmpegEncoders,
      updaterLogTail,
      lastExportStderr,
      generatedAt: new Date()
    });

    const fileName = `clipsend-diagnostics-${formatStamp(new Date())}.txt`;
    const filePath = path.join(resolveTempDir(app), fileName);
    await writeFile(filePath, content);

    return { success: true, filePath, content };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
}

/** Evaluate a getter defensively: a throwing Electron API must not sink the report. */
function safeCall(fn) {
  try {
    return fn();
  } catch (e) {
    return null;
  }
}

module.exports = {
  buildDiagnosticsReport,
  collectDiagnostics,
  // Exported for unit tests (the repo's `_internals` convention).
  _internals: {
    text,
    jsonBlock,
    boundedBlock,
    boundedBlockEnd,
    toIsoString,
    formatStamp,
    readTail,
    resolveTempDir,
    MAX_BLOCK_LINES,
    UPDATER_LOG_TAIL_LINES,
    NONE,
    UNAVAILABLE
  }
};
