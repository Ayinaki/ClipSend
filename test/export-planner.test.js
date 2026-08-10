const { calculatePlan, _internals } = require('../main/export-planner');
const { SIZE_PRESETS, getPresetById, getDefaultPreset } = require('../main/presets');

const {
  computeSizeLimitBitrate,
  resolveResolution,
  computeSeekTimes,
  QUALITY_FLOORS,
  SAFETY_MARGIN,
  MUXING_OVERHEAD,
  ABSOLUTE_MIN_VIDEO_BITRATE_KBPS,
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
  test('provides four presets (10, 50, 500 MB and custom)', () => {
    expect(SIZE_PRESETS).toHaveLength(4);
    expect(SIZE_PRESETS.filter(p => !p.isCustom).map(p => p.sizeMB)).toEqual([10, 50, 500]);
  });

  test('default preset is discord-free (10 MB)', () => {
    const d = getDefaultPreset();
    expect(d.id).toBe('discord-free');
    expect(d.sizeMB).toBe(10);
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

  test('very long clip (600s) at 10 MB → throws (bitrate too low)', () => {
    // 10 MB / 600s ≈ 6 kbps video — correctly impossible
    expect(() => {
      calculatePlan(media1440p, 0, 600, sizeLimitSettings(10));
    }).toThrow(/below the minimum threshold/);
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
    expect(plan.pass1Args).toContain('-maxrate');
  });

  test('AV1 + CPU falls back to libaom-av1 when svtav1 is not shipped', () => {
    const plan = calculatePlan(media1080p, 0, 60, sizeLimitSettings(10, {
      videoCodec: 'av1', hwAccel: 'cpu', encoders: { libaom: true, libx264: true }
    }));
    expect(plan.encoder).toBe('libaom-av1');
    expect(plan.pass1Args).toContain('libaom-av1');
    expect(plan.pass1Args).toContain('-cpu-used');
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
