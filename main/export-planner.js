/**
 * ExportPlanner — Computes a deterministic 2-pass FFmpeg encoding plan.
 *
 * Given MediaInfo, trim points, and export settings, this module:
 *   1. Computes a video bitrate budget from target size, audio bitrate,
 *      safety margin, and muxing overhead reserve.
 *   2. Checks the budget against quality-floor thresholds per resolution tier.
 *   3. Recommends a downscale if the budget is too low for the source resolution.
 *   4. Builds exact FFmpeg argument arrays for pass 1 and pass 2.
 *   5. Returns warnings for impossible or poor-quality scenarios.
 *
 * IMPORTANT: This module is pure computation — no I/O, no spawning.
 *            It is fully unit-testable with no mocks required.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Quality-floor table.
 * If the computed video bitrate falls below the minBitrateKbps for the
 * source (or current) resolution tier, the planner steps down to the
 * next tier. Tiers are ordered from largest to smallest.
 */
const QUALITY_FLOORS = [
  { w: 2560, h: 1440, minBitrateKbps: 3000 },
  { w: 1920, h: 1080, minBitrateKbps: 1500 },
  { w: 1280, h: 720,  minBitrateKbps: 800 },
  { w: 854,  h: 480,  minBitrateKbps: 400 }
];

/**
 * Safety margin applied to the raw target size.
 * FFmpeg 2-pass VBR is a target, not a hard ceiling.  We aim 3% under
 * the cap so that minor overshoot still stays below the platform limit.
 */
const SAFETY_MARGIN = 0.95;

/**
 * Muxing overhead reserve — fraction of the safe budget set aside for
 * MP4 container headers, moov atom, and faststart relocation.
 * 1.5% is a conservative estimate that covers most files.
 */
const MUXING_OVERHEAD = 0.015;

/**
 * Absolute minimum video bitrate (kbps) below which we refuse to encode.
 * At this level the output is unwatchable, so we error instead.
 */
const ABSOLUTE_MIN_VIDEO_BITRATE_KBPS = 50;

/**
 * Default audio bitrate when none is specified.
 */
const DEFAULT_AUDIO_BITRATE_KBPS = 128;

/**
 * How many seconds before the in-point we place the fast (input) seek.
 * The remaining gap is covered by accurate (output) seeking.
 */
const FAST_SEEK_RUNWAY_SECONDS = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate a complete export plan.
 *
 * @param {Object} mediaInfo         - Probed media information.
 * @param {string} mediaInfo.filePath
 * @param {number} mediaInfo.width
 * @param {number} mediaInfo.height
 * @param {number} trimIn            - Trim in-point in seconds.
 * @param {number} trimOut           - Trim out-point in seconds.
 * @param {Object} settings          - Export settings.
 * @param {'size-limit'|'custom'} settings.mode
 * @param {number} [settings.targetSizeMB=10]         - For size-limit mode.
 * @param {number} [settings.customBitrateKbps]        - For custom mode.
 * @param {number} [settings.audioBitrateKbps=128]
 * @param {number} [settings.selectedAudioTrackIndex=0]
 *
 * @returns {ExportPlan}
 * @throws {Error} If inputs are invalid or bitrate is impossibly low.
 */
function calculatePlan(mediaInfo, trimIn, trimOut, settings) {
  // ------ Input validation ------
  validateInputs(mediaInfo, trimIn, trimOut, settings);

  const clipDuration = trimOut - trimIn;

  let audioBitrateKbps = settings.audioBitrateKbps ?? DEFAULT_AUDIO_BITRATE_KBPS;
  let videoBitrateKbps = 0;
  
  const isCropped = settings.crop && settings.crop.enable;
  const sourceWidth = isCropped ? settings.crop.w : mediaInfo.width;
  const sourceHeight = isCropped ? settings.crop.h : mediaInfo.height;
  
  let width = sourceWidth;
  let height = sourceHeight;
  let isSinglePass = false;
  let crfValue = undefined;
  let warnings = [];

  const encoder = (settings.hasNvenc && (settings.hwAccel === 'nvenc' || settings.hwAccel === 'auto')) ? 'h264_nvenc' : 'libx264';
  
  if (encoder === 'h264_nvenc') {
    isSinglePass = true;
  }

  if (settings.outputFormat === 'gif') {
    isSinglePass = true;
    crfValue = undefined;
    audioBitrateKbps = 0;
    videoBitrateKbps = 0;
    
    const targetFps = mediaInfo.frameRate ? Math.min(30, mediaInfo.frameRate) : 30;
    const frameCount = clipDuration * targetFps;
    const resWidth = settings.manualResolution ? settings.manualResolution.width : sourceWidth;
    const resHeight = settings.manualResolution ? settings.manualResolution.height : sourceHeight;
    const bytesPerFrame = resWidth * resHeight * 3;
    const totalBytes = bytesPerFrame * frameCount;
    const maxBytes = 4 * 1024 * 1024 * 1024; // 4GB
    
    if (totalBytes > maxBytes) {
      throw new Error(`Estimated temporary disk space for GIF extraction exceeds 4GB (${(totalBytes/1024/1024/1024).toFixed(1)}GB). The clip is too long or the resolution is too high for GIF export.`);
    }
  } else if (settings.mode === 'auto') {
    isSinglePass = true;
    crfValue = settings.crfValue || 19;
    audioBitrateKbps = 192; // High quality AAC for auto
  } else {
    if (settings.mode === 'size-limit') {
      videoBitrateKbps = computeSizeLimitBitrate(
        settings.targetSizeMB ?? 10,
        clipDuration,
        audioBitrateKbps
      );
    } else {
      // custom mode — user supplies video bitrate directly
      videoBitrateKbps = settings.customBitrateKbps;
    }

    if (isNaN(videoBitrateKbps) || !isFinite(videoBitrateKbps) || videoBitrateKbps <= 0) {
      throw new Error(
        `Computed video bitrate is invalid (${videoBitrateKbps}). ` +
        `Ensure the clip duration is greater than 0.`
      );
    }

    if (videoBitrateKbps < ABSOLUTE_MIN_VIDEO_BITRATE_KBPS) {
      throw new Error(
        `Computed video bitrate (${Math.round(videoBitrateKbps)} kbps) is below the ` +
        `minimum threshold of ${ABSOLUTE_MIN_VIDEO_BITRATE_KBPS} kbps. ` +
        `The clip is too long for the selected target size.`
      );
    }

    // ------ Resolution decision ------
    if (!settings.manualResolution) {
      if (settings.disableAutoDownscale) {
        width = sourceWidth;
        height = sourceHeight;
        
        const applicableTierIndex = QUALITY_FLOORS.findIndex(
          t => t.w <= width && t.h <= height
        );
        if (applicableTierIndex !== -1) {
          const tier = QUALITY_FLOORS[applicableTierIndex];
          if (videoBitrateKbps < tier.minBitrateKbps) {
            warnings.push({
              id: 'bitrate-low-native',
              title: 'Low bitrate for resolution',
              body: `Video bitrate is ${Math.round(videoBitrateKbps)} kbps. Since auto-downscaling is disabled, maintaining the native ${width}x${height} resolution at this file size may result in poor visual quality.`
            });
          }
        }
      } else {
        const resResult = resolveResolution(
          sourceWidth,
          sourceHeight,
          videoBitrateKbps
        );
        width = resResult.width;
        height = resResult.height;
        warnings = resResult.warnings;
      }
    }
  }

  if (settings.manualResolution) {
    if (settings.manualResolution.width > sourceWidth || settings.manualResolution.height > sourceHeight) {
      throw new Error(`Invalid resolution: cannot exceed source resolution (${sourceWidth}x${sourceHeight})`);
    }
    width = settings.manualResolution.width;
    height = settings.manualResolution.height;
    // Manual resolution doesn't strictly need a warning since the user requested it,
    // but if we want to show it, we use a neutral object type. For now, we omit it
    // as the UI displays the resolution in the plan summary anyway.
  }

  // ------ Audio Track Validation ------
  let hasAudio = false;
  let selectedAudioTrackIndex = settings.selectedAudioTrackIndex;
  
  // If the UI passed "" or null, default to the first track, if any
  if (selectedAudioTrackIndex === '' || selectedAudioTrackIndex == null) {
    if (mediaInfo.audioTracks && mediaInfo.audioTracks.length > 0) {
      selectedAudioTrackIndex = mediaInfo.audioTracks[0].audioOrdinal;
    } else {
      selectedAudioTrackIndex = 0;
    }
  }
  
  if (mediaInfo.audioTracks && mediaInfo.audioTracks.length > 0) {
    const trackExists = mediaInfo.audioTracks.some(t => String(t.audioOrdinal) === String(selectedAudioTrackIndex));
    if (!trackExists) {
      throw new Error(`Selected audio track ordinal ${selectedAudioTrackIndex} does not exist in the source file.`);
    }
    hasAudio = true;
  }

  // ------ Build FFmpeg args ------
  const seekTimes = computeSeekTimes(trimIn, trimOut);
  
  // Enforce even dimensions
  width = width % 2 === 0 ? width : width - 1;
  height = height % 2 === 0 ? height : height - 1;
  const needsScale = (width !== sourceWidth || height !== sourceHeight);

  if (isSinglePass) {
    const singlePassArgs = buildPassArgs({
      pass: 0,
      inputPath: mediaInfo.filePath,
      seekTimes,
      crfValue,
      audioBitrateKbps,
      hasAudio,
      selectedAudioTrackIndex,
      width,
      height,
      needsScale,
      frameRate: mediaInfo.frameRate,
      encoder,
      videoBitrateKbps,
      crop: settings.crop,
      maxQuality: settings.maxQuality,
      outputFormat: settings.outputFormat
    });

    return {
      clipDuration,
      width,
      height,
      isSinglePass: true,
      crfValue,
      singlePassArgs,
      warnings,
      audioTracks: mediaInfo.audioTracks,
      selectedAudioOrdinal: selectedAudioTrackIndex,
      encoder,
      targetSizeMB: settings.targetSizeMB,
      estimatedSizeMB: parseFloat((((videoBitrateKbps + audioBitrateKbps) * 1000 * clipDuration / 8) / (1024 * 1024)).toFixed(2)),
      videoBitrateKbps: Math.round(videoBitrateKbps),
      totalBitrateKbps: Math.round(videoBitrateKbps + audioBitrateKbps),
      audioBitrateKbps,
      outputFormat: settings.outputFormat
    };
  }

  const pass1Args = buildPassArgs({
    pass: 1,
    inputPath: mediaInfo.filePath,
    seekTimes,
    videoBitrateKbps,
    audioBitrateKbps,
    hasAudio,
    selectedAudioTrackIndex,
    width,
    height,
    needsScale,
    frameRate: mediaInfo.frameRate,
    encoder,
    crop: settings.crop,
    maxQuality: settings.maxQuality
  });

  const pass2Args = buildPassArgs({
    pass: 2,
    inputPath: mediaInfo.filePath,
    seekTimes,
    videoBitrateKbps,
    audioBitrateKbps,
    hasAudio,
    selectedAudioTrackIndex,
    width,
    height,
    needsScale,
    frameRate: mediaInfo.frameRate,
    encoder,
    crop: settings.crop,
    maxQuality: settings.maxQuality
  });

  // ------ Estimated output size ------
  const totalBitrateKbps = videoBitrateKbps + (hasAudio ? audioBitrateKbps : 0);
  const estimatedSizeMB = (totalBitrateKbps * 1000 * clipDuration / 8) / (1024 * 1024);

  return {
    clipDuration,
    targetSizeMB: settings.targetSizeMB,
    estimatedSizeMB: parseFloat(estimatedSizeMB.toFixed(2)),
    videoBitrateKbps: Math.round(videoBitrateKbps),
    audioBitrateKbps,
    totalBitrateKbps: Math.round(totalBitrateKbps),
    width,
    height,
    downscaled: needsScale,
    warnings,
    pass1Args,
    pass2Args,
    audioTracks: mediaInfo.audioTracks,
    selectedAudioOrdinal: selectedAudioTrackIndex,
    encoder
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateInputs(mediaInfo, trimIn, trimOut, settings) {
  if (!mediaInfo || !mediaInfo.filePath) {
    throw new Error('mediaInfo.filePath is required');
  }
  if (typeof mediaInfo.width !== 'number' || typeof mediaInfo.height !== 'number') {
    throw new Error('mediaInfo.width and mediaInfo.height must be numbers');
  }
  if (typeof trimIn !== 'number' || typeof trimOut !== 'number') {
    throw new Error('trimIn and trimOut must be numbers');
  }
  if (trimIn < 0) {
    throw new Error('trimIn must be >= 0');
  }
  if (trimOut <= trimIn) {
    throw new Error('trimOut must be greater than trimIn');
  }
  if (!settings || !settings.mode) {
    throw new Error('settings.mode is required (size-limit, custom, auto)');
  }
  if (settings.mode !== 'size-limit' && settings.mode !== 'custom' && settings.mode !== 'auto') {
    throw new Error(`Unknown mode: "${settings.mode}". Expected "size-limit", "custom", or "auto".`);
  }
  if (settings.mode === 'custom') {
    if (typeof settings.customBitrateKbps !== 'number' || settings.customBitrateKbps <= 0) {
      throw new Error('settings.customBitrateKbps must be a positive number in custom mode');
    }
  }
}

/**
 * Compute the video bitrate from target file size.
 */
function computeSizeLimitBitrate(targetSizeMB, clipDurationSec, audioBitrateKbps) {
  const targetBytes = targetSizeMB * 1024 * 1024;
  const safeBytes = targetBytes * SAFETY_MARGIN;
  const usableBytes = safeBytes * (1 - MUXING_OVERHEAD);
  const totalBitrateBps = (usableBytes * 8) / clipDurationSec;
  const totalBitrateKbps = totalBitrateBps / 1000;
  let videoBitrateKbps = totalBitrateKbps - audioBitrateKbps;
  if (videoBitrateKbps > 50000) {
    videoBitrateKbps = 50000;
  }
  return videoBitrateKbps;
}

/**
 * Decide output resolution.
 */
function resolveResolution(sourceWidth, sourceHeight, videoBitrateKbps) {
  const warnings = [];
  const applicableTierIndex = QUALITY_FLOORS.findIndex(
    t => t.w <= sourceWidth && t.h <= sourceHeight
  );

  if (applicableTierIndex === -1) {
    return { width: sourceWidth, height: sourceHeight, warnings };
  }

  const sourceTier = QUALITY_FLOORS[applicableTierIndex];
  if (videoBitrateKbps >= sourceTier.minBitrateKbps) {
    return { width: sourceWidth, height: sourceHeight, warnings };
  }

  for (let i = applicableTierIndex + 1; i < QUALITY_FLOORS.length; i++) {
    const tier = QUALITY_FLOORS[i];
    if (videoBitrateKbps >= tier.minBitrateKbps) {
      warnings.push({
        id: 'auto-downscaled',
        title: 'Resolution downscaled',
        body: `Your ${sourceWidth}x${sourceHeight} source was reduced to ${tier.w}x${tier.h} because the selected file size doesn't allow enough bitrate to maintain full resolution quality.`
      });
      return { width: tier.w, height: tier.h, warnings };
    }
  }

  const smallest = QUALITY_FLOORS[QUALITY_FLOORS.length - 1];
  warnings.push({
    id: 'auto-downscaled',
    title: 'Resolution downscaled',
    body: `Your ${sourceWidth}x${sourceHeight} source was reduced to ${smallest.w}x${smallest.h} because the selected file size doesn't allow enough bitrate to maintain full resolution quality.`
  });
  warnings.push({
    id: 'bitrate-too-low',
    title: 'Bitrate below quality floor',
    body: `Video bitrate is ${Math.round(videoBitrateKbps)} kbps, even at the reduced ${smallest.w}x${smallest.h} resolution. Expect visible quality loss in the exported file.`
  });
  return { width: smallest.w, height: smallest.h, warnings };
}

/**
 * Compute simple input-seek trim times.
 */
function computeSeekTimes(trimIn, trimOut) {
  return {
    inputSeek: trimIn,
    duration: trimOut - trimIn
  };
}

/**
 * Build the FFmpeg argument array for one pass.
 */
function buildPassArgs(opts) {
  const {
    pass, inputPath, seekTimes,
    videoBitrateKbps, crfValue, audioBitrateKbps,
    hasAudio, selectedAudioTrackIndex,
    width, height, needsScale, frameRate,
    encoder, crop, maxQuality, outputFormat
  } = opts;

  const args = [
    '-y',
    '-ss', String(seekTimes.inputSeek),
    '-i', inputPath
  ];

  // Video codec
  if (outputFormat === 'gif') {
    // Raw output for GIF extraction, no compressed codec
    args.push('-f', 'yuv4mpegpipe', '-pix_fmt', 'yuv420p');
  } else if (encoder === 'h264_nvenc') {
    const nvencPreset = maxQuality ? 'p7' : 'p5';
    if (crfValue !== undefined) {
      // Auto (Best Quality) mode for NVENC
      args.push('-c:v', 'h264_nvenc', '-preset', nvencPreset, '-rc', 'vbr', '-cq', crfValue.toString(), '-b:v', '0');
    } else {
      // Size-targeted for NVENC (Single pass VBR constrained)
      const vbit = Math.round(videoBitrateKbps);
      const maxrate = vbit;
      const bufsize = Math.round(videoBitrateKbps * 2);
      args.push('-c:v', 'h264_nvenc', '-preset', nvencPreset, '-rc', 'vbr', '-b:v', `${vbit}k`, '-maxrate', `${maxrate}k`, '-bufsize', `${bufsize}k`);
    }
  } else {
    // libx264
    const x264Preset = maxQuality ? 'veryslow' : 'slow';
    if (pass === 0) {
      args.push('-c:v', 'libx264', '-preset', x264Preset, '-crf', crfValue.toString());
    } else if (pass === 1 || pass === 2) {
      const vbit = Math.round(videoBitrateKbps);
      // Strict ABR for libx264 2-pass (no maxrate VBV)
      args.push('-c:v', 'libx264', '-preset', x264Preset, '-b:v', `${vbit}k`, '-pass', pass.toString());
    }
  }
  
  args.push('-t', seekTimes.duration.toFixed(3));

  // Video stream mapping
  args.push('-map', '0:v:0');

  if ((pass === 2 || pass === 0) && hasAudio && outputFormat !== 'gif') {
    // Audio stream mapping (pass 2 or single pass)
    args.push('-map', `0:a:${selectedAudioTrackIndex}`);
  }

  if (outputFormat !== 'gif') {
    args.push('-pix_fmt', 'yuv420p');
  }

  // Force Constant Frame Rate (CFR)
  // If the source is VFR, the 'null' muxer (Pass 1) and 'mp4' muxer (Pass 2) might 
  // negotiate different framerates/timebases with libx264, causing Pass 2 to fail with EINVAL.
  if (frameRate && frameRate > 0) {
    args.push('-r', frameRate.toString());
  }

  // Filter chain
  const filters = [];
  
  if (crop && crop.enable) {
    filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  }

  // Scale filter (only when downscaling)
  if (needsScale) {
    // Use even dimensions (required by libx264) via the pad trick:
    //   scale to target with aspect-ratio preservation, then pad to exact target.
    filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`);
  }

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  if (pass === 1) {
    // Pass 1: no audio, output to null
    args.push('-an');
    args.push('-f', 'null');
    // NOTE: NUL output path is appended by the Encoder module at call time
  } else {
    // Pass 2 or Single Pass: audio + container flags
    if (hasAudio) {
      args.push('-c:a', 'aac');
      const audioBitrateArg = audioBitrateKbps + 'k';
      args.push('-b:a', audioBitrateArg);
    }
    args.push('-movflags', '+faststart');
    // NOTE: output path is appended by the Encoder module at call time
  }

  return args;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  calculatePlan,
  // Exported for testing internals
  _internals: {
    computeSizeLimitBitrate,
    resolveResolution,
    computeSeekTimes,
    buildPassArgs,
    QUALITY_FLOORS,
    SAFETY_MARGIN,
    MUXING_OVERHEAD,
    ABSOLUTE_MIN_VIDEO_BITRATE_KBPS,
    FAST_SEEK_RUNWAY_SECONDS
  }
};
