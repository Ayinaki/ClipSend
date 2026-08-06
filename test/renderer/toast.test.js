/**
 * @jest-environment jsdom
 *
 * Tests for the toast notification helper.
 */
const { toast, clearToasts } = require('../../renderer/utils/toast.js');

describe('toast notifications', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearToasts();
  });

  test('creates a toast element with the message and info class', () => {
    toast('Hello world');
    const el = document.querySelector('.toast');
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('Hello world');
    expect(el.classList.contains('toast-info')).toBe(true);
  });

  test('success and error types set the matching class', () => {
    toast('Done', 'success');
    toast('Failed', 'error');
    expect(document.querySelectorAll('.toast-success')).toHaveLength(1);
    expect(document.querySelectorAll('.toast-error')).toHaveLength(1);
  });

  test('reuses a single container that holds multiple toasts', () => {
    toast('a');
    toast('b');
    const container = document.querySelector('.toast-container');
    expect(container).not.toBeNull();
    expect(container.querySelectorAll('.toast')).toHaveLength(2);
    expect(container.getAttribute('aria-live')).toBe('polite');
  });

  test('clearToasts removes every toast', () => {
    toast('a');
    toast('b');
    clearToasts();
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });

  test('auto-dismisses after the display duration', () => {
    jest.useFakeTimers();
    toast('Soon gone');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);

    // Display duration elapsed -> toast begins its exit transition
    jest.runOnlyPendingTimers();
    const el = document.querySelector('.toast');
    expect(el.classList.contains('toast-leaving')).toBe(true);

    // Exit animation elapsed -> element is removed
    jest.runOnlyPendingTimers();
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
    jest.useRealTimers();
  });
});
