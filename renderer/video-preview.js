/**
 * Video Preview Module
 */

export class VideoPreview {
  constructor(videoElement, onTimeUpdate, onDurationChange) {
    this.video = videoElement;
    this.onTimeUpdate = onTimeUpdate;
    
    this.video.addEventListener('timeupdate', () => {
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.video.currentTime);
      }
    });

    this.video.addEventListener('durationchange', () => {
      if (onDurationChange) {
        onDurationChange(this.video.duration);
      }
    });
  }

  load(filePath) {
    this.video.src = `file://${filePath}`;
    this.video.load();
  }

  play() {
    this.video.play();
  }

  pause() {
    this.video.pause();
  }
  
  togglePlay() {
    if (this.video.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  seekTo(seconds) {
    if (seconds >= 0 && seconds <= this.video.duration) {
      this.video.currentTime = seconds;
    }
  }

  frameStep(frames, fps) {
    const frameDuration = 1 / fps;
    const newTime = this.video.currentTime + (frames * frameDuration);
    this.seekTo(Math.max(0, Math.min(newTime, this.video.duration)));
  }

  isPlaying() {
    return !this.video.paused;
  }
  
  setVolume(level) {
    this.video.volume = level;
  }

  setMuted(isMuted) {
    this.video.muted = isMuted;
  }
  
  getCurrentTime() {
    return this.video.currentTime;
  }
  
  onPlayStateChange(callback) {
    this.video.addEventListener('play', () => callback(true));
    this.video.addEventListener('pause', () => callback(false));
  }
}
