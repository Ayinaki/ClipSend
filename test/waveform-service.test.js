const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractWaveform,
  clearCache,
  getCacheSize,
  getCacheBytes,
  setCache,
  configureDiskCache,
  getDiskCacheDir,
  _internals
} = require('../main/waveform-service');

describe('waveform-service streaming & LRU cache', () => {
  beforeEach(() => {
    clearCache();
  });

  test('cache starts empty and clearCache resets count & bytes', () => {
    expect(getCacheSize()).toBe(0);
    expect(getCacheBytes()).toBe(0);
    clearCache();
    expect(getCacheSize()).toBe(0);
    expect(getCacheBytes()).toBe(0);
  });

  test('tracks cache bytes accurately when inserting Float32Arrays', () => {
    const arr = new Float32Array(1000); // 4000 bytes
    setCache('key1', arr);
    expect(getCacheSize()).toBe(1);
    expect(getCacheBytes()).toBe(4000);

    const arr2 = new Float32Array(500); // 2000 bytes
    setCache('key2', arr2);
    expect(getCacheSize()).toBe(2);
    expect(getCacheBytes()).toBe(6000);
  });

  test('evicts oldest items when max byte size (5MB) is exceeded', () => {
    const array2MB = new Float32Array(524288); // 2MB
    setCache('item1', array2MB);
    setCache('item2', array2MB);
    expect(getCacheSize()).toBe(2);
    expect(getCacheBytes()).toBe(4 * 1024 * 1024);

    // Third 2MB item pushes total to 6MB (> 5MB cap), causing item1 to be evicted
    setCache('item3', array2MB);
    expect(getCacheSize()).toBe(2); // item1 evicted
    expect(getCacheBytes()).toBe(4 * 1024 * 1024);
  });

  test('allows items matching exact 5MB cap boundary', () => {
    const array5MB = new Float32Array(1310720); // Exact 5MB (1310720 * 4 = 5242880 bytes)
    setCache('exact5mb', array5MB);

    expect(getCacheSize()).toBe(1);
    expect(getCacheBytes()).toBe(5 * 1024 * 1024);
  });

  test('refuses to cache oversized items exceeding 5MB cap', () => {
    const array6MB = new Float32Array(1572864); // 6MB (> 5MB cap)
    setCache('huge_item', array6MB);

    // Should be rejected from cache
    expect(getCacheSize()).toBe(0);
    expect(getCacheBytes()).toBe(0);
  });

  test('rejects gracefully when ffmpeg binary missing or invalid file', async () => {
    const result = await extractWaveform('non_existent_file.mp4', 0, 100).catch(() => null);
    expect(result).toBeNull();
  }, 10000);

  test('constructs Float32Array correctly from transferred ArrayBuffer', () => {
    const samplePeaks = new Float32Array([0.1, 0.5, 0.9, 0.3]);
    const buffer = samplePeaks.buffer;
    const reconstructed = new Float32Array(buffer);
    expect(reconstructed.length).toBe(4);
    expect(reconstructed[0]).toBeCloseTo(0.1, 2);
    expect(reconstructed[2]).toBeCloseTo(0.9, 2);
  });

  test('parses structured worker error with code and stderrTail', () => {
    const mockMsgError = {
      code: 1,
      message: 'FFmpeg process exited with code 1. Stderr: Invalid data',
      stderrTail: 'Invalid data'
    };

    const errMsg = typeof mockMsgError === 'string' ? mockMsgError : (mockMsgError.message || 'Worker extraction failed');
    const err = new Error(errMsg);
    if (typeof mockMsgError === 'object') {
      err.code = mockMsgError.code;
      err.stderrTail = mockMsgError.stderrTail;
    }

    expect(err.message).toContain('FFmpeg process exited with code 1');
    expect(err.code).toBe(1);
    expect(err.stderrTail).toBe('Invalid data');
  });

  test('verifies zero-copy ArrayBuffer transfer detaches original buffer', (done) => {
    const { MessageChannel } = require('worker_threads');
    const { port1, port2 } = new MessageChannel();

    const peaks = new Float32Array([0.2, 0.4, 0.6, 0.8]);
    const originalBuffer = peaks.buffer;

    expect(originalBuffer.byteLength).toBe(16);

    port2.on('message', (msg) => {
      const receivedPeaks = new Float32Array(msg.peaksBuffer);
      expect(receivedPeaks.length).toBe(4);
      expect(receivedPeaks[0]).toBeCloseTo(0.2, 2);
      expect(originalBuffer.byteLength).toBe(0); // Detached zero-copy transfer
      port1.close();
      port2.close();
      done();
    });

    port1.postMessage({ peaksBuffer: originalBuffer }, [originalBuffer]);
  });
});

describe('waveform-service disk cache tier', () => {
  const POINTS = 100;
  let tmpDir;      // holds the source "media" file
  let cacheDir;    // the configured disk-cache directory
  let sourcePath;
  let sourceStat;

  const keyFor = (p = sourcePath, points = POINTS) => `${p}_0_${points}`;

  // Write an entry directly in the documented on-disk shape. Tests seed the
  // cache this way because extraction of a non-media file always fails, so a
  // real recompute can never populate the tier.
  function writeEntry(key, points, peaks, stat = sourceStat) {
    const entryPath = _internals.diskEntryPath(key);
    fs.writeFileSync(entryPath, JSON.stringify({
      key, mtimeMs: stat.mtimeMs, size: stat.size, points, peaks
    }));
    return entryPath;
  }

  beforeEach(() => {
    clearCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsend-waveform-'));
    cacheDir = path.join(tmpDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    sourcePath = path.join(tmpDir, 'clip.mp4');
    fs.writeFileSync(sourcePath, Buffer.from('not really a video'));
    sourceStat = fs.statSync(sourcePath);
    configureDiskCache(cacheDir);
  });

  afterEach(() => {
    configureDiskCache(null);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('configureDiskCache stores a directory and a falsy value disables the tier', () => {
    expect(getDiskCacheDir()).toBe(cacheDir);
    configureDiskCache('');
    expect(getDiskCacheDir()).toBeNull();
  });

  test('serves peaks from disk without re-extracting when the source is unchanged', async () => {
    const peaks = Array.from({ length: POINTS }, (_, i) => (i % 10) / 10);
    const key = keyFor();
    writeEntry(key, POINTS, peaks);

    const result = await extractWaveform(sourcePath, 0, POINTS);
    expect(result.length).toBe(POINTS);
    for (let i = 0; i < POINTS; i++) expect(result[i]).toBeCloseTo(peaks[i], 5);

    // With the entry gone, an unchanged source can only fall through to
    // extraction (which fails for a non-media file) — so returning null here
    // proves the peaks above came from the disk tier, not a re-encode.
    clearCache();
    fs.unlinkSync(_internals.diskEntryPath(key));
    const recomputed = await extractWaveform(sourcePath, 0, POINTS).catch(() => null);
    expect(recomputed).toBeNull();
  });

  test('discards a stale entry when the source changed, then recomputes', async () => {
    const key = keyFor();
    const entryPath = writeEntry(key, POINTS, new Array(POINTS).fill(0.5));

    // Appending bytes changes both size and mtime, invalidating the entry.
    fs.appendFileSync(sourcePath, Buffer.from('more bytes'));

    const result = await extractWaveform(sourcePath, 0, POINTS).catch(() => null);
    expect(result).toBeNull();
    expect(fs.existsSync(entryPath)).toBe(false);
  });

  test('deletes a corrupted entry and recomputes', async () => {
    const key = keyFor();
    const entryPath = _internals.diskEntryPath(key);
    fs.writeFileSync(entryPath, '{ this is not json');

    const result = await extractWaveform(sourcePath, 0, POINTS).catch(() => null);
    expect(result).toBeNull();
    expect(fs.existsSync(entryPath)).toBe(false);
  });

  test('rejects an entry whose peak count does not match the request', async () => {
    const key = keyFor();
    const entryPath = writeEntry(key, POINTS, new Array(POINTS - 1).fill(0.5));

    const result = await extractWaveform(sourcePath, 0, POINTS).catch(() => null);
    expect(result).toBeNull();
    expect(fs.existsSync(entryPath)).toBe(false);
  });

  test('a disabled disk tier leaves the entry untouched', async () => {
    const key = keyFor();
    const entryPath = writeEntry(key, POINTS, new Array(POINTS).fill(0.7));
    configureDiskCache(null);

    const result = await extractWaveform(sourcePath, 0, POINTS).catch(() => null);
    expect(result).toBeNull();
    expect(fs.existsSync(entryPath)).toBe(true);
  });

  test('writeDiskCache persists an entry that readDiskCache round-trips', async () => {
    const key = keyFor();
    const peaks = new Float32Array(POINTS);
    for (let i = 0; i < POINTS; i++) peaks[i] = i / POINTS;

    _internals.writeDiskCache(key, sourcePath, POINTS, peaks);

    // The write is deliberately fire-and-forget, so wait for it to land.
    const entryPath = _internals.diskEntryPath(key);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(entryPath) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 25));
    }
    expect(fs.existsSync(entryPath)).toBe(true);

    const read = await _internals.readDiskCache(key, sourcePath, POINTS);
    expect(read).toBeInstanceOf(Float32Array);
    expect(read.length).toBe(POINTS);
    expect(read[POINTS - 1]).toBeCloseTo((POINTS - 1) / POINTS, 5);
  });

  test('evictDiskCache keeps at most MAX_DISK_ENTRIES, dropping the oldest', async () => {
    const total = _internals.MAX_DISK_ENTRIES + 5;
    const nameFor = (i) => `entry-${String(i).padStart(3, '0')}.json`;
    for (let i = 0; i < total; i++) {
      const p = path.join(cacheDir, nameFor(i));
      fs.writeFileSync(p, '{}');
      const t = new Date(Date.now() - (total - i) * 1000); // i=0 is oldest
      fs.utimesSync(p, t, t);
    }

    await _internals.evictDiskCache();

    const remaining = fs.readdirSync(cacheDir).filter(n => n.endsWith('.json'));
    expect(remaining.length).toBe(_internals.MAX_DISK_ENTRIES);
    expect(fs.existsSync(path.join(cacheDir, nameFor(0)))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, nameFor(total - 1)))).toBe(true);
  });
});
