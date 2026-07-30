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
const CANVAS_HEIGHT = HANDLE_HEIGHT + TRACK_HEIGHT + HANDLE_HEIGHT;
const HANDLE_WIDTH = 10;      // horizontal grab area for each handle
const PLAYHEAD_WIDTH = 2;

// --- Colours ---
const COL_BG           = '#1a1a1a';
const COL_TRACK        = '#222222';
const COL_DIMMED       = 'rgba(0, 0, 0, 0.70)';
const COL_PLAYHEAD     = '#ffffff';
const COL_PALETTE      = ['#FF9800', '#00E5FF', '#F50057', '#FFEA00', '#D500F9', '#76FF03']; // Orange, Cyan, Pink, Yellow, Purple, Light Green

// --- Hit-test tolerance (px either side of handle edge) ---
const GRAB_TOLERANCE = 8;
const MIN_TRIM_SECONDS = 0.5;
const TRASH_ICON_SIZE = 16;

export class Timeline {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} callbacks
   * @param {function(number)} callbacks.onSeek        — user clicked/dragged playhead
   * @param {function(segments, activeId)} callbacks.onSegmentChange — trim boundary changed
   */
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;

    // State
    this.duration = 0;
    this.playhead = 0;    // seconds
    
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

    this._setupSize();
    this._bindEvents();
    this._draw();
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
    this._emitSegments();
    this._draw();
  }

  /** Call on every timeupdate from the video element. */
  setPlayhead(seconds) {
    this.playhead = seconds;
    this._scheduleRedraw();
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

  _emitSegments() {
    if (this.callbacks.onSegmentChange) {
      this.callbacks.onSegmentChange(this.getSegments(), this.activeSegmentId);
    }
  }

  // -----------------------------------------------------------------------
  // Coordinate math
  // -----------------------------------------------------------------------

  /** Usable drawing width (excludes handle gutters on each side). */
  get _trackLeft()  { return HANDLE_WIDTH; }
  get _trackRight() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 300;
    return width - HANDLE_WIDTH;
  }
  get _trackWidth() { return Math.max(1, this._trackRight - this._trackLeft); }

  _secondsToX(seconds) {
    if (this.duration <= 0) return this._trackLeft;
    const ratio = seconds / this.duration;
    return this._trackLeft + ratio * this._trackWidth;
  }

  _xToSeconds(x) {
    if (this._trackWidth <= 0) return 0;
    const ratio = (x - this._trackLeft) / this._trackWidth;
    return Math.max(0, Math.min(this.duration, ratio * this.duration));
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
      const rect = this.canvas.getBoundingClientRect();
      const cssWidth = rect.width || 300;
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

  _draw() {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const W = rect.width || 300;
    const H = CANVAS_HEIGHT;

    // Background
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, H);

    if (this.duration <= 0) return;

    const trackY = HANDLE_HEIGHT;

    // --- Track bar (full width, muted) ---
    ctx.fillStyle = COL_TRACK;
    ctx.fillRect(this._trackLeft, trackY, this._trackWidth, TRACK_HEIGHT);

    // --- Waveform Overlay (background) ---
    if (this.showWaveform && this.waveformPeaks && this.waveformPeaks.length > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; 
      const peaks = this.waveformPeaks;
      const step = this._trackWidth / peaks.length;
      const midY = trackY + (TRACK_HEIGHT / 2);
      const maxHeight = (TRACK_HEIGHT / 2) - 1;

      for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i];
        if (p > 0.01) {
          const px = this._trackLeft + i * step;
          const pw = Math.max(1, step);
          const ph = p * maxHeight;
          ctx.fillRect(px, midY - ph, pw, ph * 2);
        }
      }
    }

    // --- Draw Segments ---
    // First draw dimmed background over everything
    ctx.fillStyle = COL_DIMMED;
    ctx.fillRect(this._trackLeft, trackY, this._trackWidth, TRACK_HEIGHT);

    for (const seg of this.segments) {
      const inX = this._secondsToX(seg.in);
      const outX = this._secondsToX(seg.out);
      const isActive = seg.id === this.activeSegmentId;

      // Un-dim the trimmed region by redrawing it with the segment color (semi-transparent)
      // or bright if active
      ctx.fillStyle = isActive ? seg.color : this._adjustColor(seg.color, 0.6);
      ctx.fillRect(inX, trackY, outX - inX, TRACK_HEIGHT);
      
      // Waveform for this segment in bright white
      if (this.showWaveform && this.waveformPeaks && this.waveformPeaks.length > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        const peaks = this.waveformPeaks;
        const step = this._trackWidth / peaks.length;
        const midY = trackY + (TRACK_HEIGHT / 2);
        const maxHeight = (TRACK_HEIGHT / 2) - 1;

        const startIdx = Math.max(0, Math.floor((inX - this._trackLeft) / step));
        const endIdx = Math.min(peaks.length - 1, Math.ceil((outX - this._trackLeft) / step));

        for (let i = startIdx; i <= endIdx; i++) {
          const p = peaks[i];
          if (p > 0.01) {
            const px = this._trackLeft + i * step;
            if (px >= inX && px <= outX) {
              const pw = Math.max(1, step);
              const ph = p * maxHeight;
              ctx.fillRect(px, midY - ph, pw, ph * 2);
            }
          }
        }
      }

      // Draw Handles
      this._drawHandle(ctx, inX, seg.color, 'in', isActive);
      this._drawHandle(ctx, outX, seg.color, 'out', isActive);

      // Draw Trash Icon (if multi-trim and more than 1 segment)
      if (this.isMultiTrim && this.segments.length > 1) {
        this._drawTrashIcon(ctx, inX, outX, seg.color);
      }
    }

    // --- Playhead ---
    const playheadX = this._secondsToX(this.playhead);
    ctx.fillStyle = COL_PLAYHEAD;
    ctx.fillRect(playheadX - PLAYHEAD_WIDTH / 2, 0, PLAYHEAD_WIDTH, H);
  }

  _adjustColor(color, alpha) {
    // Basic hex to rgba converter for #RRGGBB
    let r = parseInt(color.slice(1, 3), 16);
    let g = parseInt(color.slice(3, 5), 16);
    let b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  _drawHandle(ctx, x, colour, type, isActive) {
    ctx.fillStyle = colour;
    if (!isActive) ctx.globalAlpha = 0.7;

    const topY = 0;
    const botY = HANDLE_HEIGHT + TRACK_HEIGHT;

    if (type === 'in') {
      ctx.fillRect(x - 2, topY, 3, CANVAS_HEIGHT);
      ctx.fillRect(x - 2, topY, HANDLE_WIDTH, 3);
      ctx.fillRect(x - 2, botY + HANDLE_HEIGHT - 3, HANDLE_WIDTH, 3);
    } else {
      ctx.fillRect(x - 1, topY, 3, CANVAS_HEIGHT);
      ctx.fillRect(x - HANDLE_WIDTH + 2, topY, HANDLE_WIDTH, 3);
      ctx.fillRect(x - HANDLE_WIDTH + 2, botY + HANDLE_HEIGHT - 3, HANDLE_WIDTH, 3);
    }
    
    ctx.globalAlpha = 1.0;
  }

  _drawTrashIcon(ctx, inX, outX, color) {
    // Draw in the middle of the segment, horizontally centered
    const centerX = inX + (outX - inX) / 2;
    const y = CANVAS_HEIGHT / 2;

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
        const iconY = CANVAS_HEIGHT / 2;
        
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
      if (hit.type === 'in' || hit.type === 'out') {
        this.canvas.style.cursor = 'ew-resize';
      } else if (hit.type === 'trash') {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'default';
      }
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
    }
  }

  _onMouseUp() {
    this._dragging = null;
  }
}
