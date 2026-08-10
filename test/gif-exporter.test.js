const gifExporter = require('../main/gif-exporter');
const child_process = require('child_process');
const fs = require('fs');

jest.mock('child_process');
jest.mock('fs');

/**
 * The GIF exporter previously only listened for 'close' on its spawned
 * processes. A failed spawn (e.g. gifski.exe missing) fires 'error' and never
 * 'close', so the export promise hung forever. These tests pin the error
 * handler behavior.
 */
describe('GifExporter spawn error handling', () => {
  let mockProcess;

  function makeMockProcess() {
    return { stderr: { on: jest.fn() }, on: jest.fn(), kill: jest.fn() };
  }

  beforeEach(() => {
    mockProcess = makeMockProcess();
    child_process.spawn.mockReturnValue(mockProcess);
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockImplementation(() => {});
    fs.statSync.mockReturnValue({ size: 100 });
    fs.renameSync.mockImplementation(() => {});
    gifExporter.cancelled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('_runFfmpeg rejects when the process emits "error" instead of "close"', async () => {
    const promise = gifExporter._runFfmpeg(['-y', '-i', 'in.mp4'], 10, jest.fn());

    const errorHandler = mockProcess.on.mock.calls.find(c => c[0] === 'error')[1];
    expect(errorHandler).toBeDefined();
    errorHandler(new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow('spawn ENOENT');
  });

  test('_runGifski rejects when the process emits "error" instead of "close"', async () => {
    const promise = gifExporter._runGifski(['-o', 'out.gif']);

    const errorHandler = mockProcess.on.mock.calls.find(c => c[0] === 'error')[1];
    expect(errorHandler).toBeDefined();
    errorHandler(new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow('spawn ENOENT');
  });

  test('runEncode fails fast (rejects) when ffmpeg cannot be spawned', async () => {
    const plan = {
      clipDuration: 10,
      singlePassArgs: ['-i', 'in.mp4'],
      targetSizeMB: 10,
      width: 640
    };

    const promise = gifExporter.runEncode(plan, 'out.gif', jest.fn());

    const errorHandler = mockProcess.on.mock.calls.find(c => c[0] === 'error')[1];
    errorHandler(new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow('spawn ENOENT');
  });
});
