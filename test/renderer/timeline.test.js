/**
 * @jest-environment jsdom
 *
 * Unit tests for the Timeline's zoom/view mapping: zooming narrows the visible
 * window, anchors on the cursor/playhead time, clamps to the clip, and emits
 * zoom-change callbacks (driving the % readout).
 */
const { Timeline } = require('../../renderer/timeline.js');

function makeFakeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'canvas') return target.canvas;
      if (typeof prop === 'string' && !(prop in target)) {
        target[prop] = () => {};
      }
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function setup() {
  const container = document.createElement('div');
  container.style.width = '900px';
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 76 });
  container.appendChild(canvas);
  document.body.appendChild(container);

  const onZoomChange = jest.fn();
  const timeline = new Timeline(canvas, { onZoomChange });
  timeline.setDuration(240); // 4-minute clip
  return { timeline, onZoomChange };
}

describe('Timeline zoom', () => {
  beforeAll(() => {
    // jsdom has no rAF by default; Timeline's resize path schedules redraws.
    if (typeof window.requestAnimationFrame !== 'function') {
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    }
    // jsdom returns null from getContext; stub the prototype so both the
    // timeline canvas and the internal stripe-pattern canvas draw harmlessly.
    window.HTMLCanvasElement.prototype.getContext = () => makeFakeCtx();
  });

  test('starts at 100% with the whole clip mapped across the track', () => {
    const { timeline } = setup();
    expect(timeline.zoom).toBe(1);
    expect(timeline._secondsToX(0)).toBeCloseTo(timeline._trackLeft);
    expect(timeline._secondsToX(240)).toBeCloseTo(timeline._trackRight);
    expect(timeline._xToSeconds(timeline._trackLeft)).toBeCloseTo(0);
    expect(timeline._xToSeconds(timeline._trackRight)).toBeCloseTo(240);
  });

  test('zooming narrows the window and anchors on the given time', () => {
    const { timeline, onZoomChange } = setup();
    timeline.setZoom(4, 120); // 4x zoom anchored at the middle
    expect(timeline.zoom).toBe(4);
    expect(onZoomChange).toHaveBeenLastCalledWith(400);
    expect(timeline._viewSpan).toBeCloseTo(60); // 240 / 4
    // The anchor (120s) stays at the track center
    expect(timeline._secondsToX(120)).toBeCloseTo((timeline._trackLeft + timeline._trackRight) / 2);
    // Round-trip mapping is consistent
    const t = timeline._xToSeconds(timeline._trackLeft + timeline._trackWidth * 0.25);
    expect(timeline._secondsToX(t)).toBeCloseTo(timeline._trackLeft + timeline._trackWidth * 0.25, 5);
  });

  test('zoom clamps at 1x and the view never leaves the clip', () => {
    const { timeline } = setup();
    timeline.setZoom(0.5, 0); // below the floor -> clamps to 1x
    expect(timeline.zoom).toBe(1);
    timeline.setZoom(32, 239); // deep zoom anchored near the very end
    expect(timeline._viewStart).toBeGreaterThanOrEqual(0);
    expect(timeline._viewStart + timeline._viewSpan).toBeLessThanOrEqual(240);
  });

  test('resetView restores 100% and emits the readout', () => {
    const { timeline, onZoomChange } = setup();
    timeline.setZoom(8, 100);
    timeline.resetView();
    expect(timeline.zoom).toBe(1);
    expect(onZoomChange).toHaveBeenLastCalledWith(100);
  });

  test('setDuration resets zoom for a new clip', () => {
    const { timeline, onZoomChange } = setup();
    timeline.setZoom(16, 60);
    timeline.setDuration(120);
    expect(timeline.zoom).toBe(1);
    expect(timeline._viewSpan).toBeCloseTo(120);
    expect(onZoomChange).toHaveBeenLastCalledWith(100);
  });
});
