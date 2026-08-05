// Shared modal manager: only one `.modal-overlay` may be visible at a time.
//
// The app has several full-window dialogs (settings, changelog, feedback,
// export complete, warnings, update) that all share the `.modal-overlay`
// class. Previously each opener set `style.display = 'flex'` on its own
// element without hiding the others, so dialogs could stack on top of each
// other. All modal open/close code should route through these helpers so the
// single-overlay invariant holds everywhere.

const OVERLAY_SELECTOR = '.modal-overlay';

function allOverlays() {
  return Array.from(document.querySelectorAll(OVERLAY_SELECTOR));
}

/** Hide every modal overlay currently in the document. */
export function closeAllModals() {
  allOverlays().forEach((el) => {
    el.style.display = 'none';
  });
}

/** Hide every other overlay, then show the requested one. */
export function openModal(el) {
  if (!el) return;
  allOverlays().forEach((other) => {
    if (other !== el) other.style.display = 'none';
  });
  el.style.display = 'flex';
}

/** Hide a single modal overlay. */
export function closeModal(el) {
  if (el) el.style.display = 'none';
}
