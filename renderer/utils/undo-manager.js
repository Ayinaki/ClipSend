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

  function pushToStack(stack, entry) {
    stack.push(entry);
    if (stack.length > limit) stack.shift();
  }

  function push(entry) {
    if (entry === undefined || entry === null) return;
    pushToStack(undoStack, entry);
    // A new edit invalidates every redo step (linear history).
    redoStack.length = 0;
  }

  /**
   * Pop the last pre-edit snapshot. The caller passes its CURRENT state so
   * that state (the post-edit one) lands on the redo stack — redo must
   * restore the edited state, not re-apply the pre-edit one.
   */
  function undo(current) {
    if (undoStack.length === 0) return undefined;
    const entry = undoStack.pop();
    if (current !== undefined && current !== null) pushToStack(redoStack, current);
    return entry;
  }

  /**
   * Pop the last redo snapshot (the post-edit state). The caller passes its
   * CURRENT (undone) state so it can be undone again from the restored edit.
   */
  function redo(current) {
    if (redoStack.length === 0) return undefined;
    const entry = redoStack.pop();
    if (current !== undefined && current !== null) pushToStack(undoStack, current);
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
