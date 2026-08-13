/** Tests for the pure undo/redo stack (no DOM needed). */
const { createUndoManager } = require('../../renderer/utils/undo-manager.js');

describe('createUndoManager', () => {
  test('undo walks back through pre-edit snapshots; redo restores the edited states', () => {
    const mgr = createUndoManager();
    // S0 --edit1--> S1 --edit2--> S2: the stack holds each pre-edit snapshot.
    mgr.push('S0');
    mgr.push('S1');

    // Undo edit 2: caller's current state (S2) is parked for redo.
    expect(mgr.undo('S2')).toBe('S1');
    expect(mgr.undo('S1')).toBe('S0');
    expect(mgr.undo('S0')).toBeUndefined();
    expect(mgr.canUndo()).toBe(false);

    // Redo edit 1 then edit 2: each restores the post-edit state, and the
    // undone state is pushed back so it can be undone again.
    expect(mgr.redo('S0')).toBe('S1');
    expect(mgr.redo('S1')).toBe('S2');
    expect(mgr.redo('S2')).toBeUndefined();

    // The cycle is repeatable — undo again returns the pre-edit snapshots.
    expect(mgr.undo('S2')).toBe('S1');
    expect(mgr.redo('S1')).toBe('S2');
  });

  test('a new push clears the redo branch (linear history)', () => {
    const mgr = createUndoManager();
    mgr.push('S0');
    mgr.push('S1');
    mgr.undo('S2'); // back to S1; redo holds S2
    expect(mgr.canRedo()).toBe(true);

    // A fresh edit made from S1 invalidates the redo branch.
    mgr.push('S1'); // pre-edit snapshot of the new edit
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo('S3')).toBe('S1'); // undo the new edit -> back to S1
    expect(mgr.undo('S1')).toBe('S0'); // then undo the first edit
  });

  test('limit keeps the stacks bounded (oldest entries dropped)', () => {
    const mgr = createUndoManager(2);
    mgr.push(1);
    mgr.push(2);
    mgr.push(3);
    // 1 was shifted out
    expect(mgr.undo(4)).toBe(3);
    expect(mgr.undo(3)).toBe(2);
    expect(mgr.undo(2)).toBeUndefined();
  });

  test('peekUndo/peekRedo inspect the next entry without popping', () => {
    const mgr = createUndoManager();
    expect(mgr.peekUndo()).toBeUndefined();
    expect(mgr.peekRedo()).toBeUndefined();

    mgr.push('S0');
    mgr.push('S1');
    expect(mgr.peekUndo()).toBe('S1');
    expect(mgr.peekRedo()).toBeUndefined();

    mgr.undo('S2');
    expect(mgr.peekUndo()).toBe('S0');
    expect(mgr.peekRedo()).toBe('S2');
    // Stacks unchanged by peeking.
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(true);
  });

  test('clear empties both stacks', () => {
    const mgr = createUndoManager();
    mgr.push('a');
    mgr.undo('b');
    mgr.clear();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo('c')).toBeUndefined();
    expect(mgr.redo('c')).toBeUndefined();
  });

  test('null/undefined entries and current states are ignored', () => {
    const mgr = createUndoManager();
    mgr.push(undefined);
    mgr.push(null);
    expect(mgr.canUndo()).toBe(false);

    // No current state passed: undo still works but nothing is parked for redo.
    mgr.push('a');
    expect(mgr.undo()).toBe('a');
    expect(mgr.redo('x')).toBeUndefined();
  });
});
