// Title bar UI: export estimate bar, export progress cluster, warnings
// badge/modal, window controls, and the Start Export / Cancel actions.
//
// These controllers are deliberately dependency-light: they receive their
// DOM elements (or look them up) and expose small imperative methods, which
// keeps them unit-testable in jsdom without the Electron bridge.

import { formatPlanDisplay } from './export-flow.js';
import { openModal, closeModal } from './utils/modals.js';

/**
 * Export estimate bar (renders the calculated plan in the title bar center).
 * Elements: bar (#export-estimate-bar), vbrLabel (#plan-vbr-label),
 * vbr (#plan-vbr), res (#plan-res), resItem (#plan-res-item), size (#plan-size).
 */
export function createEstimateBar(elements) {
  const bar = elements && elements.bar;
  const vbrLabel = elements && elements.vbrLabel;
  const vbr = elements && elements.vbr;
  const res = elements && elements.res;
  const resItem = elements && elements.resItem;
  const size = elements && elements.size;

  function show(plan, options) {
    if (!bar) return;
    const display = formatPlanDisplay(plan, options);
    if (vbrLabel) vbrLabel.textContent = display.vbrLabel;
    if (vbr) vbr.textContent = display.vbrText;
    if (size) size.textContent = display.sizeText;
    if (res) res.textContent = display.resText || '';
    if (resItem) resItem.style.display = display.resVisible ? '' : 'none';
    bar.style.display = 'flex';
  }

  function hide() {
    if (bar) bar.style.display = 'none';
  }

  return { show, hide };
}

/**
 * Export progress cluster (swap-in for the estimate bar while exporting).
 * Elements: container (#progress-container), fill (#progress-fill),
 * text (#progress-text), cancelBtn (#cancel-btn).
 */
export function createProgressUI(elements) {
  const container = elements && elements.container;
  const fill = elements && elements.fill;
  const text = elements && elements.text;
  const cancelBtn = elements && elements.cancelBtn;

  function show() {
    if (container) container.style.display = 'flex';
  }

  function hide() {
    if (container) container.style.display = 'none';
  }

  function isVisible() {
    return container ? container.style.display !== 'none' : false;
  }

  function setPercent(percent, status) {
    if (!fill || !text) return;
    if (percent < 0) {
      fill.style.width = '100%';
      fill.style.opacity = '0.5';
      fill.style.animation = 'pulse 1.5s infinite';
      text.textContent = status || 'Processing...';
    } else {
      fill.style.opacity = '1';
      fill.style.animation = 'none';
      const rounded = Math.round(percent);
      fill.style.width = `${rounded}%`;
      text.textContent = status ? `${status} (${rounded}%)` : `${rounded}%`;
    }
  }

  function setStatus(status) {
    if (text) text.textContent = status;
  }

  function enableCancel() {
    if (cancelBtn) cancelBtn.disabled = false;
  }

  function disableCancel() {
    if (cancelBtn) cancelBtn.disabled = true;
  }

  return { show, hide, isVisible, setPercent, setStatus, enableCancel, disableCancel };
}

/**
 * Warnings badge + modal.
 * Elements: button (#titlebar-warning-btn), modal (#warnings-modal),
 * closeBtn (#close-warnings-btn), content (#warnings-modal-content).
 */
/**
 * Build a single warning card DOM node. Shared by the warnings modal (here)
 * and the merge sidebar (app.js) so both render paths stay visually
 * identical. Objects with id 'error' get the red severity variant; strings
 * are treated as plain body-only warnings.
 *
 * @param {{id?: string, title?: string, body: string} | string} w
 * @param {{showTitle?: boolean}} [opts] showTitle:false renders body only
 *   (used by the compact merge-sidebar cards).
 */
export function buildWarningCard(w, { showTitle = true } = {}) {
  const obj = typeof w === 'object' && w !== null ? w : null;
  const div = document.createElement('div');
  div.className = 'warning-card' + (obj && obj.id === 'error' ? ' warning-card--error' : '');

  const iconSpan = document.createElement('span');
  iconSpan.className = 'warning-card-icon';
  iconSpan.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  `;

  const textDiv = document.createElement('div');
  textDiv.className = 'warning-card-text';

  if (showTitle && obj && obj.title) {
    const titleDiv = document.createElement('div');
    titleDiv.className = 'warning-card-title';
    titleDiv.textContent = obj.title;
    textDiv.appendChild(titleDiv);
  }

  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'warning-card-body';
  bodyDiv.textContent = obj ? obj.body : w;
  textDiv.appendChild(bodyDiv);

  div.appendChild(iconSpan);
  div.appendChild(textDiv);
  return div;
}

export function createWarningsUI(elements) {
  const button = elements && elements.button;
  const modal = elements && elements.modal;
  const closeBtn = elements && elements.closeBtn;
  const content = elements && elements.content;
  const countEl = elements && elements.countEl;

  function render(warnings) {
    if (!warnings || warnings.length === 0) {
      if (button) button.style.display = 'none';
      if (countEl) countEl.style.display = 'none';
      if (content) content.innerHTML = '';
      return;
    }
    if (content) content.innerHTML = '';
    let renderedCount = 0;

    warnings.forEach(w => {
      // If any old string warnings somehow leak through, skip or convert them
      if (typeof w === 'string') {
        if (w.startsWith('Resolution: Native')) return;
        w = { id: 'legacy', title: 'Warning', body: w };
      }
      const div = buildWarningCard(w);
      if (content) content.appendChild(div);
      renderedCount++;
    });

    if (button) {
      // Flex (not inline-block): the inline align/justify-center styles only
      // work on a flex container, so without this the icon hugs the left edge
      // and the absolute badge floats detached at the window's top-right.
      button.style.display = renderedCount > 0 ? 'flex' : 'none';
    }
    if (countEl) {
      countEl.textContent = String(renderedCount);
      countEl.style.display = renderedCount > 0 ? 'block' : 'none';
    }
  }

  if (button && modal) {
    button.addEventListener('click', () => {
      openModal(modal);
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      closeModal(modal);
    });
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  }

  return { show: render };
}

/**
 * Window control buttons (minimize / close).
 */
export function initWindowControls({ minBtn, closeBtn, api }) {
  if (minBtn) minBtn.addEventListener('click', () => api.minimizeWindow());
  if (closeBtn) closeBtn.addEventListener('click', () => api.closeWindow());
}

/**
 * Custom animated tooltip bubbles for icon-only title bar buttons.
 *
 * Replaces native `title` tooltips (unstyleable, laggy). Buttons opt in with
 * a `data-tooltip="..."` attribute; one shared bubble (#titlebar-tooltip) is
 * fixed-positioned below the hovered button with a pointer arrow, clamped to
 * the window edges. A short show delay keeps tooltips from popping while the
 * mouse sweeps across the title bar; the hide delay prevents flicker between
 * adjacent buttons. Delays are configurable so tests can run them instantly.
 *
 * @param {Document|HTMLElement} [scope] element to search for [data-tooltip]
 * @param {{showDelay?: number, hideDelay?: number}} [opts]
 * @returns {{attach: (anchor: HTMLElement) => void}}
 */
export function initTitlebarTooltips(scope, { showDelay = 180, hideDelay = 60 } = {}) {
  const root = scope || document;
  const bubble = (root.querySelector && root.querySelector('#titlebar-tooltip')) || document.getElementById('titlebar-tooltip');
  if (!bubble) return { attach: () => {} };

  let showTimer = null;
  let hideTimer = null;
  let currentAnchor = null;

  function clearTimers() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function hide(immediate) {
    clearTimers();
    const doHide = () => {
      bubble.classList.remove('visible');
      if (currentAnchor) currentAnchor.removeAttribute('aria-describedby');
      currentAnchor = null;
    };
    if (immediate) doHide();
    else hideTimer = setTimeout(doHide, hideDelay);
  }

  function position(anchor) {
    const label = anchor.dataset.tooltip;
    if (!label) return;
    const style = getComputedStyle(anchor);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    bubble.textContent = label;
    bubble.classList.remove('visible');

    const rect = anchor.getBoundingClientRect();
    const tipWidth = bubble.offsetWidth;
    const MARGIN = 8;
    // Center under the button, clamped so the bubble stays on-screen.
    let left = rect.left + rect.width / 2 - tipWidth / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tipWidth - MARGIN));
    // Keep the arrow pointing at the button's center even when clamped.
    const arrowX = Math.max(12, Math.min(rect.left + rect.width / 2 - left, tipWidth - 12));

    bubble.style.left = `${left}px`;
    bubble.style.top = `${rect.bottom + 6}px`;
    bubble.style.setProperty('--arrow-x', `${arrowX}px`);
    anchor.setAttribute('aria-describedby', bubble.id);

    // Force a reflow between the class removal and re-add so the entrance
    // animation restarts — this is what makes sliding straight from one
    // button to its neighbour replay the pop-in instead of skipping it.
    void bubble.offsetHeight;
    bubble.classList.add('visible');
  }

  function show(anchor) {
    clearTimers();
    // Moving straight from one button to its neighbour cancels the pending
    // hide, so strip the previous button's reference before switching — it
    // must never point at a bubble that now describes a different button.
    if (currentAnchor && currentAnchor !== anchor) {
      currentAnchor.removeAttribute('aria-describedby');
    }
    currentAnchor = anchor;
    showTimer = setTimeout(() => {
      if (currentAnchor === anchor) position(anchor);
    }, showDelay);
  }

  function bind(anchor) {
    if (!anchor || anchor.__tooltipBound) return;
    anchor.__tooltipBound = true;
    anchor.addEventListener('mouseenter', () => show(anchor));
    anchor.addEventListener('mouseleave', () => hide(false));
    anchor.addEventListener('focus', () => show(anchor));
    anchor.addEventListener('blur', () => hide(true));
    anchor.addEventListener('click', () => hide(true));
  }

  Array.from(root.querySelectorAll('[data-tooltip]')).forEach(bind);
  window.addEventListener('resize', () => {
    if (currentAnchor) position(currentAnchor);
  });

  return { attach: bind };
}

/**
 * Start Export / Cancel action wiring. The handlers are provided by the app
 * (they need export state), but the click wiring lives here so the buttons'
 * clickability is exercised by the same tests as the rest of the title bar.
 */
export function initTitlebarActions({ exportBtn, cancelBtn, onStartExport, onCancel }) {
  if (exportBtn) exportBtn.addEventListener('click', onStartExport);
  if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
}
