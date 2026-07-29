const { extractWaveform, clearCache, getCacheSize } = require('../main/waveform-service');

describe('waveform-service LRU cache & API', () => {
  beforeEach(() => {
    clearCache();
  });

  test('cache starts empty and clearCache works', () => {
    expect(getCacheSize()).toBe(0);
    clearCache();
    expect(getCacheSize()).toBe(0);
  });

  test('rejects gracefully when ffmpeg binary missing or invalid file', async () => {
    const result = await extractWaveform('non_existent_file.mp4', 0, 100).catch(() => null);
    expect(result).toBeNull();
  });
});
