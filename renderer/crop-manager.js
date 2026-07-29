class CropManager {
  constructor() {
    this.video = document.getElementById('main-video');
    this.container = document.getElementById('crop-overlay-container');
    this.box = document.getElementById('crop-box');
    
    this.enableCheckbox = document.getElementById('crop-enable');
    this.controlsDiv = document.getElementById('crop-controls');
    this.presetSelect = document.getElementById('crop-preset');
    
    this.recenterBtn = document.getElementById('crop-recenter-btn');
    
    this.presetSelect.value = 'none';
    this.lockedAspectRatio = null;
    this.cropNative = { x: 0, y: 0, w: 0, h: 0 };
    this.lockedAspectRatio = null;
    
    this.enableCheckbox.disabled = true; // Disabled until a clip is loaded
    
    this._bindEvents();
    
    // Resize observer to keep the crop box scaled correctly when window resizes
    this.resizeObserver = new ResizeObserver(() => {
      if (this.isEnabled && this.video.videoWidth > 0) {
        this._updateOverlayFromNative();
      }
    });
    this.resizeObserver.observe(this.video);
  }

  _bindEvents() {
    this.enableCheckbox.addEventListener('change', (e) => {
      this.isEnabled = e.target.checked;
      if (this.isEnabled) {
        this._initializeDefaultCrop();
      } else {
        this.controlsDiv.style.opacity = '0.5';
        this.controlsDiv.style.pointerEvents = 'none';
        this.container.style.display = 'none';
        this.presetSelect.value = 'none';
        this.lockedAspectRatio = null;
      }
      this.emit('change');
    });
    this.presetSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'none') {
        this.lockedAspectRatio = null;
        return;
      }
      
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (!vw || !vh) return;

      let targetRatio;
      if (val === '16:9') targetRatio = 16 / 9;
      else if (val === '9:16') targetRatio = 9 / 16;
      else if (val === '1:1') targetRatio = 1;
      else if (val === '4:3') targetRatio = 4 / 3;
      
      this.lockedAspectRatio = targetRatio;

      let newW = vw;
      let newH = Math.round(vw / targetRatio);
      
      if (newH > vh) {
        newH = vh;
        newW = Math.round(vh * targetRatio);
      }
      
      // Ensure even dimensions
      newW = Math.floor(newW / 2) * 2;
      newH = Math.floor(newH / 2) * 2;

      this.cropNative = {
        x: Math.floor((vw - newW) / 2),
        y: Math.floor((vh - newH) / 2),
        w: newW,
        h: newH
      };
      
      this._updateOverlayFromNative();
    });

    this.recenterBtn.addEventListener('click', () => {
      if (!this.isEnabled || !this.video || !this.video.videoWidth) return;
      
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      
      this.cropNative.x = Math.round((vw - this.cropNative.w) / 2);
      this.cropNative.y = Math.round((vh - this.cropNative.h) / 2);
      
      this._updateOverlayFromNative();
    });

    // Draggable / Resizable Logic
    this._setupDragAndResize();
  }

  _setupDragAndResize() {
    let isDragging = false;
    let dragMode = null; // 'move', 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
    let startMouseX = 0, startMouseY = 0;
    let startCrop = null;

    const onMouseDown = (e) => {
      if (!this.isEnabled) return;
      e.preventDefault();
      
      isDragging = true;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      startCrop = { ...this.cropNative };

      if (e.target.classList.contains('crop-handle')) {
        dragMode = e.target.className.split(' ')[1];
      } else {
        dragMode = 'move';
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      const scale = this._getScale();
      
      // Delta in native video pixels
      const dx = (e.clientX - startMouseX) / scale;
      const dy = (e.clientY - startMouseY) / scale;

      let { x, y, w, h } = startCrop;

      if (dragMode === 'move') {
        x += dx;
        y += dy;
        x = Math.max(0, Math.min(x, vw - w));
        y = Math.max(0, Math.min(y, vh - h));
      } else if (this.lockedAspectRatio !== null) {
        let targetW = w;
        let targetH = h;
        
        if (dragMode === 'e' || dragMode === 'w') {
          targetW += (dragMode === 'e') ? dx : -dx;
          targetH = targetW / this.lockedAspectRatio;
        } else if (dragMode === 'n' || dragMode === 's') {
          targetH += (dragMode === 's') ? dy : -dy;
          targetW = targetH * this.lockedAspectRatio;
        } else {
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          if (absDx > absDy * this.lockedAspectRatio) {
            targetW += (dragMode.includes('e')) ? dx : -dx;
            targetH = targetW / this.lockedAspectRatio;
          } else {
            targetH += (dragMode.includes('s')) ? dy : -dy;
            targetW = targetH * this.lockedAspectRatio;
          }
        }
        
        targetW = Math.max(2, targetW);
        targetH = Math.max(2, targetH);
        
        let maxW = vw;
        let maxH = vh;
        const centerX = startCrop.x + startCrop.w / 2;
        const centerY = startCrop.y + startCrop.h / 2;
        
        if (dragMode.includes('w')) maxW = startCrop.x + startCrop.w;
        else if (dragMode.includes('e')) maxW = vw - startCrop.x;
        else maxW = Math.min(centerX, vw - centerX) * 2;
        
        if (dragMode.includes('n')) maxH = startCrop.y + startCrop.h;
        else if (dragMode.includes('s')) maxH = vh - startCrop.y;
        else maxH = Math.min(centerY, vh - centerY) * 2;
        
        if (targetW > maxW) {
          targetW = maxW;
          targetH = targetW / this.lockedAspectRatio;
        }
        if (targetH > maxH) {
          targetH = maxH;
          targetW = targetH * this.lockedAspectRatio;
        }
        
        w = targetW;
        h = targetH;
        
        if (dragMode.includes('w')) x = startCrop.x + startCrop.w - w;
        else if (dragMode.includes('e')) x = startCrop.x;
        else x = centerX - w / 2;
        
        if (dragMode.includes('n')) y = startCrop.y + startCrop.h - h;
        else if (dragMode.includes('s')) y = startCrop.y;
        else y = centerY - h / 2;
      } else {
        if (dragMode.includes('n')) {
          const maxDy = h - 2;
          const clampedDy = Math.max(-y, Math.min(dy, maxDy));
          y += clampedDy;
          h -= clampedDy;
        }
        if (dragMode.includes('s')) {
          const maxDy = vh - y - h;
          const minDy = 2 - h;
          const clampedDy = Math.max(minDy, Math.min(dy, maxDy));
          h += clampedDy;
        }
        if (dragMode.includes('w')) {
          const maxDx = w - 2;
          const clampedDx = Math.max(-x, Math.min(dx, maxDx));
          x += clampedDx;
          w -= clampedDx;
        }
        if (dragMode.includes('e')) {
          const maxDx = vw - x - w;
          const minDx = 2 - w;
          const clampedDx = Math.max(minDx, Math.min(dx, maxDx));
          w += clampedDx;
        }
      }

      // Ensure even numbers for encoders
      x = Math.round(x);
      y = Math.round(y);
      w = Math.floor(w / 2) * 2;
      h = Math.floor(h / 2) * 2;

      this.cropNative = { x, y, w, h };
      this._updateOverlayFromNative();
    };

    const onMouseUp = () => {
      isDragging = false;
      dragMode = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.box.addEventListener('mousedown', onMouseDown);
  }

  _getScale() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const cw = this.video.clientWidth;
    const ch = this.video.clientHeight;
    if (!vw || !cw) return 1;
    
    const videoRatio = vw / vh;
    const containerRatio = cw / ch;
    
    if (containerRatio > videoRatio) {
      return ch / vh;
    } else {
      return cw / vw;
    }
  }

  _updateOverlayFromNative() {
    if (!this.isEnabled) return;
    const scale = this._getScale();
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const cw = this.video.clientWidth;
    const ch = this.video.clientHeight;
    
    const renderedWidth = vw * scale;
    const renderedHeight = vh * scale;
    const offsetX = (cw - renderedWidth) / 2;
    const offsetY = (ch - renderedHeight) / 2;

    this.container.style.width = `${renderedWidth}px`;
    this.container.style.height = `${renderedHeight}px`;
    this.container.style.left = `${offsetX}px`;
    this.container.style.top = `${offsetY}px`;

    const left = this.cropNative.x * scale;
    const top = this.cropNative.y * scale;
    const width = this.cropNative.w * scale;
    const height = this.cropNative.h * scale;

    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
    this.box.style.width = `${width}px`;
    this.box.style.height = `${height}px`;
  }

  _initializeDefaultCrop() {
    if (!this.video || !this.video.videoWidth) {
      this.isEnabled = false;
      this.enableCheckbox.checked = false;
      return;
    }
    
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    let newW = Math.round(vw * 0.5);
    let newH = Math.round(vh * 0.5);
    newW = Math.floor(newW / 2) * 2;
    newH = Math.floor(newH / 2) * 2;
    
    this.cropNative = {
      x: Math.round((vw - newW) / 2),
      y: Math.round((vh - newH) / 2),
      w: newW,
      h: newH
    };
    
    this.controlsDiv.style.opacity = '1';
    this.controlsDiv.style.pointerEvents = 'auto';
    this.container.style.display = 'block';
    this.presetSelect.value = 'none';
    this.lockedAspectRatio = null;
    this._updateOverlayFromNative();
  }

  onVideoLoaded() {
    if (this.video && this.video.videoWidth > 0) {
      this.enableCheckbox.disabled = false;
      if (this.isEnabled) {
        this._initializeDefaultCrop();
      }
    }
  }

  reset(videoElement = null) {
    if (videoElement) {
      this.video = videoElement;
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(this.video);
    }
    
    // Checkbox state (isEnabled) persists. We only disable interactivity if no video.
    if (this.video && this.video.videoWidth > 0) {
      this.enableCheckbox.disabled = false;
    } else {
      this.enableCheckbox.disabled = true;
    }
    
    // Hide controls until video is loaded or user disables
    this.controlsDiv.style.opacity = '0.5';
    this.controlsDiv.style.pointerEvents = 'none';
    this.container.style.display = 'none';
  }

  getCropSettings() {
    return {
      enable: this.isEnabled,
      ...this.cropNative
    };
  }
}

export default CropManager;
