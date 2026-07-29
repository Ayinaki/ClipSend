import { formatTimecode, parseTimecode } from './utils/timecode.js';

/**
 * Control Bar Module
 */
export class ControlBar {
  constructor(container, fps, callbacks) {
    this.container = container;
    this.fps = fps || 30; // fallback if probe fails
    
    // Callbacks
    this.onPlayToggle = callbacks.onPlayToggle;
    this.onSeek = callbacks.onSeek;
    this.onFrameStep = callbacks.onFrameStep;
    this.onJumpIn = callbacks.onJumpIn;
    this.onSetIn = callbacks.onSetIn;
    this.onStop = callbacks.onStop;
    this.onSetOut = callbacks.onSetOut;
    this.onJumpOut = callbacks.onJumpOut;

    // DOM Elements
    this.timeDisplay = this.container.querySelector('.time-display');
    this.playBtn = this.container.querySelector('.play-btn');
    this.prevFrameBtn = this.container.querySelector('.prev-frame-btn');
    this.nextFrameBtn = this.container.querySelector('.next-frame-btn');
    
    this.jumpInBtn = this.container.querySelector('.jump-in-btn');
    this.setInBtn = this.container.querySelector('.set-in-btn');
    this.stopBtn = this.container.querySelector('.stop-btn');
    this.setOutBtn = this.container.querySelector('.set-out-btn');
    this.jumpOutBtn = this.container.querySelector('.jump-out-btn');

    this.bindEvents();
  }

  bindEvents() {
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => {
        if (this.onPlayToggle) this.onPlayToggle();
      });
    }

    if (this.prevFrameBtn) {
      this.prevFrameBtn.addEventListener('click', () => {
        if (this.onFrameStep) this.onFrameStep(-1);
      });
    }

    if (this.nextFrameBtn) {
      this.nextFrameBtn.addEventListener('click', () => {
        if (this.onFrameStep) this.onFrameStep(1);
      });
    }
    
    if (this.jumpInBtn) {
      this.jumpInBtn.addEventListener('click', () => {
        if (this.onJumpIn) this.onJumpIn();
      });
    }

    if (this.setInBtn) {
      this.setInBtn.addEventListener('click', () => {
        if (this.onSetIn) this.onSetIn();
      });
    }

    if (this.stopBtn) {
      this.stopBtn.addEventListener('click', () => {
        if (this.onStop) this.onStop();
      });
    }

    if (this.setOutBtn) {
      this.setOutBtn.addEventListener('click', () => {
        if (this.onSetOut) this.onSetOut();
      });
    }

    if (this.jumpOutBtn) {
      this.jumpOutBtn.addEventListener('click', () => {
        if (this.onJumpOut) this.onJumpOut();
      });
    }

    // Timecode typed input handling
    if (this.timeDisplay) {
      this.timeDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const seconds = parseTimecode(this.timeDisplay.textContent, this.fps);
          if (seconds !== null && this.onSeek) {
            this.onSeek(seconds);
          } else {
            // Re-format to clear invalid input visually, relying on next timeUpdate
            this.timeDisplay.blur();
          }
        }
      });

      // Focus handling to pause updates while typing
      this.timeDisplay.addEventListener('focus', () => {
        this.isTypingTimecode = true;
      });

      this.timeDisplay.addEventListener('blur', () => {
        this.isTypingTimecode = false;
      });
    }
  }

  updateTimecode(seconds) {
    if (this.timeDisplay && !this.isTypingTimecode) {
      this.timeDisplay.textContent = formatTimecode(seconds, this.fps);
    }
  }

  setPlayState(isPlaying) {
    if (this.playBtn) {
      this.playBtn.innerHTML = isPlaying ? '&#xE769;' : '&#xE768;';
      this.playBtn.title = isPlaying ? 'Pause' : 'Play';
    }
  }
}
