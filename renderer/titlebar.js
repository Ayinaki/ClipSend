// Title bar UI: export estimate bar, export progress cluster, warnings
// badge/modal, window controls, and the Start Export / Cancel actions.
//
// These controllers are deliberately dependency-light: they receive their
// DOM elements (or look them up) and expose small imperative methods, which
// keeps them unit-testable in jsdom without the Electron bridge.

import { formatPlanDisplay } from './export-flow.js';

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
export function createWarningsUI(elements) {
  const button = elements && elements.button;
  const modal = elements && elements.modal;
  const closeBtn = elements && elements.closeBtn;
  const content = elements && elements.content;

  function render(warnings) {
    if (!warnings || warnings.length === 0) {
      if (button) button.style.display = 'none';
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

      const div = document.createElement('div');
      div.className = 'warning-card';

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

      const titleDiv = document.createElement('div');
      titleDiv.className = 'warning-card-title';
      titleDiv.textContent = w.title;

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'warning-card-body';
      bodyDiv.textContent = w.body;

      textDiv.appendChild(titleDiv);
      textDiv.appendChild(bodyDiv);

      div.appendChild(iconSpan);
      div.appendChild(textDiv);

      if (content) content.appendChild(div);
      renderedCount++;
    });

    if (button) {
      button.style.display = renderedCount > 0 ? 'inline-block' : 'none';
    }
  }

  if (button && modal) {
    button.addEventListener('click', () => {
      modal.style.display = 'flex';
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
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
 * Start Export / Cancel action wiring. The handlers are provided by the app
 * (they need export state), but the click wiring lives here so the buttons'
 * clickability is exercised by the same tests as the rest of the title bar.
 */
export function initTitlebarActions({ exportBtn, cancelBtn, onStartExport, onCancel }) {
  if (exportBtn) exportBtn.addEventListener('click', onStartExport);
  if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
}
