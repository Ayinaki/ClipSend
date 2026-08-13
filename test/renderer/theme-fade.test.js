/**
 * @jest-environment jsdom
 *
 * Tests for the theme "fade" transition (renderer/utils/theme-fade.js): the
 * wash in the outgoing theme's color, its fade-out, cleanup, and the
 * reduced-motion / empty-color guards.
 */
const { fadeTheme, hasActiveFade } = require('../../renderer/utils/theme-fade.js');

describe('theme fade', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.matchMedia;
  });

  test('creates a wash layer in the outgoing color', () => {
    fadeTheme('rgb(13, 13, 13)');
    const layer = document.querySelector('.cs-theme-fade');
    expect(layer).not.toBeNull();
    expect(layer.style.getPropertyValue('--fade-color')).toBe('rgb(13, 13, 13)');
    expect(hasActiveFade()).toBe(true);
  });

  test('adds the fading class after the double-rAF paint frame', async () => {
    fadeTheme('#0d0d0d');
    const layer = document.querySelector('.cs-theme-fade');
    expect(layer.classList.contains('fading')).toBe(false);
    // The class lands after two rAF ticks (or the setTimeout fallback). Don't
    // bet on wall-clock timing — CI runners can stretch a fixed wait past the
    // frame, so poll until it appears (normally resolves in ~2 frames).
    const deadline = Date.now() + 2000;
    while (!layer.classList.contains('fading') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(layer.classList.contains('fading')).toBe(true);
  });

  test('removes the wash when the fade transition finishes', () => {
    fadeTheme('#0d0d0d');
    const layer = document.querySelector('.cs-theme-fade');
    layer.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.cs-theme-fade')).toBeNull();
    expect(hasActiveFade()).toBe(false);
  });

  test('a second fade replaces the first wash instead of stacking', () => {
    fadeTheme('#0d0d0d');
    const first = document.querySelector('.cs-theme-fade');
    fadeTheme('#ececec');
    const second = document.querySelector('.cs-theme-fade');
    expect(first).not.toBe(second);
    expect(document.querySelectorAll('.cs-theme-fade').length).toBe(1);
    expect(second.style.getPropertyValue('--fade-color')).toBe('#ececec');
  });

  test('no-op for an empty color', () => {
    fadeTheme('');
    expect(document.querySelector('.cs-theme-fade')).toBeNull();
  });

  test('skips the wash entirely when the OS requests reduced motion', () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    fadeTheme('#0d0d0d');
    expect(document.querySelector('.cs-theme-fade')).toBeNull();
  });

  test('proceeds when matchMedia is unavailable', () => {
    fadeTheme('#0d0d0d');
    expect(document.querySelector('.cs-theme-fade')).not.toBeNull();
  });
});
