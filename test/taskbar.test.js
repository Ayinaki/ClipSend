const {
  updateTaskbarProgress,
  clearTaskbarProgress,
  setTaskbarError,
  notifyExportComplete
} = require('../main/taskbar');

describe('taskbar progress helpers', () => {
  function makeWin() {
    return { setProgressBar: jest.fn(), isDestroyed: () => false };
  }

  test('maps 0-100 percent onto a 0-1 taskbar progress', () => {
    const win = makeWin();
    updateTaskbarProgress(win, 50);
    expect(win.setProgressBar).toHaveBeenCalledWith(0.5);
  });

  test('clamps percent values beyond the valid range', () => {
    const win = makeWin();
    updateTaskbarProgress(win, 150);
    expect(win.setProgressBar).toHaveBeenCalledWith(1);
    updateTaskbarProgress(win, -20);
    expect(win.setProgressBar).toHaveBeenCalledWith(0, { mode: 'indeterminate' });
  });

  test('negative percent (GIF attempt phases) renders indeterminate', () => {
    const win = makeWin();
    updateTaskbarProgress(win, -3);
    expect(win.setProgressBar).toHaveBeenCalledWith(0, { mode: 'indeterminate' });
  });

  test('null/non-numeric percent renders indeterminate', () => {
    const win = makeWin();
    updateTaskbarProgress(win, null);
    expect(win.setProgressBar).toHaveBeenCalledWith(0, { mode: 'indeterminate' });
    updateTaskbarProgress(win, 'nope');
    expect(win.setProgressBar).toHaveBeenCalledWith(0, { mode: 'indeterminate' });
  });

  test('clearTaskbarProgress removes the indicator', () => {
    const win = makeWin();
    clearTaskbarProgress(win);
    expect(win.setProgressBar).toHaveBeenCalledWith(-1);
  });

  test('setTaskbarError uses error mode', () => {
    const win = makeWin();
    setTaskbarError(win);
    expect(win.setProgressBar).toHaveBeenCalledWith(1, { mode: 'error' });
    // Cancel the pending auto-clear so the real 5s timer doesn't hold jest open.
    clearTaskbarProgress(win);
  });

  test('no-ops on a destroyed window', () => {
    const win = { setProgressBar: jest.fn(), isDestroyed: () => true };
    expect(() => updateTaskbarProgress(win, 10)).not.toThrow();
    expect(() => clearTaskbarProgress(win)).not.toThrow();
    expect(() => setTaskbarError(win)).not.toThrow();
    expect(win.setProgressBar).not.toHaveBeenCalled();
  });

  test('notifyExportComplete no-ops when notifications unsupported', () => {
    // In plain Node (jest), require('electron') yields the binary path string,
    // so Notification is undefined and the helper must not throw.
    expect(() =>
      notifyExportComplete({ win: makeWin(), filePath: 'C:\\vids\\clip.mp4', finalSizeMB: '8.02', label: 'Trimmed clip' })
    ).not.toThrow();
  });

  test('a stale error auto-clear never wipes a new export progress tick', () => {
    jest.useFakeTimers();
    const win = makeWin();
    setTaskbarError(win);
    expect(win.setProgressBar).toHaveBeenLastCalledWith(1, { mode: 'error' });

    // A fresh export starts before the 5s auto-clear fires.
    updateTaskbarProgress(win, 42);
    jest.advanceTimersByTime(6000);
    // The pending clear must have been cancelled by the progress tick.
    expect(win.setProgressBar).not.toHaveBeenCalledWith(-1);
    jest.useRealTimers();
  });

  test('error auto-clear fires when no new progress arrives', () => {
    jest.useFakeTimers();
    const win = makeWin();
    setTaskbarError(win);
    jest.advanceTimersByTime(6000);
    expect(win.setProgressBar).toHaveBeenCalledWith(-1);
    jest.useRealTimers();
  });

  test('explicit clear cancels a pending error auto-clear', () => {
    jest.useFakeTimers();
    const win = makeWin();
    setTaskbarError(win);
    clearTaskbarProgress(win);
    jest.advanceTimersByTime(6000);
    expect(win.setProgressBar.mock.calls.filter(c => c[0] === -1)).toHaveLength(1);
    jest.useRealTimers();
  });
});
