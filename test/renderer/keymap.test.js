/**
 * @jest-environment jsdom
 *
 * Tests for the remappable keyboard shortcut module (renderer/utils/keymap.js).
 * Pure logic: serialization, matching, overrides — no DOM.
 */
const {
  ACTIONS,
  DEFAULT_BINDINGS,
  bindingToValue,
  valueToBinding,
  bindingLabel,
  mergeBindings,
  matchAction,
  eventToBinding,
  shouldIgnoreCaptureEvent
} = require('../../renderer/utils/keymap.js');

function fakeEvent(code, opts = {}) {
  return {
    code,
    key: opts.key || code,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    repeat: !!opts.repeat
  };
}

describe('keymap', () => {
  test('every action has a default that round-trips through serialization', () => {
    for (const action of ACTIONS) {
      expect(DEFAULT_BINDINGS[action.id]).toBeTruthy();
      const value = bindingToValue(DEFAULT_BINDINGS[action.id]);
      expect(value).toBeTruthy();
      expect(valueToBinding(value)).toEqual(DEFAULT_BINDINGS[action.id]);
    }
  });

  test('bindingToValue / valueToBinding handle modifiers and malformed input', () => {
    expect(bindingToValue({ code: 'Space', ctrl: false, shift: false, alt: false })).toBe('Space');
    expect(bindingToValue({ code: 'KeyZ', ctrl: true, shift: false, alt: false })).toBe('ctrl+KeyZ');
    expect(bindingToValue({ code: 'Slash', shift: true, ctrl: false, alt: false })).toBe('shift+Slash');
    expect(bindingToValue({ code: 'KeyA', ctrl: true, shift: true, alt: false })).toBe('ctrl+shift+KeyA');

    expect(valueToBinding('')).toBeNull();
    expect(valueToBinding(null)).toBeNull();
    expect(valueToBinding('bogus+KeyA')).toBeNull();
    expect(valueToBinding('Space')).toEqual({ code: 'Space', ctrl: false, shift: false, alt: false });
  });

  test('bindingLabel formats keys for the help modal', () => {
    expect(bindingLabel({ code: 'Space', ctrl: false, shift: false, alt: false })).toBe('Space');
    expect(bindingLabel({ code: 'KeyZ', ctrl: true, shift: false, alt: false })).toBe('Ctrl+Z');
    expect(bindingLabel({ code: 'KeyY', ctrl: true, shift: false, alt: false })).toBe('Ctrl+Y');
    expect(bindingLabel({ code: 'Slash', shift: true, ctrl: false, alt: false })).toBe('Shift+/');
    expect(bindingLabel({ code: 'BracketLeft', ctrl: false, shift: false, alt: false })).toBe('[');
    expect(bindingLabel(null)).toBe('');
  });

  test('matchAction maps defaults with exact modifier matching', () => {
    const bindings = mergeBindings({});
    expect(matchAction(fakeEvent('Space'), bindings)).toBe('playPause');
    expect(matchAction(fakeEvent('ArrowLeft'), bindings)).toBe('frameBack');
    expect(matchAction(fakeEvent('ArrowRight'), bindings)).toBe('frameForward');
    expect(matchAction(fakeEvent('KeyI'), bindings)).toBe('setIn');
    expect(matchAction(fakeEvent('KeyO'), bindings)).toBe('setOut');
    expect(matchAction(fakeEvent('Home'), bindings)).toBe('jumpIn');
    expect(matchAction(fakeEvent('End'), bindings)).toBe('jumpOut');
    expect(matchAction(fakeEvent('KeyZ', { ctrl: true }), bindings)).toBe('undo');
    expect(matchAction(fakeEvent('KeyY', { ctrl: true }), bindings)).toBe('redo');
    expect(matchAction(fakeEvent('Slash', { shift: true }), bindings)).toBe('showShortcuts');

    // Plain keys must NOT fire under modifiers and vice versa.
    expect(matchAction(fakeEvent('KeyZ'), bindings)).toBeNull();
    expect(matchAction(fakeEvent('KeyI', { ctrl: true }), bindings)).toBeNull();
    expect(matchAction(fakeEvent('Slash'), bindings)).toBeNull();
    expect(matchAction(fakeEvent('KeyQ'), bindings)).toBeNull();
  });

  test('overrides remap, unbind (None), and respect dispatch priority', () => {
    const bindings = mergeBindings({ setIn: 'KeyJ', frameForward: '' });
    expect(matchAction(fakeEvent('KeyJ'), bindings)).toBe('setIn');
    expect(matchAction(fakeEvent('KeyI'), bindings)).toBeNull(); // moved away
    expect(matchAction(fakeEvent('ArrowRight'), bindings)).toBeNull(); // unbound
    expect(matchAction(fakeEvent('Home'), bindings)).toBe('jumpIn'); // untouched

    // With a conflict, the earlier action in ACTIONS wins.
    const conflicted = mergeBindings({ playPause: 'KeyI', setIn: 'KeyI' });
    expect(matchAction(fakeEvent('KeyI'), conflicted)).toBe('playPause');
  });

  test('eventToBinding captures the code plus exact modifiers', () => {
    expect(eventToBinding(fakeEvent('KeyZ', { ctrl: true })))
      .toEqual({ code: 'KeyZ', ctrl: true, shift: false, alt: false });
    expect(eventToBinding(fakeEvent('Slash', { shift: true })))
      .toEqual({ code: 'Slash', ctrl: false, shift: true, alt: false });
    expect(eventToBinding(fakeEvent('Space')))
      .toEqual({ code: 'Space', ctrl: false, shift: false, alt: false });
    expect(eventToBinding(fakeEvent('KeyA', { ctrl: true, shift: true, alt: true })))
      .toEqual({ code: 'KeyA', ctrl: true, shift: true, alt: true });
  });

  test('shouldIgnoreCaptureEvent skips modifiers, repeats, and OS-owned keys', () => {
    expect(shouldIgnoreCaptureEvent(fakeEvent('ControlLeft'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('ShiftRight'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('AltLeft'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('MetaLeft'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('Tab'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('CapsLock'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('Escape'))).toBe(true);
    expect(shouldIgnoreCaptureEvent(fakeEvent('KeyI', { repeat: true }))).toBe(true);

    // Real bindable keys are never ignored — even with modifiers held.
    expect(shouldIgnoreCaptureEvent(fakeEvent('KeyI'))).toBe(false);
    expect(shouldIgnoreCaptureEvent(fakeEvent('KeyZ', { ctrl: true }))).toBe(false);
    expect(shouldIgnoreCaptureEvent(fakeEvent('Space'))).toBe(false);
    expect(shouldIgnoreCaptureEvent(fakeEvent('Slash', { shift: true }))).toBe(false);
  });

  test('bindingLabel renders digits and F-keys readably', () => {
    expect(bindingLabel({ code: 'Digit1', ctrl: false, shift: false, alt: false })).toBe('1');
    expect(bindingLabel({ code: 'F5', ctrl: false, shift: false, alt: false })).toBe('F5');
    expect(bindingLabel({ code: 'KeyA', ctrl: true, shift: false, alt: false })).toBe('Ctrl+A');
  });
});
