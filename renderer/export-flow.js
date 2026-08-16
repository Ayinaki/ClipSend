// Export flow helpers: converting a calculated plan into title-bar display
// values and assembling the warning list. Pure functions — no DOM, no IPC —
// so they are trivially unit-testable.

/**
 * Build the title-bar estimate display values from a calculated plan.
 *
 * @param {object} plan - Plan from calculatePlan (width, height, bitrates, etc.)
 * @param {object} options
 * @param {boolean} options.isMp3 - Audio-only export (bitrate/size only, no res)
 * @param {string} [options.outputFormat] - 'mp4' | 'webm' | 'gif' | 'mp3'
 * @param {string} [options.mode] - 'size-limit' | 'auto' | 'custom'
 * @returns {{ vbrLabel: string, vbrText: string, sizeText: string, resText: string, resVisible: boolean }}
 */
export function formatPlanDisplay(plan, { isMp3, outputFormat, mode } = {}) {
  if (!plan) {
    return { vbrLabel: '', vbrText: '', sizeText: '', resText: '', resVisible: false };
  }

  if (isMp3) {
    return {
      vbrLabel: 'Audio:',
      vbrText: `${plan.audioBitrateKbps} kbps`,
      sizeText: `${plan.estimatedSizeMB} MB`,
      resText: '',
      resVisible: false
    };
  }

  const base = {
    vbrLabel: 'Video:',
    resText: `${plan.width}x${plan.height}`,
    resVisible: true
  };

  if (outputFormat === 'gif') {
    return { ...base, vbrText: 'GIF', sizeText: '—' };
  }
  if (mode === 'auto') {
    return { ...base, vbrText: `CRF ${plan.crfValue}`, sizeText: 'Variable (quality-based)' };
  }
  return { ...base, vbrText: `${plan.videoBitrateKbps} kbps`, sizeText: `${plan.estimatedSizeMB} MB` };
}

/**
 * True when a trim starting at trimIn would have zero video frames to
 * encode: the video track is meaningfully shorter than the container
 * (audio-outlasts-video shape: music videos, cover-art streams) AND the In
 * point lands at/past the track's end. The 0.5s gate keeps normal files
 * (where videoDuration ≈ container duration) from ever being flagged, even
 * when trimmed to the very end. NaN/undefined values fail safe (no flag).
 */
export function isTrimPastVideoEnd(trimIn, videoDuration, duration) {
  if (typeof trimIn !== 'number' || typeof videoDuration !== 'number' || typeof duration !== 'number') return false;
  return videoDuration < duration - 0.5 && trimIn >= videoDuration - 0.05;
}

/**
 * Assemble the full warning list shown after plan calculation:
 * plan warnings + VFR notice + GIF feasibility notice.
 *
 * @param {object} plan - Calculated plan
 * @param {object} context
 * @param {boolean} context.isVFR - Source media is variable frame rate
 * @param {string} [context.outputFormat] - 'mp4' | 'webm' | 'gif' | 'mp3'
 * @param {number} [context.trimDuration] - Trim duration in seconds
 * @param {number} [context.targetSizeMB] - Target size limit in MB
 * @param {number} [context.trimIn] - Trim In point in seconds
 * @param {number} [context.videoDuration] - Video track length in seconds
 *   (can be shorter than the container duration for audio-outlasts-video files)
 * @param {number} [context.duration] - Container duration in seconds
 * @returns {Array<{id: string, title: string, body: string}>}
 */
export function buildPlanWarnings(plan, { isVFR, outputFormat, trimDuration, targetSizeMB, trimIn, videoDuration, duration } = {}) {
  const warnings = [...((plan && plan.warnings) || [])];

  if (isVFR) {
    warnings.push({
      id: 'vfr',
      title: 'Variable Frame Rate detected',
      body: 'Source video has a Variable Frame Rate (VFR). Audio sync issues might occur in the exported clip.'
    });
  }

  if (outputFormat === 'gif' && trimDuration > 30 && targetSizeMB <= 10) {
    warnings.push({
      id: 'gif_feasibility',
      title: 'GIF Feasibility Warning',
      body: `This clip may be too long (${Math.round(trimDuration)}s) to comfortably fit within ${targetSizeMB}MB as a GIF. Consider trimming the clip shorter.`
    });
  }

  // A trim starting at/past the end of the video track encodes zero frames
  // (music videos / cover-art streams where audio outlasts the video).
  if (isTrimPastVideoEnd(trimIn, videoDuration, duration)) {
    warnings.push({
      id: 'no_video_frames',
      title: 'Trim has no video frames',
      body: 'The trim In point is past the end of the video track — this export would contain no video (audio only). Move the In point earlier or pick a shorter range.'
    });
  }

  return warnings;
}
