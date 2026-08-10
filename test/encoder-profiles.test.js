const {
  pickEncoder,
  buildVideoCodecArgs,
  isHardwareEncoder,
  cpuEncoderFor,
  audioCodecFor,
  containerForFormat,
  parseEncoderCapabilities
} = require('../main/encoder-profiles');

describe('pickEncoder', () => {
  const CAPS = {
    nvenc: { h264: true, av1: true },
    qsv: { h264: true, av1: false },
    amf: { h264: false, av1: false },
    svtav1: true,
    libx264: true
  };

  test('cpu forces the CPU encoder for the codec', () => {
    expect(pickEncoder({ hwAccel: 'cpu', videoCodec: 'h264', encoders: CAPS })).toBe('libx264');
    expect(pickEncoder({ hwAccel: 'cpu', videoCodec: 'av1', encoders: CAPS })).toBe('libsvtav1');
  });

  test('auto prefers the first available vendor', () => {
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'h264', encoders: CAPS })).toBe('h264_nvenc');
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'av1', encoders: CAPS })).toBe('av1_nvenc');
  });

  test('auto skips vendors that cannot do the codec', () => {
    const caps = { qsv: { h264: true, av1: true }, amf: { h264: true, av1: false } };
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'av1', encoders: caps })).toBe('av1_qsv');
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'h264', encoders: caps })).toBe('h264_qsv');
  });

  test('auto falls back to CPU when no hardware is available', () => {
    const caps = { svtav1: true, libx264: true };
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'h264', encoders: caps })).toBe('libx264');
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'av1', encoders: caps })).toBe('libsvtav1');
  });

  test('AV1 CPU falls back to libaom-av1 when svtav1 is absent', () => {
    const caps = { libaom: true, libx264: true };
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'av1', encoders: caps })).toBe('libaom-av1');
    expect(pickEncoder({ hwAccel: 'cpu', videoCodec: 'av1', encoders: caps })).toBe('libaom-av1');
  });

  test('explicit vendor uses its encoder when available', () => {
    expect(pickEncoder({ hwAccel: 'qsv', videoCodec: 'h264', encoders: CAPS })).toBe('h264_qsv');
  });

  test('explicit vendor falls back to CPU when unavailable', () => {
    expect(pickEncoder({ hwAccel: 'amf', videoCodec: 'h264', encoders: CAPS })).toBe('libx264');
    expect(pickEncoder({ hwAccel: 'qsv', videoCodec: 'av1', encoders: CAPS })).toBe('libsvtav1');
  });

  test('empty/legacy capabilities honor the hasNvenc flag for h264', () => {
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'h264', hasNvenc: true })).toBe('h264_nvenc');
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'h264', hasNvenc: false })).toBe('libx264');
    expect(pickEncoder({ hwAccel: 'auto', videoCodec: 'av1', hasNvenc: true })).toBe('libsvtav1');
  });
});

describe('buildVideoCodecArgs', () => {
  test('libx264 quality mode matches the historical CRF args', () => {
    expect(buildVideoCodecArgs({ encoder: 'libx264', crfValue: 19 }))
      .toEqual(['-c:v', 'libx264', '-preset', 'slow', '-crf', '19']);
    expect(buildVideoCodecArgs({ encoder: 'libx264', crfValue: 19, maxQuality: true }))
      .toEqual(['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '19']);
  });

  test('libx264 size mode appends -pass for two-pass encodes', () => {
    const args = buildVideoCodecArgs({ encoder: 'libx264', videoBitrateKbps: 1000, pass: 1 });
    expect(args).toContain('-b:v');
    expect(args).toContain('1000k');
    expect(args).toContain('-maxrate');
    expect(args).toContain('-pass');
    expect(args[args.indexOf('-pass') + 1]).toBe('1');
  });

  test('h264_nvenc size mode reproduces the historical constrained VBR args', () => {
    const args = buildVideoCodecArgs({ encoder: 'h264_nvenc', videoBitrateKbps: 1000 });
    expect(args).toEqual([
      '-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr',
      '-b:v', '1000k', '-maxrate', '1000k', '-bufsize', '1500k'
    ]);
  });

  test('h264_nvenc quality mode uses -cq with p7 for max quality', () => {
    const args = buildVideoCodecArgs({ encoder: 'h264_nvenc', crfValue: 19, maxQuality: true });
    expect(args).toContain('-preset');
    expect(args[args.indexOf('-preset') + 1]).toBe('p7');
    expect(args).toContain('-cq');
  });

  test('libsvtav1 quality mode uses its own preset scale', () => {
    const args = buildVideoCodecArgs({ encoder: 'libsvtav1', crfValue: 30 });
    expect(args).toContain('libsvtav1');
    expect(args).toContain('-preset');
    expect(args[args.indexOf('-preset') + 1]).toBe('6');
    expect(args).toContain('-crf');
  });

  test('libaom-av1 quality mode uses -cpu-used and -crf with -b:v 0', () => {
    const args = buildVideoCodecArgs({ encoder: 'libaom-av1', crfValue: 30 });
    expect(args).toContain('libaom-av1');
    expect(args).toContain('-cpu-used');
    expect(args).toContain('-crf');
    expect(args).toContain('-b:v');
  });

  test('libaom-av1 size mode appends -pass for two-pass encodes', () => {
    const args = buildVideoCodecArgs({ encoder: 'libaom-av1', videoBitrateKbps: 1000, pass: 2 });
    expect(args).toContain('-pass');
    expect(args[args.indexOf('-pass') + 1]).toBe('2');
  });

  test('h264_qsv uses -global_quality and AMF uses -rc cqp + -qp_i', () => {
    const qsv = buildVideoCodecArgs({ encoder: 'h264_qsv', crfValue: 18 });
    expect(qsv).toContain('-global_quality');

    const amf = buildVideoCodecArgs({ encoder: 'h264_amf', crfValue: 18 });
    expect(amf).toContain('-qp_i');
    expect(amf).toContain('-rc');
    expect(amf[amf.indexOf('-rc') + 1]).toBe('cqp');
  });

  test('preset override wins for CPU encoders', () => {
    const args = buildVideoCodecArgs({ encoder: 'libx264', crfValue: 18, preset: 'medium' });
    expect(args[args.indexOf('-preset') + 1]).toBe('medium');
  });
});

describe('helpers', () => {
  test('isHardwareEncoder recognizes every vendor suffix', () => {
    expect(isHardwareEncoder('h264_nvenc')).toBe(true);
    expect(isHardwareEncoder('av1_qsv')).toBe(true);
    expect(isHardwareEncoder('h264_amf')).toBe(true);
    expect(isHardwareEncoder('libx264')).toBe(false);
    expect(isHardwareEncoder('libsvtav1')).toBe(false);
    expect(isHardwareEncoder(undefined)).toBe(false);
  });

  test('cpuEncoderFor / audioCodecFor / containerForFormat map formats', () => {
    expect(cpuEncoderFor('h264')).toBe('libx264');
    expect(cpuEncoderFor('av1')).toBe('libsvtav1');
    // Video always muxes into the picked format — mp4 uses AAC, webm (if ever
    // requested) uses opus.
    expect(audioCodecFor('mp4')).toBe('aac');
    expect(audioCodecFor('webm')).toBe('libopus');
    expect(containerForFormat('mp4')).toBe('mp4');
    expect(containerForFormat('gif')).toBe('gif');
    expect(containerForFormat('mp3')).toBe('mp3');
    // AV1 is not forced into webm anymore — mp4 (the format picker default).
    expect(containerForFormat('mp4')).toBe('mp4');
  });

  test('parseEncoderCapabilities reads names from -encoders output', () => {
    const stdout = [
      'Encoders:',
      ' V..... libx264              libx264 H.264 / AVC (codec h264)',
      ' V....D av1_nvenc            NVIDIA AV1 (codec av1)',
      ' V....D h264_qsv             H.264 / AVC (Intel Quick Sync) (codec h264)',
      ' V..... libsvtav1            SVT-AV1 (codec av1)',
      ' A..... libmp3lame           libmp3lame MP3 (codec mp3)'
    ].join('\n');

    const caps = parseEncoderCapabilities(stdout);
    expect(caps.nvenc).toEqual({ h264: false, av1: true });
    expect(caps.qsv).toEqual({ h264: true, av1: false });
    expect(caps.amf).toEqual({ h264: false, av1: false });
    expect(caps.svtav1).toBe(true);
    expect(caps.libx264).toBe(true);
  });

  test('parseEncoderCapabilities tolerates empty output', () => {
    const caps = parseEncoderCapabilities('');
    expect(caps.nvenc.h264).toBe(false);
    expect(caps.svtav1).toBe(false);
  });
});
