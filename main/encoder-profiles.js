/**
 * Encoder profiles — the single source of truth for which video encoders
 * ClipSend can use and how to translate "quality" / "size-targeted" modes
 * into FFmpeg argument lists.
 *
 * Vendors:
 *   - nvenc  NVIDIA NVENC   (h264_nvenc / av1_nvenc)
 *   - qsv    Intel Quick Sync Video (h264_qsv / av1_qsv)
 *   - amf    AMD Advanced Media Framework (h264_amf / av1_amf)
 *   - cpu    libx264 (H.264) / libsvtav1 (AV1) / libvpx-vp9 (VP9, WebM)
 *
 * WebM gets its own codec story: the container cannot carry H.264, so a
 * WebM export with the H.264 setting is remapped to VP9 (libvpx-vp9,
 * software-only in this app) via codecForFormat(). AV1 is kept as-is —
 * AV1-in-WebM is valid and keeps the hardware AV1 encoders usable.
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
  if (videoCodec === 'av1') return 'libsvtav1';
  if (videoCodec === 'vp9') return 'libvpx-vp9';
  return 'libx264';
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
  if (codec === 'vp9') {
    // VP9 has no hardware variant in this app; only libvpx-vp9 exists.
    // (Availability is gated at plan time via the vpx9 capability flag.)
    return 'libvpx-vp9';
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
  const codec = videoCodec === 'av1' ? 'av1' : videoCodec === 'vp9' ? 'vp9' : 'h264';
  const cpu = resolveCpuEncoder(codec, encoders);

  // VP9 is software-only here (no nvenc/qsv/amf VP9 profiles), so any
  // hardware preference is irrelevant — always the CPU encoder.
  if (codec === 'vp9') return cpu;

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
    // No -maxrate: SVT-AV1 v4.2.0 rejects it in 2-pass mode ("Max Bitrate
    // only supported with CRF mode"), and the planner only uses this in
    // 2-pass (SVT is a CPU encoder, so size mode is always two-pass).
    bitrateArgs: (preset, vbit, bufsize) =>
      ['-preset', preset, '-b:v', `${vbit}k`, '-bufsize', `${bufsize}k`]
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
  'libvpx-vp9': {
    supportsTwoPass: true,
    // VP9 tunes via -cpu-used (0-5, lower = slower + better) with -deadline
    // good for the speed tier. -row-mt 1 lets the encoder use multiple
    // threads (otherwise VP9 is single-threaded and painfully slow).
    presets: { quality: '2', balanced: '4' },
    qualityArgs: (cpuUsed, crf) =>
      ['-deadline', 'good', '-cpu-used', cpuUsed, '-row-mt', '1', '-crf', String(crf), '-b:v', '0'],
    bitrateArgs: (cpuUsed, vbit, bufsize) =>
      ['-deadline', 'good', '-cpu-used', cpuUsed, '-row-mt', '1', '-b:v', `${vbit}k`, '-maxrate', `${vbit}k`, '-bufsize', `${bufsize}k`]
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
 * Audio encoder for a container. MP4 (H.264 or AV1) uses AAC; WebM uses the
 * native FFmpeg Opus encoder — NOT libopus, because the slim bundled build
 * links no external audio libs beyond libmp3lame, and the in-tree opus
 * encoder (a port of the libopus reference encoder) is byte-for-byte
 * equivalent at a fraction of the build complexity. FFmpeg still marks it
 * experimental, so the planner/merger append `-strict -2` for WebM encodes.
 */
function audioCodecFor(container) {
  return container === 'webm' ? 'opus' : 'aac';
}

/**
 * Output container for an export format. Video (H.264/VP9/AV1) lands in the
 * format the user picked (mp4 or webm); gif/mp3 keep their own containers.
 */
function containerForFormat(outputFormat) {
  if (outputFormat === 'gif') return 'gif';
  if (outputFormat === 'mp3') return 'mp3';
  if (outputFormat === 'webm') return 'webm';
  return 'mp4';
}

/**
 * Resolve the video codec an export actually uses, given the format picker
 * and the user's codec setting. WebM cannot carry H.264, so an H.264
 * request under WebM becomes VP9 (the canonical WebM codec); AV1 is valid
 * in WebM and passes through unchanged.
 *
 * @param {string} outputFormat - 'mp4' | 'webm' | 'gif' | 'mp3'
 * @param {string} requestedCodec - 'h264' | 'av1'
 * @returns {string} 'h264' | 'av1' | 'vp9'
 */
function codecForFormat(outputFormat, requestedCodec) {
  if (outputFormat === 'webm' && requestedCodec !== 'av1') return 'vp9';
  return requestedCodec === 'av1' ? 'av1' : 'h264';
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
    libx264: has('libx264'),
    // VP9 encode comes from libvpx; the slim build ships it as of the
    // WebM feature (see scripts/build-ffmpeg.sh, BUILD_VPX).
    vpx9: has('libvpx-vp9')
  };
}

/**
 * Parse `ffmpeg -hide_banner -filters` stdout for the audio/video filters the
 * app gates behavior on. `atempo` (pitch-preserving audio speed) was missing
 * from the slim build until it was added to scripts/build-ffmpeg.sh, so the
 * planner refuses audio+speed exports unless this runtime probe reports it.
 */
function parseFilterCapabilities(stdout) {
  const lines = String(stdout || '').split('\n');
  // Filter lines look like: " .. setpts  V->V  Set PTS for the output..." —
  // two flag chars (timeline/slice/audio/video), then the filter name.
  const hasAtempo = lines.some(line =>
    /^\s*[TSC.][ASV.]\s+atempo\b/.test(line)
  );
  return { atempo: hasAtempo };
}

/**
 * Run `ffmpeg -encoders` (plus `-filters`) and resolve the capability map
 * (null on failure). The filter probe shares the promise cache with the
 * encoder probe via ipc-handlers' getEncoderCapabilities.
 */
function detectAvailableEncoders(ffmpegPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-encoders'], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      const caps = parseEncoderCapabilities(stdout);
      execFile(ffmpegPath, ['-hide_banner', '-filters'], { maxBuffer: 4 * 1024 * 1024 }, (filterError, filterOut) => {
        if (!filterError) {
          caps.atempo = parseFilterCapabilities(filterOut).atempo;
        } else {
          // A failed filter probe must not fail the whole detection: atempo
          // simply stays false and audio+speed exports get the clear error.
          caps.atempo = false;
        }
        resolve(caps);
      });
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
  codecForFormat,
  parseEncoderCapabilities,
  parseFilterCapabilities,
  detectAvailableEncoders
};
