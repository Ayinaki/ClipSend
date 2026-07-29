const { extractWaveform, clearCache, getCacheSize, getCacheBytes, setCache } = require('../main/waveform-service');

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
  });
});
