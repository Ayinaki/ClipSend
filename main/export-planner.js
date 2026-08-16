/**
 * ExportPlanner — Computes a deterministic 2-pass FFmpeg encoding plan.
 *
 * Encoder selection is delegated to encoder-profiles.js: given the user's
 * hardware-acceleration preference, the chosen video codec (H.264 / AV1),
 * and what the bundled FFmpeg reports as available, the planner resolves the
 * concrete encoder and builds the right rate-control args for it. The
 * container follows the format picker: mp4 (H.264 or AV1, AAC audio),
 * webm (VP9 or AV1, Opus audio), gif, or mp3. WebM cannot carry H.264, so
 * an H.264 request under WebM is remapped to VP9 (libvpx-vp9, CPU-only).
 */

/**
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
 * Extra bitrate discount for SVT-AV1 2-pass exports.
 *
 * Measured against real encodes (Aug 2026, SVT-AV1 v4.2.0): on short
 * (<=10s) high-detail clips in the 3-10 Mbps range, SVT's 2-pass rate
 * control runs ~10% hot (delivers 1.10x the requested bitrate), blowing
 * through the generic safety margin above. On long clips and normal
 * content it is accurate to ~1%. Rather than fatten the generic margin
 * (which would shrink every libx264/VP9 export), discount only SVT's
 * budget so size-capped AV1 exports stay under the platform limit.
 */
const SVT_SAFETY_FACTOR = 0.92;

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
// Encoder selection
// ---------------------------------------------------------------------------

const {
  pickEncoder,
  buildVideoCodecArgs,
  isHardwareEncoder,
  audioCodecFor,
  containerForFormat,
  codecForFormat
} = require('./encoder-profiles');

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

  const sourceDuration = trimOut - trimIn;
  // Playback speed: the file's on-screen length is sourceDuration / speed
  // (setpts/atempo shorten or lengthen it). Bitrate budgets, -t durations,
  // size estimates, and encoder progress all work on the OUTPUT duration.
  const speed = normalizeSpeed(settings.playbackSpeed);
  const clipDuration = sourceDuration / speed;

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
  // Codec-remap warnings (e.g. WebM -> VP9) are recorded early but merged
  // into `warnings` AFTER the resolution decision — resolveResolution
  // replaces the array wholesale, so pushing early would lose them.
  let codecWarnings = [];

  // Resolve the concrete encoder from the user's HW preference + codec choice
  // + what this machine's FFmpeg actually ships. WebM remaps an H.264 request
  // to VP9 (the container cannot carry H.264); AV1 stays AV1 in WebM.
  const requestedCodec = settings.videoCodec === 'av1' ? 'av1' : 'h264';
  const videoCodec = codecForFormat(settings.outputFormat, requestedCodec);
  const isWebm = settings.outputFormat === 'webm';

  // WebM + H.264 means VP9, which is software-only here and must exist in
  // the bundled build. Gate on the runtime capability map when it's known
  // (same pattern as the atempo check below) so an old FFmpeg build fails
  // with a clear message instead of a cryptic "unknown encoder" error.
  if (isWebm && videoCodec === 'vp9') {
    const capsKnown = !!(settings.encoders &&
      typeof settings.encoders === 'object' &&
      Object.keys(settings.encoders).length > 0);
    if (capsKnown && !settings.encoders.vpx9) {
      throw new Error(
        'WebM export requires the VP9 encoder (libvpx-vp9), which this FFmpeg build does not ship. ' +
        'Update ClipSend to a build with the latest bundled FFmpeg, or pick MP4 or AV1 instead.'
      );
    }
    codecWarnings.push({
      id: 'webm-vp9',
      title: 'WebM uses VP9 instead of H.264',
      body: 'WebM cannot contain H.264, so the video will be encoded with VP9 on the CPU. Hardware acceleration does not apply to VP9 exports.'
    });
  }

  const encoder = pickEncoder({
    hwAccel: settings.hwAccel,
    videoCodec,
    encoders: settings.encoders,
    hasNvenc: settings.hasNvenc
  });

  // Hardware encoders are single-pass (no two-pass stats file support);
  // GIF extraction and auto/CRF mode are single-pass too.
  if (isHardwareEncoder(encoder)) {
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
      // SVT-AV1 2-pass runs hot on short high-detail clips (see
      // SVT_SAFETY_FACTOR); discount its budget so the output stays
      // under the cap. Hardware/VP9/libx264 encoders are accurate and
      // keep the full budget.
      if (encoder === 'libsvtav1') {
        videoBitrateKbps *= SVT_SAFETY_FACTOR;
      }
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

  // Merge any codec-remap warnings back in now that resolution is decided.
  warnings = warnings.concat(codecWarnings);

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

  // Speed with audio needs the atempo filter. The bundled slim FFmpeg build
  // did not ship it until atempo was added to scripts/build-ffmpeg.sh, so the
  // runtime capability map (encoder:detect -> settings.encoders.atempo) gates
  // it. Without it an audio+speed export would silently desync or fail with a
  // cryptic "filter not found" error, so fail loudly with a clear message.
  if (speed !== 1 && hasAudio && settings.outputFormat !== 'gif') {
    const atempoAvailable = !!(settings.encoders && settings.encoders.atempo);
    if (!atempoAvailable) {
      throw new Error(
        `Speed ${speed}x with audio requires the atempo filter, which this FFmpeg build does not ship. ` +
        'Update ClipSend to a build with the latest bundled FFmpeg, or remove the audio track from the export.'
      );
    }
  }

  // ------ MP3 audio-only export ------
  if (settings.outputFormat === 'mp3') {
    if (!hasAudio) {
      throw new Error('Cannot export MP3: the source file has no audio tracks.');
    }

    const seekTimes = computeSeekTimes(trimIn, trimOut);
    const mp3BitrateKbps = settings.audioBitrateKbps ?? 192;

    const singlePassArgs = [
      '-y',
      '-ss', String(seekTimes.inputSeek),
      '-i', mediaInfo.filePath,
      '-vn',
      '-map', `0:a:${selectedAudioTrackIndex}`,
      '-c:a', 'libmp3lame',
      '-b:a', `${mp3BitrateKbps}k`,
      '-t', clipDuration.toFixed(3)
    ];

    // Tempo change is audio-only, so the atempo chain applies here too.
    if (speed !== 1) {
      singlePassArgs.push('-af', atempoFilter(speed));
    }

    const estimatedSizeMB = (mp3BitrateKbps * 1000 * clipDuration / 8) / (1024 * 1024);

    return {
      clipDuration,
      isSinglePass: true,
      singlePassArgs,
      warnings: [],
      audioTracks: mediaInfo.audioTracks,
      selectedAudioOrdinal: selectedAudioTrackIndex,
      encoder: 'libmp3lame',
      playbackSpeed: speed,
      codec: 'mp3',
      container: 'mp3',
      outputFormat: 'mp3',
      width: 0,
      height: 0,
      crfValue: undefined,
      targetSizeMB: settings.targetSizeMB,
      estimatedSizeMB: parseFloat(estimatedSizeMB.toFixed(2)),
      videoBitrateKbps: 0,
      audioBitrateKbps: mp3BitrateKbps,
      totalBitrateKbps: mp3BitrateKbps
    };
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
      outputFormat: settings.outputFormat,
      codec: videoCodec,
      speed
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
      // GIF extraction has no real video codec/container; report it honestly.
      codec: settings.outputFormat === 'gif' ? 'gif' : videoCodec,
      container: containerForFormat(settings.outputFormat),
      playbackSpeed: speed,
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
    maxQuality: settings.maxQuality,
    // The 2-pass path used to omit outputFormat, which made buildPassArgs
    // default to the mp4 container — invisible while mp4 was the only 2-pass
    // format, but wrong for WebM (opus audio + no faststart).
    outputFormat: settings.outputFormat,
    codec: videoCodec,
    speed
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
    maxQuality: settings.maxQuality,
    outputFormat: settings.outputFormat,
    codec: videoCodec,
    speed
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
    encoder,
    codec: videoCodec,
    container: containerForFormat(settings.outputFormat),
    outputFormat: settings.outputFormat,
    playbackSpeed: speed
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
 * Applies a dynamic safety margin for short clips where I-frame overhead
 * represents a higher percentage of the total file size.
 */
function computeSizeLimitBitrate(targetSizeMB, clipDurationSec, audioBitrateKbps) {
  const targetBytes = targetSizeMB * 1024 * 1024;
  
  // Dynamic safety margin based on clip duration
  let safetyMargin = SAFETY_MARGIN;
  if (clipDurationSec < 2.0) {
    safetyMargin = 0.85;
  } else if (clipDurationSec < 3.5) {
    safetyMargin = 0.88;
  } else if (clipDurationSec < 6.0) {
    safetyMargin = 0.92;
  } else if (clipDurationSec < 10.0) {
    safetyMargin = 0.94;
  }

  const safeBytes = targetBytes * safetyMargin;
  const usableBytes = safeBytes * (1 - MUXING_OVERHEAD);
  const totalBitrateBps = (usableBytes * 8) / clipDurationSec;
  const totalBitrateKbps = totalBitrateBps / 1000;
  let videoBitrateKbps = totalBitrateKbps - audioBitrateKbps;

  // Cap maximum video bitrate to 25 Mbps to prevent rate-control overshoot
  if (videoBitrateKbps > 25000) {
    videoBitrateKbps = 25000;
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
 * Clamp a playback-speed request into the supported range. Anything missing/
 * non-numeric means 1x (no tempo change at all).
 */
function normalizeSpeed(speed) {
  const s = Number(speed);
  if (!isFinite(s) || s <= 0) return 1;
  return Math.min(4, Math.max(0.25, s));
}

/**
 * Build an atempo filter chain for a target speed. Older FFmpeg's atempo is
 * limited to 0.5–2.0 per instance, so speeds outside that range are factored
 * into chained instances whose product equals the target (e.g. 3x = 1.5x × 2x).
 * Modern builds allow 0.5–100 in one filter, but the chain is universally safe.
 */
function atempoFilter(speed) {
  const parts = [];
  let remaining = speed;
  while (remaining > 2) {
    parts.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  parts.push(`atempo=${remaining.toFixed(3)}`);
  return parts.join(',');
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
    encoder, crop, maxQuality, outputFormat,
    speed = 1
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
  } else {
    // CPU encoders use CRF/quality args in single-pass mode and 2-pass
    // bitrate args otherwise; hardware encoders stay single-pass VBR.
    args.push(...buildVideoCodecArgs({
      encoder,
      crfValue,
      videoBitrateKbps,
      maxQuality,
      pass
    }));
  }
  
  // -t limits OUTPUT time: with speed, the output is sourceDuration / speed
  // (setpts/atempo compress or stretch the timeline), so the stop point must
  // follow the sped-up clock, not the source clock.
  args.push('-t', (seekTimes.duration / speed).toFixed(3));

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

  // Playback speed: compress (or stretch) the video timeline. setpts is
  // shipped by every build; the audio side (atempo) is gated on the runtime
  // capability map in calculatePlan. Placed last so it operates on the
  // already-cropped/scaled frames.
  if (speed !== 1) {
    filters.push(`setpts=PTS/${speed}`);
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
    const container = containerForFormat(outputFormat);
    if (hasAudio) {
      args.push('-c:a', audioCodecFor(container));
      const audioBitrateArg = audioBitrateKbps + 'k';
      args.push('-b:a', audioBitrateArg);
      // The native opus encoder (WebM audio) is marked experimental and
      // refuses to open without this — the slim build deliberately avoids
      // linking libopus, so WebM always goes through the in-tree encoder.
      if (container === 'webm') {
        args.push('-strict', '-2');
      }
      // Tempo-change the audio to match setpts (atempo preserves pitch).
      // GIF extraction maps no audio stream, so the filter chain must stay
      // video-only there.
      if (speed !== 1 && outputFormat !== 'gif') {
        args.push('-af', atempoFilter(speed));
      }
    }
    // MP4 (H.264/AV1) benefits from the faststart relocation so video starts
    // playing before the whole file downloads; WebM/Matroska doesn't need it
    // (the cues live near the stream data).
    if (container === 'mp4') {
      args.push('-movflags', '+faststart');
    }
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
    normalizeSpeed,
    atempoFilter,
    QUALITY_FLOORS,
    SAFETY_MARGIN,
    MUXING_OVERHEAD,
    ABSOLUTE_MIN_VIDEO_BITRATE_KBPS,
    FAST_SEEK_RUNWAY_SECONDS
  }
};
