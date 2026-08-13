/**
 * Keyboard shortcut definitions + matching.
 *
 * The transport/global actions the app dispatches on keydown used to be
 * hardcoded in the big switch in app.js. Users can now remap them in
 * Settings → Keyboard Shortcuts; overrides persist as a `shortcuts` object
 * in electron-store ({ action: 'ctrl+KeyZ' }). This module is the single
 * source of truth for the action list, the defaults, serialization, and
 * event matching — kept pure (no DOM) so it unit-tests in plain jsdom.
 *
 * Binding model: { code: 'KeyI', ctrl: false, shift: false, alt: false }.
 * Matching is EXACT on modifiers — a plain 'KeyI' binding does not fire when
 * Ctrl is held, so remapping can't collide with browser/app chords.
 */

/** The remappable actions, in dispatch priority order (first match wins). */
export const ACTIONS = [
  { id: 'playPause', label: 'Play / Pause' },
  { id: 'frameBack', label: 'Step one frame back' },
  { id: 'frameForward', label: 'Step one frame forward' },
  { id: 'setIn', label: 'Set In point' },
  { id: 'setOut', label: 'Set Out point' },
  { id: 'jumpIn', label: 'Jump to In point' },
  { id: 'jumpOut', label: 'Jump to Out point' },
  { id: 'undo', label: 'Undo' },
  { id: 'redo', label: 'Redo' },
  { id: 'showShortcuts', label: 'Show keyboard help' }
];

export const DEFAULT_BINDINGS = {
  playPause: { code: 'Space', ctrl: false, shift: false, alt: false },
  frameBack: { code: 'ArrowLeft', ctrl: false, shift: false, alt: false },
  frameForward: { code: 'ArrowRight', ctrl: false, shift: false, alt: false },
  setIn: { code: 'KeyI', ctrl: false, shift: false, alt: false },
  setOut: { code: 'KeyO', ctrl: false, shift: false, alt: false },
  jumpIn: { code: 'Home', ctrl: false, shift: false, alt: false },
  jumpOut: { code: 'End', ctrl: false, shift: false, alt: false },
  undo: { code: 'KeyZ', ctrl: true, shift: false, alt: false },
  redo: { code: 'KeyY', ctrl: true, shift: false, alt: false },
  showShortcuts: { code: 'Slash', ctrl: false, shift: true, alt: false }
};

const MODIFIER_ORDER = ['ctrl', 'shift', 'alt'];

/** Stable string id for a binding, e.g. 'ctrl+KeyZ', 'Space', 'shift+Slash'. */
export function bindingToValue(binding) {
  if (!binding || !binding.code) return '';
  const parts = [];
  for (const mod of MODIFIER_ORDER) {
    if (binding[mod]) parts.push(mod);
  }
  parts.push(binding.code);
  return parts.join('+');
}

/** Reverse of bindingToValue. Returns null for '' (unbound) or bad input. */
export function valueToBinding(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('+');
  const code = parts.pop();
  if (!code) return null;
  const binding = { code, ctrl: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === 'ctrl') binding.ctrl = true;
    else if (part === 'shift') binding.shift = true;
    else if (part === 'alt') binding.alt = true;
    else return null; // unknown modifier — treat as malformed
  }
  return binding;
}

// Display names for non-letter codes; everything else falls back to a
// readable code-derived name (KeyA → A, Digit1 → 1, F5 → F5).
const CODE_LABELS = {
  Space: 'Space',
  ArrowLeft: '\u2190',
  ArrowRight: '\u2192',
  ArrowUp: '\u2191',
  ArrowDown: '\u2193',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Slash: '/',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Backslash: '\\',
  Enter: 'Enter',
  Insert: 'Ins',
  Delete: 'Del',
  KeyZ: 'Z',
  KeyY: 'Y'
};

function keyLabel(code) {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyA -> A
  if (/^Digit\d$/.test(code)) return code.slice(5);  // Digit1 -> 1
  return code; // F-keys, Numpad*, unusual codes pass through
}

/** Human label for the help modal and the editor's key buttons: 'Ctrl+Z'. */
export function bindingLabel(binding) {
  if (!binding || !binding.code) return '';
  const mods = [];
  if (binding.ctrl) mods.push('Ctrl');
  if (binding.shift) mods.push('Shift');
  if (binding.alt) mods.push('Alt');
  return [...mods, keyLabel(binding.code)].join('+');
}

// Keydowns that must never become a binding while the editor is recording.
// Modifier keys are only meaningful combined with a real key; Escape is the
// capture-cancel; Tab/CapsLock/NumLock are OS/browser-owned.
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'
]);
const IGNORED_CAPTURE_CODES = new Set(['Escape', 'Tab', 'CapsLock', 'NumLock']);

/**
 * True when a keydown must not be captured as a binding (modifier held
 * alone, autorepeat, or an OS-reserved key). The caller handles Escape as
 * "cancel recording" before consulting this.
 */
export function shouldIgnoreCaptureEvent(e) {
  return Boolean(e.repeat) || MODIFIER_CODES.has(e.code) || IGNORED_CAPTURE_CODES.has(e.code);
}

/** Convert a KeyboardEvent into the binding object model ({code, mods}). */
export function eventToBinding(e) {
  return { code: e.code, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey };
}

/** Merge stored overrides ({action: value}) over the defaults. */
export function mergeBindings(overrides) {
  const bindings = {};
  for (const action of ACTIONS) {
    bindings[action.id] = { ...DEFAULT_BINDINGS[action.id] };
  }
  for (const [action, value] of Object.entries(overrides || {})) {
    const binding = valueToBinding(value);
    if (bindings[action] !== undefined) {
      if (binding) bindings[action] = binding;
      else delete bindings[action]; // explicit 'None' unbinds the action
    }
  }
  return bindings;
}

/**
 * Which action (if any) a keydown event maps to, in ACTIONS priority order.
 * Modifiers match exactly, so a plain binding never fires under Ctrl/Shift.
 */
export function matchAction(e, bindings) {
  for (const action of ACTIONS) {
    const b = bindings[action.id];
    if (!b) continue;
    if (e.code === b.code
        && !!e.ctrlKey === !!b.ctrl
        && !!e.shiftKey === !!b.shift
        && !!e.altKey === !!b.alt) {
      return action.id;
    }
  }
  return null;
}
