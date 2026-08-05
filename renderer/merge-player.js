/**
 * MergePlayer — Sequential multi-clip preview engine with unified scrubber.
 *
 * Owns a primary <video> element for playback, a hidden preload <video> for
 * gapless transitions, and a <canvas> for the unified timeline scrubber that
 * spans the entire merged sequence.
 */

// --- Scrubber layout constants ---
const SCRUBBER_HEIGHT = 12;
const PLAYHEAD_W = 2;

// Minimum trim length when setting in/out points (seconds)
const MIN_TRIM_SECONDS = 0.5;

// --- Scrubber colours ---
const COL_BG         = '#1a1a1a';
const COL_PROGRESS   = '#0078d7'; // app accent color
const COL_BOUNDARY   = 'rgba(255,255,255,0.3)';
const COL_PLAYHEAD   = '#ffffff';

export class MergePlayer {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.videoElement      — primary playback element
   * @param {HTMLVideoElement} opts.preloadElement     — hidden preload element
   * @param {HTMLCanvasElement} opts.scrubberCanvas    — unified scrubber canvas
   * @param {HTMLElement}       opts.timecodeDisplay   — element to show elapsed/total
   * @param {function(boolean)} opts.onPlayStateChange — called with isPlaying
   */
  constructor({ videoElement, preloadElement, scrubberCanvas, timecodeDisplay, onPlayStateChange, onClipChange }) {
    this.video = videoElement;
    this.preload = preloadElement;
    this.canvas = scrubberCanvas;
    this.ctx = scrubberCanvas.getContext('2d');
    this.timecodeEl = timecodeDisplay;
    this.onPlayStateChange = onPlayStateChange || (() => {});
    this.onClipChange = onClipChange || (() => {});

    this.volume = 0.6;
    this.muted = false;

    // Clip state
    this.clips = [];           // ordered array of clip objects
    this.boundaries = [];      // cumulative [start, end] for each clip in global seconds
    this.totalDuration = 0;
    this.currentClipIndex = 0;
    this.isPlaying = false;
    this.preloadedIndex = -1;  // index of the clip currently preloaded

    // Scrubber interaction
    this._dragging = false;
    this._animFrame = null;

    // Bind video events
    this._onTimeUpdate = this._onTimeUpdate.bind(this);
    this._onEnded = this._onEnded.bind(this);
    this._onPlay = () => { this.isPlaying = true; this.onPlayStateChange(true); };
    this._onPause = () => { this.isPlaying = false; this.onPlayStateChange(false); };

    this.video.addEventListener('timeupdate', this._onTimeUpdate);
    this.video.addEventListener('ended', this._onEnded);
    this.video.addEventListener('play', this._onPlay);
    this.video.addEventListener('pause', this._onPause);

    // Scrubber sizing and events
    this._setupScrubberSize();
    this._bindScrubberEvents();
    this._drawScrubber();
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Set or update the ordered clip list. Recalculates all boundaries.
   * Tries to preserve the current global playback position if possible.
   */
  setClips(clips) {
    const prevGlobal = this.getGlobalTime();
    const wasPlaying = this.isPlaying;

    this.clips = clips;
    this._recalcBoundaries();

    if (this.clips.length === 0) {
      this.video.removeAttribute('src');
      this.video.load();
      this.currentClipIndex = 0;
      this._updateTimecodeDisplay(0);
      this._scheduleRedraw();
      return;
    }

    // Clamp previous position to new total
    const clampedGlobal = Math.min(prevGlobal, this.totalDuration - 0.01);
    if (clampedGlobal > 0 && this.clips.length > 0) {
      this._seekToGlobalInternal(Math.max(0, clampedGlobal), wasPlaying);
    } else {
      this._loadClip(0, 0, false);
    }

    this._scheduleRedraw();
  }

  /** Get the current global elapsed time across all clips. */
  getGlobalTime() {
    if (this.clips.length === 0) return 0;
    if (this.currentClipIndex >= this.boundaries.length) return this.totalDuration;
    const boundary = this.boundaries[this.currentClipIndex];
    const bounds = this._getTrimBounds(this.currentClipIndex);
    return boundary.start + Math.max(0, (this.video.currentTime || 0) - bounds.trimIn);
  }

  /**
   * Set per-clip trim bounds. Mutates the shared clip object and recalculates
   * the sequence boundaries/redraws, preserving the current playback position
   * within the new range when possible.
   */
  setTrimForClip(index, trimIn, trimOut) {
    const clip = this.clips[index];
    if (!clip) return;
    const full = (clip.mediaInfo && clip.mediaInfo.duration) || 0;
    const tIn = Math.max(0, Math.min(typeof trimIn === 'number' ? trimIn : 0, full));
    const minDur = Math.min(MIN_TRIM_SECONDS, Math.max(0, full - tIn));
    const tOut = Math.min(full, Math.max(typeof trimOut === 'number' ? trimOut : full, tIn + minDur));
    clip.trimIn = tIn;
    clip.trimOut = tOut;
    this._recalcBoundaries();
    // Keep the current frame inside the new range
    if (this.currentClipIndex === index && this.video.src) {
      const srcTime = this.video.currentTime || 0;
      if (srcTime < tIn) this.video.currentTime = tIn;
      else if (srcTime > tOut) this.video.currentTime = Math.max(tIn, tOut);
    }
    this._scheduleRedraw();
  }

  /**
   * Get the playable source-time window [trimIn, trimOut] for a clip, in the
   * clip's own seconds. Defaults to the full clip when no trims are set.
   */
  _getTrimBounds(index) {
    const clip = this.clips[index];
    if (!clip) return { trimIn: 0, trimOut: 0 };
    const full = (clip.mediaInfo && clip.mediaInfo.duration) || 0;
    const rawIn = typeof clip.trimIn === 'number' ? clip.trimIn : 0;
    const rawOut = typeof clip.trimOut === 'number' ? clip.trimOut : full;
    return {
      trimIn: Math.max(0, Math.min(rawIn, full)),
      trimOut: Math.max(0, Math.min(rawOut, full))
    };
  }

  /** Duration a clip contributes to the merged sequence (trimmed length). */
  getClipDuration(clip) {
    if (!clip) return 0;
    const full = (clip.mediaInfo && clip.mediaInfo.duration) || 0;
    const tin = typeof clip.trimIn === 'number' ? Math.max(0, Math.min(clip.trimIn, full)) : 0;
    const tout = typeof clip.trimOut === 'number' ? Math.max(0, Math.min(clip.trimOut, full)) : full;
    return Math.max(0, tout - tin);
  }

  /** Toggle play/pause for the entire sequence. */
  togglePlay() {
    if (this.clips.length === 0) return;
    if (this.isPlaying) {
      this.video.pause();
    } else {
      // If at the very end of the last clip, restart from beginning
      if (this.currentClipIndex === this.clips.length - 1) {
        const bounds = this._getTrimBounds(this.currentClipIndex);
        if (this.video.currentTime >= bounds.trimOut - 0.1) {
          this._loadClip(0, 0, true);
          return;
        }
      }
      this.video.play();
    }
  }

  play() {
    if (this.clips.length === 0) return;
    this.video.play();
  }

  pause() {
    this.video.pause();
  }

  /** Seek to a global timestamp across the entire merged sequence. */
  seekToGlobal(globalSeconds) {
    this._seekToGlobalInternal(globalSeconds, false);
  }

  /**
   * Handle removal of a clip at the given index.
   * If it's the currently-playing clip, gracefully jump to the next available.
   */
  removeClipAtIndex(index) {
    if (index < 0 || index >= this.clips.length) return;

    const wasPlaying = this.isPlaying;
    const wasCurrentIndex = this.currentClipIndex;
    const localTime = this.video.currentTime || 0;

    if (index === wasCurrentIndex) {
      // Currently playing this clip — jump to next or previous
      this.video.pause();
      if (this.clips.length <= 1) {
        // About to become empty — handled by setClips caller
        this.currentClipIndex = 0;
        return;
      }
      if (index < this.clips.length - 1) {
        // Jump to next clip (which will shift down after splice)
        this.currentClipIndex = index; // will be the "next" clip after splice
      } else {
        // Was the last clip, jump to previous
        this.currentClipIndex = index - 1;
      }
    } else if (index < wasCurrentIndex) {
      // Shift current index down
      this.currentClipIndex = wasCurrentIndex - 1;
    }
    // Note: the actual splice from mergeClips happens in app.js
    // This method just adjusts the player's internal index
  }

  // =========================================================================
  // Internal — clip loading & transitions
  // =========================================================================

  _recalcBoundaries() {
    this.boundaries = [];
    let cumulative = 0;
    for (let i = 0; i < this.clips.length; i++) {
      const bounds = this._getTrimBounds(i);
      const dur = Math.max(0, bounds.trimOut - bounds.trimIn);
      this.boundaries.push({ start: cumulative, end: cumulative + dur });
      cumulative += dur;
    }
    this.totalDuration = cumulative;
  }

  /**
   * Load a specific clip into the video element and seek to localOffset.
   * @param {number} index      — clip index
   * @param {number} localTime  — seconds within that clip's trimmed window (0 = trimIn)
   * @param {boolean} autoplay  — whether to auto-play after loading
   */
  _loadClip(index, localTime = 0, autoplay = false) {
    if (index < 0 || index >= this.clips.length) return;

    if (this.currentClipIndex !== index) {
      this.currentClipIndex = index;
      this.onClipChange(index);
    }
    
    const clip = this.clips[index];
    const bounds = this._getTrimBounds(index);
    const sourceTime = bounds.trimIn + Math.max(0, localTime);
    const fileSrc = `file://${clip.filePath.replace(/\\/g, '/')}`;

    // Avoid reloading if already on this clip's source
    const currentSrc = this.video.src || '';
    const isSameSource = decodeURIComponent(currentSrc).replace(/\\/g, '/') ===
                         decodeURIComponent(fileSrc).replace(/\\/g, '/');

    if (isSameSource) {
      this.video.currentTime = sourceTime;
      if (autoplay) this.video.play();
      this._drawScrubber();
      return;
    }

    this.video.src = fileSrc;
    this._applyVolume();

    const onCanPlay = () => {
      this.video.removeEventListener('canplay', onCanPlay);
      this.video.currentTime = sourceTime;
      if (autoplay) this.video.play();
      this._drawScrubber();
    };
    this.video.addEventListener('canplay', onCanPlay);
    this.video.load();
  }

  /** Preload the next clip's metadata into the hidden element. */
  _preloadNext() {
    const nextIdx = this.currentClipIndex + 1;
    if (nextIdx >= this.clips.length) return;
    if (this.preloadedIndex === nextIdx) return; // already preloading

    this.preloadedIndex = nextIdx;
    const clip = this.clips[nextIdx];
    this.preload.src = `file://${clip.filePath.replace(/\\/g, '/')}`;
    this._applyVolume();
    this.preload.load();
  }

  _seekToGlobalInternal(globalSeconds, autoplay) {
    if (this.clips.length === 0) return;
    const clamped = Math.max(0, Math.min(globalSeconds, this.totalDuration - 0.001));

    // Find which clip this falls into
    let targetIndex = 0;
    for (let i = 0; i < this.boundaries.length; i++) {
      if (clamped >= this.boundaries[i].start && clamped < this.boundaries[i].end) {
        targetIndex = i;
        break;
      }
      // If past the last boundary start, it's the last clip
      if (i === this.boundaries.length - 1) {
        targetIndex = i;
      }
    }

    const localTime = clamped - this.boundaries[targetIndex].start;
    this._loadClip(targetIndex, localTime, autoplay);
    this._updateTimecodeDisplay(clamped);
  }

  // =========================================================================
  // Volume Control
  // =========================================================================

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this._applyVolume();
  }

  setMuted(m) {
    this.muted = Boolean(m);
    this._applyVolume();
  }

  _applyVolume() {
    const effectiveVolume = this.muted ? 0 : this.volume;
    if (this.video) {
      this.video.volume = effectiveVolume;
      this.video.muted = this.muted;
    }
    if (this.preload) {
      this.preload.volume = effectiveVolume;
      this.preload.muted = this.muted;
    }
  }

  // =========================================================================
  // Video event handlers
  // =========================================================================

  _onTimeUpdate() {
    const global = this.getGlobalTime();
    this._updateTimecodeDisplay(global);
    this._scheduleRedraw();

    const bounds = this._getTrimBounds(this.currentClipIndex);
    const videoDur = this.video.duration || 0;
    const currentTime = this.video.currentTime || 0;

    // Trimmed clip reached its out-point — advance before the file truly ends.
    // (Fully-untouched clips fall through to the 'ended' event instead.)
    if (this.isPlaying && bounds.trimOut < videoDur - 0.05 && currentTime >= bounds.trimOut) {
      this._onTrimOutReached();
      return;
    }

    // Preload next clip when approaching the trim out-point (< 1.5s remaining)
    if (this.isPlaying && videoDur) {
      const remaining = bounds.trimOut - currentTime;
      if (remaining < 1.5) {
        this._preloadNext();
      }
    }
  }

  /** Playback hit a clip's trim out-point: advance to the next clip or finish. */
  _onTrimOutReached() {
    const nextIdx = this.currentClipIndex + 1;
    if (nextIdx < this.clips.length) {
      // Advance to next clip and continue playing
      this._loadClip(nextIdx, 0, true);
    } else {
      // End of sequence — park the video at the out-point (it is mid-file here,
      // so it would otherwise keep playing the trimmed-away tail)
      this.video.pause();
      this.video.currentTime = Math.min(this.video.currentTime, this._getTrimBounds(this.currentClipIndex).trimOut);
      this.isPlaying = false;
      this.onPlayStateChange(false);
      this._updateTimecodeDisplay(this.totalDuration);
      this._drawScrubber();
    }
  }

  _onEnded() {
    const nextIdx = this.currentClipIndex + 1;
    if (nextIdx < this.clips.length) {
      // Advance to next clip and continue playing
      this._loadClip(nextIdx, 0, true);
    } else {
      // End of sequence — stay on last frame, paused
      this.isPlaying = false;
      this.onPlayStateChange(false);
      this._updateTimecodeDisplay(this.totalDuration);
      this._drawScrubber();
    }
  }

  // =========================================================================
  // Timecode display
  // =========================================================================

  _updateTimecodeDisplay(globalSeconds) {
    if (!this.timecodeEl) return;
    const elapsed = this._formatMmSs(globalSeconds);
    const total = this._formatMmSs(this.totalDuration);
    this.timecodeEl.textContent = `${elapsed} / ${total}`;
  }

  _formatMmSs(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  // =========================================================================
  // Scrubber — sizing
  // =========================================================================

  _setupScrubberSize() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = SCRUBBER_HEIGHT;
      this.canvas.style.height = SCRUBBER_HEIGHT + 'px';
      this._drawScrubber();
    };
    resize();
    this._resizeHandler = resize;
    window.addEventListener('resize', resize);
  }

  // =========================================================================
  // Scrubber — drawing
  // =========================================================================

  _scheduleRedraw() {
    if (this._animFrame) return;
    this._animFrame = requestAnimationFrame(() => {
      this._animFrame = null;
      this._drawScrubber();
    });
  }

  _getVisualBoundaries() {
    const strip = document.getElementById('merge-timeline-strip');
    if (!strip) return null;
    const blocks = strip.querySelectorAll('.merge-timeline-block');
    if (blocks.length !== this.clips.length || blocks.length === 0) return null;

    const boundaries = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      // block.offsetLeft is relative to the #merge-timeline-strip container.
      // Since #merge-timeline-strip padding-left is 12px, and .merge-scrubber-area padding-left is 12px,
      // canvas X=0 corresponds to block.offsetLeft = 12.
      const x = block.offsetLeft - 12;
      const w = block.offsetWidth;
      boundaries.push({
        startX: x,
        endX: x + w,
        startSec: this.boundaries[i].start,
        endSec: this.boundaries[i].end
      });
    }
    return boundaries;
  }

  _drawScrubber() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = SCRUBBER_HEIGHT;

    // Background (unfilled track)
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, H);

    if (this.totalDuration <= 0 || this.clips.length === 0) return;

    const vBounds = this._getVisualBoundaries();
    const secondsToX = (s) => {
      if (vBounds) {
        for (let i = 0; i < vBounds.length; i++) {
          const b = vBounds[i];
          if (s >= b.startSec && s <= b.endSec) {
            const ratio = (b.endSec - b.startSec) === 0 ? 0 : (s - b.startSec) / (b.endSec - b.startSec);
            return b.startX + ratio * (b.endX - b.startX);
          }
        }
        return vBounds[vBounds.length - 1].endX;
      }
      return (s / this.totalDuration) * W;
    };

    // Draw filled progress
    const globalTime = this.getGlobalTime();
    const elapsedX = secondsToX(globalTime);
    
    ctx.fillStyle = COL_PROGRESS;
    ctx.fillRect(0, 0, elapsedX, H);

    // Draw clip boundary tick marks
    for (let i = 1; i < this.boundaries.length; i++) {
      const x = secondsToX(this.boundaries[i].start);
      ctx.fillStyle = COL_BOUNDARY;
      ctx.fillRect(x - 0.5, 0, 1, H);
    }

    // Draw playhead
    ctx.fillStyle = COL_PLAYHEAD;
    ctx.fillRect(elapsedX - PLAYHEAD_W / 2, 0, PLAYHEAD_W, H);
  }

  // =========================================================================
  // Scrubber — interaction
  // =========================================================================

  _bindScrubberEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onScrubberDown(e));
    this._onScrubberMoveRef = (e) => this._onScrubberMove(e);
    this._onScrubberUpRef = () => this._onScrubberUp();
    window.addEventListener('mousemove', this._onScrubberMoveRef);
    window.addEventListener('mouseup', this._onScrubberUpRef);

    // Cursor
    this.canvas.style.cursor = 'pointer';
  }

  _canvasX(e) {
    const rect = this.canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }

  _xToGlobalSeconds(x) {
    if (this.totalDuration <= 0) return 0;
    
    const vBounds = this._getVisualBoundaries();
    if (vBounds) {
      for (let i = 0; i < vBounds.length; i++) {
        const b = vBounds[i];
        if (x >= b.startX && x <= b.endX) {
          const ratio = (b.endX - b.startX) === 0 ? 0 : (x - b.startX) / (b.endX - b.startX);
          return b.startSec + ratio * (b.endSec - b.startSec);
        }
      }
      
      if (vBounds.length > 0) {
        if (x < vBounds[0].startX) return 0;
        if (x > vBounds[vBounds.length - 1].endX) return this.totalDuration;
        
        for (let i = 0; i < vBounds.length - 1; i++) {
          if (x > vBounds[i].endX && x < vBounds[i+1].startX) {
            return vBounds[i].endSec;
          }
        }
      }
    }
    
    // Fallback if blocks not found
    const ratio = x / this.canvas.width;
    return Math.max(0, Math.min(this.totalDuration, ratio * this.totalDuration));
  }

  _onScrubberDown(e) {
    if (this.totalDuration <= 0) return;
    this._dragging = true;
    this._wasPausedBeforeScrub = !this.isPlaying;
    if (this.isPlaying) this.video.pause();

    const globalSec = this._xToGlobalSeconds(this._canvasX(e));
    this._seekToGlobalInternal(globalSec, false);
    e.preventDefault();
  }

  _onScrubberMove(e) {
    if (!this._dragging) return;
    const globalSec = this._xToGlobalSeconds(this._canvasX(e));
    this._seekToGlobalInternal(globalSec, false);
  }

  _onScrubberUp() {
    if (!this._dragging) return;
    this._dragging = false;
    if (!this._wasPausedBeforeScrub) {
      this.video.play();
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  destroy() {
    this.video.removeEventListener('timeupdate', this._onTimeUpdate);
    this.video.removeEventListener('ended', this._onEnded);
    this.video.removeEventListener('play', this._onPlay);
    this.video.removeEventListener('pause', this._onPause);
    window.removeEventListener('mousemove', this._onScrubberMoveRef);
    window.removeEventListener('mouseup', this._onScrubberUpRef);
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
  }
}
