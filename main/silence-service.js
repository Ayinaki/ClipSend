/**
 * Silence detection for the "Tighten" action.
 *
 * Gameplay clips and screen recordings usually open on a loading screen and
 * end on a menu, so the interesting part sits between a silent head and tail.
 * Tighten trims exactly those two runs in one click.
 *
 * The audio is deliberately NOT decoded here. waveform-service already turns
 * every loaded clip into a normalized max-abs envelope (and caches it), and a
 * max-abs envelope is a perfectly good silence proxy: a genuinely quiet bucket
 * sits at ~0, while speech, footsteps and music spike well above the floor.
 * Reusing those peaks means Tighten costs no extra FFmpeg pass and inherits the
 * existing worker + LRU cache for free.
 *
 * The detection half is pure computation (no I/O) so it is unit-testable with
 * a plain array, matching the module split the rest of main/ follows.
 */

const { extractWaveform } = require('./waveform-service');

/**
 * Defaults chosen to be conservative: 0.02 of full scale (~-34 dBFS) ignores
 * room tone and controller idle hum without eating quiet dialogue, and 0.35s
 * is long enough that a natural pause between sentences is never treated as
 * dead air worth cutting.
 */
const DEFAULT_SILENCE_OPTIONS = { threshold: 0.02, minSilenceSec: 0.35 };

/**
 * A trim that removed everything would leave nothing to export, so the head
 * and tail trims always leave this much of the clip behind.
 */
const MIN_SURVIVING_SEC = 0.5;

/** Coerce a caller-supplied option into a usable number, falling back safely. */
function numberOr(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : fallback;
}

/**
 * Find the leading and trailing silent runs of a clip.
 *
 * @param {ArrayLike<number>} peaks - normalized 0..1 amplitudes, evenly spaced
 *   across the whole clip (exactly what extractWaveform returns)
 * @param {number} clipDurationSec - the span those peaks cover
 * @param {Object} [options]
 * @param {number} [options.threshold=0.02] - amplitude at/below which a bucket
 *   counts as silent
 * @param {number} [options.minSilenceSec=0.35] - shortest run worth trimming
 * @returns {{startSec:number,endSec:number,leadingSilenceSec:number,trailingSilenceSec:number,trimmedSec:number,hasSilence:boolean}|null}
 *   null when there is nothing measurable to analyze (no peaks, or a duration
 *   that isn't a positive number) — callers treat that as "nothing to do".
 */
function detectSilenceBounds(peaks, clipDurationSec, options = {}) {
  if (!peaks || typeof peaks.length !== 'number' || peaks.length === 0) return null;
  if (typeof clipDurationSec !== 'number' || !isFinite(clipDurationSec) || clipDurationSec <= 0) {
    return null;
  }

  const threshold = Math.min(1, Math.max(0, numberOr(options.threshold, DEFAULT_SILENCE_OPTIONS.threshold)));
  const minSilenceSec = Math.max(0, numberOr(options.minSilenceSec, DEFAULT_SILENCE_OPTIONS.minSilenceSec));

  const bucketSec = clipDurationSec / peaks.length;

  // Leading run: buckets from the start that sit at/below the floor.
  let leadCount = 0;
  while (leadCount < peaks.length && peaks[leadCount] <= threshold) leadCount++;

  // Trailing run: stop where it would meet the leading run, so an all-silent
  // clip can't have the same buckets counted at both ends.
  let trailCount = 0;
  while (
    trailCount < peaks.length - leadCount &&
    peaks[peaks.length - 1 - trailCount] <= threshold
  ) {
    trailCount++;
  }

  let leadTrim = leadCount * bucketSec;
  let trailTrim = trailCount * bucketSec;

  // A blip of silence shorter than the minimum is a pause, not dead air.
  if (leadTrim < minSilenceSec) leadTrim = 0;
  if (trailTrim < minSilenceSec) trailTrim = 0;

  // Never consume the whole clip (an all-silent source lands here). Trim the
  // tail back first so a "start at the first sound" clip keeps its beginning.
  const maxTrim = Math.max(0, clipDurationSec - MIN_SURVIVING_SEC);
  if (leadTrim > maxTrim) leadTrim = maxTrim;
  if (leadTrim + trailTrim > maxTrim) trailTrim = Math.max(0, maxTrim - leadTrim);

  // Round to milliseconds: the UI shows these numbers and feeds them straight
  // back in as trim points, so sub-ms noise has no business in them.
  const round = (sec) => Math.round(sec * 1000) / 1000;
  const leadingSilenceSec = round(leadTrim);
  const trailingSilenceSec = round(trailTrim);

  return {
    startSec: round(leadTrim),
    endSec: round(clipDurationSec - trailTrim),
    leadingSilenceSec,
    trailingSilenceSec,
    trimmedSec: round(leadingSilenceSec + trailingSilenceSec),
    hasSilence: leadingSilenceSec > 0 || trailingSilenceSec > 0
  };
}

/**
 * Detect silence for a file by reusing its waveform envelope.
 *
 * Resolves to null (never rejects) when the peaks can't be produced — no audio
 * track, an unreadable file, a missing FFmpeg — because "Tighten" should simply
 * do nothing in those cases rather than raising an error dialog over a
 * convenience action.
 *
 * @param {string} filePath
 * @param {number} [audioIndex]
 * @param {number} clipDurationSec
 * @param {Object} [options] - see detectSilenceBounds
 */
async function detectSilence(filePath, audioIndex, clipDurationSec, options = {}) {
  let peaks = null;
  try {
    peaks = await extractWaveform(filePath, audioIndex);
  } catch (e) {
    peaks = null;
  }
  return detectSilenceBounds(peaks, clipDurationSec, options);
}

module.exports = {
  DEFAULT_SILENCE_OPTIONS,
  detectSilenceBounds,
  detectSilence
};
