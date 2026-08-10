/**
 * Encoder profiles — the single source of truth for which video encoders
 * ClipSend can use and how to translate "quality" / "size-targeted" modes
 * into FFmpeg argument lists.
 *
 * Vendors:
 *   - nvenc  NVIDIA NVENC   (h264_nvenc / av1_nvenc)
 *   - qsv    Intel Quick Sync Video (h264_qsv / av1_qsv)
 *   - amf    AMD Advanced Media Framework (h264_amf / av1_amf)
 *   - cpu    libx264 (H.264) / libsvtav1 (AV1)
 *
 * Detection is presence-based: `ffmpeg -encoders` lists what the bundled
 * binary can decode/encode. Whether the hardware actually initializes is
 * only known at encode time, so the export pipeline keeps its existing
 * "hardware failed -> retry with CPU" fallback for every vendor.
 */
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Encoder name lookup
// ---------------------------------------------------------------------------

/** Vendor encoder names per video codec. */
const VENDOR_ENCODERS = {
  h264: { nvenc: 'h264_nvenc', qsv: 'h264_qsv', amf: 'h264_amf' },
  av1: { nvenc: 'av1_nvenc', qsv: 'av1_qsv', amf: 'av1_amf' }
};

const HW_VENDORS = ['nvenc', 'qsv', 'amf'];

/** Nominal CPU encoder for a video codec (used when availability is unknown). */
function cpuEncoderFor(videoCodec) {
  return videoCodec === 'av1' ? 'libsvtav1' : 'libx264';
}

/**
 * Pick the CPU encoder that this FFmpeg build actually ships. The bundled
 * binary may have libsvtav1, libaom-av1, or both.
 */
function resolveCpuEncoder(codec, encoders) {
  if (codec === 'av1') {
    if (encoders && encoders.svtav1) return 'libsvtav1';
    if (encoders && encoders.libaom) return 'libaom-av1';
    return 'libsvtav1';
  }
  return 'libx264';
}

/** True when an encoder name is a hardware encoder (has a vendor suffix). */
function isHardwareEncoder(encoderName) {
  return /_(nvenc|qsv|amf)$/.test(encoderName || '');
}

/**
 * Resolve the concrete FFmpeg encoder from the user's preference and what is
 * available on this machine. Falls back to CPU whenever the chosen vendor is
 * missing, and in Auto mode prefers the first available vendor in
 * nvenc -> qsv -> amf order before giving up on hardware.
 *
 * @param {object} opts
 * @param {string} [opts.hwAccel='auto'] - 'auto' | 'nvenc' | 'qsv' | 'amf' | 'cpu'
 * @param {string} [opts.videoCodec='h264'] - 'h264' | 'av1'
 * @param {object} [opts.encoders] - capability map from detectAvailableEncoders()
 * @param {boolean} [opts.hasNvenc] - legacy flag (pre-capabilities-map callers)
 */
function pickEncoder({ hwAccel = 'auto', videoCodec = 'h264', encoders = {}, hasNvenc = false } = {}) {
  const codec = videoCodec === 'av1' ? 'av1' : 'h264';
  const cpu = resolveCpuEncoder(codec, encoders);

  // Legacy callers passed hasNvenc instead of the capabilities map.
  const noCaps = !encoders || typeof encoders !== 'object' || Object.keys(encoders).length === 0;
  if (noCaps) {
    if (codec === 'h264' && hasNvenc && (hwAccel === 'nvenc' || hwAccel === 'auto')) {
      return 'h264_nvenc';
    }
    return cpu;
  }

  if (hwAccel === 'cpu') return cpu;

  if (hwAccel === 'auto') {
    for (const vendor of HW_VENDORS) {
      if (encoders[vendor] && encoders[vendor][codec]) return VENDOR_ENCODERS[codec][vendor];
    }
    return cpu;
  }

  if (encoders[hwAccel] && encoders[hwAccel][codec]) return VENDOR_ENCODERS[codec][hwAccel];
  return cpu;
}

// ---------------------------------------------------------------------------
// FFmpeg argument builders
// ---------------------------------------------------------------------------

/**
 * Per-encoder profile. `presets` maps a quality intent ('quality' | 'balanced')
 * to the encoder's preset/quality string. `qualityArgs` is used for CRF-style
 * single-pass quality mode; `bitrateArgs` for size-targeted mode (VBV
 * constrained). 2-pass-capable CPU encoders get `-pass 1|2` appended by the
 * caller via `supportsTwoPass`.
 */
const PROFILES = {
  libx264: {
    supportsTwoPass: true,
    presets: { quality: 'veryslow', balanced: 'slow' },
    qualityArgs: (preset, crf) => ['-preset', preset, '-crf', String(crf)],
    bitrateArgs: (preset, vbit, bufsize) =>
      ['-preset', preset, '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`, '-bufsize', `${bufsize}k`]
  },
  libsvtav1: {
    supportsTwoPass: true,
    // SVT-AV1 preset 0-13, lower = slower + better quality per bit.
    presets: { quality: '3', balanced: '6' },
    qualityArgs: (preset, crf) => ['-preset', preset, '-crf', String(crf)],
    bitrateArgs: (preset, vbit, bufsize) =>
      ['-preset', preset, '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`, '-bufsize', `${bufsize}k`]
  },
  'libaom-av1': {
    supportsTwoPass: true,
    // libaom uses -cpu-used (0-8, lower = slower + better) instead of -preset,
    // and CRF mode needs an explicit -b:v 0.
    presets: { quality: '2', balanced: '6' },
    qualityArgs: (cpuUsed, crf) => ['-cpu-used', cpuUsed, '-crf', String(crf), '-b:v', '0'],
    bitrateArgs: (cpuUsed, vbit, bufsize) =>
      ['-cpu-used', cpuUsed, '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`, '-bufsize', `${bufsize}k`]
  },
  h264_nvenc: hwNvencProfile(),
  av1_nvenc: hwNvencProfile(),
  h264_qsv: hwQsvProfile(),
  av1_qsv: hwQsvProfile(),
  h264_amf: hwAmfProfile(),
  av1_amf: hwAmfProfile()
};

function hwNvencProfile() {
  return {
    supportsTwoPass: false,
    presets: { quality: 'p7', balanced: 'p5' },
    qualityArgs: (preset, cq) => ['-preset', preset, '-rc', 'vbr', '-cq', String(cq), '-b:v', '0'],
    bitrateArgs: (preset, vbit, bufsize) =>
      ['-preset', preset, '-rc', 'vbr', '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`, '-bufsize', `${bufsize}k`]
  };
}

function hwQsvProfile() {
  return {
    supportsTwoPass: false,
    presets: { quality: 'veryslow', balanced: 'medium' },
    // QSV uses -global_quality (ICQ) for quality mode.
    qualityArgs: (preset, q) => ['-preset', preset, '-global_quality', String(q)],
    bitrateArgs: (preset, vbit, bufsize) =>
      ['-preset', preset, '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`, '-bufsize', `${bufsize}k`]
  };
}

function hwAmfProfile() {
  return {
    supportsTwoPass: false,
    // AMF exposes -quality (speed/balanced/quality) instead of -preset, and
    // uses -qp_i/-qp_p/-qp_b with -rc cqp for quality mode.
    presets: { quality: 'quality', balanced: 'balanced' },
    qualityArgs: (quality, q) =>
      ['-quality', quality, '-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q), '-qp_b', String(q)],
    bitrateArgs: (quality, vbit) =>
      ['-quality', quality, '-rc', 'vbr_peak', '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`]
  };
}

/**
 * Build the `-c:v <encoder> ...` argument list for a video encode.
 *
 * Quality mode (crfValue set) is single-pass; size mode uses 2-pass for
 * CPU encoders (pass 1|2) and constrained single-pass VBR for hardware.
 *
 * @param {object} opts
 * @param {string} opts.encoder - resolved encoder name (e.g. 'libsvtav1')
 * @param {number} [opts.crfValue] - quality mode (CRF / CQ / QP value)
 * @param {number} [opts.videoBitrateKbps] - size mode target video bitrate
 * @param {boolean} [opts.maxQuality] - prefer the slower, higher-quality preset
 * @param {string} [opts.preset] - explicit preset override (CPU encoders)
 * @param {number} [opts.pass] - 0 (single) | 1 | 2
 * @returns {string[]}
 */
function buildVideoCodecArgs({ encoder, crfValue, videoBitrateKbps, maxQuality = false, pass = 0, preset } = {}) {
  const name = encoder || 'libx264';
  const profile = PROFILES[name] || PROFILES.libx264;
  const chosen = preset || (maxQuality ? profile.presets.quality : profile.presets.balanced);
  const args = ['-c:v', name];

  const vbit = Math.round(videoBitrateKbps);
  if (crfValue !== undefined) {
    args.push(...profile.qualityArgs(chosen, crfValue));
    return args;
  }

  const bufsize = Math.round(videoBitrateKbps * 1.5);
  if (profile.supportsTwoPass && (pass === 1 || pass === 2)) {
    args.push(...profile.bitrateArgs(chosen, vbit, bufsize), '-pass', String(pass));
    return args;
  }
  args.push(...profile.bitrateArgs(chosen, vbit, bufsize));
  return args;
}

/**
 * Audio encoder for a container. The app's format picker (mp4/gif/mp3)
 * always muxes video into MP4 — including AV1, which Discord plays fine in
 * MP4 with AAC audio — so opus is only ever used if a WebM container is
 * requested explicitly (kept for completeness/future use).
 */
function audioCodecFor(container) {
  return container === 'webm' ? 'libopus' : 'aac';
}

/**
 * Output container for an export format. Video (H.264 or AV1) always lands
 * in the format the user picked — mp4 — rather than being forced to WebM;
 * gif/mp3 keep their own containers.
 */
function containerForFormat(outputFormat) {
  if (outputFormat === 'gif') return 'gif';
  if (outputFormat === 'mp3') return 'mp3';
  return 'mp4';
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Parse `ffmpeg -encoders` stdout into the capability map the renderer and
 * planner consume:
 *   { nvenc: { h264, av1 }, qsv: { h264, av1 }, amf: { h264, av1 },
 *     svtav1, libaom, libx264 }
 */
function parseEncoderCapabilities(stdout) {
  const names = new Set();
  for (const line of String(stdout || '').split('\n')) {
    // Encoder lines look like: " V....D av1_nvenc    NVIDIA AV1 (codec av1)"
    const m = line.match(/^\s*V.{5}\s+([\w-]+)/);
    if (m) names.add(m[1]);
  }
  const has = (n) => names.has(n);
  return {
    nvenc: { h264: has('h264_nvenc'), av1: has('av1_nvenc') },
    qsv: { h264: has('h264_qsv'), av1: has('av1_qsv') },
    amf: { h264: has('h264_amf'), av1: has('av1_amf') },
    svtav1: has('libsvtav1'),
    libaom: has('libaom-av1'),
    libx264: has('libx264')
  };
}

/** Run `ffmpeg -encoders` and resolve the capability map (null on failure). */
function detectAvailableEncoders(ffmpegPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-encoders'], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(parseEncoderCapabilities(stdout));
    });
  });
}

module.exports = {
  VENDOR_ENCODERS,
  HW_VENDORS,
  PROFILES,
  pickEncoder,
  buildVideoCodecArgs,
  isHardwareEncoder,
  cpuEncoderFor,
  resolveCpuEncoder,
  audioCodecFor,
  containerForFormat,
  parseEncoderCapabilities,
  detectAvailableEncoders
};
