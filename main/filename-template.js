/**
 * Filename templates — turn a user-configured template string plus export
 * context into a safe, legal Windows filename.
 *
 * Tokens (case-insensitive, `{token}` syntax):
 *   {name}   - source file base name (trim) or "Merged Video" (merge)
 *   {date}   - YYYY-MM-DD
 *   {time}   - HH-MM-SS
 *   {codec}  - h264 | av1 | gif | mp3
 *   {res}    - planned output resolution, e.g. "1920x1080" (empty for MP3)
 *   {size}   - target/estimated size in MB, e.g. "10MB" or "9.6MB"
 *
 * Unknown tokens are left literally in place so a template written for a
 * context that lacks a value (e.g. {res} during a merge save-dialog prompt)
 * never crashes or silently drops user input. The result is sanitized to
 * characters Windows allows in filenames.
 *
 * Pure computation — no I/O — so it is unit-testable without mocks.
 */

/** Characters Windows forbids in filenames (plus control chars). */
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
/** Windows strips trailing dots/spaces from filenames; strip them explicitly. */
const TRAILING_DOTS = /[. ]+$/;

/**
 * Replace illegal filename characters so the rendered name survives Windows.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return String(name == null ? '' : name)
    // Collapse whitespace first: tabs/newlines are also control chars, and
    // turning them into spaces is friendlier than into underscores.
    .replace(/\s+/g, ' ')
    .replace(ILLEGAL_CHARS, '_')
    .replace(TRAILING_DOTS, '')
    .trim();
}

/** YYYY-MM-DD from a Date (local time, matching the old merge naming). */
function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** HH-MM-SS from a Date. */
function formatTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Compact MB display: "10MB" for whole numbers, "9.6MB" otherwise. */
function formatSizeMB(mb) {
  const n = Number(mb);
  if (!isFinite(n) || n <= 0) return '';
  const rounded = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded}MB`;
}

/**
 * Build the standard token map from export context. Values are all strings;
 * missing context simply leaves the token out of the map.
 *
 * @param {object} ctx
 * @param {string} [ctx.name]  - base name without extension
 * @param {Date}   [ctx.date]  - Date object (defaults to now)
 * @param {string} [ctx.codec] - h264/av1/gif/mp3
 * @param {string} [ctx.res]   - "WxH"
 * @param {number} [ctx.sizeMB]
 * @returns {Object<string, string>}
 */
function buildTemplateVars(ctx = {}) {
  const date = ctx.date || new Date();
  const vars = {
    name: ctx.name != null ? String(ctx.name) : '',
    date: formatDate(date),
    time: formatTime(date)
  };
  if (ctx.codec) vars.codec = String(ctx.codec);
  if (ctx.res) vars.res = String(ctx.res);
  if (ctx.sizeMB != null) vars.size = formatSizeMB(ctx.sizeMB);
  return vars;
}

/**
 * Render a template to a safe filename base (no extension).
 *
 * @param {string} template - raw template, e.g. "{name} - Trimmed"
 * @param {Object<string,string>} vars - token map from buildTemplateVars
 * @param {string} [fallback='clip'] - used when the rendered name is empty
 * @returns {string}
 */
function renderFilenameTemplate(template, vars, fallback = 'clip') {
  const raw = String(template == null ? '' : template);
  const rendered = raw.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars ? vars[key] : undefined;
    return value !== undefined && value !== null ? String(value) : match;
  });
  const safe = sanitizeFilename(rendered);
  return safe || fallback;
}

module.exports = {
  sanitizeFilename,
  formatDate,
  formatTime,
  formatSizeMB,
  buildTemplateVars,
  renderFilenameTemplate
};
