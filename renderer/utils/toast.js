// Lightweight transient toast notifications.
//
// Deliberately dependency-light and DOM-self-contained (it creates its own
// host container on first use), so it stays unit-testable in jsdom without
// any Electron bridge.

const TOAST_DURATION_MS = 2600;
const ANIM_MS = 220;
let host = null;

function ensureHost() {
  // Recreate if the cached container is no longer in the document (e.g. the
  // page was re-rendered or a test wiped the body).
  if (host && !host.isConnected) host = null;
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toast-container';
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

/**
 * Show a transient toast.
 * @param {string} message  Text to display.
 * @param {'info'|'success'|'error'} [type]  Visual accent; defaults to 'info'.
 * @returns {HTMLElement} The toast element (useful in tests).
 */
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  // Clicking a toast dismisses it early (otherwise it stays click-capturing
  // for the full duration, which would block the UI beneath it).
  el.addEventListener('click', () => dismiss(el));
  ensureHost().appendChild(el);
  // rAF lets the enter transition run from the initial hidden state.
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => dismiss(el), TOAST_DURATION_MS);
  return el;
}

/** Remove a toast (with its exit transition). Idempotent. */
function dismiss(el) {
  if (el.dataset.dismissed) return;
  el.dataset.dismissed = '1';
  el.classList.remove('toast-visible');
  el.classList.add('toast-leaving');
  setTimeout(() => el.remove(), ANIM_MS);
}

/** Remove every visible toast (e.g. on mode switch). */
export function clearToasts() {
  if (host) host.innerHTML = '';
}
