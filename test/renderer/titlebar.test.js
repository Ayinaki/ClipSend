/**
 * @jest-environment jsdom
 *
 * Smoke tests for the title bar UI: the export estimate must render into the
 * title bar when a plan is calculated, and the title-bar buttons (Start
 * Export, Cancel, minimize, close) must remain clickable.
 */
const fs = require('fs');
const path = require('path');

const {
  createEstimateBar,
  createProgressUI,
  createWarningsUI,
  buildWarningCard,
  initWindowControls,
  initTitlebarActions,
  initTitlebarTooltips
} = require('../../renderer/titlebar.js');

function loadAppDom() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
  document.documentElement.innerHTML = html;
  return document;
}

function getElements() {
  return {
    bar: document.getElementById('export-estimate-bar'),
    vbrLabel: document.getElementById('plan-vbr-label'),
    vbr: document.getElementById('plan-vbr'),
    res: document.getElementById('plan-res'),
    resItem: document.getElementById('plan-res-item'),
    size: document.getElementById('plan-size'),
    exportBtn: document.getElementById('export-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    progressContainer: document.getElementById('progress-container'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    warningBtn: document.getElementById('titlebar-warning-btn'),
    warningCount: document.getElementById('titlebar-warning-count'),
    warningsModal: document.getElementById('warnings-modal'),
    closeWarningsBtn: document.getElementById('close-warnings-btn'),
    warningsModalContent: document.getElementById('warnings-modal-content'),
    minBtn: document.getElementById('win-min'),
    closeBtn: document.getElementById('win-close')
  };
}

const SAMPLE_PLAN = {
  width: 854,
  height: 480,
  videoBitrateKbps: 365,
  audioBitrateKbps: 96,
  estimatedSizeMB: 9.36,
  crfValue: 19,
  warnings: []
};

describe('export estimate bar', () => {
  let els;

  beforeEach(() => {
    loadAppDom();
    els = getElements();
  });

  test('renders a size-limit plan into the title bar', () => {
    const estimateBar = createEstimateBar(els);
    estimateBar.show(SAMPLE_PLAN, { isMp3: false, outputFormat: 'mp4', mode: 'size-limit' });

    expect(els.bar.style.display).toBe('flex');
    expect(els.vbrLabel.textContent).toBe('Video:');
    expect(els.vbr.textContent).toBe('365 kbps');
    expect(els.res.textContent).toBe('854x480');
    expect(els.resItem.style.display).toBe('');
    expect(els.size.textContent).toBe('9.36 MB');
  });

  test('renders an MP3 plan as audio-only (no resolution row)', () => {
    const estimateBar = createEstimateBar(els);
    estimateBar.show(SAMPLE_PLAN, { isMp3: true, outputFormat: 'mp3', mode: 'size-limit' });

    expect(els.bar.style.display).toBe('flex');
    expect(els.vbrLabel.textContent).toBe('Audio:');
    expect(els.vbr.textContent).toBe('96 kbps');
    expect(els.resItem.style.display).toBe('none');
    expect(els.size.textContent).toBe('9.36 MB');
  });

  test('renders auto/CRF mode as quality-based', () => {
    const estimateBar = createEstimateBar(els);
    estimateBar.show(SAMPLE_PLAN, { isMp3: false, outputFormat: 'mp4', mode: 'auto' });

    expect(els.vbr.textContent).toBe('CRF 19');
    expect(els.size.textContent).toBe('Variable (quality-based)');
  });

  test('renders GIF mode without bitrate/size', () => {
    const estimateBar = createEstimateBar(els);
    estimateBar.show(SAMPLE_PLAN, { isMp3: false, outputFormat: 'gif', mode: 'size-limit' });

    expect(els.vbr.textContent).toBe('GIF');
    expect(els.size.textContent).toBe('—');
  });

  test('hide() clears the estimate cluster', () => {
    const estimateBar = createEstimateBar(els);
    estimateBar.show(SAMPLE_PLAN, { isMp3: false, outputFormat: 'mp4', mode: 'size-limit' });
    estimateBar.hide();
    expect(els.bar.style.display).toBe('none');
  });
});

describe('title bar buttons stay clickable', () => {
  let els;

  beforeEach(() => {
    loadAppDom();
    els = getElements();
  });

  test('Start Export fires the export callback', () => {
    const onStartExport = jest.fn();
    initTitlebarActions({ ...els, onStartExport, onCancel: jest.fn() });

    els.exportBtn.click();
    expect(onStartExport).toHaveBeenCalledTimes(1);
    expect(els.exportBtn.disabled).toBe(false);
  });

  test('Cancel fires the cancel callback', () => {
    const onCancel = jest.fn();
    initTitlebarActions({ ...els, onStartExport: jest.fn(), onCancel });

    els.cancelBtn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('window controls invoke the window API', () => {
    const api = { minimizeWindow: jest.fn(), closeWindow: jest.fn() };
    initWindowControls({ ...els, api });

    els.minBtn.click();
    els.closeBtn.click();

    expect(api.minimizeWindow).toHaveBeenCalledTimes(1);
    expect(api.closeWindow).toHaveBeenCalledTimes(1);
  });
});

describe('progress UI', () => {
  let els;

  beforeEach(() => {
    loadAppDom();
    els = getElements();
  });

  const makeProgressUI = () => createProgressUI({
    container: els.progressContainer,
    fill: els.progressFill,
    text: els.progressText,
    cancelBtn: els.cancelBtn
  });

  test('setPercent renders percent text and fill width', () => {
    const progressUI = makeProgressUI();
    progressUI.show();
    progressUI.setPercent(42, null);

    expect(els.progressContainer.style.display).toBe('flex');
    expect(els.progressFill.style.width).toBe('42%');
    expect(els.progressText.textContent).toBe('42%');
  });

  test('setPercent with status appends status text', () => {
    const progressUI = makeProgressUI();
    progressUI.setPercent(10, 'Encoding');

    expect(els.progressText.textContent).toBe('Encoding (10%)');
  });

  test('negative percent enters indeterminate pulse state', () => {
    const progressUI = makeProgressUI();
    progressUI.setPercent(-1, 'Processing');

    expect(els.progressFill.style.width).toBe('100%');
    expect(els.progressFill.style.animation).toBe('pulse 1.5s infinite');
    expect(els.progressText.textContent).toBe('Processing');
  });

  test('hide() removes the progress cluster', () => {
    const progressUI = makeProgressUI();
    progressUI.show();
    progressUI.hide();

    expect(els.progressContainer.style.display).toBe('none');
    expect(progressUI.isVisible()).toBe(false);
  });
});

describe('title bar tooltip bubbles', () => {
  let els;

  beforeEach(() => {
    loadAppDom();
    els = getElements();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('hovering a button reveals an animated bubble with its label', () => {
    const bubble = document.getElementById('titlebar-tooltip');
    const helpBtn = document.getElementById('help-btn');
    initTitlebarTooltips(document, { showDelay: 150, hideDelay: 60 });

    helpBtn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    // Not shown yet — the show delay must elapse first.
    expect(bubble.classList.contains('visible')).toBe(false);
    jest.advanceTimersByTime(150);
    expect(bubble.classList.contains('visible')).toBe(true);
    expect(bubble.textContent).toBe('Keyboard Shortcuts');
    // The bubble is announced as the button's tooltip.
    expect(helpBtn.getAttribute('aria-describedby')).toBe('titlebar-tooltip');

    // Moving away hides it again after the hide delay.
    helpBtn.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
    jest.advanceTimersByTime(60);
    expect(bubble.classList.contains('visible')).toBe(false);
    expect(helpBtn.hasAttribute('aria-describedby')).toBe(false);
  });

  test('clicking a button hides its tooltip immediately', () => {
    const bubble = document.getElementById('titlebar-tooltip');
    const settingsBtn = document.getElementById('settings-btn');
    initTitlebarTooltips(document, { showDelay: 0, hideDelay: 60 });

    settingsBtn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    jest.advanceTimersByTime(0);
    expect(bubble.classList.contains('visible')).toBe(true);
    expect(bubble.textContent).toBe('Settings');

    settingsBtn.click();
    expect(bubble.classList.contains('visible')).toBe(false);
  });

  test('sliding directly from one button to another swaps the label and stays visible', () => {
    const bubble = document.getElementById('titlebar-tooltip');
    const helpBtn = document.getElementById('help-btn');
    const settingsBtn = document.getElementById('settings-btn');
    initTitlebarTooltips(document, { showDelay: 150, hideDelay: 60 });

    // Hover Help and let its tooltip appear.
    helpBtn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    jest.advanceTimersByTime(150);
    expect(bubble.classList.contains('visible')).toBe(true);
    expect(bubble.textContent).toBe('Keyboard Shortcuts');

    // Move straight to Settings: leaving Help schedules a hide, but entering
    // Settings cancels it — the bubble must swap labels and stay visible.
    helpBtn.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
    settingsBtn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    jest.advanceTimersByTime(150);

    expect(bubble.classList.contains('visible')).toBe(true);
    expect(bubble.textContent).toBe('Settings');
    // The stale aria reference on the previous button is stripped.
    expect(helpBtn.hasAttribute('aria-describedby')).toBe(false);
    expect(settingsBtn.getAttribute('aria-describedby')).toBe('titlebar-tooltip');
  });

  test('a hidden button (warning badge) never shows a tooltip', () => {
    const bubble = document.getElementById('titlebar-tooltip');
    const warningBtn = document.getElementById('titlebar-warning-btn');
    initTitlebarTooltips(document, { showDelay: 0, hideDelay: 60 });

    warningBtn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    jest.advanceTimersByTime(0);
    expect(bubble.classList.contains('visible')).toBe(false);
  });
});

describe('warnings UI', () => {
  let els;

  beforeEach(() => {
    loadAppDom();
    els = getElements();
  });

  const makeWarningsUI = () => createWarningsUI({
    button: els.warningBtn,
    modal: els.warningsModal,
    closeBtn: els.closeWarningsBtn,
    content: els.warningsModalContent,
    countEl: els.warningCount
  });

  test('shows the warning badge and renders cards when warnings exist', () => {
    const warningsUI = makeWarningsUI();
    warningsUI.show([
      { id: 'vfr', title: 'VFR detected', body: 'Audio sync issues might occur.' }
    ]);

    expect(els.warningBtn.style.display).toBe('flex');
    expect(els.warningCount.style.display).not.toBe('none');
    expect(els.warningCount.textContent).toBe('1');
    expect(els.warningsModalContent.querySelectorAll('.warning-card')).toHaveLength(1);
    expect(els.warningsModalContent.textContent).toContain('VFR detected');
  });

  test('hides the badge when no warnings remain', () => {
    const warningsUI = makeWarningsUI();
    warningsUI.show([]);

    expect(els.warningBtn.style.display).toBe('none');
    expect(els.warningCount.style.display).toBe('none');
    expect(els.warningsModalContent.innerHTML).toBe('');
  });

  test('converts legacy string warnings into cards', () => {
    const warningsUI = makeWarningsUI();
    warningsUI.show(['Something to note']);

    expect(els.warningsModalContent.querySelectorAll('.warning-card')).toHaveLength(1);
    expect(els.warningsModalContent.textContent).toContain('Something to note');
  });

  test('error warnings render the red severity variant', () => {
    const warningsUI = makeWarningsUI();
    warningsUI.show([{ id: 'error', title: 'Plan failed', body: 'Something broke' }]);

    expect(els.warningsModalContent.querySelectorAll('.warning-card--error')).toHaveLength(1);
    expect(els.warningsModalContent.textContent).toContain('Plan failed');
  });

  test('buildWarningCard with showTitle:false renders body-only (merge sidebar)', () => {
    const card = buildWarningCard('Clips have different formats', { showTitle: false });

    expect(card.className).toBe('warning-card');
    expect(card.querySelector('.warning-card-title')).toBeNull();
    expect(card.querySelector('.warning-card-body').textContent).toBe('Clips have different formats');
  });
});
