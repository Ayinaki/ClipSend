/**
 * UndoManager — a tiny two-stack undo/redo history for opaque snapshots.
 *
 * Snapshots are plain data (whatever the caller captures); the manager only
 * owns the stacks. Pushing a new snapshot clears the redo branch (standard
 * linear history). Undo/redo pop the stacks and return the snapshot to apply
 * — the caller decides how to restore it, keeping this module UI-agnostic
 * and unit-testable in plain jsdom.
 */

export function createUndoManager(limit = 50) {
  const undoStack = [];
  const redoStack = [];

  function push(entry) {
    if (entry === undefined || entry === null) return;
    undoStack.push(entry);
    if (undoStack.length > limit) undoStack.shift();
    // A new edit invalidates every redo step (linear history).
    redoStack.length = 0;
  }

  /** Pop the last undo snapshot (pushing the current one onto redo). */
  function undo() {
    if (undoStack.length === 0) return undefined;
    const entry = undoStack.pop();
    redoStack.push(entry);
    return entry;
  }

  /** Pop the last redo snapshot (pushing it back onto undo). */
  function redo() {
    if (redoStack.length === 0) return undefined;
    const entry = redoStack.pop();
    undoStack.push(entry);
    return entry;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  return { push, undo, redo, canUndo, canRedo, clear };
}
