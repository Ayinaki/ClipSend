/**
 * @jest-environment jsdom
 *
 * Unit tests for the first-run onboarding tour (renderer/onboarding.js):
 * first-run auto-show, skip/complete persistence, step navigation, keyboard
 * handling, and replay-from-settings behavior.
 */
const fs = require('fs');
const path = require('path');

const { createOnboardingController, ONBOARDING_STEPS } = require('../../renderer/onboarding.js');

function loadAppDom() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
  document.documentElement.innerHTML = html;
  return document;
}

function makeApi(overrides = {}) {
  const calls = { setSetting: [] };
  return {
    getSetting: jest.fn(async () => true), // seen by default (first-run already handled)
    setSetting: jest.fn(async (key, value) => { calls.setSetting.push([key, value]); }),
    calls,
    ...overrides
  };
}

function getElements() {
  return {
    modal: document.getElementById('onboarding-modal'),
    closeBtn: document.getElementById('onboarding-close-btn'),
    skipBtn: document.getElementById('onboarding-skip-btn'),
    prevBtn: document.getElementById('onboarding-prev-btn'),
    nextBtn: document.getElementById('onboarding-next-btn'),
    dots: document.getElementById('onboarding-dots'),
    stepTitle: document.getElementById('onboarding-title'),
    stepBody: document.getElementById('onboarding-copy'),
    stepVisual: document.getElementById('onboarding-visual')
  };
}

function pressKey(key) {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('onboarding tour', () => {
  let api;
  let els;
  let onboarding;

  beforeEach(() => {
    loadAppDom();
    api = makeApi();
    els = getElements();
    onboarding = createOnboardingController({ api, elements: els });
  });

  test('defines a 5-step tour with copy and visuals for each step', () => {
    expect(ONBOARDING_STEPS.length).toBe(5);
    ONBOARDING_STEPS.forEach(step => {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.visual).toContain('<svg');
    });
  });

  test('copy is taste-skill clean: no em-dashes, all visuals share one aspect ratio', () => {
    ONBOARDING_STEPS.forEach(step => {
      expect(step.title).not.toContain('\u2014');
      expect(step.body).not.toContain('\u2014');
      expect(step.body).not.toContain('&mdash;');
      expect(step.visual).toContain('viewBox="0 0 380 96"');
    });
  });

  test('init() does not auto-show when the tour was already seen', async () => {
    await onboarding.init();
    expect(els.modal.style.display).toBe('none');
  });

  test('init() auto-shows the tour on first run after a short delay', async () => {
    jest.useFakeTimers();
    api = makeApi({ getSetting: jest.fn(async () => undefined) });
    onboarding = createOnboardingController({ api, elements: els });

    await onboarding.init();
    expect(els.modal.style.display).toBe('none'); // not yet - timer pending

    jest.advanceTimersByTime(700);
    expect(els.modal.style.display).toBe('flex');
    jest.useRealTimers();
  });

  test('init() does not auto-show when another modal is already open', async () => {
    jest.useFakeTimers();
    api = makeApi({ getSetting: jest.fn(async () => undefined) });
    document.getElementById('settings-modal').style.display = 'flex';
    onboarding = createOnboardingController({ api, elements: els });

    await onboarding.init();
    jest.advanceTimersByTime(1000);
    expect(els.modal.style.display).toBe('none');
    jest.useRealTimers();
  });

  test('first step renders title, visual and dots; Back is disabled', () => {
    onboarding.show();
    expect(els.modal.style.display).toBe('flex');
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[0].title);
    expect(els.stepVisual.querySelector('svg')).toBeTruthy();
    expect(els.dots.querySelectorAll('.onboarding-dot').length).toBe(5);
    expect(els.dots.querySelectorAll('.onboarding-dot')[0].classList.contains('active')).toBe(true);
    expect(els.prevBtn.disabled).toBe(true);
    expect(els.nextBtn.textContent).toBe('Next');
  });

  test('Next/Back navigate steps and move the active dot', () => {
    onboarding.show();
    els.nextBtn.click();
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[1].title);
    expect(els.dots.querySelectorAll('.onboarding-dot')[1].classList.contains('active')).toBe(true);
    expect(els.prevBtn.disabled).toBe(false);

    els.nextBtn.click();
    els.nextBtn.click();
    expect(els.dots.querySelectorAll('.onboarding-dot')[3].classList.contains('active')).toBe(true);

    els.prevBtn.click();
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[2].title);
    expect(els.dots.querySelectorAll('.onboarding-dot')[2].classList.contains('active')).toBe(true);
  });

  test('completing the last step closes the tour and marks it seen', () => {
    onboarding.show();
    for (let i = 0; i < ONBOARDING_STEPS.length; i++) els.nextBtn.click();
    expect(els.modal.style.display).toBe('none');
    expect(api.calls.setSetting).toContainEqual(['hasSeenOnboarding', true]);
  });

  test('Skip closes the tour and marks it seen', () => {
    onboarding.show();
    els.skipBtn.click();
    expect(els.modal.style.display).toBe('none');
    expect(api.calls.setSetting).toContainEqual(['hasSeenOnboarding', true]);
  });

  test('closing via the X or backdrop also marks it seen', () => {
    onboarding.show();
    els.closeBtn.click();
    expect(api.calls.setSetting).toContainEqual(['hasSeenOnboarding', true]);

    // Backdrop click on a fresh controller persists too.
    const fresh = createOnboardingController({ api, elements: getElements() });
    fresh.show();
    els.modal.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(api.calls.setSetting.filter(([k]) => k === 'hasSeenOnboarding').length).toBe(2);
  });

  test('markSeen is idempotent', () => {
    onboarding.show();
    els.skipBtn.click();
    els.skipBtn.click();
    expect(api.calls.setSetting.filter(([k]) => k === 'hasSeenOnboarding').length).toBe(1);
  });

  test('Escape closes the tour and marks it seen', () => {
    onboarding.show();
    pressKey('Escape');
    expect(els.modal.style.display).toBe('none');
    expect(api.calls.setSetting).toContainEqual(['hasSeenOnboarding', true]);
  });

  test('arrow keys navigate steps while the tour is open', () => {
    onboarding.show();
    pressKey('ArrowRight');
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[1].title);
    pressKey('ArrowRight');
    pressKey('ArrowRight');
    pressKey('ArrowRight');
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[4].title);
    pressKey('ArrowLeft');
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[3].title);
  });

  test('arrow keys do nothing when the tour is closed', () => {
    pressKey('ArrowRight');
    expect(onboarding.getStep()).toBe(0);
    expect(els.modal.style.display).toBe('none');
  });

  test('show() replays the tour from step 1 even after it was seen', async () => {
    await onboarding.init(); // seen -> no auto-show
    expect(els.modal.style.display).toBe('none');
    onboarding.show();
    expect(els.modal.style.display).toBe('flex');
    expect(onboarding.getStep()).toBe(0);
    // Replaying must not reset the seen flag.
    expect(api.calls.setSetting).toHaveLength(0);
  });

  test('shortcuts step renders kbd chips in the body and a keyboard mock as visual', () => {
    onboarding.show();
    for (let i = 0; i < 4; i++) els.nextBtn.click();
    expect(els.stepTitle.textContent).toBe(ONBOARDING_STEPS[4].title);
    expect(els.stepBody.querySelectorAll('kbd').length).toBeGreaterThan(0);
    expect(els.stepBody.querySelector('.onboarding-shortcuts')).toBeTruthy();
    expect(els.nextBtn.textContent).toBe('Get Started');
    // The visual is a keycap-only keyboard (no action labels), so the same
    // content is not shown twice.
    const visualText = els.stepVisual.textContent;
    expect(visualText).not.toContain('Play');
    expect(visualText).not.toContain('Zoom');
  });

  test('onCompleted fires once when the tour is finished or skipped', async () => {
    const onCompleted = jest.fn();
    onboarding = createOnboardingController({ api, elements: els, onCompleted });
    onboarding.show();
    els.skipBtn.click();
    await new Promise(r => setTimeout(r, 0)); // markSeen persists before firing
    expect(onCompleted).toHaveBeenCalledTimes(1);
    onboarding.show();
    els.skipBtn.click();
    await new Promise(r => setTimeout(r, 0));
    expect(onCompleted).toHaveBeenCalledTimes(1); // still once
  });
});
