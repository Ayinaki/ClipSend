/**
 * Transport & volume icons as inline SVG strings.
 *
 * One icon language for the whole transport row. The old bar mixed Segoe MDL2
 * glyphs (play/skip), raw text brackets ([ ]) and text chevrons (< >), which
 * never read as a coherent set. Everything here is drawn in the same feather
 * style the loop button already used: 24px viewBox, 2px rounded strokes.
 * Media-transport shapes (play/skip) are filled — that's the universal
 * convention — while editing controls (brackets, chevrons, volume) stay
 * stroked. All colors come from currentColor, so the teal play button
 * renders white and the rest follow --text-secondary.
 */
function svg(inner) {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const ICON_PLAY = svg('<polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/>');
export const ICON_PAUSE = svg('<rect x="5.5" y="4" width="4.5" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4.5" height="16" rx="1" fill="currentColor" stroke="none"/>');
// |◀  and  ▶| : bar + left/right-pointing triangle (jump to trim in/out)
export const ICON_SKIP_BACK = svg('<polygon points="18 19 9 12 18 5 18 19" fill="currentColor" stroke="none"/><line x1="5" y1="5" x2="5" y2="19" stroke-width="2.5"/>');
export const ICON_SKIP_FORWARD = svg('<polygon points="6 5 15 12 6 19 6 5" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19" stroke-width="2.5"/>');
// Frame stepping: chevrons (distinct from the skip triangles above)
export const ICON_CHEVRON_LEFT = svg('<polyline points="15 18 9 12 15 6"/>');
export const ICON_CHEVRON_RIGHT = svg('<polyline points="9 18 15 12 9 6"/>');
// Trim-range brackets drawn as rounded strokes — same shape as the text [ ]
// but in the same stroke language as everything else on the row.
export const ICON_BRACKET_IN = svg('<path d="M9.5 4.5 H7 A2.5 2.5 0 0 0 4.5 7 V17 A2.5 2.5 0 0 0 7 19.5 H9.5"/>');
export const ICON_BRACKET_OUT = svg('<path d="M14.5 4.5 H17 A2.5 2.5 0 0 1 19.5 7 V17 A2.5 2.5 0 0 1 17 19.5 H14.5"/>');
// Speaker + arc (audible) / speaker + X (muted)
export const ICON_VOLUME = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>');
export const ICON_VOLUME_MUTED = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>');
