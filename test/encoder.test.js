const { Encoder } = require('../main/encoder');
const child_process = require('child_process');
const fs = require('fs');

jest.mock('child_process');
jest.mock('fs');

describe('Encoder', () => {
  let encoder;
  let mockSpawn;
  let mockProcess;

  beforeEach(() => {
    encoder = new Encoder();
    
    // Mock child process
    mockProcess = {
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn()
    };
    
    mockSpawn = jest.spyOn(child_process, 'spawn').mockReturnValue(mockProcess);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true); // Pretend ffmpeg exists
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10 * 1024 * 1024 }); // Mock file size 10MB
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs two passes and reports progress', async () => {
    const plan = {
      clipDuration: 10,
      pass1Args: ['-pass', '1'],
      pass2Args: ['-pass', '2']
    };

    const progressLogs = [];
    const runPromise = encoder.runEncode(plan, 'out.mp4', (pct, status) => {
      progressLogs.push({ pct, status });
    });

    // Simulate pass 1 events
    // 1. Get the stderr handler
    const pass1StderrHandler = mockProcess.stderr.on.mock.calls.find(c => c[0] === 'data')[1];
    // Send time=00:00:05.00 (5 seconds in = 50% of 10s pass = 25% total)
    pass1StderrHandler(Buffer.from('time=00:00:05.00'));
    
    // Close pass 1
    const pass1CloseHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    pass1CloseHandler(0);

    // Give microtasks time to run so pass 2 spawns
    await Promise.resolve();

    // Pass 2 should now be spawned
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Simulate pass 2 events
    // Find the latest stderr handler (for pass 2)
    const pass2StderrHandler = mockProcess.stderr.on.mock.calls.find(
      (c, idx, arr) => c[0] === 'data' && idx === arr.length - 1
    )[1];
    
    // Send time=00:00:10.00 (100% of pass 2 = 100% total)
    pass2StderrHandler(Buffer.from('time=00:00:10.00'));

    // Close pass 2
    const pass2CloseHandler = mockProcess.on.mock.calls.find(
      (c, idx, arr) => c[0] === 'close' && idx === arr.length - 2 // -2 because error handler is last
    )[1];
    pass2CloseHandler(0);

    const result = await runPromise;

    expect(result.success).toBe(true);
    expect(result.filePath).toBe('out.mp4');
    expect(result.finalSizeMB).toBe(10); // from our statSync mock

    // Check progress scaling
    expect(progressLogs).toContainEqual({ pct: 25, status: 'Pass 1/2: Analyzing...' });
    expect(progressLogs).toContainEqual({ pct: 100, status: 'Pass 2/2: Encoding...' });
  });

  it('cancels the process and cleans up', async () => {
    const plan = {
      clipDuration: 10,
      pass1Args: ['-pass', '1'],
      pass2Args: ['-pass', '2']
    };

    const runPromise = encoder.runEncode(plan, 'out.mp4');
    
    // Cancel while pass 1 is running
    encoder.cancel();
    
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    
    // Simulate close after kill
    const pass1CloseHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    pass1CloseHandler(-1); // arbitrary non-zero code on kill

    const result = await runPromise;
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    
    // Should have tried to clean up log files and output file
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('attaches ffmpegStderr to error on non-zero exit', async () => {
    const plan = {
      clipDuration: 10,
      pass1Args: ['-pass', '1'],
      pass2Args: ['-pass', '2']
    };

    const runPromise = encoder.runEncode(plan, 'out.mp4');
    
    const stderrHandler = mockProcess.stderr.on.mock.calls.find(c => c[0] === 'data')[1];
    stderrHandler(Buffer.from('Cannot load nvcuda.dll'));

    const pass1CloseHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    pass1CloseHandler(1); // non-zero exit code

    await expect(runPromise).rejects.toThrow();
    try {
      await runPromise;
    } catch (err) {
      expect(err.ffmpegStderr).toContain('Cannot load nvcuda.dll');
    }
  });
});
