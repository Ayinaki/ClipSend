/**
 * Timecode formatting and parsing utilities.
 */

/**
 * Format a time in seconds to HH:MM:SS:FF.
 * @param {number} seconds - The time in seconds.
 * @param {number} fps - The frame rate.
 * @returns {string} Formatted timecode.
 */
function formatTimecode(seconds, fps) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  if (isNaN(fps) || fps <= 0) fps = 30; // fallback

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);

  return [
    h.toString().padStart(2, '0'),
    m.toString().padStart(2, '0'),
    s.toString().padStart(2, '0'),
    f.toString().padStart(2, '0')
  ].join(':');
}

/**
 * Parse a timecode string (HH:MM:SS:FF) into seconds.
 * @param {string} timecode - The timecode string.
 * @param {number} fps - The frame rate.
 * @returns {number|null} Time in seconds, or null if invalid.
 */
function parseTimecode(timecode, fps) {
  if (isNaN(fps) || fps <= 0) fps = 30; // fallback
  
  const parts = timecode.split(':').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) {
    return null;
  }

  const [h, m, s, f] = parts;
  return (h * 3600) + (m * 60) + s + (f / fps);
}

export { formatTimecode, parseTimecode };
