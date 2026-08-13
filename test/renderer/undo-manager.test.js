/** Tests for the pure undo/redo stack (no DOM needed). */
const { createUndoManager } = require('../../renderer/utils/undo-manager.js');

describe('createUndoManager', () => {
  test('undo returns snapshots in LIFO order and redo returns them back', () => {
    const mgr = createUndoManager();
    mgr.push({ n: 1 });
    mgr.push({ n: 2 });

    expect(mgr.canUndo()).toBe(true);
    expect(mgr.undo()).toEqual({ n: 2 });
    expect(mgr.undo()).toEqual({ n: 1 });
    expect(mgr.undo()).toBeUndefined();
    expect(mgr.canUndo()).toBe(false);

    expect(mgr.redo()).toEqual({ n: 1 });
    expect(mgr.redo()).toEqual({ n: 2 });
    expect(mgr.redo()).toBeUndefined();
  });

  test('a new push clears the redo branch (linear history)', () => {
    const mgr = createUndoManager();
    mgr.push('a');
    mgr.push('b');
    mgr.undo(); // pops 'b' -> current state is 'a'
    mgr.push('c'); // diverges -> redo cleared, current state is now 'c'

    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo()).toBe('c');
    expect(mgr.undo()).toBe('a');
    expect(mgr.undo()).toBeUndefined();
  });

  test('undo pushes the current top onto redo so redo restores the future', () => {
    const mgr = createUndoManager();
    mgr.push('state1');
    mgr.push('state2');
    mgr.undo(); // pops state2
    mgr.redo(); // back to state2
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo()).toBe('state2');
  });

  test('limit keeps the stack bounded (oldest entries dropped)', () => {
    const mgr = createUndoManager(2);
    mgr.push(1);
    mgr.push(2);
    mgr.push(3);
    // 1 was shifted out
    expect(mgr.undo()).toBe(3);
    expect(mgr.undo()).toBe(2);
    expect(mgr.undo()).toBeUndefined();
  });

  test('clear empties both stacks', () => {
    const mgr = createUndoManager();
    mgr.push('a');
    mgr.undo();
    mgr.clear();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo()).toBeUndefined();
  });

  test('null/undefined entries are ignored', () => {
    const mgr = createUndoManager();
    mgr.push(undefined);
    mgr.push(null);
    expect(mgr.canUndo()).toBe(false);
  });
});
