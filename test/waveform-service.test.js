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
    // Insert 2MB arrays
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

  test('rejects gracefully when ffmpeg binary missing or invalid file', async () => {
    const result = await extractWaveform('non_existent_file.mp4', 0, 100).catch(() => null);
    expect(result).toBeNull();
  });
});
