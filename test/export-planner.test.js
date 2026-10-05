const { calculatePlan, _internals } = require('../main/export-planner');
const { SIZE_PRESETS, getPresetById, getDefaultPreset } = require('../main/presets');

const {
  planSizeLimitBudget,
  computeSizeLimitBitrate,
  minimumTargetSizeMB,
  maximumClipDurationSec,
  formatClipDuration,
  buildDiscountedPlan,
  sizeRetryTargets,
  resolveResolution,
  computeSeekTimes,
  QUALITY_FLOORS,
  SAFETY_MARGIN,
  MUXING_OVERHEAD,
  ABSOLUTE_MIN_VIDEO_BITRATE_KBPS,
  AUDIO_BUDGET_SHARE,
  MIN_AUDIO_BITRATE_KBPS,
  FAST_SEEK_RUNWAY_SECONDS
} = _internals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard 1440p media stub for most tests. */
const media1440p = {
  filePath: 'C:\\clips\\test.mkv',
  width: 2560,
  height: 1440,
  audioTracks: [{ audioOrdinal: 0, streamIndex: 1, codec: 'aac' }, { audioOrdinal: 1, streamIndex: 3, codec: 'mp3' }]
};

const media1080p = { filePath: 'test.mp4', width: 1920, height: 1080, audioTracks: [{ audioOrdinal: 0, streamIndex: 1 }, { audioOrdinal: 1, streamIndex: 3 }] };
const media720p  = { filePath: 'test.mp4', width: 1280, height: 720, audioTracks: [{ audioOrdinal: 0, streamIndex: 1 }] };
const media480p  = { filePath: 'test.mp4', width: 854,  height: 480, audioTracks: [{ audioOrdinal: 0, streamIndex: 1 }] };
const media360p  = { filePath: 'test.mp4', width: 640,  height: 360, audioTracks: [{ audioOrdinal: 0, streamIndex: 1 }] };

function sizeLimitSettings(sizeMB, opts = {}) {
  return { mode: 'size-limit', targetSizeMB: sizeMB, audioBitrateKbps: 128, ...opts };
}

function customSettings(bitrateKbps, opts = {}) {
  return { mode: 'custom', customBitrateKbps: bitrateKbps, audioBitrateKbps: 128, ...opts };
}

// ---------------------------------------------------------------------------
// Presets module
// ---------------------------------------------------------------------------

describe('Presets', () => {
  test('provides the platform presets plus custom', () => {
    expect(SIZE_PRESETS).toHaveLength(8);
    expect(SIZE_PRESETS.filter(p => !p.isCustom).map(p => p.sizeMB)).toEqual([20, 50, 500, 512, 1024, 2048, 2048]);
  });

  test('default preset is discord-free (20 MB)', () => {
    const d = getDefaultPreset();
    expect(d.id).toBe('discord-free');
    expect(d.sizeMB).toBe(20);
  });

  test('getPresetById returns null for unknown id', () => {
    expect(getPresetById('nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSizeLimitBitrate (internal)
// ---------------------------------------------------------------------------

describe('computeSizeLimitBitrate', () => {
  test('10 MB / 60s clip → correct video bitrate after safety + overhead', () => {
    const vbr = computeSizeLimitBitrate(10, 60, 128);
    // Expected math:
    //   targetBytes  = 10 × 1024² = 10,485,760
    //   safeBytes    = 10,485,760 × 0.97 = 10,171,187.2
    //   usableBytes  = 10,171,187.2 × (1 − 0.015) = 10,018,619.39
    //   totalBps     = 10,018,619.39 × 8 / 60 = 1,335,815.92
    //   totalKbps    = 1,335.816
    //   videoKbps    = 1,335.816 − 128 = 
    expect(vbr).toBeCloseTo(1180.3, 0);
  });

  test('50 MB / 120s clip → higher bitrate than 10 MB', () => {
    const vbr10 = computeSizeLimitBitrate(10, 120, 128);
    const vbr50 = computeSizeLimitBitrate(50, 120, 128);
    expect(vbr50).toBeGreaterThan(vbr10);
  });

  test('500 MB / 30s clip → very high bitrate', () => {
    const vbr = computeSizeLimitBitrate(500, 30, 128);
    expect(vbr).toBe(25000); // capped at 25 Mbps
  });

  test('custom target size (e.g. 25 MB / 60s) computes proportional bitrate', () => {
    const vbr10 = computeSizeLimitBitrate(10, 60, 128);
    const vbr25 = computeSizeLimitBitrate(25, 60, 128);
    expect(vbr25).toBeGreaterThan(vbr10);
  });

  test('higher audio bitrate reduces video bitrate', () => {
    const lo = computeSizeLimitBitrate(10, 60, 96);
    const hi = computeSizeLimitBitrate(10, 60, 320);
    expect(lo).toBeGreaterThan(hi);
    expect(lo - hi).toBeCloseTo(320 - 96, 1); // difference equals audio delta
  });
});

// ---------------------------------------------------------------------------
// planSizeLimitBudget (internal)
// ---------------------------------------------------------------------------

describe('planSizeLimitBudget', () => {
  test('a comfortable budget hands audio exactly what it asked for', () => {
    const budget = planSizeLimitBudget(20, 120, 128);
    expect(budget.audioBitrateKbps).toBe(128);
    expect(budget.videoBitrateKbps).toBeCloseTo(budget.totalBitrateKbps - 128, 6);
  });

  test('a tight budget caps audio at its share and gives the rest to video', () => {
    // 10:40 in 20 MB affords ~245 kbps. A quarter of that is plenty for AAC,
    // and the video keeps the majority of the budget.
    const budget = planSizeLimitBudget(20, 640, 128);
    expect(budget.audioBitrateKbps).toBeLessThan(128);
    expect(budget.audioBitrateKbps).toBeGreaterThanOrEqual(MIN_AUDIO_BITRATE_KBPS);
    expect(budget.audioBitrateKbps).toBeCloseTo(budget.totalBitrateKbps * AUDIO_BUDGET_SHARE, 0);
    expect(budget.videoBitrateKbps).toBeGreaterThan(budget.audioBitrateKbps);
    expect(budget.videoBitrateKbps + budget.audioBitrateKbps).toBeCloseTo(budget.totalBitrateKbps, 0);
  });

  test('below the share the audio floor takes over', () => {
    // 21:16 in 20 MB affords ~123 kbps, and a quarter of that is under the
    // 32 kbps audio floor, so audio sits on the floor and video keeps the rest.
    const budget = planSizeLimitBudget(20, 1276, 128);
    expect(budget.totalBitrateKbps).toBeLessThan(128);
    expect(budget.totalBitrateKbps * AUDIO_BUDGET_SHARE).toBeLessThan(MIN_AUDIO_BITRATE_KBPS);
    expect(budget.audioBitrateKbps).toBe(MIN_AUDIO_BITRATE_KBPS);
    expect(budget.videoBitrateKbps).toBeGreaterThan(0);
    expect(budget.videoBitrateKbps + budget.audioBitrateKbps).toBeCloseTo(budget.totalBitrateKbps, 0);
  });

  test('audio never drops below its floor, and video never goes negative', () => {
    // 50 minutes in 10 MB affords ~26 kbps: not even the audio floor fits.
    // Video reports 0 rather than a negative bitrate, and the caller's floor
    // check turns that into an explanation.
    const budget = planSizeLimitBudget(10, 3000, 128);
    expect(budget.totalBitrateKbps).toBeLessThan(MIN_AUDIO_BITRATE_KBPS);
    expect(budget.audioBitrateKbps).toBe(MIN_AUDIO_BITRATE_KBPS);
    expect(budget.videoBitrateKbps).toBe(0);
  });

  test('a silent source pays no audio bitrate at all', () => {
    const withAudio = planSizeLimitBudget(10, 60, 128);
    const silent = planSizeLimitBudget(10, 60, 0);
    expect(silent.audioBitrateKbps).toBe(0);
    expect(silent.videoBitrateKbps - withAudio.videoBitrateKbps).toBe(128);
  });

  test('audio is reported in whole kbps so the -b:a argument matches the plan', () => {
    const budget = planSizeLimitBudget(10, 600, 128);
    expect(Number.isInteger(budget.audioBitrateKbps)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Budget bisections (internal) — the numbers quoted in the size-cap error
// ---------------------------------------------------------------------------

describe('size-limit floor guidance', () => {
  test('minimumTargetSizeMB is the exact size where the plan starts to pass', () => {
    const minimumMB = minimumTargetSizeMB(1276, 128);
    expect(minimumMB).toBeGreaterThan(0);
    // Just below it fails, at it (within the bisection's tolerance) it passes.
    expect(planSizeLimitBudget(minimumMB - 0.01, 1276, 128).videoBitrateKbps)
      .toBeLessThan(ABSOLUTE_MIN_VIDEO_BITRATE_KBPS);
    expect(planSizeLimitBudget(minimumMB, 1276, 128).videoBitrateKbps)
      .toBeGreaterThanOrEqual(ABSOLUTE_MIN_VIDEO_BITRATE_KBPS);
  });

  test('maximumClipDurationSec is the longest clip the target can hold', () => {
    const maximumSec = maximumClipDurationSec(20, 128);
    expect(planSizeLimitBudget(20, maximumSec, 128).videoBitrateKbps)
      .toBeGreaterThanOrEqual(ABSOLUTE_MIN_VIDEO_BITRATE_KBPS);
    expect(planSizeLimitBudget(20, maximumSec * 1.05, 128).videoBitrateKbps)
      .toBeLessThan(ABSOLUTE_MIN_VIDEO_BITRATE_KBPS);
  });

  test('a huge target and a tiny clip have no practical ceiling', () => {
    expect(maximumClipDurationSec(2048, 128)).toBeGreaterThan(3600);
    expect(minimumTargetSizeMB(2, 128)).toBeLessThan(1);
  });

  test('formatClipDuration renders m:ss and h:mm:ss', () => {
    expect(formatClipDuration(0)).toBe('0:00');
    expect(formatClipDuration(59.6)).toBe('1:00');
    expect(formatClipDuration(1276)).toBe('21:16');
    expect(formatClipDuration(3661)).toBe('1:01:01');
  });
});

// ---------------------------------------------------------------------------
// resolveResolution (internal)
// ---------------------------------------------------------------------------

describe('resolveResolution', () => {
  test('keeps source when bitrate exceeds floor', () => {
    const r = resolveResolution(2560, 1440, 5000);
    expect(r.width).toBe(2560);
    expect(r.height).toBe(1440);
    expect(r.warnings).toHaveLength(0);
  });

  test('1440p → 1080p when bitrate between 1500–3000', () => {
    const r = resolveResolution(2560, 1440, 2000);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].body).toContain('reduced');
  });

  test('1440p → 720p when bitrate between 800–1500', () => {
    const r = resolveResolution(2560, 1440, 1000);
    expect(r.width).toBe(1280);
    expect(r.height).toBe(720);
  });

  test('1440p → 480p when bitrate between 400–800', () => {
    const r = resolveResolution(2560, 1440, 500);
    expect(r.width).toBe(854);
    expect(r.height).toBe(480);
  });

  test('1440p → 480p with poor-quality warning when bitrate < 400', () => {
    const r = resolveResolution(2560, 1440, 200);
    expect(r.width).toBe(854);
    expect(r.height).toBe(480);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.warnings.some(w => w.body.includes('quality') || w.body.includes('poor'))).toBe(true);
  });

  test('1080p source stays at 1080p when bitrate >= 1500', () => {
    const r = resolveResolution(1920, 1080, 1500);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  });

  test('source smaller than 480p is left unchanged regardless of bitrate', () => {
    const r = resolveResolution(640, 360, 100);
    expect(r.width).toBe(640);
    expect(r.height).toBe(360);
    expect(r.warnings).toHaveLength(0);
  });

  test('exact floor boundary keeps source resolution', () => {
    // Exactly at the 1440p floor → should keep 1440p
    const r = resolveResolution(2560, 1440, 3000);
    expect(r.width).toBe(2560);
    expect(r.height).toBe(1440);
  });
});

// ---------------------------------------------------------------------------
// computeSeekTimes (internal)
// ---------------------------------------------------------------------------

describe('computeSeekTimes', () => {
  test('in-point far into the file → fast seek to exact in point', () => {
    const s = computeSeekTimes(120, 150);
    expect(s.inputSeek).toBe(120);
    expect(s.duration).toBe(30);
  });

  test('in-point < 30s → fast seek to exact in point', () => {
    const s = computeSeekTimes(10, 25);
    expect(s.inputSeek).toBe(10);
    expect(s.duration).toBe(15);
  });

  test('in-point at 0 → fast seek to 0', () => {
    const s = computeSeekTimes(0, 5);
    expect(s.inputSeek).toBe(0);
    expect(s.duration).toBe(5);
  });

  test('durations are preserved exactly', () => {
    const s = computeSeekTimes(45.123, 67.456);
    const originalDuration = 67.456 - 45.123;
    expect(s.duration).toBeCloseTo(originalDuration, 10);
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — size-limit mode
// ---------------------------------------------------------------------------

describe('calculatePlan — size-limit mode', () => {
  test('10 MB / 30s 1080p clip produces a valid plan', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(10));
    expect(plan.videoBitrateKbps).toBeGreaterThan(0);
    expect(plan.audioBitrateKbps).toBe(128);
    expect(plan.clipDuration).toBe(30);
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.downscaled).toBe(false);
    expect(plan.estimatedSizeMB).toBeLessThanOrEqual(10);
    expect(plan.pass1Args).toBeInstanceOf(Array);
    expect(plan.pass2Args).toBeInstanceOf(Array);
  });

  test('50 MB preset gives higher bitrate than 10 MB for same clip', () => {
    const plan10 = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10));
    const plan50 = calculatePlan(media1080p, 0, 60, sizeLimitSettings(50));
    expect(plan50.videoBitrateKbps).toBeGreaterThan(plan10.videoBitrateKbps);
  });

  test('500 MB preset with short clip → very high bitrate, no downscale', () => {
    const plan = calculatePlan(media1440p, 0, 10, sizeLimitSettings(500));
    expect(plan.videoBitrateKbps).toBeGreaterThan(10000);
    expect(plan.downscaled).toBe(false);
  });

  test('10 MB / 120s 1440p clip → triggers downscale', () => {
    const plan = calculatePlan(media1440p, 0, 120, sizeLimitSettings(10));
    expect(plan.downscaled).toBe(true);
    expect(plan.width).toBeLessThan(2560);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  test('estimated size stays below target', () => {
    const plan = calculatePlan(media1080p, 10, 70, sizeLimitSettings(10));
    expect(plan.estimatedSizeMB).toBeLessThan(10);
  });

  test('long clip (600s) at 10 MB → audio is squeezed, not refused', () => {
    // 10 MB / 600s affords ~131 kbps in total, which is less than the 128 kbps
    // audio default. Subtracting the full audio rate used to leave ~3 kbps of
    // video and refuse the export with "Computed video bitrate is invalid".
    // Audio is the negotiable side of a tight budget, so it drops to its share
    // and the clip stays encodable.
    const plan = calculatePlan(media1440p, 0, 600, sizeLimitSettings(10));
    const budget = planSizeLimitBudget(10, 600, 128);
    expect(plan.videoBitrateKbps).toBeGreaterThanOrEqual(ABSOLUTE_MIN_VIDEO_BITRATE_KBPS);
    expect(plan.audioBitrateKbps).toBe(budget.audioBitrateKbps);
    expect(plan.audioBitrateKbps).toBeLessThan(128);
    // The squeezed rate is what actually gets encoded — budgeting for a
    // smaller audio track than the one written would overshoot the size cap.
    expect(plan.pass2Args[plan.pass2Args.indexOf('-b:a') + 1]).toBe(`${plan.audioBitrateKbps}k`);
    expect(plan.warnings.map(w => w.id)).toContain('audio-squeezed');
    expect(plan.estimatedSizeMB).toBeLessThanOrEqual(10);
  });

  test('a comfortable budget never touches the requested audio bitrate', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(20));
    expect(plan.audioBitrateKbps).toBe(128);
    expect(plan.warnings.map(w => w.id)).not.toContain('audio-squeezed');
  });

  test('a source with no audio gets the whole budget', () => {
    // The audio bitrate used to be subtracted from the budget even when there
    // was no audio track to spend it on, costing silent clips 128 kbps of
    // video they were entitled to.
    const silent = { filePath: 'test.mp4', width: 1920, height: 1080, audioTracks: [] };
    const plan = calculatePlan(silent, 0, 60, sizeLimitSettings(10));
    expect(plan.audioBitrateKbps).toBe(0);
    expect(plan.videoBitrateKbps).toBe(Math.round(planSizeLimitBudget(10, 60, 0).videoBitrateKbps));
    expect(plan.videoBitrateKbps).toBeGreaterThan(computeSizeLimitBitrate(10, 60, 128));
  });

  test('a clip too long for the target reports the target and the trim that would fit', () => {
    // 30 minutes cannot fit in 10 MB at any watchable bitrate. The message has
    // to name both ways out; the old one blamed the clip duration, which the
    // user could not act on when the duration was simply the whole file.
    let message = '';
    expect(() => {
      calculatePlan(media1440p, 0, 1800, sizeLimitSettings(10));
    }).toThrow(/below the minimum threshold/);
    try {
      calculatePlan(media1440p, 0, 1800, sizeLimitSettings(10));
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/A 30:00 clip does not fit in 10 MB/);
    // The two numbers must actually be actionable, not just present.
    const minimumMB = minimumTargetSizeMB(1800, 128);
    expect(message).toContain(`at least ${minimumMB.toFixed(1)} MB`);
    const maximumSec = maximumClipDurationSec(10, 128);
    expect(message).toContain(`trim the clip to ${formatClipDuration(maximumSec)} or less`);
    // ...and the trim it suggests has to be an alternative that really works.
    expect(() => calculatePlan(media1440p, 0, maximumSec, sizeLimitSettings(10))).not.toThrow();
    expect(() => calculatePlan(media1440p, 0, 1800, sizeLimitSettings(minimumMB))).not.toThrow();
  });

  test('long clip (600s) at 50 MB → encodable but downscaled with warnings', () => {
    const plan = calculatePlan(media1440p, 0, 600, sizeLimitSettings(50));
    expect(plan.downscaled).toBe(true);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.videoBitrateKbps).toBeGreaterThanOrEqual(ABSOLUTE_MIN_VIDEO_BITRATE_KBPS);
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — custom mode
// ---------------------------------------------------------------------------

describe('calculatePlan — custom mode', () => {
  test('custom 5000 kbps on 1440p → keeps source resolution', () => {
    const plan = calculatePlan(media1440p, 0, 30, customSettings(5000));
    expect(plan.videoBitrateKbps).toBe(5000);
    expect(plan.width).toBe(2560);
    expect(plan.height).toBe(1440);
    expect(plan.downscaled).toBe(false);
  });

  test('custom 1000 kbps on 1440p → downscales to 720p', () => {
    const plan = calculatePlan(media1440p, 0, 30, customSettings(1000));
    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(720);
    expect(plan.downscaled).toBe(true);
  });

  test('custom 100 kbps on 1440p → poor quality warning', () => {
    const plan = calculatePlan(media1440p, 0, 30, customSettings(100));
    expect(plan.warnings.some(w => (w.body || w.title || '').toLowerCase().includes('quality') || (w.body || '').toLowerCase().includes('poor'))).toBe(true);
  });

  test('custom 30 kbps → throws (below absolute minimum)', () => {
    expect(() => {
      calculatePlan(media1080p, 0, 30, customSettings(30));
    }).toThrow(/below the minimum threshold/);
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — audio track selection
// ---------------------------------------------------------------------------

describe('calculatePlan — audio track', () => {
  test('default audio track uses audioOrdinal 0', () => {
    // Planner fallback uses the first audio track's ordinal (0)
    const plan = calculatePlan(media1080p, 0, 10, customSettings(5000));
    expect(plan.pass2Args).toContain('0:a:0');
  });

  test('selected audio track ordinal 1 appears in pass 2 args as 0:a:1', () => {
    const plan = calculatePlan(media1080p, 0, 10, customSettings(5000, { selectedAudioTrackIndex: 1 }));
    expect(plan.pass2Args).toContain('0:a:1');
    // Pass 1 should not contain audio mapping
    expect(plan.pass1Args).not.toContain('0:a:1');
  });

  test('fails if selected audio track does not exist', () => {
    expect(() => calculatePlan(media1080p, 0, 10, customSettings(5000, { selectedAudioTrackIndex: 99 })))
      .toThrow(/does not exist in the source file/);
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — FFmpeg arg structure
// ---------------------------------------------------------------------------

describe('calculatePlan — FFmpeg arg structure', () => {
  let plan;

  beforeAll(() => {
    plan = calculatePlan(media1080p, 45, 75, sizeLimitSettings(10));
  });

  test('pass 1 outputs to NUL with -f null', () => {
    const args = plan.pass1Args;
    const fIdx = args.indexOf('-f');
    expect(fIdx).not.toBe(-1);
    expect(args[fIdx + 1]).toBe('null');
    // NUL is now appended by encoder.js after -passlogfile
  });

  test('pass 1 has -an (no audio)', () => {
    expect(plan.pass1Args).toContain('-an');
  });

  test('pass 2 has AAC audio codec', () => {
    const args = plan.pass2Args;
    const caIdx = args.indexOf('-c:a');
    expect(caIdx).not.toBe(-1);
    expect(args[caIdx + 1]).toBe('aac');
  });

  test('pass 2 has -movflags +faststart', () => {
    const args = plan.pass2Args;
    const mfIdx = args.indexOf('-movflags');
    expect(mfIdx).not.toBe(-1);
    expect(args[mfIdx + 1]).toBe('+faststart');
  });

  test('pass 2 does NOT output to NUL', () => {
    expect(plan.pass2Args).not.toContain('NUL');
  });

  test('both passes use libx264', () => {
    expect(plan.pass1Args).toContain('libx264');
    expect(plan.pass2Args).toContain('libx264');
  });

  test('both passes use preset slow', () => {
    expect(plan.pass1Args).toContain('slow');
    expect(plan.pass2Args).toContain('slow');
  });

  test('pass args contain simple input seek and duration', () => {
    const args = plan.pass1Args;
    // -ss should be before -i
    const ssIdx = args.indexOf('-ss');
    const iIdx = args.indexOf('-i');
    expect(ssIdx).toBeLessThan(iIdx);

    // -t should be after -i
    const tIdx = args.indexOf('-t');
    expect(tIdx).toBeGreaterThan(iIdx);
  });

  test('-vf is absent when source resolution is kept', () => {
    // With 10 MB / 30s at 1080p, bitrate should be high enough
    const shortPlan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(10));
    if (!shortPlan.downscaled) {
      expect(shortPlan.pass1Args).not.toContain('-vf');
      expect(shortPlan.pass2Args).not.toContain('-vf');
    }
  });

  test('-vf is present when downscaling', () => {
    const dsPlan = calculatePlan(media1440p, 0, 120, sizeLimitSettings(10));
    if (dsPlan.downscaled) {
      expect(dsPlan.pass1Args).toContain('-vf');
      expect(dsPlan.pass2Args).toContain('-vf');
    }
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — input validation
// ---------------------------------------------------------------------------

describe('calculatePlan — validation', () => {
  test('throws if mediaInfo is null', () => {
    expect(() => calculatePlan(null, 0, 10, sizeLimitSettings(10))).toThrow();
  });

  test('throws if trimIn >= trimOut', () => {
    expect(() => calculatePlan(media1080p, 10, 10, sizeLimitSettings(10))).toThrow();
    expect(() => calculatePlan(media1080p, 15, 10, sizeLimitSettings(10))).toThrow();
  });

  test('throws if trimIn is negative', () => {
    expect(() => calculatePlan(media1080p, -1, 10, sizeLimitSettings(10))).toThrow();
  });

  test('throws if mode is unknown', () => {
    expect(() => calculatePlan(media1080p, 0, 10, { mode: 'turbo' })).toThrow(/Unknown mode/);
  });

  test('throws if custom mode has no bitrateKbps', () => {
    expect(() => calculatePlan(media1080p, 0, 10, { mode: 'custom' })).toThrow();
  });

  test('throws if width/height are missing', () => {
    expect(() => calculatePlan({ filePath: 'x' }, 0, 10, sizeLimitSettings(10))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — MP3 audio-only export
// ---------------------------------------------------------------------------

describe('calculatePlan — MP3 audio export', () => {
  test('produces a single-pass audio-only plan', () => {
    const plan = calculatePlan(media1080p, 10, 40, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3' });
    expect(plan.isSinglePass).toBe(true);
    expect(plan.outputFormat).toBe('mp3');
    expect(plan.videoBitrateKbps).toBe(0);
    expect(plan.singlePassArgs).toContain('-vn');
    expect(plan.singlePassArgs).toContain('libmp3lame');
    const bIdx = plan.singlePassArgs.indexOf('-b:a');
    expect(bIdx).not.toBe(-1);
    expect(plan.singlePassArgs[bIdx + 1]).toBe('192k');
  });

  test('defaults audio bitrate to 192 kbps and estimates size correctly', () => {
    const plan = calculatePlan(media1080p, 0, 60, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3' });
    expect(plan.audioBitrateKbps).toBe(192);
    expect(plan.estimatedSizeMB).toBeCloseTo((192 * 1000 * 60 / 8) / (1024 * 1024), 1);
  });

  test('honors a custom audio bitrate', () => {
    const plan = calculatePlan(media1080p, 0, 60, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3', audioBitrateKbps: 320 });
    const bIdx = plan.singlePassArgs.indexOf('-b:a');
    expect(plan.singlePassArgs[bIdx + 1]).toBe('320k');
  });

  test('maps the selected audio track', () => {
    const plan = calculatePlan(media1080p, 0, 60, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3', selectedAudioTrackIndex: 1 });
    expect(plan.singlePassArgs).toContain('0:a:1');
  });

  test('uses simple input seek and duration like video exports', () => {
    const plan = calculatePlan(media1080p, 45, 75, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3' });
    const ssIdx = plan.singlePassArgs.indexOf('-ss');
    const iIdx = plan.singlePassArgs.indexOf('-i');
    expect(ssIdx).toBeLessThan(iIdx);
    expect(plan.singlePassArgs[ssIdx + 1]).toBe('45');
    expect(plan.singlePassArgs).toContain('-t');
  });

  test('throws when the source has no audio tracks', () => {
    const noAudio = { filePath: 'test.mp4', width: 1920, height: 1080, audioTracks: [] };
    expect(() => calculatePlan(noAudio, 0, 60, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3' }))
      .toThrow(/no audio tracks/i);
  });

  test('throws for invalid audio track ordinal like video exports', () => {
    expect(() => calculatePlan(media1080p, 0, 60, { mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3', selectedAudioTrackIndex: 99 }))
      .toThrow(/does not exist in the source file/);
  });

  test('ignores mode/crf — works even with auto mode settings', () => {
    const plan = calculatePlan(media1080p, 0, 60, { mode: 'auto', crfValue: 19, outputFormat: 'mp3' });
    expect(plan.isSinglePass).toBe(true);
    expect(plan.crfValue).toBeUndefined();
    expect(plan.audioBitrateKbps).toBe(192);
    expect(plan.singlePassArgs).toContain('libmp3lame');
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — codec & hardware encoder selection
// ---------------------------------------------------------------------------

describe('calculatePlan — codec & hardware encoder selection', () => {
  const CAPS_ALL = {
    nvenc: { h264: true, av1: true },
    qsv: { h264: true, av1: true },
    amf: { h264: true, av1: true },
    svtav1: true,
    libx264: true
  };

  test('AV1 + CPU resolves to libsvtav1 with an mp4 container in auto mode', () => {
    const plan = calculatePlan(media1080p, 0, 30, {
      mode: 'auto', crfValue: 19, videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_ALL
    });
    expect(plan.encoder).toBe('libsvtav1');
    expect(plan.codec).toBe('av1');
    expect(plan.container).toBe('mp4');
    expect(plan.isSinglePass).toBe(true);
    expect(plan.singlePassArgs).toContain('libsvtav1');
    // AV1 now muxes into the picked format (mp4): AAC audio + faststart.
    expect(plan.singlePassArgs).toContain('aac');
    expect(plan.singlePassArgs).toContain('+faststart');
  });

  test('AV1 + CPU size-limit uses 2-pass SVT-AV1 with VBV constraints', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_ALL
    }));
    expect(plan.encoder).toBe('libsvtav1');
    // 2-pass plans don't set isSinglePass (encoder.js treats it as 2-pass).
    expect(plan.isSinglePass).toBeFalsy();
    expect(plan.pass1Args).toContain('libsvtav1');
    expect(plan.pass1Args).toContain('-pass');
    expect(plan.pass1Args[plan.pass1Args.indexOf('-pass') + 1]).toBe('1');
    expect(plan.pass2Args[plan.pass2Args.indexOf('-pass') + 1]).toBe('2');
    // SVT-AV1 v4.2.0 rejects -maxrate in 2-pass ("Max Bitrate only supported
    // with CRF mode"), so size-mode SVT must not carry it.
    expect(plan.pass1Args).not.toContain('-maxrate');
    expect(plan.pass2Args).not.toContain('-maxrate');
  });

  test('SVT-AV1 size-limit gets a discounted bitrate budget', () => {
    // SVT's 2-pass rate control runs ~10% hot on short high-detail clips,
    // so its budget is discounted (SVT_SAFETY_FACTOR) to stay under the cap.
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_ALL
    }));
    expect(plan.encoder).toBe('libsvtav1');
    const baseline = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'h264', hwAccel: 'cpu', encoders: CAPS_ALL
    }));
    expect(plan.videoBitrateKbps).toBeLessThan(baseline.videoBitrateKbps);
    expect(plan.estimatedSizeMB).toBeLessThanOrEqual(10);
  });

  test('SVT discount cannot push a plan below the absolute minimum bitrate', () => {
    // The pre-discount budget passes the ABSOLUTE_MIN check, but the 0.92
    // factor must not let the final budget slip under the declared floor.
    // 60s at 0.4 MB ≈ 52 kbps undiscounted → ~48 kbps after the discount.
    expect(() => calculatePlan(media1080p, 0, 60, sizeLimitSettings(0.4, {
      audioBitrateKbps: 0, videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_ALL
    }))).toThrow(/minimum threshold/);
  });

  test('SVT discount does not distort the resolution decision', () => {
    // The discount applies only to the encode budget, not the resolution
    // decision: a plan whose full budget clears the quality floor must keep
    // the native resolution even when the discounted bitrate dips below it
    // (SVT's hot runs actually deliver ~the full budget on overshoot clips).
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(13, {
      videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_ALL
    }));
    expect(plan.encoder).toBe('libsvtav1');
    expect(plan.videoBitrateKbps).toBeLessThan(1500); // discounted below 1080p floor
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.downscaled).toBe(false);
    expect(plan.estimatedSizeMB).toBeLessThanOrEqual(13);
  });

  test('AV1 + CPU falls back to libaom-av1 when svtav1 is not shipped', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'av1', hwAccel: 'cpu', encoders: { libaom: true, libx264: true }
    }));
    expect(plan.encoder).toBe('libaom-av1');
    expect(plan.pass1Args).toContain('libaom-av1');
    expect(plan.pass1Args).toContain('-cpu-used');
  });

  test('mp4 exports never get the -strict experimental flag', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: { libx264: true }
    }));
    expect(plan.pass2Args).not.toContain('-strict');
  });

  test('AV1 + NVENC resolves to av1_nvenc single-pass when available', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'av1', hwAccel: 'nvenc', encoders: CAPS_ALL
    }));
    expect(plan.encoder).toBe('av1_nvenc');
    expect(plan.isSinglePass).toBe(true);
    expect(plan.singlePassArgs).toContain('av1_nvenc');
    expect(plan.container).toBe('mp4');
  });

  test('Intel QSV is selected when the user picks it and it is available', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'qsv', encoders: { qsv: { h264: true, av1: false } }
    }));
    expect(plan.encoder).toBe('h264_qsv');
    expect(plan.isSinglePass).toBe(true);
    expect(plan.singlePassArgs).toContain('h264_qsv');
  });

  test('AMD AMF is selected when the user picks it and it is available', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'amf', encoders: { amf: { h264: true, av1: true } }
    }));
    expect(plan.encoder).toBe('h264_amf');
    expect(plan.isSinglePass).toBe(true);
    expect(plan.singlePassArgs).toContain('h264_amf');
  });

  test('auto mode prefers NVENC over QSV/AMF/CPU for h264', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'auto', encoders: CAPS_ALL
    }));
    expect(plan.encoder).toBe('h264_nvenc');
  });

  test('auto mode falls through vendors in order for AV1', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'auto', videoCodec: 'av1',
      encoders: { qsv: { h264: true, av1: true } } // no nvenc/amf
    }));
    expect(plan.encoder).toBe('av1_qsv');
  });

  test('auto mode with no hardware available falls back to CPU', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'auto', encoders: { svtav1: true, libx264: true }
    }));
    expect(plan.encoder).toBe('libx264');
  });

  test('requesting an unavailable vendor falls back to the CPU encoder', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'amf', encoders: { nvenc: { h264: true, av1: false } }
    }));
    expect(plan.encoder).toBe('libx264');
  });

  test('legacy hasNvenc flag still selects NVENC in auto mode', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'auto', hasNvenc: true
    }));
    expect(plan.encoder).toBe('h264_nvenc');
  });

  test('QSV quality mode (auto preset) uses -global_quality', () => {
    const plan = calculatePlan(media1080p, 0, 60, {
      mode: 'auto', crfValue: 19, hwAccel: 'qsv',
      encoders: { qsv: { h264: true, av1: false } }
    });
    expect(plan.singlePassArgs).toContain('-global_quality');
    expect(plan.singlePassArgs).not.toContain('-cq');
  });

  test('AMF quality mode uses -rc cqp and -qp_i/-qp_p', () => {
    const plan = calculatePlan(media1080p, 0, 60, {
      mode: 'auto', crfValue: 19, hwAccel: 'amf',
      encoders: { amf: { h264: true, av1: false } }
    });
    expect(plan.singlePassArgs).toContain('-qp_i');
    expect(plan.singlePassArgs).toContain('-qp_p');
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — WebM format (VP9/AV1 + Opus)
// ---------------------------------------------------------------------------

describe('calculatePlan — WebM format', () => {
  const CAPS_VPX = {
    nvenc: { h264: true, av1: true },
    qsv: { h264: true, av1: false },
    amf: { h264: false, av1: false },
    svtav1: true,
    libx264: true,
    vpx9: true
  };

  test('WebM + H.264 setting remaps to VP9 (2-pass libvpx-vp9, opus, no faststart)', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      outputFormat: 'webm', hwAccel: 'cpu', encoders: CAPS_VPX
    }));
    expect(plan.codec).toBe('vp9');
    expect(plan.encoder).toBe('libvpx-vp9');
    expect(plan.container).toBe('webm');
    expect(plan.outputFormat).toBe('webm');
    // 2-pass size targeting (VP9 is a CPU encoder)
    expect(plan.isSinglePass).toBeFalsy();
    expect(plan.pass1Args).toContain('libvpx-vp9');
    expect(plan.pass2Args).toContain('libvpx-vp9');
    expect(plan.pass1Args).toContain('-pass');
    expect(plan.pass2Args[plan.pass2Args.indexOf('-pass') + 1]).toBe('2');
    // WebM audio is opus (native encoder needs -strict -2, no faststart)
    expect(plan.pass2Args).toContain('opus');
    expect(plan.pass2Args).toContain('-strict');
    expect(plan.pass2Args[plan.pass2Args.indexOf('-strict') + 1]).toBe('-2');
    expect(plan.pass2Args).not.toContain('aac');
    expect(plan.pass2Args).not.toContain('+faststart');
    // The H.264 -> VP9 remap is surfaced to the user
    expect(plan.warnings.some(w => w.id === 'webm-vp9')).toBe(true);
  });

  test('WebM + H.264 ignores the hardware preference (VP9 is CPU-only)', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      outputFormat: 'webm', hwAccel: 'nvenc', encoders: CAPS_VPX
    }));
    expect(plan.encoder).toBe('libvpx-vp9');
    expect(plan.isSinglePass).toBeFalsy(); // 2-pass, not single-pass VBR
  });

  test('WebM + H.264 auto mode uses CRF single-pass with -b:v 0', () => {
    const plan = calculatePlan(media1080p, 0, 30, {
      mode: 'auto', crfValue: 19, outputFormat: 'webm', hwAccel: 'cpu', encoders: CAPS_VPX
    });
    expect(plan.encoder).toBe('libvpx-vp9');
    expect(plan.isSinglePass).toBe(true);
    expect(plan.singlePassArgs).toContain('-crf');
    expect(plan.singlePassArgs).toContain('-b:v');
    expect(plan.singlePassArgs).toContain('opus');
    expect(plan.singlePassArgs).toContain('-strict');
    expect(plan.singlePassArgs).not.toContain('+faststart');
  });

  test('WebM + AV1 setting keeps AV1 with opus audio in the webm container', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      outputFormat: 'webm', videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_VPX
    }));
    expect(plan.codec).toBe('av1');
    expect(plan.encoder).toBe('libsvtav1');
    expect(plan.container).toBe('webm');
    expect(plan.pass2Args).toContain('opus');
    expect(plan.pass2Args).toContain('-strict');
    expect(plan.pass2Args).not.toContain('aac');
    expect(plan.pass2Args).not.toContain('+faststart');
    // No VP9 remap warning when AV1 is kept
    expect(plan.warnings.some(w => w.id === 'webm-vp9')).toBe(false);
  });

  test('WebM + H.264 throws a clear error when the build lacks libvpx', () => {
    const noVpx = { ...CAPS_VPX, vpx9: false };
    expect(() => calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      outputFormat: 'webm', hwAccel: 'cpu', encoders: noVpx
    }))).toThrow(/libvpx-vp9/);
  });

  test('WebM + AV1 does not gate on vpx9 availability', () => {
    const noVpx = { ...CAPS_VPX, vpx9: false };
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      outputFormat: 'webm', videoCodec: 'av1', hwAccel: 'cpu', encoders: noVpx
    }));
    expect(plan.codec).toBe('av1');
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — playback speed (setpts/atempo)
// ---------------------------------------------------------------------------

describe('calculatePlan — playback speed', () => {
  const CAPS_WITH_ATEMPO = { libx264: true, atempo: true };
  const CAPS_NO_ATEMPO = { libx264: true, atempo: false };

  /** The -vf value (filters are joined into one string) or null. */
  function vfArg(args) {
    const idx = args.indexOf('-vf');
    return idx === -1 ? null : args[idx + 1];
  }

  /** The -af value or null. */
  function afArg(args) {
    const idx = args.indexOf('-af');
    return idx === -1 ? null : args[idx + 1];
  }

  test('2x speed halves the plan duration and adds setpts + atempo', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      playbackSpeed: 2, encoders: CAPS_WITH_ATEMPO, hwAccel: 'cpu'
    }));
    expect(plan.playbackSpeed).toBe(2);
    expect(plan.clipDuration).toBe(30); // output duration = 60 / 2
    // Video timeline compressed on both passes (setpts joins the -vf chain)
    expect(vfArg(plan.pass1Args)).toContain('setpts=PTS/2');
    expect(vfArg(plan.pass2Args)).toContain('setpts=PTS/2');
    // Audio tempo on pass 2 only (pass 1 is -an)
    expect(plan.pass1Args).not.toContain('-af');
    expect(afArg(plan.pass2Args)).toBe('atempo=2.000');
    // -t is the OUTPUT duration
    const tIdx = plan.pass2Args.indexOf('-t');
    expect(plan.pass2Args[tIdx + 1]).toBe('30.000');
  });

  test('0.5x speed doubles the output duration', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(10, {
      playbackSpeed: 0.5, encoders: CAPS_WITH_ATEMPO, hwAccel: 'cpu'
    }));
    expect(plan.clipDuration).toBe(60);
    expect(vfArg(plan.pass2Args)).toContain('setpts=PTS/0.5');
    expect(afArg(plan.pass2Args)).toBe('atempo=0.500');
  });

  test('size-limit bitrate budgets against the OUTPUT duration (2x gets more bitrate)', () => {
    const normal = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, { hwAccel: 'cpu', encoders: CAPS_NO_ATEMPO }));
    // Video-only media (no audio) doesn't need atempo
    const noAudio = { filePath: 'test.mp4', width: 1920, height: 1080, audioTracks: [] };
    const fast = calculatePlan(noAudio, 0, 60, sizeLimitSettings(10, {
      playbackSpeed: 2, hwAccel: 'cpu', encoders: CAPS_NO_ATEMPO
    }));
    expect(fast.videoBitrateKbps).toBeGreaterThan(normal.videoBitrateKbps);
    expect(fast.estimatedSizeMB).toBeLessThanOrEqual(10);
  });

  test('video-only speed works without atempo capability', () => {
    const noAudio = { filePath: 'test.mp4', width: 1920, height: 1080, audioTracks: [] };
    const plan = calculatePlan(noAudio, 0, 60, sizeLimitSettings(10, {
      playbackSpeed: 2, hwAccel: 'cpu', encoders: CAPS_NO_ATEMPO
    }));
    expect(vfArg(plan.pass2Args)).toContain('setpts=PTS/2');
    expect(afArg(plan.pass2Args)).toBeNull();
  });

  test('audio speed without atempo capability throws a clear error', () => {
    expect(() => calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      playbackSpeed: 2, hwAccel: 'cpu', encoders: CAPS_NO_ATEMPO
    }))).toThrow(/atempo/);
  });

  test('MP3 export honors speed with -af atempo and output-duration -t', () => {
    const plan = calculatePlan(media1080p, 0, 60, {
      mode: 'size-limit', targetSizeMB: 10, outputFormat: 'mp3',
      playbackSpeed: 1.5, encoders: CAPS_WITH_ATEMPO
    });
    expect(plan.clipDuration).toBeCloseTo(40, 6);
    const tIdx = plan.singlePassArgs.indexOf('-t');
    expect(plan.singlePassArgs[tIdx + 1]).toBe('40.000');
    // 1.5x is a single atempo instance
    expect(afArg(plan.singlePassArgs)).toBe('atempo=1.500');
  });

  test('3x speed chains atempo instances (2x then 1.5x)', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      playbackSpeed: 3, hwAccel: 'cpu', encoders: CAPS_WITH_ATEMPO
    }));
    expect(afArg(plan.pass2Args)).toBe('atempo=2,atempo=1.500');
  });

  test('GIF export applies setpts but never atempo', () => {
    const plan = calculatePlan(media1080p, 0, 30, {
      mode: 'auto', crfValue: 19, outputFormat: 'gif',
      playbackSpeed: 2, hwAccel: 'cpu', encoders: CAPS_NO_ATEMPO
    });
    expect(vfArg(plan.singlePassArgs)).toContain('setpts=PTS/2');
    expect(afArg(plan.singlePassArgs)).toBeNull();
  });

  test('speed of 1 (or missing) changes nothing', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(10, { hwAccel: 'cpu', encoders: CAPS_WITH_ATEMPO }));
    expect(plan.clipDuration).toBe(30);
    expect(vfArg(plan.pass2Args)).toBeNull();
    expect(afArg(plan.pass2Args)).toBeNull();
  });

  test('out-of-range speeds are clamped', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(10, {
      playbackSpeed: 99, hwAccel: 'cpu', encoders: CAPS_WITH_ATEMPO
    }));
    expect(plan.playbackSpeed).toBe(4);
    expect(plan.clipDuration).toBeCloseTo(7.5, 6);
  });

  test('atempoFilter factors >2x and <0.5x into chained instances', () => {
    const { atempoFilter, normalizeSpeed } = require('../main/export-planner')._internals;
    expect(atempoFilter(3)).toBe('atempo=2,atempo=1.500');
    expect(atempoFilter(4)).toBe('atempo=2,atempo=2.000');
    expect(atempoFilter(0.25)).toBe('atempo=0.5,atempo=0.500');
    expect(atempoFilter(1.25)).toBe('atempo=1.250');
    expect(normalizeSpeed(undefined)).toBe(1);
    expect(normalizeSpeed('banana')).toBe(1);
    expect(normalizeSpeed(0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calculatePlan — edge cases
// ---------------------------------------------------------------------------

describe('calculatePlan — edge cases', () => {
  test('very short clip (1s) at 10 MB → high bitrate, no downscale', () => {
    const plan = calculatePlan(media1440p, 0, 1, sizeLimitSettings(10));
    expect(plan.videoBitrateKbps).toBe(25000);
    expect(plan.downscaled).toBe(false);
  });

  test('exact 10s clip at 10 MB', () => {
    const plan = calculatePlan(media1080p, 5, 15, sizeLimitSettings(10));
    expect(plan.clipDuration).toBe(10);
    expect(plan.estimatedSizeMB).toBeLessThan(10);
  });

  test('fractional trim points are handled', () => {
    const plan = calculatePlan(media1080p, 1.234, 5.678, sizeLimitSettings(10));
    expect(plan.clipDuration).toBeCloseTo(4.444, 3);
  });

  test('audio bitrate of 0 gives all budget to video', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, { audioBitrateKbps: 0 }));
    const planWithAudio = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, { audioBitrateKbps: 128 }));
    expect(plan.videoBitrateKbps).toBeGreaterThan(planWithAudio.videoBitrateKbps);
  });

  test('360p source is never downscaled even at low bitrate', () => {
    const plan = calculatePlan(media360p, 0, 60, customSettings(200));
    expect(plan.width).toBe(640);
    expect(plan.height).toBe(360);
    expect(plan.downscaled).toBe(false);
  });

  test('all standard size presets produce valid plans for a 30s 1080p clip', () => {
    for (const preset of SIZE_PRESETS.filter(p => !p.isCustom)) {
      const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(preset.sizeMB));
      expect(plan.videoBitrateKbps).toBeGreaterThan(0);
      expect(plan.estimatedSizeMB).toBeLessThanOrEqual(preset.sizeMB);
    }
  });
});

// ---------------------------------------------------------------------------
// buildDiscountedPlan (internal) — post-encode size-retry re-planning
// ---------------------------------------------------------------------------

describe('buildDiscountedPlan', () => {
  const CAPS_ALL = {
    nvenc: { h264: true, av1: true },
    qsv: { h264: true, av1: true },
    amf: { h264: true, av1: true },
    svtav1: true,
    libx264: true
  };

  function argAfter(args, flag) {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  }

  test('2-pass libx264 plan: bitrate and derived fields scale down', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: { libx264: true }
    }));
    // 2-pass plans carry pass1/pass2 args (isSinglePass is only set on the
    // single-pass branch, so buildDiscountedPlan's falsy check routes here).
    expect(plan.isSinglePass).toBeUndefined();
    expect(plan.pass1Args).toBeDefined();
    expect(plan.pass2Args).toBeDefined();

    const d = buildDiscountedPlan(plan, 0.85);
    expect(d).not.toBeNull();
    expect(d).not.toBe(plan); // a fresh plan, never a mutation of the input

    expect(d.videoBitrateKbps).toBe(Math.max(64, Math.round(plan.videoBitrateKbps * 0.85)));
    expect(d.totalBitrateKbps).toBe(d.videoBitrateKbps + plan.audioBitrateKbps);
    expect(d.estimatedSizeMB).toBeCloseTo(
      plan.estimatedSizeMB * (d.videoBitrateKbps / plan.videoBitrateKbps), 1
    );

    // Both passes carry the discounted bitrate; audio stays untouched.
    expect(argAfter(d.pass1Args, '-b:v')).toBe(`${d.videoBitrateKbps}k`);
    expect(argAfter(d.pass2Args, '-b:v')).toBe(`${d.videoBitrateKbps}k`);
    expect(argAfter(d.pass2Args, '-b:a')).toBe('128k');

    // The original plan is never mutated.
    expect(argAfter(plan.pass2Args, '-b:v')).toBe(`${plan.videoBitrateKbps}k`);
  });

  test('hardware single-pass plan: -b:v, -maxrate and -bufsize all scale', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'h264', hwAccel: 'nvenc', encoders: CAPS_ALL
    }));
    expect(plan.isSinglePass).toBe(true);

    const d = buildDiscountedPlan(plan, 0.85);
    expect(d).not.toBeNull();
    expect(d.videoBitrateKbps).toBeLessThan(plan.videoBitrateKbps);
    expect(argAfter(d.singlePassArgs, '-b:v')).toBe(`${d.videoBitrateKbps}k`);
    expect(argAfter(d.singlePassArgs, '-maxrate')).toBe(`${d.videoBitrateKbps}k`);
    expect(argAfter(d.singlePassArgs, '-bufsize')).toBe(`${Math.round(d.videoBitrateKbps * 1.5)}k`);
    expect(argAfter(d.singlePassArgs, '-b:a')).toBe('128k');
  });

  test('libsvtav1 plan (no -maxrate in 2-pass) still scales -b:v', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'av1', hwAccel: 'cpu', encoders: CAPS_ALL
    }));
    expect(plan.encoder).toBe('libsvtav1');
    expect(plan.pass1Args).not.toContain('-maxrate');

    const d = buildDiscountedPlan(plan, 0.85);
    expect(d).not.toBeNull();
    expect(argAfter(d.pass2Args, '-b:v')).toBe(`${d.videoBitrateKbps}k`);
  });

  test('returns null for quality/CRF plans (no size target)', () => {
    const plan = calculatePlan(media1080p, 0, 30, {
      mode: 'auto', crfValue: 19, videoCodec: 'h264', hwAccel: 'cpu', encoders: CAPS_ALL
    });
    expect(plan.crfValue).not.toBeUndefined();
    expect(buildDiscountedPlan(plan, 0.85)).toBeNull();
  });

  test('returns null for gif and mp3 formats', () => {
    expect(buildDiscountedPlan({ outputFormat: 'gif', videoBitrateKbps: 500, crfValue: undefined, singlePassArgs: [] }, 0.85)).toBeNull();
    expect(buildDiscountedPlan({ outputFormat: 'mp3', videoBitrateKbps: 0, crfValue: undefined, singlePassArgs: [] }, 0.85)).toBeNull();
  });

  test('clamps at the 64 kbps floor and stops when nothing is left to give', () => {
    const nearFloor = {
      outputFormat: 'mp4', videoBitrateKbps: 70, audioBitrateKbps: 128, estimatedSizeMB: 1.5,
      crfValue: undefined,
      pass1Args: ['-b:v', '70k', '-maxrate', '70k', '-bufsize', '105k'],
      pass2Args: ['-b:v', '70k', '-maxrate', '70k', '-bufsize', '105k', '-b:a', '128k']
    };
    const d = buildDiscountedPlan(nearFloor, 0.85);
    expect(d.videoBitrateKbps).toBe(64);
    expect(argAfter(d.pass2Args, '-b:v')).toBe('64k');
    expect(argAfter(d.pass2Args, '-maxrate')).toBe('64k');
    expect(argAfter(d.pass2Args, '-b:a')).toBe('128k');

    // Already at the floor: another discount gains nothing.
    const atFloor = { ...nearFloor, videoBitrateKbps: 64, pass1Args: ['-b:v', '64k'], pass2Args: ['-b:v', '64k'] };
    expect(buildDiscountedPlan(atFloor, 0.85)).toBeNull();
  });

  test('VP9/WebM plan scales like any other 2-pass CPU plan', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      outputFormat: 'webm', videoCodec: 'vp9', hwAccel: 'cpu', encoders: { libx264: true, vpx9: true }
    }));
    expect(plan.encoder).toBe('libvpx-vp9');

    const d = buildDiscountedPlan(plan, 0.85);
    expect(d).not.toBeNull();
    expect(argAfter(d.pass2Args, '-b:v')).toBe(`${d.videoBitrateKbps}k`);
    expect(d.pass2Args).toContain('-strict'); // opus stays experimental
  });
});

// ---------------------------------------------------------------------------
// sizeRetryTargets (internal) — merge post-convert retry target sequence
// ---------------------------------------------------------------------------

describe('sizeRetryTargets', () => {
  test('produces a descending sequence up to the retry cap', () => {
    expect(sizeRetryTargets(20, 3, 0.85)).toEqual([20, 17, 14.45]);
  });

  test('stops early at the 1 MB floor', () => {
    expect(sizeRetryTargets(1.2, 3, 0.85)).toEqual([1.2, 1.02, 1]);
    expect(sizeRetryTargets(1, 3, 0.85)).toEqual([1]);
  });

  test('honors a maxRetries of 1 (no retries)', () => {
    expect(sizeRetryTargets(20, 1, 0.85)).toEqual([20]);
  });
});

// ---------------------------------------------------------------------------
// Watermark overlay — normalizeWatermark / watermarkFilterParts /
// applyVideoFilters / calculatePlan wiring
// ---------------------------------------------------------------------------

describe('normalizeWatermark', () => {
  const { normalizeWatermark } = _internals;

  test('returns null without a usable path', () => {
    expect(normalizeWatermark(null)).toBeNull();
    expect(normalizeWatermark(undefined)).toBeNull();
    expect(normalizeWatermark({})).toBeNull();
    expect(normalizeWatermark({ path: '' })).toBeNull();
    expect(normalizeWatermark({ path: 42 })).toBeNull();
  });

  test('defaults to bottom right, 15% of the frame width, 85% opacity', () => {
    expect(normalizeWatermark({ path: 'logo.png' })).toEqual({
      path: 'logo.png', position: 'br', sizePct: 15, opacity: 0.85
    });
  });

  test('keeps a known position and falls back for an unknown one', () => {
    expect(normalizeWatermark({ path: 'l.png', position: 'tl' }).position).toBe('tl');
    expect(normalizeWatermark({ path: 'l.png', position: 'middle' }).position).toBe('br');
  });

  test('clamps size to 5-50% and opacity to 0.1-1', () => {
    expect(normalizeWatermark({ path: 'l.png', sizePct: 1 }).sizePct).toBe(5);
    expect(normalizeWatermark({ path: 'l.png', sizePct: 900 }).sizePct).toBe(50);
    expect(normalizeWatermark({ path: 'l.png', opacity: 0 }).opacity).toBe(0.1);
    expect(normalizeWatermark({ path: 'l.png', opacity: 5 }).opacity).toBe(1);
  });

  test('falls back to the defaults for non-numeric values', () => {
    expect(normalizeWatermark({ path: 'l.png', sizePct: 'wide', opacity: 'x' }))
      .toMatchObject({ sizePct: 15, opacity: 0.85 });
  });
});

describe('watermarkFilterParts', () => {
  const { watermarkFilterParts } = _internals;
  const wm = { path: 'l.png', position: 'br', sizePct: 20, opacity: 0.5 };

  test('sizes the logo from the output width, keeping the aspect ratio', () => {
    expect(watermarkFilterParts(wm, 1000, 500, 1).prepare).toBe('[1:v:0]scale=200:-1,format=rgba[wm]');
  });

  test('bottom right anchors on the right/bottom edges with a 2% margin', () => {
    expect(watermarkFilterParts(wm, 1000, 500, 1).overlay)
      .toBe('overlay=x=1000-w-20:y=500-h-20:eof_action=repeat');
  });

  test('top left anchors flush to the edges plus the margin', () => {
    expect(watermarkFilterParts({ ...wm, position: 'tl' }, 1000, 500, 1).overlay)
      .toBe('overlay=x=20:y=20:eof_action=repeat');
  });

  test('top right and bottom left mix the anchors', () => {
    expect(watermarkFilterParts({ ...wm, position: 'tr' }, 800, 600, 1).overlay)
      .toBe('overlay=x=800-w-16:y=16:eof_action=repeat');
    expect(watermarkFilterParts({ ...wm, position: 'bl' }, 800, 600, 1).overlay)
      .toBe('overlay=x=16:y=600-h-16:eof_action=repeat');
  });

  test('honors the input index (the merge path passes the clip count)', () => {
    expect(watermarkFilterParts(wm, 1000, 500, 3).prepare).toContain('[3:v:0]');
  });

  test('never sizes the logo below 16px even on a tiny frame', () => {
    expect(watermarkFilterParts({ ...wm, sizePct: 5 }, 100, 100, 1).prepare).toBe('[1:v:0]scale=16:-1,format=rgba[wm]');
  });
});

describe('applyVideoFilters', () => {
  const { applyVideoFilters, normalizeWatermark } = _internals;
  const wm = normalizeWatermark({ path: 'C:\\logo.png', position: 'br', sizePct: 10, opacity: 0.5 });
  const fcOf = (args) => args[args.indexOf('-filter_complex') + 1];

  test('no watermark, no speed -> the plain -vf path', () => {
    const args = [];
    applyVideoFilters(args, ['crop=100:100:0:0'], { wm: null, width: 100, height: 100, speed: 1 });
    expect(args).toEqual(['-vf', 'crop=100:100:0:0']);
  });

  test('no filters and normal speed emits nothing at all', () => {
    const args = [];
    applyVideoFilters(args, [], { wm: null, width: 640, height: 360, speed: 1 });
    expect(args).toEqual([]);
  });

  test('a watermark switches to -filter_complex and terminates at [vout]', () => {
    const args = [];
    applyVideoFilters(args, ['scale=640:360'], { wm, width: 640, height: 360, speed: 1 });
    expect(args).not.toContain('-vf');
    const fc = fcOf(args);
    expect(fc).toContain('[0:v:0]scale=640:360[base]');
    expect(fc).toContain('[base][wm]overlay=');
    expect(fc.endsWith('[vout]')).toBe(true);
  });

  test('a watermark with no other filters still builds a valid graph', () => {
    const args = [];
    applyVideoFilters(args, [], { wm, width: 1920, height: 1080, speed: 1 });
    expect(fcOf(args)).toContain('[0:v:0][wm]overlay=');
  });

  test('speed is applied after the overlay so the logo stays pinned', () => {
    const args = [];
    applyVideoFilters(args, ['scale=640:360'], { wm, width: 640, height: 360, speed: 2 });
    const fc = fcOf(args);
    expect(fc.indexOf('overlay=')).toBeLessThan(fc.indexOf('setpts=PTS/2'));
    expect(fc).toContain('setpts=PTS/2[vout]');
  });

  test('speed without a watermark stays on the -vf path', () => {
    const args = [];
    applyVideoFilters(args, ['scale=640:360'], { wm: null, width: 640, height: 360, speed: 2 });
    expect(args).toEqual(['-vf', 'scale=640:360,setpts=PTS/2']);
  });
});

describe('calculatePlan with a watermark', () => {
  const CAPS_OVERLAY = { libx264: true, overlay: true, atempo: true };
  const logo = { path: 'C:\\logo.png', position: 'tr', sizePct: 20, opacity: 0.5 };

  test('2-pass CPU plan adds the logo as a second input and maps [vout]', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: CAPS_OVERLAY, watermark: logo
    }));
    // Both passes encode the watermarked video (pass 1 feeds the stats file).
    [plan.pass1Args, plan.pass2Args].forEach(args => {
      expect(args.filter(a => a === '-i').length).toBe(2);
      expect(args).toContain('C:\\logo.png');
      expect(args[args.indexOf('-map') + 1]).toBe('[vout]');
      expect(args).toContain('-filter_complex');
      // The logo is itself an input, and nothing but the second -i sits
      // between it and the source -i, so every later flag stays an OUTPUT
      // option (a flag in there would be read as a decoder option).
      expect(args[args.indexOf('C:\\logo.png') - 1]).toBe('-i');
      expect(args.slice(args.indexOf('-i') + 2, args.indexOf('C:\\logo.png'))).toEqual(['-i']);
    });
  });

  test('with no watermark the video maps 0:v:0 as before', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: CAPS_OVERLAY
    }));
    expect(plan.pass2Args[plan.pass2Args.indexOf('-map') + 1]).toBe('0:v:0');
    expect(plan.pass2Args).not.toContain('-filter_complex');
  });

  test('single-pass hardware plans carry the watermark too', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'nvenc', encoders: { nvenc: { h264: true, av1: false }, overlay: true },
      watermark: logo
    }));
    expect(plan.isSinglePass).toBe(true);
    expect(plan.singlePassArgs).toContain('-filter_complex');
    expect(plan.singlePassArgs[plan.singlePassArgs.indexOf('-map') + 1]).toBe('[vout]');
  });

  test('speed and a watermark compose: overlay first, then setpts', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: CAPS_OVERLAY, playbackSpeed: 2, watermark: logo
    }));
    const fc = plan.pass2Args[plan.pass2Args.indexOf('-filter_complex') + 1];
    expect(fc.indexOf('overlay=')).toBeLessThan(fc.indexOf('setpts=PTS/2'));
    expect(plan.clipDuration).toBe(30);
  });

  test('throws a clear error when the build lacks the overlay filter', () => {
    expect(() => calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: { libx264: true, overlay: false }, watermark: logo
    }))).toThrow(/overlay filter/);
  });

  test('does not gate on the probe when no capability map is known yet', () => {
    // An empty/absent capability map means "not probed", not "not available".
    expect(() => calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', watermark: logo
    }))).not.toThrow();
  });

  test('an invalid watermark shape is simply ignored', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      hwAccel: 'cpu', encoders: CAPS_OVERLAY, watermark: { position: 'br' }
    }));
    expect(plan.pass2Args).not.toContain('-filter_complex');
  });
});

// ---------------------------------------------------------------------------
// estimateRequiredBytes — the pre-export disk-space budget
// ---------------------------------------------------------------------------

describe('estimateRequiredBytes', () => {
  const { estimateRequiredBytes } = _internals;
  const MB = 1024 * 1024;

  test('takes the larger of the estimate and the size cap, plus 5% slack', () => {
    const bytes = estimateRequiredBytes({ estimatedSizeMB: 8, targetSizeMB: 20 });
    expect(bytes).toBe(Math.ceil(20 * MB * 1.05));
  });

  test('prefers the estimate when it exceeds the cap', () => {
    const bytes = estimateRequiredBytes({ estimatedSizeMB: 30, targetSizeMB: 20 });
    expect(bytes).toBe(Math.ceil(30 * MB * 1.05));
  });

  test('a 2-pass export adds the x264 stats allowance', () => {
    const one = estimateRequiredBytes({ estimatedSizeMB: 10, twoPass: false });
    const two = estimateRequiredBytes({ estimatedSizeMB: 10, twoPass: true });
    expect(two - one).toBe(64 * MB);
  });

  test('GIF extraction budgets raw y4m frames (w*h*3*30fps)', () => {
    const noFrames = estimateRequiredBytes({ estimatedSizeMB: 5, outputFormat: 'mp4' });
    const gif = estimateRequiredBytes({
      estimatedSizeMB: 5, outputFormat: 'gif', width: 640, height: 480, clipDuration: 10
    });
    expect(gif - noFrames).toBe(640 * 480 * 3 * 10 * 30);
  });

  test('adds the temp-segment and merge-intermediate allowances', () => {
    const bytes = estimateRequiredBytes({
      estimatedSizeMB: 10, tempSegmentsMB: 12, mergeIntermediateMB: 15
    });
    expect(bytes).toBe(Math.ceil(10 * MB * 1.05) + 12 * MB + 15 * MB);
  });

  test('ignores negative, zero, and non-numeric inputs', () => {
    expect(estimateRequiredBytes({})).toBe(0);
    expect(estimateRequiredBytes({ estimatedSizeMB: -5, tempSegmentsMB: NaN, mergeIntermediateMB: 'lots' })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Export audio (mute / volume) and structured plan-fix data
// ---------------------------------------------------------------------------

describe('calculatePlan — export audio', () => {
  const ENCODERS = { libx264: true, atempo: true, overlay: true, volume: true };

  test('muting drops the audio stream entirely (-an, no audio map, no audio args)', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, {
      encoders: ENCODERS,
      audio: { muted: true, volume: 1 }
    }));

    const args = plan.isSinglePass ? plan.singlePassArgs : plan.pass2Args;
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('-b:a');
    // No audio stream is mapped, so nothing can sneak a track into the file.
    expect(args).not.toContain('0:a:0');
    // And the plan reports what it actually encodes.
    expect(plan.audioBitrateKbps).toBe(0);
  });

  test('a muted export does not reserve audio bitrate from a size budget', () => {
    const withAudio = calculatePlan(media1080p, 0, 60, sizeLimitSettings(20, { encoders: ENCODERS }));
    const muted = calculatePlan(media1080p, 0, 60, sizeLimitSettings(20, {
      encoders: ENCODERS,
      audio: { muted: true, volume: 1 }
    }));
    // The budget that went to audio now goes to the video.
    expect(muted.videoBitrateKbps).toBeGreaterThan(withAudio.videoBitrateKbps);
  });

  test('volume below unity encodes the gain through the volume filter', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, {
      encoders: ENCODERS,
      audio: { muted: false, volume: 0.5 }
    }));
    const args = plan.isSinglePass ? plan.singlePassArgs : plan.pass2Args;
    expect(args).toContain('-af');
    expect(args[args.indexOf('-af') + 1]).toContain('volume=0.5');
  });

  test('unity volume adds no audio filter at all', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, {
      encoders: ENCODERS,
      audio: { muted: false, volume: 1 }
    }));
    const args = plan.isSinglePass ? plan.singlePassArgs : plan.pass2Args;
    expect(args).not.toContain('-af');
  });

  test('speed and volume combine into one ordered audio chain', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, {
      encoders: ENCODERS,
      playbackSpeed: 2,
      audio: { muted: false, volume: 0.5 }
    }));
    const args = plan.isSinglePass ? plan.singlePassArgs : plan.pass2Args;
    const chain = args[args.indexOf('-af') + 1];
    expect(chain).toMatch(/atempo=/);
    expect(chain).toMatch(/volume=0\.5/);
    expect(chain.indexOf('atempo')).toBeLessThan(chain.indexOf('volume'));
  });

  test('volume below unity fails loudly on a build without the filter', () => {
    expect(() => calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, {
      encoders: { libx264: true, atempo: true, overlay: true, volume: false },
      audio: { muted: false, volume: 0.5 }
    }))).toThrow(/volume filter/);
  });

  test('muting needs no filter, so it works on a build without volume', () => {
    expect(() => calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, {
      encoders: { libx264: true, atempo: true, overlay: true, volume: false },
      audio: { muted: true, volume: 1 }
    }))).not.toThrow();
  });

  test('missing audio settings mean unity gain (backwards compatible)', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, { encoders: ENCODERS }));
    const args = plan.isSinglePass ? plan.singlePassArgs : plan.pass2Args;
    expect(args).not.toContain('-af');
    expect(plan.audioBitrateKbps).toBeGreaterThan(0);
  });
});

describe('buildPlanFix', () => {
  const { buildPlanFix } = _internals;

  test('reports the longest clip and smallest target that would fit', () => {
    // 3000s at 20 MB is past the ~1915s ceiling, so the target genuinely fails.
    const fix = buildPlanFix(3000, 20, 128);
    expect(fix.maximumClipDurationSec).toBeGreaterThan(0);
    expect(fix.maximumClipDurationSec).toBeLessThan(3000);
    expect(fix.minimumTargetSizeMB).toBeGreaterThan(20);
    // The numbers must agree with the planner's own thresholds.
    expect(fix.maximumClipDurationSec).toBeCloseTo(maximumClipDurationSec(20, 128), 2);
    expect(fix.minimumTargetSizeMB).toBeCloseTo(minimumTargetSizeMB(3000, 128), 1);
  });

  test('nulls out a value that cannot help instead of inventing one', () => {
    // A tiny clip already fits any target, so there is no minimum to raise to.
    const fix = buildPlanFix(1, 20, 128);
    expect(fix.minimumTargetSizeMB === null || fix.minimumTargetSizeMB <= 20).toBe(true);
  });

  test('the fix numbers round-trip through a real refusal', () => {
    let caught = null;
    try {
      calculatePlan(media1080p, 0, 3000, sizeLimitSettings(20, { encoders: { libx264: true } }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    // The error still reads as before; only the structured numbers are new.
    expect(caught.message).toMatch(/does not fit in 20 MB/);
    expect(caught.planFix.maximumClipDurationSec).toBeGreaterThan(0);
  });

  test('a plan that fits still carries no fix (nothing to fix)', () => {
    const plan = calculatePlan(media1080p, 0, 30, sizeLimitSettings(20, { encoders: { libx264: true } }));
    expect(plan.planFix).toBeUndefined();
  });
});
