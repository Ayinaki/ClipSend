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

  // The concat-filter fallback derives its container from the output
  // extension so the re-encode lands in the muxer the output will use
  // (multi-segment trim exports pre-encode VP9/Opus segments into .webm and
  // merge with skipConvert — H.264 into a .webm destination would be
  // rejected by the muxer).
  test('concat-filter fallback to a .webm output uses vp9/opus and no faststart', async () => {
    const clips = [
      { width: 1280, height: 720, fps: 30, audioCodec: 'opus', duration: 5 },
      { width: 1280, height: 720, fps: 30, audioCodec: 'opus', duration: 5 }
    ];
    const runPromise = merger._runConcatFilter(
      ['C:\\a.webm', 'C:\\b.webm'],
      clips,
      'C:\\out.webm',
      10,
      onProgress,
      'libvpx-vp9',
      'vp9'
    );

    await flush();
    const args = mockSpawn.mock.calls[0][1];
    expect(args[args.length - 1]).toBe('C:\\out.webm');
    expect(args).toContain('libvpx-vp9');
    expect(args).toContain('-c:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('opus');
    expect(args).toContain('-strict');
    expect(args[args.indexOf('-strict') + 1]).toBe('-2');
    expect(args).not.toContain('+faststart');

    completeProcess(processes[0]);
    await flush();
    await runPromise;
  });

  test('concat-filter fallback to a .mp4 output keeps aac + faststart', async () => {
    const clips = [
      { width: 1280, height: 720, fps: 30, audioCodec: 'aac', duration: 5 },
      { width: 1280, height: 720, fps: 30, audioCodec: 'aac', duration: 5 }
    ];
    const runPromise = merger._runConcatFilter(
      ['C:\\a.mp4', 'C:\\b.mp4'],
      clips,
      'C:\\out.mp4',
      10,
      onProgress,
      'libx264',
      'h264'
    );

    await flush();
    const args = mockSpawn.mock.calls[0][1];
    expect(args[args.length - 1]).toBe('C:\\out.mp4');
    expect(args).toContain('-c:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args).toContain('+faststart');
    expect(args).not.toContain('-strict');

    completeProcess(processes[0]);
    await flush();
    await runPromise;
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

// --- postConvertMerged size targeting (the 10.33 MB vs 10 MB fix) ---

describe('Merger.postConvertMerged size targeting', () => {
  let merger;
  let mockSpawn;
  let processes;

  function makeMockProcess() {
    return { stderr: { on: jest.fn() }, on: jest.fn(), kill: jest.fn() };
  }

  function completeProcess(p) {
    const closeHandler = p.on.mock.calls.find(c => c[0] === 'close')?.[1];
    expect(closeHandler).toBeDefined();
    closeHandler(0);
  }

  const flush = () => new Promise(r => setTimeout(r, 0));

  beforeEach(() => {
    jest.clearAllMocks();
    merger = new Merger();
    processes = [];

    mockSpawn = jest.spyOn(child_process, 'spawn').mockImplementation(() => {
      const p = makeMockProcess();
      processes.push(p);
      return p;
    });

    fs.promises = {
      stat: jest.fn(async () => ({ mtimeMs: 123, size: 10 * 1024 * 1024 })),
      writeFile: jest.fn(async () => {}),
      unlink: jest.fn(async () => {}),
      rename: jest.fn(async () => {}),
      access: jest.fn(async () => { throw new Error('not found'); })
    };
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // 10 MB / 60 s / 192 kbps audio with the planner's margin + muxing overhead
  // math gives ~1116 kbps video. The naive full-size calc (~1206 kbps) is what
  // overshot to 10.33 MB before this fix.
  const MARGIN_BITRATE = '1116k';

  test('CPU encoders use a margin-buffered bitrate with a real 2-pass encode', async () => {
    const runPromise = merger.postConvertMerged('C:\\merged.mp4', {
      format: 'mp4',
      targetSizeMB: 10,
      totalDurationSec: 60,
      codec: 'h264',
      encoder: 'libx264'
    });

    await flush();
    // Pass 1 spawns first; pass 2 only starts after pass 1 completes.
    expect(processes.length).toBe(1);
    const pass1Args = mockSpawn.mock.calls[0][1];
    expect(pass1Args).toContain('-pass');
    expect(pass1Args[pass1Args.indexOf('-pass') + 1]).toBe('1');
    expect(pass1Args).toContain('-an');
    expect(pass1Args[pass1Args.indexOf('-f') + 1]).toBe('null');

    completeProcess(processes[0]);
    await flush();
    expect(processes.length).toBe(2);
    const pass2Args = mockSpawn.mock.calls[1][1];
    expect(pass2Args).toContain('-pass');
    expect(pass2Args[pass2Args.indexOf('-pass') + 1]).toBe('2');
    expect(pass2Args).toContain('-b:v');
    expect(pass2Args[pass2Args.indexOf('-b:v') + 1]).toBe(MARGIN_BITRATE);
    expect(pass2Args).toContain('-c:a');
    expect(pass2Args[pass2Args.indexOf('-c:a') + 1]).toBe('aac');
    expect(pass2Args[pass2Args.indexOf('-movflags') + 1]).toBe('+faststart');

    completeProcess(processes[1]);
    await flush();

    const result = await runPromise;
    expect(result.path).toBe('C:\\merged.mp4');
    expect(typeof result.sizeMB).toBe('number');
  });

  test('AV1 CPU encode (the reported merge scenario) is also 2-pass into MP4 with AAC', async () => {
    const runPromise = merger.postConvertMerged('C:\\merged.mp4', {
      format: 'mp4',
      targetSizeMB: 10,
      totalDurationSec: 60,
      codec: 'av1',
      encoder: 'libaom-av1'
    });

    await flush();
    expect(processes.length).toBe(1);
    completeProcess(processes[0]);
    await flush();
    expect(processes.length).toBe(2);

    const pass2Args = mockSpawn.mock.calls[1][1];
    expect(pass2Args).toContain('-c:v');
    expect(pass2Args[pass2Args.indexOf('-c:v') + 1]).toBe('libaom-av1');
    expect(pass2Args).toContain('-pass');
    expect(pass2Args[pass2Args.indexOf('-pass') + 1]).toBe('2');
    expect(pass2Args[pass2Args.indexOf('-b:v') + 1]).toBe(MARGIN_BITRATE);
    expect(pass2Args[pass2Args.indexOf('-c:a') + 1]).toBe('aac');

    completeProcess(processes[1]);
    await runPromise;
  });

  test('hardware encoders stay single-pass (no 2-pass support) but keep the margin bitrate', async () => {
    const runPromise = merger.postConvertMerged('C:\\merged.mp4', {
      format: 'mp4',
      targetSizeMB: 10,
      totalDurationSec: 60,
      codec: 'h264',
      encoder: 'h264_nvenc'
    });

    await flush();
    expect(processes.length).toBe(1); // single pass only

    const args = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('-pass');
    expect(args[args.indexOf('-b:v') + 1]).toBe(MARGIN_BITRATE);
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('h264_nvenc');
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');

    completeProcess(processes[0]);
    await runPromise;
  });

  // x264-on-Windows passlog regression: the 2-pass re-encode must pass a
  // RELATIVE passlog name and run with cwd = output dir (like encoder.js), or
  // pass 2 fails to find the stats file when the path has backslashes.
  test('CPU 2-pass uses a relative passlog filename with cwd set to the output dir', async () => {
    const runPromise = merger.postConvertMerged('C:\\out\\merged.mp4', {
      format: 'mp4',
      targetSizeMB: 10,
      totalDurationSec: 60,
      codec: 'h264',
      encoder: 'libx264'
    });

    await flush();
    const pass1Args = mockSpawn.mock.calls[0][1];
    const plIdx = pass1Args.indexOf('-passlogfile');
    expect(plIdx).not.toBe(-1);
    const passlog = pass1Args[plIdx + 1];
    // Relative (no drive letter / no directory), not an absolute Windows path.
    expect(passlog).not.toMatch(/^[A-Za-z]:/);
    expect(passlog).not.toContain('\\');
    expect(passlog).toMatch(/^clipsend-pass-/);

    // Pass 1 ran with cwd = the output directory.
    expect(mockSpawn.mock.calls[0][2]).toEqual({ cwd: 'C:\\out' });

    completeProcess(processes[0]);
    await flush();
    const pass2Args = mockSpawn.mock.calls[1][1];
    const pl2 = pass2Args[pass2Args.indexOf('-passlogfile') + 1];
    expect(pl2).toBe(passlog); // same relative name both passes
    expect(mockSpawn.mock.calls[1][2]).toEqual({ cwd: 'C:\\out' });

    completeProcess(processes[1]);
    await runPromise;
  });

  // Merged-GIF regression: pass 2 previously dropped fps=15 when no scale
  // filter was present, so the GIF ran at the source framerate.
  test('GIF conversion applies fps=15 on the palette pass even without a scale filter', async () => {
    const runPromise = merger.postConvertMerged('C:\\merged.mp4', {
      format: 'gif',
      codec: 'h264',
      encoder: 'libx264'
    });

    await flush();
    expect(processes.length).toBe(1); // palettegen
    completeProcess(processes[0]);
    await flush();

    expect(processes.length).toBe(2); // paletteuse
    const pass2Args = mockSpawn.mock.calls[1][1];
    const lavfiIdx = pass2Args.indexOf('-lavfi');
    expect(lavfiIdx).not.toBe(-1);
    const lavfi = pass2Args[lavfiIdx + 1];
    expect(lavfi).toContain('fps=15');
    expect(lavfi).toContain('paletteuse');

    completeProcess(processes[1]);
    await runPromise;
  });
});
