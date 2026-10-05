jest.mock('child_process', () => ({ execFile: jest.fn() }));

const { execFile } = require('child_process');
const { buildDiagnosticsReport, collectDiagnostics, _internals } = require('../main/diagnostics');

describe('buildDiagnosticsReport', () => {
  test('includes every section label', () => {
    const report = buildDiagnosticsReport({ appVersion: '2.4.0' });
    expect(report).toContain('ClipSend diagnostics');
    expect(report).toContain('-- App --');
    expect(report).toContain('-- System --');
    expect(report).toContain('-- Encoders --');
    expect(report).toContain('-- FFmpeg version --');
    expect(report).toContain('-- FFmpeg encoders --');
    expect(report).toContain('-- Settings --');
    expect(report).toContain('-- Updater log (tail) --');
    expect(report).toContain('-- Last export stderr --');
  });

  test('renders explicit placeholders for missing values, never undefined/null', () => {
    const report = buildDiagnosticsReport({});
    expect(report).toContain('(none)');
    expect(report).not.toContain('undefined');
    expect(report).not.toContain('null');
  });

  test('pretty-prints settings and encoder caps as JSON', () => {
    const report = buildDiagnosticsReport({
      settings: { videoCodec: 'h264', maxQuality: true },
      encoderCaps: { nvenc: { h264: true } }
    });
    expect(report).toContain('"videoCodec": "h264"');
    expect(report).toContain('"h264": true');
  });

  test('truncates an over-long block and says how much was dropped', () => {
    const encoders = Array.from({ length: 250 }, (_, i) => `V..... encoder_${i}`).join('\n');
    const report = buildDiagnosticsReport({ ffmpegEncoders: encoders });
    expect(report).toContain('encoder_0');
    expect(report).not.toContain('encoder_249');
    expect(report).toContain('(truncated 50 more lines)');
  });

  test('caps the updater log to its last lines, not its first', () => {
    const log = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const report = buildDiagnosticsReport({ updaterLogTail: log });
    expect(report).toContain('line 99');
    expect(report).not.toContain('line 0');
    expect(report).toContain('(truncated 40 earlier lines)');
  });

  test('does not throw for a null or non-object parts argument', () => {
    expect(() => buildDiagnosticsReport(null)).not.toThrow();
    expect(() => buildDiagnosticsReport('nonsense')).not.toThrow();
    expect(typeof buildDiagnosticsReport(undefined)).toBe('string');
  });

  test('pins the generation timestamp when one is supplied', () => {
    const report = buildDiagnosticsReport({ generatedAt: new Date('2026-10-05T12:00:00Z') });
    expect(report).toContain('2026-10-05T12:00:00.000Z');
  });

  test('survives a circular object without throwing', () => {
    const circular = { a: 1 };
    circular.self = circular;
    expect(() => buildDiagnosticsReport({ settings: circular })).not.toThrow();
    expect(buildDiagnosticsReport({ settings: circular })).toContain(_internals.UNAVAILABLE);
  });
});

describe('collectDiagnostics', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('writes a timestamped report and returns its path and content', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      callback(null, args[0] === '-encoders' ? 'ENCODER LIST' : 'ffmpeg version 7.0', '');
    });

    const writes = [];
    const writeFile = jest.fn(async (filePath, content) => {
      writes.push({ filePath, content });
    });

    const result = await collectDiagnostics({
      writeFile,
      ffmpegPath: 'C:/app/bin/ffmpeg.exe',
      store: { store: { videoCodec: 'h264' }, get: () => undefined },
      app: {
        getVersion: () => '2.4.0',
        getPath: () => 'C:/Temp',
        isPackaged: true
      },
      logPath: null,
      encoderCaps: { libx264: true },
      lastExportStderr: 'boom'
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toMatch(/clipsend-diagnostics-\d{8}-\d{6}\.txt$/);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writes[0].filePath).toBe(result.filePath);
    expect(result.content).toContain('ClipSend diagnostics');
    expect(result.content).toContain('2.4.0');
    expect(result.content).toContain('ffmpeg version 7.0');
    expect(result.content).toContain('ENCODER LIST');
    expect(result.content).toContain('boom');
  });

  test('reports failure instead of throwing when the write fails', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    const result = await collectDiagnostics({
      writeFile: async () => { throw new Error('disk full'); },
      app: { getVersion: () => '2.4.0', getPath: () => 'C:/Temp', isPackaged: false },
      store: { store: {} }
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('disk full');
  });

  test('degrades to (unavailable) when ffmpeg cannot be run', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(new Error('ENOENT'), '', ''));
    const result = await collectDiagnostics({
      writeFile: async () => {},
      ffmpegPath: 'C:/missing/ffmpeg.exe',
      app: { getVersion: () => '2.4.0', getPath: () => 'C:/Temp', isPackaged: false },
      store: { store: {} }
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain(_internals.UNAVAILABLE);
  });
});
