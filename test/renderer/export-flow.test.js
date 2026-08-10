const { formatPlanDisplay, buildPlanWarnings, isTrimPastVideoEnd } = require('../../renderer/export-flow.js');

const PLAN = {
  width: 854,
  height: 480,
  videoBitrateKbps: 365,
  audioBitrateKbps: 96,
  estimatedSizeMB: 9.36,
  crfValue: 19,
  warnings: []
};

describe('formatPlanDisplay', () => {
  test('size-limit mp4 shows video bitrate, resolution and size', () => {
    const d = formatPlanDisplay(PLAN, { isMp3: false, outputFormat: 'mp4', mode: 'size-limit' });
    expect(d).toEqual({
      vbrLabel: 'Video:',
      vbrText: '365 kbps',
      sizeText: '9.36 MB',
      resText: '854x480',
      resVisible: true
    });
  });

  test('mp3 shows audio bitrate and hides resolution', () => {
    const d = formatPlanDisplay(PLAN, { isMp3: true, outputFormat: 'mp3', mode: 'size-limit' });
    expect(d).toEqual({
      vbrLabel: 'Audio:',
      vbrText: '96 kbps',
      sizeText: '9.36 MB',
      resText: '',
      resVisible: false
    });
  });

  test('gif shows a static GIF label', () => {
    const d = formatPlanDisplay(PLAN, { isMp3: false, outputFormat: 'gif', mode: 'size-limit' });
    expect(d.vbrText).toBe('GIF');
    expect(d.sizeText).toBe('—');
    expect(d.resText).toBe('854x480');
  });

  test('auto mode shows CRF and variable size', () => {
    const d = formatPlanDisplay(PLAN, { isMp3: false, outputFormat: 'mp4', mode: 'auto' });
    expect(d.vbrText).toBe('CRF 19');
    expect(d.sizeText).toBe('Variable (quality-based)');
  });

  test('handles a missing plan', () => {
    const d = formatPlanDisplay(null, {});
    expect(d.resVisible).toBe(false);
    expect(d.vbrText).toBe('');
  });
});

describe('isTrimPastVideoEnd', () => {
  test('flags a trim past the end of a meaningfully shorter video track', () => {
    expect(isTrimPastVideoEnd(62, 60, 120)).toBe(true);
  });

  test('never flags normal files (video ≈ container duration)', () => {
    expect(isTrimPastVideoEnd(59.99, 60, 60.02)).toBe(false);
    expect(isTrimPastVideoEnd(60, 60, 60)).toBe(false);
  });

  test('does not flag a trim inside the video track', () => {
    expect(isTrimPastVideoEnd(10, 60, 120)).toBe(false);
  });

  test('fails safe on missing/NaN durations', () => {
    expect(isTrimPastVideoEnd(62, undefined, 120)).toBe(false);
    expect(isTrimPastVideoEnd(62, NaN, 120)).toBe(false);
    expect(isTrimPastVideoEnd(62, 60, NaN)).toBe(false);
  });
});

describe('buildPlanWarnings', () => {
  test('includes plan warnings and VFR notice', () => {
    const warnings = buildPlanWarnings(
      { warnings: [{ id: 'x', title: 'X', body: 'y' }] },
      { isVFR: true, outputFormat: 'mp4', trimDuration: 10, targetSizeMB: 10 }
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.map(w => w.id)).toEqual(['x', 'vfr']);
  });

  test('adds GIF feasibility warning for long clips in a 10MB target', () => {
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'gif', trimDuration: 45, targetSizeMB: 10 }
    );
    expect(warnings.map(w => w.id)).toEqual(['gif_feasibility']);
    expect(warnings[0].body).toContain('45s');
  });

  test('does not warn about GIF feasibility for short clips', () => {
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'gif', trimDuration: 20, targetSizeMB: 10 }
    );
    expect(warnings).toHaveLength(0);
  });

  test('does not warn for a large target', () => {
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'gif', trimDuration: 45, targetSizeMB: 50 }
    );
    expect(warnings).toHaveLength(0);
  });

  test('warns when the trim In point is past the end of the video track', () => {
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'mp4', trimDuration: 30, targetSizeMB: 10, trimIn: 62, videoDuration: 60, duration: 120 }
    );
    expect(warnings.map(w => w.id)).toEqual(['no_video_frames']);
    expect(warnings[0].title).toContain('no video frames');
  });

  test('does not warn when the trim In is inside the video track', () => {
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'mp4', trimDuration: 30, targetSizeMB: 10, trimIn: 10, videoDuration: 60, duration: 120 }
    );
    expect(warnings).toHaveLength(0);
  });

  test('does not warn when the video track is not meaningfully shorter than the container', () => {
    // Normal file: videoDuration ≈ container duration — a trim to the very
    // end must not be flagged even though trimIn ≈ videoDuration.
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'mp4', trimDuration: 0.1, targetSizeMB: 10, trimIn: 59.99, videoDuration: 60, duration: 60.02 }
    );
    expect(warnings).toHaveLength(0);
  });

  test('does not warn when the video track duration is unknown', () => {
    const warnings = buildPlanWarnings(
      { warnings: [] },
      { isVFR: false, outputFormat: 'mp4', trimDuration: 30, targetSizeMB: 10, trimIn: 62, videoDuration: undefined }
    );
    expect(warnings).toHaveLength(0);
  });

  test('tolerates missing plan and context', () => {
    expect(buildPlanWarnings(null, {})).toEqual([]);
    expect(buildPlanWarnings(undefined, undefined)).toEqual([]);
  });
});
