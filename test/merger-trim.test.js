const { Merger, normalizeTrimPlan } = require('../main/merger');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

jest.mock('child_process');
jest.mock('fs');

// --- normalizeTrimPlan (pure helper) ---

describe('normalizeTrimPlan', () => {
  const filePaths = ['a.mp4', 'b.mp4', 'c.mp4'];
  const durations = [100, 50, 30];

  test('defaults to full range when no trims are provided', () => {
    const plan = normalizeTrimPlan(filePaths, undefined, durations);
    expect(plan).toEqual([
      { filePath: 'a.mp4', duration: 100, trimIn: 0, trimOut: 100, trimDuration: 100, isTrimmed: false },
      { filePath: 'b.mp4', duration: 50, trimIn: 0, trimOut: 50, trimDuration: 50, isTrimmed: false },
      { filePath: 'c.mp4', duration: 30, trimIn: 0, trimOut: 30, trimDuration: 30, isTrimmed: false }
    ]);
  });

  test('marks only clips with meaningful trims as trimmed', () => {
    const trims = [
      { trimIn: 10, trimOut: 40 },
      { trimIn: 0, trimOut: 50 },
      null
    ];
    const plan = normalizeTrimPlan(filePaths, trims, durations);
    expect(plan[0]).toMatchObject({ trimIn: 10, trimOut: 40, trimDuration: 30, isTrimmed: true });
    expect(plan[1].isTrimmed).toBe(false);
    expect(plan[2].isTrimmed).toBe(false);
  });

  test('clamps out-of-range trim values', () => {
    const trims = [{ trimIn: -5, trimOut: 999 }];
    const plan = normalizeTrimPlan(filePaths, trims, durations);
    expect(plan[0]).toMatchObject({ trimIn: 0, trimOut: 100, trimDuration: 100, isTrimmed: false });
  });

  test('treats sub-50ms trims as no-ops so untouched clips keep the fast path', () => {
    const trims = [{ trimIn: 0.01, trimOut: 99.99 }]; // applied to the 100s clip
    const plan = normalizeTrimPlan(filePaths, trims, durations);
    expect(plan[0].isTrimmed).toBe(false);
  });
});

// --- runMerge with per-clip trims (spawn/execFile mocked) ---

describe('Merger.runMerge with trims', () => {
  let merger;
  let mockSpawn;
  let processes;
  let execFileMock;
  let onProgress;

  const PROBE_JSON = JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2, channel_layout: 'stereo' }
    ],
    format: { duration: '10' }
  });

  function makeMockProcess() {
    return { stderr: { on: jest.fn() }, on: jest.fn(), kill: jest.fn() };
  }

  function completeProcess(p) {
    const dataHandler = p.stderr.on.mock.calls.find(c => c[0] === 'data')?.[1];
    if (dataHandler) dataHandler(Buffer.from('time=00:00:02.00'));
    const closeHandler = p.on.mock.calls.find(c => c[0] === 'close')?.[1];
    expect(closeHandler).toBeDefined();
    closeHandler(0);
  }

  const flush = () => new Promise(r => setTimeout(r, 0));

  beforeEach(() => {
    jest.clearAllMocks(); // reset call history on child_process auto-mocks across tests
    merger = new Merger();
    processes = [];
    onProgress = jest.fn();

    mockSpawn = jest.spyOn(child_process, 'spawn').mockImplementation(() => {
      const p = makeMockProcess();
      processes.push(p);
      return p;
    });

    execFileMock = jest.spyOn(child_process, 'execFile').mockImplementation((bin, args, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      cb(null, PROBE_JSON, '');
    });

    fs.promises = {
      stat: jest.fn(async () => ({ mtimeMs: 123, size: 999 })),
      writeFile: jest.fn(async () => {}),
      unlink: jest.fn(async () => {}),
      access: jest.fn(async () => { throw new Error('not found'); })
    };
    jest.spyOn(fs, 'existsSync').mockReturnValue(true); // pretend ffmpeg/ffprobe exist
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('trims a clip to a temp file before lossless concat, then cleans up', async () => {
    const runPromise = merger.runMerge(
      ['C:\\a.mp4', 'C:\\b.mp4'],
      'C:\\out.mp4',
      onProgress,
      {
        trims: [
          { trimIn: 5, trimOut: 8 }, // trimmed
          { trimIn: 0, trimOut: 10 } // full
        ]
      }
    );

    await flush(); // initial probes settle

    // First spawn = trim pass for clip 1
    expect(processes.length).toBe(1);
    const trimArgs = mockSpawn.mock.calls[0][1];
    expect(trimArgs).toContain('-ss');
    expect(trimArgs[trimArgs.indexOf('-ss') + 1]).toBe('5.000');
    expect(trimArgs).toContain('-t');
    expect(trimArgs[trimArgs.indexOf('-t') + 1]).toBe('3.000');
    const tempOut = trimArgs[trimArgs.length - 1];
    expect(path.basename(tempOut)).toMatch(/^clipsend-merge-trim/);

    completeProcess(processes[0]);
    await flush(); // effective compat probes settle

    // Second spawn = lossless concat demuxer
    expect(processes.length).toBe(2);
    const concatArgs = mockSpawn.mock.calls[1][1];
    expect(concatArgs).toContain('-f');
    expect(concatArgs[concatArgs.indexOf('-f') + 1]).toBe('concat');
    expect(concatArgs).toContain('-c');
    expect(concatArgs[concatArgs.indexOf('-c') + 1]).toBe('copy');

    // The concat list must reference the trimmed temp file (forward slashes)
    const listPath = concatArgs[concatArgs.indexOf('-i') + 1];
    const listContents = fs.promises.writeFile.mock.calls.find(c => c[0] === listPath)?.[1] || '';
    expect(listContents).toContain(tempOut.replace(/\\/g, '/'));

    completeProcess(processes[1]);
    await flush();

    const result = await runPromise;
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('concat_demuxer');
    expect(result.trimmedClips).toBe(1);

    // Temp file cleaned up afterwards
    expect(fs.promises.unlink).toHaveBeenCalledWith(tempOut);
  });

  test('skips the trim pass entirely when nothing is trimmed', async () => {
    const runPromise = merger.runMerge(
      ['C:\\x.mp4', 'C:\\y.mp4'],
      'C:\\out2.mp4',
      onProgress,
      {
        trims: [
          { trimIn: 0, trimOut: 10 },
          { trimIn: 0, trimOut: 10 }
        ]
      }
    );

    await flush();

    // Only the concat spawn happens — no trim pass
    expect(processes.length).toBe(1);
    const concatArgs = mockSpawn.mock.calls[0][1];
    expect(concatArgs).toContain('-f');
    expect(concatArgs[concatArgs.indexOf('-f') + 1]).toBe('concat');

    completeProcess(processes[0]);
    await flush();

    const result = await runPromise;
    expect(result.success).toBe(true);
    expect(result.trimmedClips).toBe(0);
  });

  test('rejects degenerate trim ranges before spawning anything', async () => {
    await expect(
      merger.runMerge(
        ['C:\\p.mp4', 'C:\\q.mp4'],
        'C:\\out3.mp4',
        () => {},
        { trims: [{ trimIn: 5, trimOut: 5.05 }, { trimIn: 0, trimOut: 10 }] }
      )
    ).rejects.toThrow(/invalid trim range/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
