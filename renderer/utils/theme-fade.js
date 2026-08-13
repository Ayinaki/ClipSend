/**
 * The theme "fade" transition: when the app flips between dark and light, a
 * wash of the OLD theme's background color fades out over the new theme — a
 * quick, unobtrusive crossfade instead of an instant snap. The wash starts
 * at ~60% opacity and is pointer-transparent, so the app stays visible and
 * clickable the whole time. Called by settings.applyTheme() just before the
 * theme attribute swaps; the wash carries its color inline so the swap
 * doesn't repaint it.
 *
 * Accessibility: skipped entirely when the OS requests reduced motion.
 * Robustness: a transitionend listener removes the wash, backed by a
 * duration-based safety timer; a rapid second toggle replaces the current
 * wash instantly so fades never stack.
 */

let activeLayer = null;

/**
 * Start the fade transition with the given (already-resolved) color — the
 * theme that is ABOUT to be replaced.
 * @param {string} oldColor - CSS color of the outgoing theme's background
 */
export function fadeTheme(oldColor) {
  if (activeLayer) {
    activeLayer.remove();
    activeLayer = null;
  }
  if (!oldColor) return;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) { /* no matchMedia (jsdom) — proceed */ }

  const layer = document.createElement('div');
  layer.className = 'cs-theme-fade';
  layer.style.setProperty('--fade-color', oldColor);
  document.body.appendChild(layer);

  // Double-rAF so the browser paints the wash before the transition class
  // lands; without it the fade can jump straight to transparent.
  const start = () => layer.classList.add('fading');
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(start));
  } else {
    setTimeout(start, 0);
  }

  const finish = () => {
    if (layer.isConnected) layer.remove();
    if (activeLayer === layer) activeLayer = null;
  };
  layer.addEventListener('transitionend', finish);
  setTimeout(finish, 700); // safety net (0.38s fade + buffer; see header)
  activeLayer = layer;
}

/** Testing hook: whether a fade wash is currently on screen. */
export function hasActiveFade() {
  return activeLayer !== null;
}
