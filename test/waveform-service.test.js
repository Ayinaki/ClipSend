const { extractWaveform, clearCache, getCacheSize, getCacheBytes } = require('../main/waveform-service');

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

  test('rejects gracefully when ffmpeg binary missing or invalid file', async () => {
    const result = await extractWaveform('non_existent_file.mp4', 0, 100).catch(() => null);
    expect(result).toBeNull();
  });
});
