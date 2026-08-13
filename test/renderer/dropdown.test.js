/**
 * @jest-environment jsdom
 *
 * Tests for the custom dropdown component (renderer/utils/dropdown.js):
 * replacing native <select> controls with a styled button + option list,
 * keeping the native select as the value/options source, and mirroring
 * dynamic option changes back into the custom UI.
 */
const { enhanceSelect, enhanceAllSelects, refreshSelect, refreshAllSelects, _computeMenuLeft } = require('../../renderer/utils/dropdown.js');

function makeSelect({ options = [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma']], selected = 'a', disabled = false } = {}) {
  const select = document.createElement('select');
  select.id = 'test-select';
  for (const [value, text] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  }
  select.value = selected;
  select.disabled = disabled;
  document.body.appendChild(select);
  return select;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('custom dropdown', () => {
  let select;

  beforeEach(() => {
    document.body.innerHTML = '';
    select = makeSelect();
  });

  test('enhances a select into a button + menu, hiding the native select', () => {
    const ctl = enhanceSelect(select);

    expect(select.hidden).toBe(true);
    expect(select.dataset.csEnhanced).toBe('1');
    expect(ctl.wrapper.classList.contains('cs-dropdown')).toBe(true);
    expect(ctl.btn.textContent).toBe('Alpha'); // current option as the label
    expect(ctl.btn.disabled).toBe(false);
    expect(ctl.menu.hidden).toBe(true);
    expect(ctl.menu.getAttribute('role')).toBe('listbox');
  });

  test('enhanceSelect is idempotent (returns the same controller)', () => {
    const first = enhanceSelect(select);
    const second = enhanceSelect(select);
    expect(second).toBe(first);
    expect(document.querySelectorAll('.cs-dropdown-btn').length).toBe(1);
  });

  test('enhanceAllSelects converts every select under the root', () => {
    const other = makeSelect({ options: [['x', 'Xray']] });
    const ctls = enhanceAllSelects(document);
    expect(ctls.length).toBe(2);
    expect(document.querySelectorAll('.cs-dropdown').length).toBe(2);
    expect(other.hidden).toBe(true);
  });

  test('clicking the button opens the menu with the options', () => {
    const ctl = enhanceSelect(select);
    ctl.btn.click();

    expect(ctl.menu.hidden).toBe(false);
    expect(ctl.btn.getAttribute('aria-expanded')).toBe('true');
    const labels = [...ctl.menu.querySelectorAll('.cs-dropdown-option')].map((el) => el.textContent);
    expect(labels).toEqual(['Alpha', 'Beta', 'Gamma']);
    // The current value is marked selected
    expect(ctl.menu.querySelectorAll('.cs-dropdown-option.selected').length).toBe(1);
    expect(ctl.menu.querySelector('.cs-dropdown-option.selected').textContent).toBe('Alpha');
  });

  test('clicking the button again closes the menu', () => {
    const ctl = enhanceSelect(select);
    ctl.btn.click();
    ctl.btn.click();
    expect(ctl.menu.hidden).toBe(true);
    expect(ctl.btn.getAttribute('aria-expanded')).toBe('false');
  });

  test('picking an option updates the select value, fires change, and closes', () => {
    const ctl = enhanceSelect(select);
    const onChange = jest.fn();
    select.addEventListener('change', onChange);

    ctl.btn.click();
    const options = ctl.menu.querySelectorAll('.cs-dropdown-option');
    options[2].click(); // Gamma

    expect(select.value).toBe('c');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ctl.labelEl.textContent).toBe('Gamma');
    expect(ctl.menu.hidden).toBe(true);
  });

  test('re-selecting the current option closes without firing change', () => {
    const ctl = enhanceSelect(select);
    const onChange = jest.fn();
    select.addEventListener('change', onChange);

    ctl.btn.click();
    const options = ctl.menu.querySelectorAll('.cs-dropdown-option');
    options[0].click(); // Alpha is already selected

    expect(onChange).not.toHaveBeenCalled();
    expect(select.value).toBe('a');
    expect(ctl.menu.hidden).toBe(true);
  });

  test('a disabled select renders a disabled button and cannot open', () => {
    select.disabled = true;
    const ctl = enhanceSelect(select);
    expect(ctl.btn.disabled).toBe(true);
    ctl.btn.click();
    expect(ctl.menu.hidden).toBe(true);
  });

  test('disabled options render disabled and are not selectable', () => {
    select.options[1].disabled = true;
    const ctl = enhanceSelect(select);
    ctl.btn.click();

    const beta = [...ctl.menu.querySelectorAll('.cs-dropdown-option')][1];
    expect(beta.classList.contains('disabled')).toBe(true);
    beta.click();
    expect(select.value).toBe('a');
  });

  test('dynamic option repopulation mirrors into the menu', async () => {
    const ctl = enhanceSelect(select);
    // Simulate populateAudioTracks: clear, append, set value
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '3';
    opt.textContent = 'Track 4: H264 (2ch)';
    select.appendChild(opt);
    select.value = '3';
    await flush(); // MutationObserver callbacks run async

    expect(ctl.labelEl.textContent).toBe('Track 4: H264 (2ch)');
    ctl.btn.click();
    expect(ctl.menu.querySelector('.cs-dropdown-option').textContent).toBe('Track 4: H264 (2ch)');
    expect(ctl.menu.querySelectorAll('.cs-dropdown-option').length).toBe(1);
  });

  test('encoder-detection style disabled flips are mirrored', async () => {
    const ctl = enhanceSelect(select);
    select.options[1].disabled = true;
    await flush();
    ctl.btn.click();
    expect(ctl.menu.querySelectorAll('.cs-dropdown-option.disabled').length).toBe(1);
  });

  test('an external value change followed by change keeps the label in sync', async () => {
    const ctl = enhanceSelect(select);
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(ctl.labelEl.textContent).toBe('Beta');
  });

  test('refreshSelect re-syncs the label after a plain .value write', () => {
    // Regression: settings load writes select.value without dispatching
    // 'change' (e.g. videoCodec after startup), which used to leave the label
    // showing the HTML default until the menu was opened.
    const ctl = enhanceSelect(select);
    select.value = 'b';
    refreshSelect(select);
    expect(ctl.labelEl.textContent).toBe('Beta');
  });

  test('refreshSelect after a .value write to a nonexistent option clears the label', () => {
    const ctl = enhanceSelect(select);
    select.value = 'zzz'; // native behavior: no matching option -> ''
    refreshSelect(select);
    expect(select.value).toBe('');
    expect(ctl.labelEl.textContent).toBe('');
  });

  test('refreshAllSelects re-syncs every enhanced label at once', () => {
    const ctl = enhanceSelect(select);
    const other = makeSelect({ options: [['x', 'Xray'], ['y', 'Yankee']] });
    const ctl2 = enhanceSelect(other);
    select.value = 'c';
    other.value = 'y';
    refreshAllSelects(document);
    expect(ctl.labelEl.textContent).toBe('Gamma');
    expect(ctl2.labelEl.textContent).toBe('Yankee');
  });

  test('refreshSelect is a no-op for a select that was never enhanced', () => {
    const plain = makeSelect();
    expect(() => refreshSelect(plain)).not.toThrow();
  });

  test('keyboard: ArrowDown opens and highlights, Enter selects', () => {
    const ctl = enhanceSelect(select);
    const onChange = jest.fn();
    select.addEventListener('change', onChange);

    ctl.btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(ctl.menu.hidden).toBe(false);

    // Down again moves the highlight past the selected Alpha to Beta
    ctl.btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const active = ctl.menu.querySelector('.cs-dropdown-option.active');
    expect(active.textContent).toBe('Beta');

    ctl.btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(select.value).toBe('b');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ctl.menu.hidden).toBe(true);
  });

  test('keyboard: Escape closes the menu without changing the value', () => {
    const ctl = enhanceSelect(select);
    ctl.btn.click();
    ctl.btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ctl.menu.hidden).toBe(true);
    expect(select.value).toBe('a');
  });

  test('keyboard: typeahead jumps to the option starting with the letter', () => {
    const ctl = enhanceSelect(select);
    ctl.btn.click();
    ctl.btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    const active = ctl.menu.querySelector('.cs-dropdown-option.active');
    expect(active.textContent).toBe('Gamma');
  });

  test('clicking outside closes the menu', () => {
    const ctl = enhanceSelect(select);
    ctl.btn.click();
    // jsdom has no PointerEvent; a plain Event suffices (handler reads e.target)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(ctl.menu.hidden).toBe(true);
  });

  test('copies the label text for the aria-label and title', () => {
    const label = document.createElement('label');
    label.setAttribute('for', 'test-select');
    label.textContent = 'Target Size:';
    document.body.appendChild(label);
    select.title = 'Size cap for the export';

    const ctl = enhanceSelect(select);
    expect(ctl.btn.getAttribute('aria-label')).toBe('Target Size:');
    expect(ctl.btn.title).toBe('Size cap for the export');
  });
});

describe('menu placement math', () => {
  // _computeMenuLeft(btnLeft, btnWidth, menuWidth, viewportWidth)
  test('a menu no wider than the button sits flush under it', () => {
    expect(_computeMenuLeft(100, 200, 200, 1000)).toBe(100);
    expect(_computeMenuLeft(100, 200, 150, 1000)).toBe(100);
  });

  test('a menu wider than the button is centered on it', () => {
    // Button 50..130 (80 wide); menu 160 wide centered on 90 -> left = 10
    expect(_computeMenuLeft(50, 80, 160, 1000)).toBe(10);
    // Centering a 400px menu on a 200px button at x=100 would go negative,
    // so it clamps to the 8px safety padding instead.
    expect(_computeMenuLeft(100, 200, 400, 1000)).toBe(8);
  });

  test('the centered menu is clamped so it never leaves the viewport', () => {
    // Button hard against the left edge: a wider centered menu would go
    // negative, so it clamps to the 8px safety padding.
    expect(_computeMenuLeft(0, 100, 300, 1000)).toBe(8);
    // Button at 900..1000; centered 300px menu would sit at 800..1100, so it
    // clamps so the right edge stays 8px inside the viewport (left 692).
    expect(_computeMenuLeft(900, 100, 300, 1000)).toBe(692);
    // A flush-narrow menu at the right edge clamps too.
    expect(_computeMenuLeft(950, 50, 50, 1000)).toBe(942);
  });
});
