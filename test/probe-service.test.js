const { probeFile, extractThumbnail, getCreatedThumbnails } = require('../main/probe-service');
const child_process = require('child_process');
const fs = require('fs');

jest.mock('child_process');
jest.mock('fs');

describe('extractThumbnail temp-file tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true); // ffmpeg exists + thumbnail written
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns { url, tempPath } and registers the temp file for cleanup', async () => {
    child_process.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, '', ''); // extraction succeeds
    });

    const result = await extractThumbnail('C:\\vid.mp4', 'C:\\temp');
    expect(result).toBeTruthy();
    expect(result.url).toMatch(/^file:\/\//);
    expect(result.tempPath).toMatch(/thumb-/);
    expect(result.tempPath).toContain('C:\\temp');
    expect(getCreatedThumbnails()).toContain(result.tempPath);
  });

  test('falls back to the 0s frame and still tracks the file', async () => {
    // First attempt (1s) fails to produce a file, fallback (0s) succeeds.
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('ffmpeg.exe')) return true; // binary present
      return String(p).includes('thumb-'); // thumbnail appears on fallback
    });
    child_process.execFile.mockImplementation((bin, args, opts, cb) => cb(null, '', ''));

    const result = await extractThumbnail('C:\\vid.mp4', 'C:\\temp');
    expect(result).toBeTruthy();
    expect(getCreatedThumbnails()).toContain(result.tempPath);
  });

  test('resolves null and tracks nothing when both attempts fail', async () => {
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('ffmpeg.exe')) return true;
      return false; // thumbnail never written
    });
    child_process.execFile.mockImplementation((bin, args, opts, cb) => cb(null, '', ''));

    const result = await extractThumbnail('C:\\vid.mp4', 'C:\\temp');
    expect(result).toBeNull();
  });
});

describe('probeFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true); // ffprobe present
  });

  test('reports videoDuration when the video stream is shorter than the container', async () => {
    const PROBE_JSON = JSON.stringify({
      format: { duration: '10.0', size: '1048576' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30/1',
          duration: '2.0'
        },
        { codec_type: 'audio', codec_name: 'aac', channels: 2 }
      ]
    });
    child_process.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, PROBE_JSON, '');
    });

    const info = await probeFile('C:\\music-video.mp4');
    expect(info.duration).toBe(10);
    expect(info.videoDuration).toBe(2);
    expect(info.fileSize).toBe(1048576);
  });

  test('leaves videoDuration undefined when the stream has no duration field', async () => {
    const PROBE_JSON = JSON.stringify({
      format: { duration: '10.0', size: '1048576' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30/1'
        },
        { codec_type: 'audio', codec_name: 'aac', channels: 2 }
      ]
    });
    child_process.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, PROBE_JSON, '');
    });

    const info = await probeFile('C:\\plain.mp4');
    expect(info.videoDuration).toBeUndefined();
  });
});
