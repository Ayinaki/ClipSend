// The waveform envelope is another module's concern (and is exercised by
// waveform-service.test.js), so it is mocked here: these tests are about the
// silence math and the "fail quietly" contract of detectSilence.
jest.mock('../main/waveform-service', () => ({
  extractWaveform: jest.fn()
}));

const { extractWaveform } = require('../main/waveform-service');
const {
  DEFAULT_SILENCE_OPTIONS,
  detectSilenceBounds,
  detectSilence
} = require('../main/silence-service');

describe('silence-service detection', () => {
  beforeEach(() => {
    extractWaveform.mockReset();
  });

  test('exposes conservative defaults', () => {
    expect(DEFAULT_SILENCE_OPTIONS).toEqual({ threshold: 0.02, minSilenceSec: 0.35 });
  });

  test('returns null when there are no peaks to analyze', () => {
    expect(detectSilenceBounds(null, 10)).toBeNull();
    expect(detectSilenceBounds([], 10)).toBeNull();
    expect(detectSilenceBounds(undefined, 10)).toBeNull();
  });

  test('returns null for a duration that is not a positive number', () => {
    expect(detectSilenceBounds([0.5, 0.5], 0)).toBeNull();
    expect(detectSilenceBounds([0.5, 0.5], -3)).toBeNull();
    expect(detectSilenceBounds([0.5, 0.5], NaN)).toBeNull();
    expect(detectSilenceBounds([0.5, 0.5], 'ten')).toBeNull();
  });

  test('reports no silence for a clip that is loud end to end', () => {
    // duration === peaks.length, so one bucket spans exactly one second.
    const result = detectSilenceBounds([0.5, 0.6, 0.7], 3);
    expect(result.hasSilence).toBe(false);
    expect(result.leadingSilenceSec).toBe(0);
    expect(result.trailingSilenceSec).toBe(0);
    expect(result.trimmedSec).toBe(0);
    expect(result.startSec).toBe(0);
    expect(result.endSec).toBe(3);
  });

  test('trims leading silence only', () => {
    const result = detectSilenceBounds([0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5], 8);
    expect(result.leadingSilenceSec).toBe(3);
    expect(result.trailingSilenceSec).toBe(0);
    expect(result.trimmedSec).toBe(3);
    expect(result.startSec).toBe(3);
    expect(result.endSec).toBe(8);
    expect(result.hasSilence).toBe(true);
  });

  test('trims trailing silence only', () => {
    const result = detectSilenceBounds([0.5, 0.5, 0.5, 0, 0], 5);
    expect(result.leadingSilenceSec).toBe(0);
    expect(result.trailingSilenceSec).toBe(2);
    expect(result.startSec).toBe(0);
    expect(result.endSec).toBe(3);
    expect(result.hasSilence).toBe(true);
  });

  test('trims both ends at once', () => {
    const result = detectSilenceBounds([0, 0, 0.5, 0.5, 0.5, 0, 0], 7);
    expect(result.leadingSilenceSec).toBe(2);
    expect(result.trailingSilenceSec).toBe(2);
    expect(result.trimmedSec).toBe(4);
    expect(result.startSec).toBe(2);
    expect(result.endSec).toBe(5);
  });

  test('leaves interior silence alone', () => {
    // A zero in the middle is a pause between sounds, never a trim candidate.
    const result = detectSilenceBounds([0.5, 0, 0.5], 3);
    expect(result.hasSilence).toBe(false);
    expect(result.startSec).toBe(0);
    expect(result.endSec).toBe(3);
  });

  test('ignores a run shorter than the minimum', () => {
    // 100 buckets over 1 second -> each bucket is 0.01s; two silent buckets
    // (0.02s) are well under the 0.35s default and must not be trimmed.
    const peaks = new Array(100).fill(0.5);
    peaks[0] = 0;
    peaks[1] = 0;
    const result = detectSilenceBounds(peaks, 1);
    expect(result.trimmedSec).toBe(0);
    expect(result.hasSilence).toBe(false);
  });

  test('honors a custom threshold and minimum', () => {
    const peaks = [0.05, 0.05, 0.9, 0.9];
    // With the default 0.02 floor those 0.05 buckets count as sound.
    expect(detectSilenceBounds(peaks, 4).trimmedSec).toBe(0);
    // A 0.1 floor treats them as silent, and 2s clears any sane minimum.
    const loosened = detectSilenceBounds(peaks, 4, { threshold: 0.1, minSilenceSec: 0.35 });
    expect(loosened.leadingSilenceSec).toBe(2);
    expect(loosened.startSec).toBe(2);
  });

  test('never trims the whole clip when every bucket is silent', () => {
    const result = detectSilenceBounds([0, 0, 0, 0], 4);
    expect(result.trimmedSec).toBe(3.5); // 4s - the 0.5s survivor
    expect(result.endSec - result.startSec).toBe(0.5);
    expect(result.hasSilence).toBe(true);
  });

  test('detectSilence returns null when the waveform cannot be produced', async () => {
    extractWaveform.mockResolvedValue(null);
    await expect(detectSilence('clip.mp4', 0, 10)).resolves.toBeNull();
  });

  test('detectSilence swallows extraction errors and returns null', async () => {
    extractWaveform.mockRejectedValue(new Error('ffmpeg missing'));
    await expect(detectSilence('clip.mp4', 0, 10)).resolves.toBeNull();
  });

  test('detectSilence forwards the extracted peaks and options', async () => {
    extractWaveform.mockResolvedValue(new Float32Array([0, 0, 0.8, 0.8]));
    const result = await detectSilence('clip.mp4', 1, 4, { minSilenceSec: 0.35 });
    expect(extractWaveform).toHaveBeenCalledWith('clip.mp4', 1);
    expect(result.startSec).toBe(2);
    expect(result.hasSilence).toBe(true);
  });
});
