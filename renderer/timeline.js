/**
 * Timeline — canvas-based timeline with playhead and draggable in/out trim handles.
 *
 * Layout (vertical pixel zones within the canvas):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  Handle zone (top)  — in/out bracket caps   │  HANDLE_HEIGHT
 *   ├─────────────────────────────────────────────┤
 *   │  Track zone         — filled bar + trim     │  TRACK_HEIGHT
 *   ├─────────────────────────────────────────────┤
 *   │  Handle zone (bot)  — in/out bracket caps   │  HANDLE_HEIGHT
 *   └─────────────────────────────────────────────┘
 *
 *   A thin playhead line spans the full height of the canvas.
 *   The trimmed region is visually highlighted; areas outside are dimmed.
 */

// --- Layout constants (px) ---
const HANDLE_HEIGHT = 14;
const TRACK_HEIGHT = 28;
const RULER_HEIGHT = 20;
const CANVAS_HEIGHT = HANDLE_HEIGHT + TRACK_HEIGHT + HANDLE_HEIGHT + RULER_HEIGHT;
// Interactive body (handle zones + track); the time ruler sits below it.
const BODY_HEIGHT = HANDLE_HEIGHT + TRACK_HEIGHT + HANDLE_HEIGHT;
const HANDLE_WIDTH = 10;      // horizontal grab area for each handle
const PLAYHEAD_WIDTH = 2;

// --- Colours ---
// Dark/light pairs: the canvas flips with the app theme (read from
// <html data-theme>) so it doesn't read as a dark hole inside the light-mode
// chrome. The dark set is the pre-theme app palette; the light set keeps the
// same structure (dark dim overlay, teal kept segments) on light surfaces.
const COL_DARK = {
  bg:             '#1a1a1a',
  track:          '#222222',
  dimmed:         'rgba(0, 0, 0, 0.70)',
  playhead:       '#ffffff',
  playheadGlow:   'rgba(255, 255, 255, 0.18)',
  waveformDim:    'rgba(255, 255, 255, 0.2)',
  waveformBright: 'rgba(255, 255, 255, 0.8)',
  keptOutline:    'rgba(255, 255, 255, 0.85)',
  gridLine:       'rgba(255, 255, 255, 0.05)',
  rulerTickMajor: '#5a5a5a',
  rulerTickMinor: '#3c3c3c',
  rulerLabel:     '#777',
  currentTime:    '#ffffff'
};
const COL_LIGHT = {
  bg:             '#ececec',
  track:          '#d6d6d6',
  dimmed:         'rgba(0, 0, 0, 0.45)',
  playhead:       '#1a1a1a',
  playheadGlow:   'rgba(0, 0, 0, 0.12)',
  waveformDim:    'rgba(0, 0, 0, 0.22)',
  waveformBright: 'rgba(0, 0, 0, 0.75)',
  keptOutline:    'rgba(0, 0, 0, 0.85)',
  gridLine:       'rgba(0, 0, 0, 0.08)',
  rulerTickMajor: '#9a9a9a',
  rulerTickMinor: '#b8b8b8',
  rulerLabel:     '#888',
  currentTime:    '#1a1a1a'
};
// Single-hue teal ramp (matches the app accent) so multi-trim segments stay
// distinguishable without introducing rainbow neon accents. Stored segment
// colors are the dark hexes; the light map swaps them for deeper teals at
// draw time so they stay legible on a light track.
const COL_PALETTE = ['#2ba87e', '#8fe0bf', '#1d8f6b', '#c4f2e0', '#0f6e54'];
const COL_PALETTE_LIGHT = {
  '#2ba87e': '#1d8f6b',
  '#8fe0bf': '#2ba87e',
  '#1d8f6b': '#0f6e54',
  '#c4f2e0': '#3aa67f',
  '#0f6e54': '#0a5a44'
};

// --- Hit-test tolerance (px either side of handle edge) ---
const GRAB_TOLERANCE = 8;
const MIN_TRIM_SECONDS = 0.5;
const TRASH_ICON_SIZE = 16;

// --- Zoom ---
const MAX_ZOOM = 64; // 64x = full clip squeezed into a 1/64-wide window

export class Timeline {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} callbacks
   * @param {function(number)} callbacks.onSeek        — user clicked/dragged playhead
   * @param {function(segments, activeId)} callbacks.onSegmentChange — trim boundary changed
   * @param {function()} callbacks.onBeforeEdit — called before a mutating gesture (handle drag / trash)
   */
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;

    // State
    this.duration = 0;
    this.playhead = 0;    // seconds

    // Zoom / view state. zoom=1 shows the whole clip; higher zooms narrow the
    // visible window (_viewStart .. _viewStart+_viewSpan in seconds).
    this.zoom = 1;
    this._viewStart = 0;
    this._viewSpan = 0;
    
    // Multi-segment state
    this.segments = []; // Array of { id, in, out, color }
    this.activeSegmentId = null;
    this.nextSegmentId = 1;
    this.isMultiTrim = false;

    // Interaction state
    this._dragging = null;  // null | 'playhead' | { type: 'in'/'out', id } 
    this._animFrame = null;

    // Waveform state
    this.waveformPeaks = null;
    this.showWaveform = true;

    // Overlay state
    this.isPlaying = false;
    this._hoverHandle = null;   // { type, id } — trim handle currently hovered
    this._stripePattern = null;

    this._setupSize();
    this._bindEvents();
    this._draw();

    // Redraw when the app theme flips (light <-> dark changes canvas colors)
    // or the accessibility font changes (text is drawn in the new face).
    this._onThemeChange = () => this._scheduleRedraw();
    document.addEventListener('themechange', this._onThemeChange);
    document.addEventListener('fontchange', this._onThemeChange);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  setMultiTrim(enabled) {
    this.isMultiTrim = enabled;
    if (!enabled && this.segments.length > 1) {
      // Revert to single segment
      const first = this.segments[0];
      this.segments = [first];
      this.activeSegmentId = first.id;
      this._emitSegments();
      this._draw();
    }
  }

  /** Call once when media duration is known. */
  setDuration(duration) {
    this.duration = duration;
    this.segments = [{
      id: this.nextSegmentId++,
      in: 0,
      out: duration,
      color: COL_PALETTE[0]
    }];
    this.activeSegmentId = this.segments[0].id;
    this.playhead = 0;
    // New clip: reset zoom back to the full view.
    this.zoom = 1;
    this._viewStart = 0;
    this._viewSpan = duration;
    this._emitZoom();
    this._emitSegments();
    this._draw();
  }

  /** Call on every timeupdate from the video element. */
  setPlayhead(seconds) {
    this.playhead = seconds;
    // When zoomed in, keep the playhead in view during playback.
    if (this.isPlaying) this._ensurePlayheadVisible();
    this._scheduleRedraw();
  }

  /** Zoom to a factor (1 = full clip). Anchors on anchorSeconds (default: playhead). */
  setZoom(zoom, anchorSeconds) {
    if (this.duration <= 0) return;
    const newZoom = Math.max(1, Math.min(MAX_ZOOM, zoom));
    const span = this.duration / newZoom;
    if (anchorSeconds == null) anchorSeconds = this.playhead;
    const curSpan = this._viewSpan > 0 ? this._viewSpan : this.duration;
    const curStart = curSpan >= this.duration ? 0 : this._viewStart;
    const ratio = curSpan > 0 ? (anchorSeconds - curStart) / curSpan : 0.5;
    let vs = anchorSeconds - ratio * span;
    vs = Math.max(0, Math.min(Math.max(0, this.duration - span), vs));
    this.zoom = newZoom;
    this._viewStart = vs;
    this._viewSpan = span;
    this._emitZoom();
    this._draw();
  }

  /** Multiply the current zoom by a factor (convenience for +/- buttons). */
  zoomBy(factor, anchorSeconds) {
    this.setZoom((this.zoom || 1) * factor, anchorSeconds);
  }

  /** Reset zoom to the full-clip view. */
  resetView() {
    if (this.duration <= 0) return;
    this.zoom = 1;
    this._viewStart = 0;
    this._viewSpan = this.duration;
    this._emitZoom();
    this._draw();
  }

  _emitZoom() {
    if (this.callbacks.onZoomChange) {
      this.callbacks.onZoomChange(Math.round((this.zoom || 1) * 100));
    }
  }

  /** When zoomed, pan the view so the playhead stays visible during playback. */
  _ensurePlayheadVisible() {
    if (this.duration <= 0 || this.zoom <= 1 || !this._viewSpan) return;
    const margin = this._viewSpan * 0.1;
    if (this.playhead < this._viewStart + margin || this.playhead > this._viewStart + this._viewSpan - margin) {
      this._viewStart = Math.max(0, Math.min(this.duration - this._viewSpan, this.playhead - this._viewSpan / 2));
      this._scheduleRedraw();
    }
  }

  getActiveSegment() {
    return this.segments.find(s => s.id === this.activeSegmentId) || this.segments[0];
  }

  /** Programmatically set the in-point (e.g. from timecode entry). */
  setTrimIn(seconds) {
    const active = this.getActiveSegment();
    if (!active) return;
    
    if (this.isMultiTrim && (seconds < active.in || seconds > active.out)) {
      // Check if we should create a new segment
      const inEmptySpace = !this.segments.some(s => seconds >= s.in && seconds <= s.out);
      if (inEmptySpace) {
        // Create new segment
        const newColor = COL_PALETTE[this.segments.length % COL_PALETTE.length];
        const newSeg = {
          id: this.nextSegmentId++,
          in: seconds,
          out: this._clampNewSegmentOut(seconds),
          color: newColor
        };
        this.segments.push(newSeg);
        this.segments.sort((a, b) => a.in - b.in);
        this.activeSegmentId = newSeg.id;
        this._emitSegments();
        this._draw();
        return;
      }
    }
    
    active.in = this._clampIn(active.id, seconds);
    this._emitSegments();
    this._draw();
  }

  /** Programmatically set the out-point. */
  setTrimOut(seconds) {
    const active = this.getActiveSegment();
    if (!active) return;
    active.out = this._clampOut(active.id, seconds);
    this._emitSegments();
    this._draw();
  }

  getSegments() {
    return this.segments.map(s => ({ ...s }));
  }

  // Backwards compatibility for single-segment logic in app.js if needed
  getTrimIn()  { return this.getActiveSegment()?.in || 0; }
  getTrimOut() { return this.getActiveSegment()?.out || this.duration; }
  getTrimDuration() { 
    return this.segments.reduce((total, s) => total + (s.out - s.in), 0);
  }

  setWaveformData(peaks) {
    this.waveformPeaks = peaks;
    this._draw();
  }

  setShowWaveform(show) {
    this.showWaveform = show;
    this._draw();
  }

  /** Collapse all segments back to a single full-range trim (Reset). */
  resetAll() {
    this.segments = [{
      id: this.nextSegmentId++,
      in: 0,
      out: this.duration,
      color: COL_PALETTE[0]
    }];
    this.activeSegmentId = this.segments[0].id;
    this._emitSegments();
    this._draw();
  }

  /**
   * Replace the full edit state from an undo/redo snapshot (see
   * app.js captureTrimState). Emits exactly once so consumers re-render
   * without flooding listeners, and mirrors setMultiTrim's collapse rule
   * when multi-trim is off with multiple segments.
   *
   * @param {object} state - { segments, activeSegmentId, multiTrim }
   */
  restoreState(state) {
    if (!state) return;
    if (Array.isArray(state.segments) && state.segments.length > 0) {
      this.segments = state.segments.map(s => ({ ...s }));
      const maxId = this.segments.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
      this.nextSegmentId = maxId + 1;
    }
    if (state.activeSegmentId != null && this.segments.some(s => s.id === state.activeSegmentId)) {
      this.activeSegmentId = state.activeSegmentId;
    } else if (this.segments.length > 0) {
      this.activeSegmentId = this.segments[0].id;
    }
    if (typeof state.multiTrim === 'boolean') {
      this.isMultiTrim = state.multiTrim;
      if (!this.isMultiTrim && this.segments.length > 1) {
        this.segments = [this.segments[0]];
      }
    }
    this._emitSegments();
    this._draw();
  }

  /** Let the timeline know the video is playing (shows the playhead time bubble). */
  setPlaying(playing) {
    this.isPlaying = playing;
    this._scheduleRedraw();
  }

  _emitSegments() {
    if (this.callbacks.onSegmentChange) {
      this.callbacks.onSegmentChange(this.getSegments(), this.activeSegmentId);
    }
  }

  _updateDimensions() {
    // Measure the PARENT container, not the canvas: the canvas has an inline
    // pixel width (set in _setupSize) that overrides its CSS width:100%, so
    // reading the canvas rect would freeze the timeline at its load-time width
    // forever, even when the window is resized.
    const parent = this.canvas.parentElement;
    const parentW = parent ? parent.clientWidth : 0;
    const rectW = this.canvas.getBoundingClientRect().width;
    this._cssWidth = parentW || rectW || 300;
    this._trackLeftVal = HANDLE_WIDTH;
    this._trackRightVal = Math.max(HANDLE_WIDTH + 1, this._cssWidth - HANDLE_WIDTH);
    this._trackWidthVal = Math.max(1, this._trackRightVal - this._trackLeftVal);
  }

  /** Usable drawing width (excludes handle gutters on each side). */
  get _trackLeft()  { return this._trackLeftVal || HANDLE_WIDTH; }
  get _trackRight() { return this._trackRightVal || (300 - HANDLE_WIDTH); }
  get _trackWidth() { return this._trackWidthVal || (300 - 2 * HANDLE_WIDTH); }

  _secondsToX(seconds) {
    if (this.duration <= 0) return this._trackLeft;
    const span = this._viewSpan > 0 ? this._viewSpan : this.duration;
    const start = this._viewSpan > 0 ? this._viewStart : 0;
    const ratio = (seconds - start) / span;
    return this._trackLeft + ratio * this._trackWidth;
  }

  _xToSeconds(x) {
    if (this._trackWidth <= 0) return 0;
    const span = this._viewSpan > 0 ? this._viewSpan : this.duration;
    const start = this._viewSpan > 0 ? this._viewStart : 0;
    const ratio = (x - this._trackLeft) / this._trackWidth;
    return Math.max(0, Math.min(this.duration, start + ratio * span));
  }

  // -----------------------------------------------------------------------
  // Clamping
  // -----------------------------------------------------------------------

  _clampIn(id, seconds) {
    const seg = this.getSegment(id);
    let minIn = 0;
    
    // Find segment immediately before this one
    const prevSegments = this.segments.filter(s => s.id !== id && s.out <= seg.in);
    if (prevSegments.length > 0) {
      const prev = prevSegments.reduce((p, c) => c.out > p.out ? c : p);
      minIn = prev.out;
    }
    
    return Math.max(minIn, Math.min(seconds, seg.out - MIN_TRIM_SECONDS));
  }

  _clampOut(id, seconds) {
    const seg = this.getSegment(id);
    let maxOut = this.duration;
    
    // Find segment immediately after this one
    const nextSegments = this.segments.filter(s => s.id !== id && s.in >= seg.out);
    if (nextSegments.length > 0) {
      const next = nextSegments.reduce((p, c) => c.in < p.in ? c : p);
      maxOut = next.in;
    }
    
    return Math.min(maxOut, Math.max(seconds, seg.in + MIN_TRIM_SECONDS));
  }

  _clampNewSegmentOut(inSeconds) {
    let maxOut = this.duration;
    const nextSegments = this.segments.filter(s => s.in > inSeconds);
    if (nextSegments.length > 0) {
      const next = nextSegments.reduce((p, c) => c.in < p.in ? c : p);
      maxOut = next.in;
    }
    // Default new segment duration to 5 seconds or up to the next segment
    return Math.min(inSeconds + 5, maxOut);
  }

  getSegment(id) {
    return this.segments.find(s => s.id === id);
  }

  // -----------------------------------------------------------------------
  // Sizing
  // -----------------------------------------------------------------------

  _setupSize() {
    let resizeTimeout = null;
    const resize = () => {
      this._updateDimensions();
      const cssWidth = this._cssWidth;
      const dpr = window.devicePixelRatio || 1;
      
      this.canvas.width = cssWidth * dpr;
      this.canvas.height = CANVAS_HEIGHT * dpr;
      this.canvas.style.width = cssWidth + 'px';
      this.canvas.style.height = CANVAS_HEIGHT + 'px';
      
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._scheduleRedraw();
    };

    resize();
    window.addEventListener('resize', () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resize, 50);
    });
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  _scheduleRedraw() {
    if (this._animFrame) return;
    this._animFrame = requestAnimationFrame(() => {
      this._animFrame = null;
      this._draw();
    });
  }

  /** True when the app is in light theme (the canvas flips with it). */
  _isLight() {
    return document.documentElement.dataset.theme === 'light';
  }

  /** Theme-resolved color for a COL_DARK/COL_LIGHT key (dark is the fallback). */
  _themeColor(key) {
    const set = this._isLight() ? COL_LIGHT : COL_DARK;
    return set[key] || COL_DARK[key];
  }

  /** Map a stored segment color through the light palette (draw-time only). */
  _segmentColor(color) {
    if (!this._isLight()) return color;
    return COL_PALETTE_LIGHT[color] || color;
  }

  _draw() {
    this._updateDimensions();
    const ctx = this.ctx;
    const W = this._cssWidth;
    const H = CANVAS_HEIGHT;

    // Background
    ctx.fillStyle = this._themeColor('bg');
    ctx.fillRect(0, 0, W, H);

    if (this.duration <= 0) return;

    const trackY = HANDLE_HEIGHT;

    // --- Track bar (full width, muted) ---
    ctx.fillStyle = this._themeColor('track');
    ctx.fillRect(this._trackLeft, trackY, this._trackWidth, TRACK_HEIGHT);

    // --- Waveform Overlay (background, full track) ---
    this._drawWaveform(ctx, trackY, this._trackLeft, this._trackRight, this._themeColor('waveformDim'));

    // --- Dim + striped overlay covering everything outside the kept regions ---
    ctx.fillStyle = this._themeColor('dimmed');
    ctx.fillRect(this._trackLeft, trackY, this._trackWidth, TRACK_HEIGHT);
    if (!this._stripePattern) this._createStripePattern();
    if (this._stripePattern) {
      ctx.fillStyle = this._stripePattern;
      ctx.fillRect(this._trackLeft, trackY, this._trackWidth, TRACK_HEIGHT);
    }

    // --- Segments (kept regions) ---
    for (let si = 0; si < this.segments.length; si++) {
      const seg = this.segments[si];
      const inX = this._secondsToX(seg.in);
      const outX = this._secondsToX(seg.out);
      const isActive = seg.id === this.activeSegmentId;

      // Dark separation frame so the kept window pops off the dimmed track
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(inX - 2, trackY - 2, (outX - inX) + 4, TRACK_HEIGHT + 4);

      // Kept region fill (bright when active, muted otherwise). The segment
      // color is theme-mapped at draw time so stored state stays canonical.
      const segColor = this._segmentColor(seg.color);
      ctx.fillStyle = isActive ? segColor : this._adjustColor(segColor, 0.55);
      ctx.fillRect(inX, trackY, outX - inX, TRACK_HEIGHT);

      // Waveform for this segment in bright contrast
      this._drawWaveform(ctx, trackY, inX, outX, this._themeColor('waveformBright'));

      // Kept-window outline on the active segment
      if (isActive) {
        ctx.strokeStyle = this._themeColor('keptOutline');
        ctx.lineWidth = 1;
        ctx.strokeRect(inX + 0.5, trackY + 0.5, Math.max(0, (outX - inX) - 1), TRACK_HEIGHT - 1);
      }

      // Numbered chip (multi-trim only) so segments are easy to tell apart
      if (this.isMultiTrim && this.segments.length > 1) {
        this._drawSegmentChip(ctx, inX, trackY, si + 1, segColor);
      }

      // Handles
      this._drawHandle(ctx, inX, segColor, 'in', isActive, seg.id);
      this._drawHandle(ctx, outX, segColor, 'out', isActive, seg.id);

      // Trash Icon (if multi-trim and more than 1 segment)
      if (this.isMultiTrim && this.segments.length > 1) {
        this._drawTrashIcon(ctx, inX, outX, seg.color);
      }
    }

    // --- Ruler ---
    this._drawRuler(ctx, W, H);

    // --- Playhead ---
    this._drawPlayhead(ctx, W, H);
  }

  /** Draw waveform bars between x0..x1 (CSS px, already clamped to the track). */
  _drawWaveform(ctx, trackY, x0, x1, fillStyle) {
    if (!this.showWaveform || !this.waveformPeaks || this.waveformPeaks.length === 0) return;
    ctx.fillStyle = fillStyle;
    const peaks = this.waveformPeaks;
    const span = this._viewSpan > 0 ? this._viewSpan : this.duration;
    const start = this._viewSpan > 0 ? this._viewStart : 0;
    const midY = trackY + (TRACK_HEIGHT / 2);
    const maxHeight = (TRACK_HEIGHT / 2) - 1;
    const peakDur = this.duration / peaks.length;   // seconds each peak covers
    const peakPx = this._trackWidth * (peakDur / span); // px each peak spans at this zoom

    // Only visit peaks inside the visible window (zoom-aware)
    const startIdx = Math.max(0, Math.floor(start / peakDur));
    const endIdx = Math.min(peaks.length - 1, Math.ceil((start + span) / peakDur));

    for (let i = startIdx; i <= endIdx; i++) {
      const p = peaks[i];
      if (p > 0.01) {
        const px = this._secondsToX(i * peakDur);
        if (px >= x0 && px <= x1) {
          const pw = Math.max(1, peakPx);
          const ph = p * maxHeight;
          ctx.fillRect(px, midY - ph, pw, ph * 2);
        }
      }
    }
  }

  /** Diagonal stripe pattern laid over the dimmed (cut-away) regions. */
  _createStripePattern() {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 12;
    const pctx = c.getContext('2d');
    pctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    pctx.lineWidth = 4;
    pctx.beginPath();
    pctx.moveTo(-5, 17);
    pctx.lineTo(17, -5);
    pctx.stroke();
    this._stripePattern = this.ctx.createPattern(c, 'repeat');
  }

  /** Choose a "nice" ruler step so ticks land ~70px+ apart (based on the visible window). */
  _rulerStep() {
    const W = Math.max(1, this._cssWidth - 2 * HANDLE_WIDTH);
    const span = this._viewSpan > 0 ? this._viewSpan : this.duration;
    if (span <= 0) return 1;
    // Sub-second steps only appear when zoomed in far enough to fit them.
    const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    for (const s of candidates) {
      if ((s / span) * W >= 70) return s;
    }
    return 7200;
  }

  _formatRulerTime(sec, step) {
    sec = Math.max(0, sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const base = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
    // Sub-second tick spacing shows a tenths digit (rounded so a 0.25s tick
    // reads 0.3 rather than 0.2).
    return step < 1 ? `${base}.${Math.round((sec % 1) * 10)}` : base;
  }

  _drawRuler(ctx, W, H) {
    const y = H - RULER_HEIGHT;
    const span = this._viewSpan > 0 ? this._viewSpan : this.duration;
    const start = this._viewSpan > 0 ? this._viewStart : 0;
    const step = this._rulerStep();
    const stepPx = this._trackWidth > 0 ? (step / span) * this._trackWidth : 0;
    const labelEvery = stepPx >= 55 ? 1 : 2;

    ctx.font = '9px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'bottom';

    // Tick from the first step boundary at/after the visible window start.
    let tick = Math.ceil(start / step - 1e-6) * step;
    let idx = 0;
    const end = start + span + 1e-6;
    while (tick <= end) {
      const x = this._secondsToX(tick);
      const major = idx % 2 === 0;

      // Faint grid line through the whole body
      ctx.fillStyle = this._themeColor('gridLine');
      ctx.fillRect(x, 0, 1, BODY_HEIGHT);

      // Tick in the ruler
      ctx.fillStyle = major ? this._themeColor('rulerTickMajor') : this._themeColor('rulerTickMinor');
      ctx.fillRect(x, y, 1, major ? 7 : 4);

      // Time label
      if (idx % labelEvery === 0) {
        ctx.fillStyle = this._themeColor('rulerLabel');
        const tx = Math.min(x + 4, W - 26);
        ctx.fillText(this._formatRulerTime(tick, step), tx, H - 3);
      }

      tick += step;
      idx++;
    }

    // Current-time marker on the ruler
    const px = this._secondsToX(this.playhead);
    ctx.fillStyle = this._themeColor('currentTime');
    ctx.fillRect(px - 0.5, y + 1, 1, 3);
  }

  _formatPlayheadTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const d = Math.floor((sec % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${d}`;
  }

  _drawPlayhead(ctx, W, H) {
    const x = this._secondsToX(this.playhead);

    // Soft glow either side of the line
    ctx.fillStyle = this._themeColor('playheadGlow');
    ctx.fillRect(x - 3, 0, 6, BODY_HEIGHT);

    // Thin line spanning the body
    ctx.fillStyle = this._themeColor('playhead');
    ctx.fillRect(x - 1, 0, PLAYHEAD_WIDTH, BODY_HEIGHT);

    // Cap triangle at the top
    ctx.fillStyle = this._themeColor('playhead');
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 7);
    ctx.closePath();
    ctx.fill();

    // Live time bubble while playing or while dragging the playhead
    const showBubble = this.isPlaying || (this._dragging && this._dragging.type === 'playhead');
    if (!showBubble) return;

    const label = this._formatPlayheadTime(this.playhead);
    ctx.font = '10px Consolas, "Courier New", monospace';
    const tw = ctx.measureText(label).width;
    const bw = tw + 12;
    const bh = 15;
    const bx = Math.max(HANDLE_WIDTH + 2, Math.min(W - bw - HANDLE_WIDTH - 2, x - bw / 2));
    const by = 10;

    ctx.fillStyle = 'rgba(10, 10, 10, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 6, by + bh / 2 + 0.5);
  }

  /** Numbered chip drawn at the top-left of each multi-trim segment. */
  _drawSegmentChip(ctx, inX, trackY, number, color) {
    const chipW = 15;
    const chipH = 12;
    const x = inX + 3;
    const y = trackY + 3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, 3);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '9px Consolas, "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), x + chipW / 2, y + chipH / 2 + 0.5);
    ctx.textAlign = 'start';
  }

  _adjustColor(color, alpha) {
    // Basic hex to rgba converter for #RRGGBB
    let r = parseInt(color.slice(1, 3), 16);
    let g = parseInt(color.slice(3, 5), 16);
    let b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  _drawHandle(ctx, x, colour, type, isActive, id) {
    const hovered = this._hoverHandle && this._hoverHandle.type === type && this._hoverHandle.id === id;
    const drawColour = hovered ? '#ffffff' : colour;
    if (!isActive && !hovered) ctx.globalAlpha = 0.75;

    const topY = 0;
    const botY = HANDLE_HEIGHT + TRACK_HEIGHT;
    const capW = 12;
    const capH = 5;

    // Vertical grab bar across the body
    ctx.fillStyle = drawColour;
    ctx.fillRect(x - 1, topY, 2, BODY_HEIGHT);

    // Bracket caps (top + bottom), opening inward
    const capLeftIn = x - 2;
    const capLeftOut = x - capW + 2;
    if (type === 'in') {
      ctx.fillRect(capLeftIn, topY, capW, capH);
      ctx.fillRect(capLeftIn, botY + HANDLE_HEIGHT - capH, capW, capH);
    } else {
      ctx.fillRect(capLeftOut, topY, capW, capH);
      ctx.fillRect(capLeftOut, botY + HANDLE_HEIGHT - capH, capW, capH);
    }

    // Grip notches inside the caps
    const notchXs = type === 'in'
      ? [capLeftIn + 3, capLeftIn + 7]
      : [capLeftOut + 3, capLeftOut + 7];
    ctx.fillStyle = (hovered || isActive) ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.35)';
    for (const nx of notchXs) {
      ctx.fillRect(nx, topY + 1, 2, 2);
      ctx.fillRect(nx, botY + HANDLE_HEIGHT - 3, 2, 2);
    }

    ctx.globalAlpha = 1.0;
  }

  _drawTrashIcon(ctx, inX, outX, color) {
    // Draw in the middle of the segment, horizontally centered
    const centerX = inX + (outX - inX) / 2;
    const y = BODY_HEIGHT / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(centerX, y, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    // Simple trash icon drawing
    ctx.fillRect(centerX - 4, y - 5, 8, 2); // Lid
    ctx.fillRect(centerX - 2, y - 7, 4, 2); // Handle
    ctx.fillRect(centerX - 3, y - 3, 6, 8); // Body
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(centerX - 1, y - 2, 2, 6); // Detail line
  }

  // -----------------------------------------------------------------------
  // Interaction
  // -----------------------------------------------------------------------

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));
    // Ctrl+wheel zooms around the cursor; must be non-passive to preventDefault
    // (otherwise Chromium might treat it as page zoom).
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  _onWheel(e) {
    if (this.duration <= 0 || !e.ctrlKey) return;
    e.preventDefault();
    const anchor = this._xToSeconds(this._canvasX(e));
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    this.setZoom((this.zoom || 1) * factor, anchor);
  }

  _canvasX(e) {
    const rect = this.canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }
  
  _canvasY(e) {
    const rect = this.canvas.getBoundingClientRect();
    return e.clientY - rect.top;
  }

  _hitTest(x, y) {
    // 1. Check Trash Icons
    if (this.isMultiTrim && this.segments.length > 1) {
      for (const seg of this.segments) {
        const inX = this._secondsToX(seg.in);
        const outX = this._secondsToX(seg.out);
        const centerX = inX + (outX - inX) / 2;
        const iconY = BODY_HEIGHT / 2;
        
        // Distance formula for circular hit test
        const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - iconY, 2));
        if (dist <= 12) {
          return { type: 'trash', id: seg.id };
        }
      }
    }

    // 2. Check Handles
    for (const seg of this.segments) {
      const inX = this._secondsToX(seg.in);
      const outX = this._secondsToX(seg.out);
      if (Math.abs(x - inX) <= GRAB_TOLERANCE) return { type: 'in', id: seg.id };
      if (Math.abs(x - outX) <= GRAB_TOLERANCE) return { type: 'out', id: seg.id };
    }
    
    // 3. Check Segment Bodies (click to activate)
    for (const seg of this.segments) {
      const inX = this._secondsToX(seg.in);
      const outX = this._secondsToX(seg.out);
      if (x > inX && x < outX) {
        return { type: 'body', id: seg.id };
      }
    }

    return { type: 'playhead' };
  }

  _onMouseDown(e) {
    if (this.duration <= 0) return;
    const x = this._canvasX(e);
    const y = this._canvasY(e);
    const hit = this._hitTest(x, y);

    // Mutating gestures (handle drag, trash delete) announce themselves
    // BEFORE touching state so the host can snapshot for undo/redo.
    if (hit.type === 'trash' || hit.type === 'in' || hit.type === 'out') {
      if (this.callbacks.onBeforeEdit) this.callbacks.onBeforeEdit();
    }

    if (hit.type === 'trash') {
      this.segments = this.segments.filter(s => s.id !== hit.id);
      if (this.activeSegmentId === hit.id) {
        this.activeSegmentId = this.segments[0].id;
      }
      this._emitSegments();
      this._draw();
      return;
    }

    if (hit.id) {
      this.activeSegmentId = hit.id;
      this._scheduleRedraw();
    }

    // Ctrl+drag pans the view when zoomed in — but only on plain body/empty
    // hits; handles and trash keep their normal behavior even with Ctrl held.
    if (e.ctrlKey && this.zoom > 1 && hit.type !== 'in' && hit.type !== 'out') {
      this._dragging = { type: 'pan', startX: x, startViewStart: this._viewStart };
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (hit.type === 'in' || hit.type === 'out') {
      this._dragging = hit;
    } else {
      this._dragging = { type: 'playhead' };
      const seconds = this._xToSeconds(x);
      this.playhead = seconds;
      this._scheduleRedraw();
      if (this.callbacks.onSeek) this.callbacks.onSeek(seconds);
    }

    e.preventDefault();
  }

  _onMouseMove(e) {
    if (!this._dragging) {
      const x = this._canvasX(e);
      const y = this._canvasY(e);
      const hit = this._hitTest(x, y);
      // Handles win over the pan cursor so hovering still highlights them.
      if (hit.type === 'in' || hit.type === 'out') {
        this.canvas.style.cursor = 'ew-resize';
        this._hoverHandle = { type: hit.type, id: hit.id };
      } else {
        this._hoverHandle = null;
        if (e.ctrlKey && this.zoom > 1) {
          this.canvas.style.cursor = 'grab';
        } else if (hit.type === 'trash' || hit.type === 'body') {
          this.canvas.style.cursor = 'pointer';
        } else {
          this.canvas.style.cursor = 'default';
        }
      }
      this._scheduleRedraw();
      return;
    }

    const x = this._canvasX(e);
    const seconds = this._xToSeconds(x);

    switch (this._dragging.type) {
      case 'in': {
        const seg = this.getSegment(this._dragging.id);
        seg.in = this._clampIn(seg.id, seconds);
        this._scheduleRedraw();
        this._emitSegments();
        if (this.callbacks.onSeek) this.callbacks.onSeek(seg.in);
        break;
      }
      case 'out': {
        const seg = this.getSegment(this._dragging.id);
        seg.out = this._clampOut(seg.id, seconds);
        this._scheduleRedraw();
        this._emitSegments();
        if (this.callbacks.onSeek) this.callbacks.onSeek(seg.out);
        break;
      }
      case 'playhead': {
        const clamped = Math.max(0, Math.min(this.duration, seconds));
        this.playhead = clamped;
        this._scheduleRedraw();
        if (this.callbacks.onSeek) this.callbacks.onSeek(clamped);
        break;
      }
      case 'pan': {
        if (this.zoom <= 1 || !this._viewSpan) break;
        const dx = x - this._dragging.startX;
        const secPerPx = this._viewSpan / this._trackWidth;
        this._viewStart = Math.max(0, Math.min(this.duration - this._viewSpan, this._dragging.startViewStart - dx * secPerPx));
        this._draw();
        break;
      }
    }
  }

  _onMouseUp() {
    this._dragging = null;
    this._scheduleRedraw();
  }
}
