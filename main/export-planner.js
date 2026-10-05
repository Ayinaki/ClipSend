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
 * How much of a size-limit budget audio may claim before it starts eating
 * into video.
 *
 * The size-limit math used to subtract the requested audio bitrate from the
 * total budget unconditionally, so the moment the audio rate alone exceeded
 * the budget the plan came out with a negative video bitrate and the export
 * died with "Computed video bitrate is invalid". That is not a corner case:
 * a 21-minute clip in a 20 MB target affords ~123 kbps in total, less than
 * the 128 kbps audio default, so *every* long-clip/small-target export was
 * refused with a nonsense error (the message blamed the clip duration, which
 * was fine).
 *
 * Audio is the negotiable side of a tight budget — nobody needs 128 kbps
 * stereo to follow speech in a size-capped clip, and a quarter of the budget
 * is plenty for AAC — so the split caps audio here and hands the rest to the
 * video, which is what the viewer actually looks at.
 */
const AUDIO_BUDGET_SHARE = 0.25;

/**
 * Floor for a negotiated audio bitrate. AAC-LC stays intelligible down to
 * ~32 kbps; squeezing further to protect the video bitrate produces artifacts
 * that are not worth the bytes, and the video floor below refuses those plans
 * anyway.
 */
const MIN_AUDIO_BITRATE_KBPS = 32;

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
  // Export-audio request from the transport controls. Muted (or zero volume)
  // means no audio stream is written at all, so a size-capped plan must not
  // reserve audio bitrate for a track it will never encode.
  const audioRequest = normalizeAudio(settings.audio);
  const audioMuted = audioRequest.muted || audioRequest.volume === 0;
  const audioGain = audioRequest.volume;
  // Watermark request normalized once so every pass sees identical values.
  const watermark = normalizeWatermark(settings.watermark);

  let audioBitrateKbps = settings.audioBitrateKbps ?? DEFAULT_AUDIO_BITRATE_KBPS;
  let videoBitrateKbps = 0;

  // Whether the source carries audio at all. A silent source must not pay the
  // audio bitrate out of a size-limit budget — subtracting it anyway used to
  // hand such clips 128 kbps less video than the target could afford. The full
  // track validation (ordinal existence) still runs below, after the budget is
  // settled; this only decides how the budget is split.
  const sourceHasAudio = Array.isArray(mediaInfo.audioTracks) && mediaInfo.audioTracks.length > 0;
  
  const isCropped = settings.crop && settings.crop.enable;
  const sourceWidth = isCropped ? settings.crop.w : mediaInfo.width;
  const sourceHeight = isCropped ? settings.crop.h : mediaInfo.height;
  
  let width = sourceWidth;
  let height = sourceHeight;
  let isSinglePass = false;
  let crfValue = undefined;
  let warnings = [];
  // Warnings produced before the resolution decision (codec remaps, a
  // squeezed audio bitrate) are collected here and merged into `warnings`
  // AFTER it — resolveResolution replaces the array wholesale, so pushing
  // early would drop them.
  const deferredWarnings = [];

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
    deferredWarnings.push({
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

  // Size-limit bookkeeping, declared at function scope because both the floor
  // check inside the branch below AND the SVT discount check further down need
  // the real budget and the audio bitrate the caller actually asked for
  // (audioBitrateKbps has already been replaced by the squeezed value at that
  // point, so it cannot stand in for the request).
  let sizeLimitTargetMB = 0;
  let sizeLimitTotalKbps = 0;
  let requestedAudioKbps = 0;

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
      sizeLimitTargetMB = settings.targetSizeMB ?? 10;
      requestedAudioKbps = (sourceHasAudio && !audioMuted) ? audioBitrateKbps : 0;
      // The budget decides the split, so the audio bitrate the plan encodes at
      // must come back out of it — encoding at the requested rate while
      // budgeting for a smaller one is how a size-capped export overshoots.
      const budget = planSizeLimitBudget(
        sizeLimitTargetMB,
        clipDuration,
        requestedAudioKbps
      );
      videoBitrateKbps = budget.videoBitrateKbps;
      sizeLimitTotalKbps = budget.totalBitrateKbps;
      if (sourceHasAudio && budget.audioBitrateKbps < audioBitrateKbps) {
        deferredWarnings.push({
          id: 'audio-squeezed',
          title: 'Audio bitrate reduced',
          body: `Audio dropped to ${budget.audioBitrateKbps} kbps from ` +
            `${Math.round(audioBitrateKbps)} kbps so the video keeps enough of the ` +
            `${Math.round(budget.totalBitrateKbps)} kbps that ${sizeLimitTargetMB} MB allows. ` +
            'Encode to a larger target for full-quality audio.'
        });
      }
      audioBitrateKbps = budget.audioBitrateKbps;
    } else {
      // custom mode — user supplies video bitrate directly
      videoBitrateKbps = settings.customBitrateKbps;
    }

    if (isNaN(videoBitrateKbps) || !isFinite(videoBitrateKbps)) {
      throw new Error(
        `Computed video bitrate is invalid (${videoBitrateKbps}). ` +
        `Ensure the clip duration and the target size are greater than 0.`
      );
    }

    if (videoBitrateKbps < ABSOLUTE_MIN_VIDEO_BITRATE_KBPS) {
      // Two very different situations land here, and they need different
      // advice: a custom-mode user who asked for a bitrate that is too low,
      // and a size-limit user whose clip simply cannot fit the target. The old
      // single message told both of them to check the clip duration, which was
      // useless when the duration was fine and the target was the problem.
      // Thrown (not wrapped): sizeLimitFloorError already carries the message
      // AND the structured fix numbers, and `new Error(anError)` would flatten
      // it to a string and drop `.planFix`.
      if (settings.mode === 'size-limit') {
        throw sizeLimitFloorError(clipDuration, sizeLimitTargetMB, requestedAudioKbps, sizeLimitTotalKbps);
      }
      throw new Error(
        `Computed video bitrate (${Math.round(videoBitrateKbps)} kbps) is below the ` +
        `minimum threshold of ${ABSOLUTE_MIN_VIDEO_BITRATE_KBPS} kbps. ` +
        `Raise the custom bitrate to at least ${ABSOLUTE_MIN_VIDEO_BITRATE_KBPS} kbps.`
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

  // SVT-AV1 2-pass runs hot on short high-detail clips (see SVT_SAFETY_FACTOR):
  // discount its bitrate budget so the output stays under the platform cap.
  // Applied AFTER the resolution decision on purpose — the resolution is
  // chosen from the full budget the user's target size affords (SVT's hot
  // runs actually deliver ~the full budget on the clips it overshoots), and
  // discounting earlier would push plans just above a quality floor into an
  // unnecessary downscale. Hardware/VP9/libx264 encoders are accurate and
  // keep the full budget.
  if (settings.mode === 'size-limit' && encoder === 'libsvtav1') {
    videoBitrateKbps *= SVT_SAFETY_FACTOR;
    // The pre-discount budget already passed ABSOLUTE_MIN above, but the
    // discount can push a 50-54 kbps plan below the declared floor — refuse
    // rather than silently encode below it. Round to match what
    // buildVideoCodecArgs actually encodes (Math.round), so a 49.5 kbps
    // budget that lands on the valid 50 kbps minimum is not rejected.
    if (Math.round(videoBitrateKbps) < ABSOLUTE_MIN_VIDEO_BITRATE_KBPS) {
      // Same structured fix as the generic floor above: SVT's discount pushed a
      // passing plan below the floor, and the clip really is too long for this
      // target, so trimming is the actionable fix.
      const err = new Error(
        `Computed video bitrate (${Math.round(videoBitrateKbps)} kbps) is below the ` +
        `minimum threshold of ${ABSOLUTE_MIN_VIDEO_BITRATE_KBPS} kbps. ` +
        `The clip is too long for the selected target size.`
      );
      err.planFix = buildPlanFix(clipDuration, sizeLimitTargetMB, requestedAudioKbps);
      throw err;
    }
  }

  // Merge the deferred warnings back in now that resolution is decided.
  warnings = warnings.concat(deferredWarnings);

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

  // Audio actually written to the file. The source may have tracks and still
  // export silently (the transport was muted), and every downstream consumer
  // — stream mapping, the audio filters, and the size estimate — must agree.
  const encodeAudio = hasAudio && !audioMuted;

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

  // Volume below unity needs FFmpeg's volume filter. Probe it like atempo and
  // overlay (encoder:detect -> settings.encoders.volume) so a build that lacks
  // it fails with a clear message instead of a cryptic "No such filter".
  // Muting needs no filter at all (it drops the stream), so it is never gated.
  if (!audioMuted && audioGain < 1 && settings.outputFormat !== 'mp3') {
    const capsKnown = !!(settings.encoders &&
      typeof settings.encoders === 'object' &&
      Object.keys(settings.encoders).length !== 0);
    if (capsKnown && !settings.encoders.volume) {
      throw new Error(
        'Adjusting the export volume needs the volume filter, which this FFmpeg build does not ship. ' +
        'Update ClipSend to a build with the latest bundled FFmpeg, or set the volume back to 100%.'
      );
    }
  }

  // A watermark burns an image over the video via the overlay filter. Gate on
  // the runtime filter probe (encoder:detect -> settings.encoders.overlay) like
  // the atempo check above, so an old FFmpeg build fails with a clear message
  // instead of a cryptic "No such filter: 'overlay'".
  if (watermark) {
    const capsKnown = !!(settings.encoders &&
      typeof settings.encoders === 'object' &&
      Object.keys(settings.encoders).length !== 0);
    if (capsKnown && !settings.encoders.overlay) {
      throw new Error(
        'A watermark needs the overlay filter, which this FFmpeg build does not ship. ' +
        'Update ClipSend to a build with the latest bundled FFmpeg, or remove the watermark.'
      );
    }
  }

  // ------ MP3 audio-only export ------
  // The mute button is deliberately ignored here: an MP3's whole purpose is
  // its audio, so a muted transport must not produce an empty file. (A silent
  // video export is the case mute exists for.)
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
      hasAudio: encodeAudio,
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
      speed,
      watermark,
      volume: audioGain,
      muted: audioMuted
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
      estimatedSizeMB: parseFloat((((videoBitrateKbps + (encodeAudio ? audioBitrateKbps : 0)) * 1000 * clipDuration / 8) / (1024 * 1024)).toFixed(2)),
      videoBitrateKbps: Math.round(videoBitrateKbps),
      totalBitrateKbps: Math.round(videoBitrateKbps + (encodeAudio ? audioBitrateKbps : 0)),
      audioBitrateKbps: encodeAudio ? audioBitrateKbps : 0,
      outputFormat: settings.outputFormat
    };
  }

  const pass1Args = buildPassArgs({
    pass: 1,
    inputPath: mediaInfo.filePath,
    seekTimes,
    videoBitrateKbps,
    audioBitrateKbps,
    hasAudio: encodeAudio,
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
    speed,
    watermark,
    volume: audioGain,
    muted: audioMuted
  });

  const pass2Args = buildPassArgs({
    pass: 2,
    inputPath: mediaInfo.filePath,
    seekTimes,
    videoBitrateKbps,
    audioBitrateKbps,
    hasAudio: encodeAudio,
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
    speed,
    watermark,
    volume: audioGain,
    muted: audioMuted
  });

  // ------ Estimated output size ------
  const totalBitrateKbps = videoBitrateKbps + (encodeAudio ? audioBitrateKbps : 0);
  const estimatedSizeMB = (totalBitrateKbps * 1000 * clipDuration / 8) / (1024 * 1024);

  return {
    clipDuration,
    targetSizeMB: settings.targetSizeMB,
    estimatedSizeMB: parseFloat(estimatedSizeMB.toFixed(2)),
    videoBitrateKbps: Math.round(videoBitrateKbps),
    audioBitrateKbps: encodeAudio ? audioBitrateKbps : 0,
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
 * Split a size-limit budget between audio and video.
 *
 * Applies a dynamic safety margin for short clips where I-frame overhead
 * represents a higher percentage of the total file size, then divides what is
 * left between the two streams. Audio is capped at its share of a tight budget
 * (see AUDIO_BUDGET_SHARE) so a long clip still gets a usable video bitrate
 * instead of the plan coming out negative.
 *
 * @param {number} targetSizeMB
 * @param {number} clipDurationSec - OUTPUT duration (after playback speed)
 * @param {number} requestedAudioKbps - 0 when the source has no audio at all
 * @returns {{ totalBitrateKbps: number, audioBitrateKbps: number, videoBitrateKbps: number }}
 */
function planSizeLimitBudget(targetSizeMB, clipDurationSec, requestedAudioKbps) {
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

  let audioBitrateKbps = 0;
  if (requestedAudioKbps > 0) {
    // Never more than the request, never more than its share of the budget.
    audioBitrateKbps = Math.min(
      requestedAudioKbps,
      Math.max(MIN_AUDIO_BITRATE_KBPS, totalBitrateKbps * AUDIO_BUDGET_SHARE)
    );
    // Squeeze below the audio floor only when the video floor would otherwise
    // be starved, and then stop: below MIN_AUDIO_BITRATE_KBPS the encode is not
    // worth making, and the caller refuses the plan with an explanation.
    audioBitrateKbps = Math.max(
      Math.min(audioBitrateKbps, totalBitrateKbps - ABSOLUTE_MIN_VIDEO_BITRATE_KBPS),
      MIN_AUDIO_BITRATE_KBPS
    );
    // Whole kbps only: this value ends up in the `-b:a` argument and in the
    // plan summary the UI renders. Rounding happens here (rather than at the
    // argument) so the bitrate the plan displays is the bitrate it encodes.
    audioBitrateKbps = Math.round(audioBitrateKbps);
  }

  let videoBitrateKbps = totalBitrateKbps - audioBitrateKbps;

  // Cap maximum video bitrate to 25 Mbps to prevent rate-control overshoot
  if (videoBitrateKbps > 25000) {
    videoBitrateKbps = 25000;
  }
  // Never report a negative video bitrate. When the budget cannot cover even
  // the audio floor there is nothing left for video, and the caller's floor
  // check refuses the plan with an explanation instead of a negative number.
  if (videoBitrateKbps < 0) videoBitrateKbps = 0;

  return { totalBitrateKbps, audioBitrateKbps, videoBitrateKbps };
}

/**
 * Video-share-only view of planSizeLimitBudget, kept for callers that just
 * want the video bitrate (merger.js and the arithmetic unit tests).
 */
function computeSizeLimitBitrate(targetSizeMB, clipDurationSec, audioBitrateKbps) {
  return planSizeLimitBudget(targetSizeMB, clipDurationSec, audioBitrateKbps).videoBitrateKbps;
}

/**
 * Human "m:ss" / "h:mm:ss" duration for error copy, local to the planner so
 * the message reads the same wherever it is surfaced.
 */
function formatClipDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Upper bound for the target-size search below, so a nonsense input cannot
 *  spin the doubling loop forever. */
const MAX_TARGET_SEARCH_MB = 1000000;

/**
 * Smallest target size (MB) whose budget still clears the video floor.
 * Bisected rather than solved in closed form: the audio split has a min/max
 * kink (and the safety margin steps down by duration), so an algebraic answer
 * is easy to get wrong by a few megabytes — which is exactly the number the
 * user is being told to pick.
 *
 * @returns {number|null} null when no reasonable target fits
 */
function minimumTargetSizeMB(clipDurationSec, requestedAudioKbps) {
  const fits = (mb) =>
    planSizeLimitBudget(mb, clipDurationSec, requestedAudioKbps).videoBitrateKbps >=
    ABSOLUTE_MIN_VIDEO_BITRATE_KBPS;

  let lo = 0; // a 0 MB target can never fit, so this is a valid lower bound
  let hi = 1;
  while (hi <= MAX_TARGET_SEARCH_MB && !fits(hi)) {
    lo = hi;
    hi *= 2;
  }
  if (hi > MAX_TARGET_SEARCH_MB) return null;

  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Longest clip (seconds) that still clears the video floor at this target.
 * The budget shrinks monotonically as the duration grows, so this is a
 * well-behaved bisection too.
 *
 * @returns {number} 0 when even a very short clip cannot fit
 */
function maximumClipDurationSec(targetSizeMB, requestedAudioKbps) {
  const fits = (sec) =>
    planSizeLimitBudget(targetSizeMB, sec, requestedAudioKbps).videoBitrateKbps >=
    ABSOLUTE_MIN_VIDEO_BITRATE_KBPS;

  let lo = 0.1; // guards the divide-by-duration in the budget math
  if (!fits(lo)) return 0;
  let hi = lo * 2;
  while (hi < 360000 && fits(hi)) {
    lo = hi;
    hi *= 2;
  }
  if (fits(hi)) return hi;

  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Explain a size-limit plan that cannot reach the video floor, in the numbers
 * the user can act on: what target would work, and how long a clip this target
 * can hold. Reports the total budget rather than the leftover video bitrate,
 * because on the tightest budgets the leftover is 0 and says nothing about
 * what is actually wrong.
 */
function sizeLimitFloorMessage(clipDuration, targetSizeMB, requestedAudioKbps, totalBitrateKbps) {
  let message =
    `A ${formatClipDuration(clipDuration)} clip does not fit in ${targetSizeMB} MB: the size ` +
    `budget is only ${Math.round(totalBitrateKbps)} kbps, below the minimum threshold of ` +
    `${ABSOLUTE_MIN_VIDEO_BITRATE_KBPS} kbps for video.`;

  const minimumMB = minimumTargetSizeMB(clipDuration, requestedAudioKbps);
  message += minimumMB
    ? ` Raise the target size to at least ${minimumMB.toFixed(1)} MB`
    : ' Raise the target size';

  const maximumSec = maximumClipDurationSec(targetSizeMB, requestedAudioKbps);
  if (maximumSec > 0) {
    message += `, or trim the clip to ${formatClipDuration(maximumSec)} or less`;
  }
  return `${message}.`;
}

/**
 * Structured "what would actually work" numbers for a refused or tight plan.
 *
 * The refusal message quotes these as prose, which is enough to read but not
 * enough to act on: the renderer needs the raw numbers to offer a one-click
 * fix ("Trim to 42s to fit 20 MB") instead of making the user re-read the
 * sentence and drag the Out handle by hand. Attached to the refusal error as
 * `err.planFix` and forwarded to the renderer by ipc-handlers.
 *
 * @param {number} clipDurationSec - current (speed-adjusted) clip length
 * @param {number} targetSizeMB
 * @param {number} requestedAudioKbps - 0 when the export has no audio
 * @returns {{ maximumClipDurationSec: number|null, minimumTargetSizeMB: number|null }}
 */
function buildPlanFix(clipDurationSec, targetSizeMB, requestedAudioKbps) {
  const maximumSec = maximumClipDurationSec(targetSizeMB, requestedAudioKbps);
  const minimumMB = minimumTargetSizeMB(clipDurationSec, requestedAudioKbps);
  return {
    maximumClipDurationSec: maximumSec > 0 ? parseFloat(maximumSec.toFixed(2)) : null,
    minimumTargetSizeMB: minimumMB != null ? parseFloat(minimumMB.toFixed(1)) : null
  };
}

/**
 * The size-limit refusal as an Error that also carries the fix numbers above.
 * Callers keep catching a normal Error (message unchanged); only the export
 * IPC layer reads `.planFix`.
 */
function sizeLimitFloorError(clipDuration, targetSizeMB, requestedAudioKbps, totalBitrateKbps) {
  const err = new Error(
    sizeLimitFloorMessage(clipDuration, targetSizeMB, requestedAudioKbps, totalBitrateKbps)
  );
  err.planFix = buildPlanFix(clipDuration, targetSizeMB, requestedAudioKbps);
  return err;
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
 * Normalize the export-audio request (the transport's volume slider and mute
 * button) into a safe shape.
 *
 * The export used to ignore both: the slider and mute only drove the preview
 * <video>, so a clip you muted still exported with full audio, and the preview
 * was not honest about what the file would sound like. `volume` is now the
 * export's audio gain (1 = full volume) and `muted` drops the audio stream.
 * Missing/non-numeric input means unity gain, so callers that never pass an
 * `audio` block (older saved plans, the merge path, tests) are unaffected.
 */
function normalizeAudio(audio) {
  const muted = !!(audio && audio.muted);
  const raw = audio ? audio.volume : undefined;
  const n = Number(raw);
  const volume = (raw == null || !isFinite(n)) ? 1 : Math.min(1, Math.max(0, n));
  return { muted, volume };
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
 * Watermark (image overlay) helpers.
 *
 * A watermark is a still image (PNG with alpha is the intended case) overlaid
 * on the exported video. The slim FFmpeg build already ships the overlay
 * filter and PNG decode, so no build change is needed. These fragments are
 * shared by the trim planner (buildPassArgs) and the merge re-encode path
 * (merger._runConcatFilter) so both produce identical overlays.
 */
const WATERMARK_POSITIONS = ['tl', 'tr', 'bl', 'br'];

/**
 * Clamp a raw watermark request into a safe shape. Returns null when no
 * watermark is requested (or no image path), so callers can branch on truthy.
 */
function normalizeWatermark(wm) {
  if (!wm || typeof wm.path !== 'string' || !wm.path) return null;
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  return {
    path: wm.path,
    position: WATERMARK_POSITIONS.includes(wm.position) ? wm.position : 'br',
    // Logo width as a share of the OUTPUT frame width. Opacity 0.1-1 is
    // baked into the image by the renderer before export (the slim FFmpeg
    // has no alpha-scaling filter); the export graph positions and sizes it.
    sizePct: clamp(wm.sizePct, 5, 50, 15),
    opacity: clamp(wm.opacity, 0.1, 1, 0.85)
  };
}

/**
 * Filter-graph fragments for one watermark, placed in the corner position of
 * an outW x outH output frame. inputIndex is the watermark's input ordinal
 * (1 for the trim path, N for the merge path).
 *
 * prepare renders the logo at the requested size with its alpha scaled by
 * the requested opacity; overlay is appended to the main video chain. The
 * coordinates use overlay's own w/h/W/H variables, so nothing here depends on
 * decoding the image's natural size.
 */
function watermarkFilterParts(wm, outW, outH, inputIndex) {
  const wmWidthPx = Math.max(16, Math.round((outW || 0) * (wm.sizePct / 100)) || 64);
  // 2% margin from the frame edge, matching the preview overlay in the UI.
  const margin = Math.max(8, Math.round((outW || 0) * 0.02));
  const x = wm.position === 'tl' || wm.position === 'bl'
    ? String(margin)
    : `${outW}-w-${margin}`;
  const y = wm.position === 'tl' || wm.position === 'tr'
    ? String(margin)
    : `${outH}-h-${margin}`;
  return {
    // Opacity is baked into the image upstream (the slim FFmpeg ships no
    // alpha-scaling filter), so this chain only sizes the logo; format=rgba
    // guarantees an alpha plane for the overlay even for JPEG sources.
    prepare: `[${inputIndex}:v:0]scale=${wmWidthPx}:-1,format=rgba[wm]`,
    // eof_action=repeat holds the still image for the whole clip (and lets a
    // one-frame PNG input work without any -loop hackery).
    overlay: `overlay=x=${x}:y=${y}:eof_action=repeat`
  };
}

/**
 * Apply the video filter chain to one pass's args: the plain -vf path, or the
 * watermark's -filter_complex path (a still overlay needs two inputs).
 *   - The overlay runs LAST (after crop and scale) so the logo lands in a
 *     corner of the actual output frame and can never be cropped away.
 *   - setpts runs after the overlay (overlay matches frames by timestamp;
 *     retiming the combined stream keeps the still logo pinned).
 */
function applyVideoFilters(args, filters, { wm, width, height, speed }) {
  const wmParts = wm ? watermarkFilterParts(wm, width, height, 1) : null;
  if (wmParts) {
    const baseChain = filters.join(',');
    const tail = [wmParts.overlay];
    if (speed !== 1) tail.push('setpts=PTS/' + speed);
    const overlayChain = tail.join(',');
    args.push('-filter_complex', baseChain
      ? wmParts.prepare + ';[0:v:0]' + baseChain + '[base];[base][wm]' + overlayChain + '[vout]'
      : wmParts.prepare + ';[0:v:0][wm]' + overlayChain + '[vout]');
    return;
  }
  // Playback speed: compress (or stretch) the video timeline. setpts is
  // shipped by every build; the audio side (atempo) is gated on the runtime
  // capability map in calculatePlan. Placed last so it operates on the
  // already-cropped/scaled frames.
  if (speed !== 1) {
    filters.push('setpts=PTS/' + speed);
  }
  if (filters.length !== 0) {
    args.push('-vf', filters.join(','));
  }
}

/**
 * Worst-case free disk space (bytes) an export needs on the target drive
 * before FFmpeg spawns. Deliberately conservative: overestimating only warns
 * early, while underestimating lets the encode die mid-write on a full drive.
 */
const DISK_OVERHEAD_SLACK = 0.05;                  // container/retry-temp slack
const PASS_LOG_ALLOWANCE_BYTES = 64 * 1024 * 1024; // 2-pass x264 stats + mbtree
const GIF_EXTRACT_FPS = 30;                        // y4m extraction caps at 30

function estimateRequiredBytes(opts = {}) {
  const MB = 1024 * 1024;
  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  // A size-capped export may legally land anywhere up to the cap, so the
  // larger of the estimate and the target is the honest output allowance.
  const outputBytes = Math.max(num(opts.estimatedSizeMB), num(opts.targetSizeMB)) * MB;

  // GIF extraction writes raw yuv4mpegpipe frames to a temp file first
  // (3 bytes per pixel at up to 30fps) - usually larger than the GIF itself.
  let gifTempBytes = 0;
  if (opts.outputFormat === 'gif') {
    gifTempBytes = num(opts.width) * num(opts.height) * 3 * num(opts.clipDuration) * GIF_EXTRACT_FPS;
  }

  const tempSegmentsBytes = num(opts.tempSegmentsMB) * MB;
  const mergeIntermediateBytes = num(opts.mergeIntermediateMB) * MB;

  return Math.ceil(
    outputBytes +
    gifTempBytes +
    tempSegmentsBytes +
    mergeIntermediateBytes +
    (opts.twoPass ? PASS_LOG_ALLOWANCE_BYTES : 0) +
    outputBytes * DISK_OVERHEAD_SLACK
  );
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
    speed = 1,
    watermark = null,
    volume = 1,
    muted = false
  } = opts;

  const args = [
    '-y',
    '-ss', String(seekTimes.inputSeek),
    '-i', inputPath
  ];

  // Watermark source: a still image as a second input. It must sit right
  // after the first -i so the codec args below stay OUTPUT options (a flag
  // between the two -i's would be read as a decoder option for the logo).
  // A single-frame input is held for the whole clip by overlay's
  // eof_action=repeat, so no -loop is needed.
  const wm = normalizeWatermark(watermark);
  if (wm) {
    args.push('-i', wm.path);
  }

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

  // Video stream mapping (a watermark runs through -filter_complex and is
  // mapped by its output label instead of the raw input stream).
  args.push('-map', wm ? '[vout]' : '0:v:0');

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

  applyVideoFilters(args, filters, { wm, width, height, speed });

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
      // Audio filters, in order: tempo-change to match setpts (atempo
      // preserves pitch), then the export gain from the transport volume
      // slider. GIF extraction maps no audio stream, so the chain stays
      // video-only there. volume=1 is never emitted (it would be a no-op
      // filter that still costs a full audio re-encode).
      const audioFilters = [];
      if (speed !== 1 && outputFormat !== 'gif') {
        audioFilters.push(atempoFilter(speed));
      }
      if (volume < 1) {
        audioFilters.push(`volume=${volume}`);
      }
      if (audioFilters.length > 0) {
        args.push('-af', audioFilters.join(','));
      }
    } else {
      // Muted (or a silent source): write no audio stream at all. The explicit
      // -an also switches off ffmpeg's automatic audio stream selection, so a
      // source with audio can never sneak a full-volume track into a muted
      // export (the -map above disables auto-selection, -an makes it belt-and-
      // braces and self-documenting in the arg dump).
      args.push('-an');
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

/**
 * Produce a re-encode plan for a file that overshot its size target.
 *
 * The original plan's FFmpeg args embed the video bitrate as literal
 * `-b:v <N>k` tokens (plus `-maxrate`/`-bufsize` where the encoder profile
 * uses VBV constraints). Re-running the full planning pipeline needs
 * mediaInfo + settings that are no longer around once an export is running,
 * so instead scale those tokens in place and update the plan's derived
 * fields. This is the video analogue of the GIF exporter's descension loop:
 * each retry re-encodes at a lower bitrate until the file fits.
 *
 * Returns null when a discount cannot help: quality/CRF mode has no size
 * target, gif/mp3 sizes are not driven by the video bitrate, and a bitrate
 * already at the 64 kbps floor has nothing left to give up.
 *
 * @param {Object} plan - a plan from calculatePlan (video formats only)
 * @param {number} factor - bitrate multiplier per retry, e.g. 0.85
 * @returns {Object|null} discounted plan, or null when not applicable
 */
function buildDiscountedPlan(plan, factor) {
  if (!plan || plan.crfValue !== undefined || !plan.videoBitrateKbps) return null;
  const fmt = plan.outputFormat;
  if (fmt === 'gif' || fmt === 'mp3') return null;

  const newBitrate = Math.max(64, Math.round(plan.videoBitrateKbps * factor));
  if (!(newBitrate < plan.videoBitrateKbps)) return null; // floor hit, no progress

  // Every PROFILES.bitrateArgs shape puts the video bitrate in its own
  // argument right after the flag (-b:v / -maxrate / -bufsize). Audio
  // (-b:a) is deliberately not touched. libsvtav1 has no -maxrate (it
  // rejects it in 2-pass), which is fine — the walk simply finds none.
  const scaleValueToken = (token) => {
    const m = /^(\d+)k$/.exec(token);
    if (!m) return token;
    return `${Math.max(64, Math.round(parseInt(m[1], 10) * factor))}k`;
  };
  const scaleArgs = (args) => {
    const scaled = args.slice();
    for (let i = 0; i < scaled.length; i++) {
      if (scaled[i] === '-b:v' || scaled[i] === '-maxrate' || scaled[i] === '-bufsize') {
        if (scaled[i + 1] !== undefined) {
          scaled[i + 1] = scaleValueToken(scaled[i + 1]);
          i++; // skip the value token just rewritten
        }
      }
    }
    return scaled;
  };

  const discounted = { ...plan };
  discounted.videoBitrateKbps = newBitrate;
  discounted.totalBitrateKbps = newBitrate + (plan.audioBitrateKbps || 0);
  // Estimated size scales with the bitrate ratio; the muxing overhead stays
  // proportionally the same, so this stays honest.
  discounted.estimatedSizeMB = parseFloat(
    ((plan.estimatedSizeMB || 0) * (newBitrate / plan.videoBitrateKbps)).toFixed(2)
  );

  if (plan.isSinglePass) {
    discounted.singlePassArgs = scaleArgs(plan.singlePassArgs);
  } else {
    discounted.pass1Args = scaleArgs(plan.pass1Args);
    discounted.pass2Args = scaleArgs(plan.pass2Args);
  }
  return discounted;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Size-retry parameters shared by the trim encoder and the merge post-convert
// step: total encode attempts a size-capped video export gets when it
// overshoots, and how much the target is cut per retry. Mirrors the GIF
// exporter's descension loop (fps -> scale -> quality), but for bitrate.
const MAX_SIZE_RETRIES = 3;
const SIZE_RETRY_FACTOR = 0.85;

/**
 * The sequence of size targets a retry loop should attempt, largest first:
 * the original target, then the discounted targets, floored at 1 MB. Stops
 * early when a discount can no longer shrink the target.
 */
function sizeRetryTargets(targetMB, maxRetries = MAX_SIZE_RETRIES, factor = SIZE_RETRY_FACTOR) {
  const targets = [targetMB];
  for (let i = 1; i < maxRetries; i++) {
    const next = Math.max(1, targets[i - 1] * factor);
    if (next >= targets[i - 1]) break;
    targets.push(next);
  }
  return targets;
}

module.exports = {
  calculatePlan,
  // Used at runtime by the encoder/merge retry loops (not just tests), so
  // they live at top level alongside calculatePlan — keep them here when
  // adding runtime consumers.
  MAX_SIZE_RETRIES,
  SIZE_RETRY_FACTOR,
  buildDiscountedPlan,
  sizeRetryTargets,
  // Runtime consumers (merger.js) share the watermark fragments and the disk
  // estimate, so they live at top level alongside calculatePlan.
  normalizeWatermark,
  watermarkFilterParts,
  estimateRequiredBytes,
  // Exported for testing internals
  _internals: {
    planSizeLimitBudget,
    computeSizeLimitBitrate,
    minimumTargetSizeMB,
    maximumClipDurationSec,
    buildPlanFix,
    formatClipDuration,
    AUDIO_BUDGET_SHARE,
    MIN_AUDIO_BITRATE_KBPS,
    buildDiscountedPlan,
    sizeRetryTargets,
    resolveResolution,
    computeSeekTimes,
    buildPassArgs,
    normalizeSpeed,
    normalizeAudio,
    atempoFilter,
    applyVideoFilters,
    normalizeWatermark,
    watermarkFilterParts,
    estimateRequiredBytes,
    QUALITY_FLOORS,
    SAFETY_MARGIN,
    MUXING_OVERHEAD,
    ABSOLUTE_MIN_VIDEO_BITRATE_KBPS,
    FAST_SEEK_RUNWAY_SECONDS
  }
};
