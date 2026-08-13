/**
 * Custom dropdown replacement for native <select> elements.
 *
 * Why this exists: on Windows, Chromium still draws the *open* <select>
 * popup as an OS widget that CSS cannot touch, so every dropdown in the app
 * opened as a stock Windows menu (white, system font) regardless of the
 * theme. This module swaps each <select> for a styled button plus a
 * positioned option list rendered in the app DOM, so the open menu uses the
 * same surface tokens as the rest of the UI and flips with the light/dark
 * theme (the closed control was already styled — this fixes the popup).
 *
 * The original <select> stays in the DOM (hidden) as the single source of
 * truth: all app code keeps reading/writing its .value, picking an option
 * dispatches a bubbling 'change' on it (existing listeners work untouched),
 * and a MutationObserver mirrors dynamic option changes back into the custom
 * UI — audio-track repopulation, resolution presets, and encoder detection
 * toggling vendor options are all handled without touching app code.
 *
 * Accessibility: the button is a combobox (role, aria-haspopup,
 * aria-expanded, aria-activedescendant) and options are listbox options;
 * Arrow/Home/End/Enter/Escape, Tab-out closing, and single-letter typeahead
 * are supported. Focus stays on the button while navigating, per the ARIA
 * combobox pattern.
 */

let uidCounter = 0;

/**
 * Horizontal placement for the open menu, given the trigger button's rect.
 * Narrow menus sit flush under the button; menus wider than the button are
 * centered on it (the old left-alignment made wide menus lunge off to the
 * right, which read as "not aligned"). Clamped so a menu near a window edge
 * never gets clipped. Exported (via _internals) for unit tests — pure math.
 */
export function _computeMenuLeft(btnLeft, btnWidth, menuWidth, viewportWidth) {
  let left = btnLeft;
  if (menuWidth > btnWidth) {
    left = btnLeft + (btnWidth - menuWidth) / 2;
  }
  const pad = 8; // keep a sliver of the menu + its shadow on screen
  left = Math.max(pad, Math.min(left, viewportWidth - menuWidth - pad));
  return left;
}

/**
 * Replace one <select> with a custom dropdown. No-op if already enhanced.
 * Returns the controller ({ select, refresh }) so callers can re-sync.
 */
export function enhanceSelect(select) {
  if (!select || select.dataset.csEnhanced) {
    return select ? controllers.get(select) : null;
  }
  select.dataset.csEnhanced = '1';

  const uid = 'cs-dd-' + ++uidCounter;
  const wrapper = document.createElement('div');
  wrapper.className = 'cs-dropdown';
  // Mirror the handful of layout classes the selects carry: .full-width
  // stretches the button like the old select did, .speed/.form keep the
  // compact transport-bar and feedback-modal variants.
  if (select.classList.contains('full-width')) wrapper.classList.add('full-width');
  if (select.classList.contains('speed-select')) wrapper.classList.add('speed');
  if (select.classList.contains('form-input')) wrapper.classList.add('form');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-dropdown-btn';
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  // Pull the associated <label> text so the button announces itself the way
  // the select did (several labels use `for` pointing at these ids).
  const labelText = (select.labels && select.labels[0] ? select.labels[0].textContent : '').trim()
    || select.getAttribute('aria-label') || '';
  btn.setAttribute('aria-label', labelText);
  if (select.title) btn.title = select.title;

  const labelEl = document.createElement('span');
  labelEl.className = 'cs-dropdown-label';
  btn.appendChild(labelEl);
  wrapper.appendChild(btn);

  // The menu lives on <body> (position: fixed) so modal overlays with
  // overflow/scroll containers can never clip it.
  const menu = document.createElement('div');
  menu.className = 'cs-dropdown-menu';
  menu.id = uid + '-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  document.body.appendChild(menu);

  select.hidden = true; // keep it in the DOM as the value/options source
  select.parentNode.insertBefore(wrapper, select.nextSibling);

  const ctl = {
    select, wrapper, btn, labelEl, menu, uid,
    optionEls: [],
    selectedIndex: -1,
    activeIndex: -1,
    refresh: null // set below after renderMenu exists
  };

  function setActive(index) {
    ctl.activeIndex = index;
    ctl.optionEls.forEach((el, i) => el.classList.toggle('active', i === index));
    if (index >= 0) {
      ctl.btn.setAttribute('aria-activedescendant', ctl.optionEls[index].id);
      // Guarded: jsdom has no scrollIntoView and hidden containers throw.
      try { ctl.optionEls[index].scrollIntoView({ block: 'nearest' }); } catch (e) { /* no-op */ }
    }
  }

  function renderMenu() {
    ctl.menu.textContent = '';
    ctl.optionEls = [];
    const opts = Array.from(ctl.select.options);
    let selectedIndex = -1;
    opts.forEach((opt, i) => {
      const el = document.createElement('div');
      el.className = 'cs-dropdown-option';
      el.id = ctl.uid + '-opt-' + i;
      el.setAttribute('role', 'option');
      // Text lives in a wrapper span so the option row keeps a full-width
      // hover/selected highlight while the span centers short labels and
      // clamps long ones — the same center-if-fits rule as the button label.
      const textEl = document.createElement('span');
      textEl.className = 'cs-dropdown-option-text';
      textEl.textContent = opt.textContent; // textContent only: option labels are data, not markup
      el.appendChild(textEl);
      if (opt.disabled) {
        el.classList.add('disabled');
        el.setAttribute('aria-disabled', 'true');
      }
      const isSelected = opt.selected;
      el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) {
        el.classList.add('selected');
        selectedIndex = i;
      }
      el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the button
      el.addEventListener('click', () => selectOption(i));
      ctl.menu.appendChild(el);
      ctl.optionEls.push(el);
    });
    ctl.selectedIndex = selectedIndex;
    ctl.activeIndex = selectedIndex;
    ctl.labelEl.textContent = selectedIndex >= 0 ? opts[selectedIndex].textContent : '';
    ctl.btn.disabled = ctl.select.disabled;
    ctl.wrapper.classList.toggle('disabled', ctl.select.disabled);
    if (!ctl.menu.hidden) setActive(ctl.activeIndex);
  }

  function selectOption(index) {
    const opt = ctl.select.options[index];
    if (!opt || opt.disabled) return;
    // Native selects don't fire change for re-selecting the current option;
    // match that so downstream handlers don't double-run.
    if (index === ctl.select.selectedIndex) {
      closeMenu();
      return;
    }
    ctl.select.selectedIndex = index;
    closeMenu();
    ctl.labelEl.textContent = opt.textContent;
    ctl.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openMenu() {
    if (ctl.select.disabled) return;
    renderMenu();
    const rect = ctl.btn.getBoundingClientRect();
    ctl.menu.style.minWidth = rect.width + 'px';
    ctl.menu.hidden = false; // visible first: offsetWidth is 0 while hidden
    const menuWidth = ctl.menu.offsetWidth || rect.width;
    ctl.menu.style.left = _computeMenuLeft(rect.left, rect.width, menuWidth, window.innerWidth) + 'px';
    // Flip above the button when there is no room below.
    const menuHeight = ctl.menu.offsetHeight || 0;
    const below = rect.bottom + 4;
    const above = rect.top - menuHeight - 4;
    ctl.menu.style.top = (below + menuHeight > window.innerHeight && above > 0 ? above : below) + 'px';
    ctl.wrapper.classList.add('open');
    ctl.btn.setAttribute('aria-expanded', 'true');
    setActive(ctl.activeIndex >= 0 ? ctl.activeIndex : 0);
    // Close on outside press (capture so it beats the option click), and on
    // any scroll/resize — the menu is fixed-position, so its anchor moves.
    ctl._onDocPointerDown = (e) => {
      if (!ctl.wrapper.contains(e.target) && !ctl.menu.contains(e.target)) closeMenu();
    };
    document.addEventListener('pointerdown', ctl._onDocPointerDown, true);
    ctl._onWinScroll = () => closeMenu();
    window.addEventListener('scroll', ctl._onWinScroll, true);
    window.addEventListener('resize', ctl._onWinScroll);
  }

  function closeMenu() {
    ctl.menu.hidden = true;
    ctl.wrapper.classList.remove('open');
    ctl.btn.setAttribute('aria-expanded', 'false');
    ctl.btn.removeAttribute('aria-activedescendant');
    if (ctl._onDocPointerDown) {
      document.removeEventListener('pointerdown', ctl._onDocPointerDown, true);
      ctl._onDocPointerDown = null;
    }
    if (ctl._onWinScroll) {
      window.removeEventListener('scroll', ctl._onWinScroll, true);
      window.removeEventListener('resize', ctl._onWinScroll);
      ctl._onWinScroll = null;
    }
  }

  // Move the active highlight to the next/prev enabled option (wraps).
  function moveActive(dir) {
    const n = ctl.optionEls.length;
    if (n === 0) return;
    let idx = ctl.activeIndex;
    for (let step = 0; step < n; step++) {
      idx = (idx + dir + n) % n;
      if (!ctl.optionEls[idx].classList.contains('disabled')) {
        setActive(idx);
        return;
      }
    }
  }

  // Single-letter typeahead: jump to the next option whose label starts
  // with the typed character (case-insensitive), like a native select.
  function typeahead(ch) {
    const n = ctl.optionEls.length;
    if (n === 0) return;
    const lower = ch.toLowerCase();
    for (let step = 1; step <= n; step++) {
      const idx = (ctl.activeIndex + step) % n;
      const el = ctl.optionEls[idx];
      if (el.classList.contains('disabled')) continue;
      if (el.textContent.toLowerCase().startsWith(lower)) {
        setActive(idx);
        return;
      }
    }
  }

  btn.addEventListener('click', () => {
    if (ctl.menu.hidden) openMenu();
    else closeMenu();
  });

  btn.addEventListener('keydown', (e) => {
    const open = !ctl.menu.hidden;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openMenu(); else moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openMenu(); else moveActive(-1);
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActive(ctl.optionEls.length - 1); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) selectOption(ctl.activeIndex);
        else openMenu();
        break;
      case 'Escape':
        if (open) { e.preventDefault(); closeMenu(); }
        break;
      case 'Tab':
        closeMenu(); // let the browser move focus naturally
        break;
      default:
        if (open && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key);
    }
  });

  // Mirror dynamic option changes (childList), disabled/selected flips, and
  // label edits (characterData) from the native select into the custom UI.
  const observer = new MutationObserver(renderMenu);
  observer.observe(ctl.select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'selected'],
    characterData: true
  });
  // .value = is a property write (no mutation event); re-render on change so
  // the label follows programmatic selection changes too. App code that sets
  // a value without dispatching 'change' (settings load, default presets)
  // must call refreshSelect() afterwards — property writes can't be observed
  // here, and dispatching 'change' would fire app change listeners (which
  // invalidate plans and persist settings) during startup.
  ctl.select.addEventListener('change', renderMenu);

  ctl.refresh = renderMenu;
  renderMenu();
  controllers.set(select, ctl);
  return ctl;
}

const controllers = new WeakMap();

/**
 * Enhance every <select> under root (default: the document). Idempotent —
 * re-enhancing an already-enhanced select returns its existing controller.
 */
export function enhanceAllSelects(root = document) {
  return Array.from(root.querySelectorAll('select')).map(enhanceSelect);
}

/**
 * Re-render one enhanced select's label/menu from its current value. Needed
 * after a programmatic .value write that doesn't dispatch 'change' — e.g.
 * settings load applies the persisted codec/theme and then calls
 * refreshAllSelects() so the button label matches immediately instead of
 * waiting for the menu to open. No-op for selects that aren't enhanced.
 */
export function refreshSelect(select) {
  const ctl = controllers.get(select);
  if (ctl) ctl.refresh();
}

/** Re-render every enhanced select under root (default: the document). */
export function refreshAllSelects(root = document) {
  Array.from(root.querySelectorAll('select')).forEach(refreshSelect);
}
