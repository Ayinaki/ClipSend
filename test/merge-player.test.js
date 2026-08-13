/**
 * @jest-environment jsdom
 *
 * Unit tests for MergePlayer's click-to-seek mapping (globalSecondsForClientX)
 * and the autoplay-aware seekToGlobal. The mapping is what makes clicking a
 * clip block in the merge timeline land on the exact position clicked — the
 * same geometry the scrubber bar uses, so both surfaces agree.
 */
const { MergePlayer } = require('../renderer/merge-player.js');

function makeFakeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'canvas') return target.canvas;
      if (typeof prop === 'string' && !(prop in target)) target[prop] = () => {};
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function setupDom() {
  document.body.innerHTML = `
    <div id="merge-timeline-strip"></div>
    <div class="merge-scrubber-area"><canvas id="merge-scrubber-canvas"></canvas></div>
    <div id="merge-timecode"></div>
    <video id="merge-video"></video>
    <video id="merge-preload-video"></video>
  `;
  window.HTMLCanvasElement.prototype.getContext = () => makeFakeCtx();
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  }
  const player = new MergePlayer({
    videoElement: document.getElementById('merge-video'),
    preloadElement: document.getElementById('merge-preload-video'),
    scrubberCanvas: document.getElementById('merge-scrubber-canvas'),
    timecodeDisplay: document.getElementById('merge-timecode'),
    onPlayStateChange: () => {},
    onClipChange: () => {}
  });
  return player;
}

/**
 * Populate the player and create the clip-block DOM that app.js would build,
 * with simulated layout geometry (jsdom has none): strip at origin with 12px
 * padding-left, 200px blocks and a 6px gap.
 */
function addBlocks(player, durations, trims = []) {
  const strip = document.getElementById('merge-timeline-strip');
  const clips = durations.map((dur, i) => ({
    filePath: `C:\\clip-${i}.mp4`,
    mediaInfo: { duration: dur },
    trimIn: trims[i] ? trims[i][0] : 0,
    trimOut: trims[i] ? trims[i][1] : dur
  }));
  player.setClips(clips);

  strip.querySelectorAll('.merge-timeline-block').forEach(b => b.remove());
  clips.forEach((clip, i) => {
    const block = document.createElement('div');
    block.className = 'merge-timeline-block';
    strip.appendChild(block);
    Object.defineProperty(block, 'offsetLeft', { value: 12 + i * 206, configurable: true });
    Object.defineProperty(block, 'offsetWidth', { value: 200, configurable: true });
  });
  Object.defineProperty(strip, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 430, bottom: 60, width: 430, height: 60 }),
    configurable: true
  });
  Object.defineProperty(strip, 'scrollLeft', { value: 0, configurable: true });
  Object.defineProperty(strip, 'scrollWidth', { value: 430, configurable: true });
  Object.defineProperty(strip, 'clientWidth', { value: 430, configurable: true });
  return { strip, clips };
}

describe('MergePlayer.globalSecondsForClientX', () => {
  let player;

  beforeEach(() => {
    document.body.innerHTML = '';
    player = setupDom();
  });

  test('maps clicks inside an untrimmed clip proportionally', () => {
    addBlocks(player, [60, 30]);
    // Block 0 (60s) at 25% -> global 15s; block 1 (30s) at 50% -> 60 + 15.
    expect(player.globalSecondsForClientX(12 + 50)).toBeCloseTo(15, 5);
    expect(player.globalSecondsForClientX(218 + 100)).toBeCloseTo(75, 5);
  });

  test('snaps clicks over trimmed-away regions to the nearest kept edge', () => {
    addBlocks(player, [60, 60], [null, [15, 45]]);
    // Clip 1 keeps [15,45] of its 60s source: canvas-x kept window is
    // [256, 356] (offsetLeft 218 - 12 + fractions of 200px).
    // Left dim -> kept start (global 60).
    expect(player.globalSecondsForClientX(206 + 25 + 12)).toBeCloseTo(60, 5);
    // Right dim (also the sequence end) -> kept end (global 90).
    expect(player.globalSecondsForClientX(356 + 25 + 12)).toBeCloseTo(90, 5);
    // Inside the kept window at 50% -> 60 + 0.5 * (45-15) = 75.
    expect(player.globalSecondsForClientX(256 + 50 + 12)).toBeCloseTo(75, 5);
  });

  test('clamps clicks before the first block and after the last', () => {
    addBlocks(player, [60, 30]);
    expect(player.globalSecondsForClientX(0)).toBe(0);
    expect(player.globalSecondsForClientX(430)).toBe(90);
  });

  test('falls back to proportional mapping when block geometry is absent', () => {
    const { strip } = addBlocks(player, [60, 30]);
    strip.innerHTML = ''; // no blocks -> _getVisualBoundaries returns null
    const got = player.globalSecondsForClientX(215);
    expect(got).toBeCloseTo(((215 - 12) / 430) * 90, 5);
  });

  test('returns 0 with no clips', () => {
    expect(player.globalSecondsForClientX(100)).toBe(0);
  });
});

describe('MergePlayer.seekToGlobal autoplay passthrough', () => {
  test('forwards the optional autoplay flag to the internal seeker', () => {
    const player = setupDom();
    addBlocks(player, [60]);
    const spy = jest.spyOn(player, '_seekToGlobalInternal').mockImplementation(() => {});
    player.seekToGlobal(30);
    expect(spy).toHaveBeenCalledWith(30, false);
    player.seekToGlobal(30, true);
    expect(spy).toHaveBeenCalledWith(30, true);
    spy.mockRestore();
  });
});

describe('MergePlayer theme awareness', () => {
  test('resolves light/dark scrubber colors from the document theme', () => {
    const player = setupDom();
    expect(player._themeColor('bg')).toBe('#1a1a1a');
    expect(player._themeColor('boundary')).toBe('rgba(255,255,255,0.3)');

    document.documentElement.dataset.theme = 'light';
    expect(player._themeColor('bg')).toBe('#dcdcdc');
    expect(player._themeColor('playhead')).toBe('#1a1a1a');
    expect(player._themeColor('boundary')).toBe('rgba(0,0,0,0.35)');

    document.documentElement.dataset.theme = '';
  });

  test('redraws on theme change and stops listening after destroy', () => {
    const player = setupDom();
    const spy = jest.spyOn(player, '_drawScrubber');

    document.documentElement.dataset.theme = 'light';
    document.dispatchEvent(new window.Event('themechange'));
    expect(spy).toHaveBeenCalledTimes(1);

    player.destroy();
    spy.mockClear();
    document.dispatchEvent(new window.Event('themechange'));
    expect(spy).not.toHaveBeenCalled();

    document.documentElement.dataset.theme = '';
  });
});
