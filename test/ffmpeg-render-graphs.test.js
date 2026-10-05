/**
 * Integration coverage for the filter graphs the export pipeline hands to
 * FFmpeg, run against the REAL bundled binaries with the output pixels read
 * back.
 *
 * Why this exists: the watermark overlay and the merge retime are the two
 * places where a wrong graph still encodes "successfully". The unit suites mock
 * child_process, so they can only assert the argument arrays — they cannot tell
 * you the logo landed in the wrong corner, that the alpha channel was dropped,
 * or that setpts never retimed anything. This suite runs the graph and looks at
 * the frames.
 *
 * Skipped (never failed) when `bin/ffmpeg.exe` / `bin/ffprobe.exe` are absent.
 * They are gitignored and fetched by CI (or by `bin/README.md`'s download
 * steps), so a fresh clone still runs `npm test` green.
 *
 * Windows-only, like the app: the binaries are `.exe`.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { calculatePlan } = require('../main/export-planner');
const { Merger } = require('../main/merger');

const FFMPEG = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
const FFPROBE = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
const BINARIES_PRESENT = fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE);

if (!BINARIES_PRESENT) {
  // Loud on purpose: a silent skip is how an integration suite rots unnoticed.
  console.warn(
    '[ffmpeg-render-graphs] bin/ffmpeg.exe or bin/ffprobe.exe is missing, ' +
    'so the real-FFmpeg render-graph suite is skipped. Fetch them (see bin/README.md) to run it.'
  );
}

/** A plain describe when the binaries exist, a skipped one otherwise. */
const whenBundled = BINARIES_PRESENT ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

/**
 * Minimal solid-colour PNG. Passing `alpha` writes RGBA (colour type 6), which
 * is exactly the shape the renderer's opacity bake produces before an export.
 *
 * Hand-rolled because the bundled FFmpeg ships no lavfi source and no `color`
 * filter, so it cannot synthesise test media for itself.
 */
function solidPng(width, height, [r, g, b], alpha = null) {
  const bpp = alpha === null ? 3 : 4;
  const raw = Buffer.alloc((width * bpp + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * bpp + 1);
    // Filter type 0 (none) on every row: these are single-colour frames, so
    // there is nothing for a predictor to save.
    for (let x = 0; x < width; x++) {
      const at = rowStart + 1 + x * bpp;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      if (bpp === 4) raw[at + 3] = alpha;
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                            // bit depth
  ihdr[9] = alpha === null ? 2 : 6;       // truecolour / truecolour + alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Minimal 16-bit mono PCM WAV of a quiet sine. Hand-rolled for the same reason
 * as solidPng: no lavfi source in the bundled build. A size-capped export plan
 * only produces a meaningful file size when there is an audio track to spend
 * part of the budget on.
 */
function toneWav(seconds, rate = 44100) {
  const samples = Math.round(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(2000 * Math.sin(i * 0.05)), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);        // PCM chunk size
  header.writeUInt16LE(1, 20);         // format: PCM
  header.writeUInt16LE(1, 22);         // channels: mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);  // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Run FFmpeg's first pixel of a 1x1 PNG (all filters are identity at 1x1). */
function firstPixelOf(pngPath) {
  const png = fs.readFileSync(pngPath);
  const idat = [];
  let pos = 8;
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    if (png.toString('ascii', pos + 4, pos + 8) === 'IDAT') {
      idat.push(png.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // raw = [filterByte, r, g, b]. With a single pixel there is no left or upper
  // neighbour, so every PNG filter predictor evaluates to 0 and the filter byte
  // can be ignored.
  return { r: raw[1], g: raw[2], b: raw[3] };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

whenBundled('FFmpeg render graphs (real bundled binaries)', () => {
  // Real encodes, but each one is a 2s 320x240 clip: a few hundred ms.
  jest.setTimeout(120000);

  let dir;
  let clipA;
  let clipB;
  let clipWithAudio;
  let logo;
  let logoAlpha;
  let outputCount = 0;

  // A 20s clip needs ~137 kbps to fit in 350 KB, which is less than the 128
  // kbps audio default plus any real video bitrate. That is the same shape as
  // the reported bug (a 21-minute clip in a 20 MB target), scaled down to
  // something that encodes in about a second.
  const AUDIO_CLIP_SECONDS = 20;
  const SQUEEZED_TARGET_MB = 0.35;

  /** A fresh output path per test so reruns never read a stale file. */
  const outputFor = (label) => path.join(dir, `${label}-${++outputCount}.mp4`);

  // `cwd` matters for the 2-pass encodes below: pass 1 writes its stats file
  // relative to the working directory (an absolute Windows path breaks pass 2),
  // so the two passes have to agree on it.
  const runFfmpeg = (args, cwd) => execFileSync(FFMPEG, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024
  });

  /** Per-stream codec type and bit rate, for checking what was actually encoded. */
  function probeStreams(file) {
    const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,bit_rate',
      '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out.toString()).streams;
  }

  /** Average colour of one crop, read back through a 1x1 PNG. */
  function averageColor(file, crop, tag) {
    const probe = path.join(dir, `probe-${tag}-${++outputCount}.png`);
    runFfmpeg(['-v', 'error', '-y', '-i', file, '-vf',
      `${crop},format=rgb24,scale=1:1`, '-frames:v', '1', '-update', '1', '-f', 'image2', probe]);
    const px = firstPixelOf(probe);
    fs.unlinkSync(probe);
    return px;
  }

  function probeDuration(file) {
    const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    return parseFloat(JSON.parse(out.toString()).format.duration);
  }

  /** The logo is solid green, the clip is solid red: easy to tell apart. */
  const isLogoGreen = ({ r, g }) => g > 150 && g > r + 30;

  const clipMediaInfo = () => ({
    filePath: clipA, width: 320, height: 240, frameRate: 30, audioTracks: []
  });

  /** A single-pass CPU plan for the fixture clip, with the given watermark. */
  function planWithWatermark(watermark) {
    return calculatePlan(clipMediaInfo(), 0, 2, {
      mode: 'auto',
      crfValue: 23,
      outputFormat: 'mp4',
      hwAccel: 'cpu',
      encoders: { libx264: true, overlay: true },
      watermark
    });
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsend-render-graphs-'));

    const redFrame = path.join(dir, 'red.png');
    fs.writeFileSync(redFrame, solidPng(320, 240, [220, 40, 40]));
    logo = path.join(dir, 'logo-rgb.png');
    fs.writeFileSync(logo, solidPng(48, 48, [40, 220, 40]));
    logoAlpha = path.join(dir, 'logo-alpha.png');
    fs.writeFileSync(logoAlpha, solidPng(48, 48, [40, 220, 40], 128));

    // Two identical 2s clips: the lossless concat demuxer is usable for them,
    // so any re-encode in the merge tests is the thing under test and not a
    // forced mismatch.
    clipA = path.join(dir, 'a.mp4');
    clipB = path.join(dir, 'b.mp4');
    for (const file of [clipA, clipB]) {
      runFfmpeg(['-y', '-loop', '1', '-i', redFrame, '-t', '2', '-r', '30',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    }

    // The same colour, but long enough and with an audio track for the
    // size-capped budget tests.
    const tone = path.join(dir, 'tone.wav');
    fs.writeFileSync(tone, toneWav(AUDIO_CLIP_SECONDS));
    clipWithAudio = path.join(dir, 'with-audio.mp4');
    runFfmpeg(['-y', '-loop', '1', '-i', redFrame, '-i', tone,
      '-t', String(AUDIO_CLIP_SECONDS), '-r', '30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', clipWithAudio]);
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('watermark burn-in', () => {
    test('the plan feeds the logo in as its own input and maps [vout]', () => {
      const args = planWithWatermark({ path: logo, position: 'tl', sizePct: 25, opacity: 1 }).singlePassArgs;

      expect(args[args.indexOf('-map') + 1]).toBe('[vout]');
      expect(args[args.indexOf(logo) - 1]).toBe('-i');
      // Only the second -i may sit between the source input and the logo path:
      // any option flag in there would be read as a decoder option for the logo
      // instead of an output option.
      expect(args.slice(args.indexOf('-i') + 2, args.indexOf(logo))).toEqual(['-i']);
    });

    // 320x240 source, a 25% logo is 80px wide (square, so 80x80) inset by
    // max(8, 2% of 320) = 8px. Each case samples inside its corner's logo and
    // inside the opposite corner as a control.
    const CORNERS = [
      ['top left', 'tl', 'crop=40:40:14:14', 'crop=40:40:250:180'],
      ['top right', 'tr', 'crop=40:40:250:14', 'crop=40:40:14:180'],
      ['bottom left', 'bl', 'crop=40:40:14:180', 'crop=40:40:250:14'],
      ['bottom right', 'br', 'crop=40:40:250:180', 'crop=40:40:14:14']
    ];

    test.each(CORNERS)('burns the logo into the %s corner only', (_label, position, logoCrop, controlCrop) => {
      const outFile = outputFor(`wm-${position}`);
      const plan = planWithWatermark({ path: logo, position, sizePct: 25, opacity: 1 });
      runFfmpeg(plan.singlePassArgs.concat([outFile]));

      expect(isLogoGreen(averageColor(outFile, logoCrop, `logo-${position}`))).toBe(true);
      expect(isLogoGreen(averageColor(outFile, controlCrop, `ctl-${position}`))).toBe(false);
    });

    test('a pre-baked alpha image blends with the video instead of covering it', () => {
      const outFile = outputFor('wm-alpha');
      // This is the shape renderer/app.js watermarkForExport() writes: the
      // opacity is applied to the pixels on a canvas, because the bundled
      // FFmpeg has no alpha-scaling filter. The graph then passes it through
      // untouched, so the blend has to come from the image's own alpha.
      const plan = planWithWatermark({ path: logoAlpha, position: 'tl', sizePct: 25, opacity: 1 });
      runFfmpeg(plan.singlePassArgs.concat([outFile]));

      const blend = averageColor(outFile, 'crop=40:40:14:14', 'alpha');
      // 50% green over red lands both channels mid-range. Full opacity would
      // give (40, 220, 40); no overlay at all would give (220, 40, 40).
      expect(blend.r).toBeGreaterThan(60);
      expect(blend.r).toBeLessThan(200);
      expect(blend.g).toBeGreaterThan(60);
      expect(blend.g).toBeLessThan(200);
    });

    test('a watermark larger than the frame margin still fits inside it', () => {
      const outFile = outputFor('wm-large');
      const plan = planWithWatermark({ path: logo, position: 'br', sizePct: 50, opacity: 1 });
      runFfmpeg(plan.singlePassArgs.concat([outFile]));

      // 50% of 320 is 160px, so the bottom-right logo spans 152..312 on x and
      // 72..232 on y. Sampling the far edge of it proves the anchor used the
      // real logo size and did not run off the frame.
      expect(isLogoGreen(averageColor(outFile, 'crop=30:30:275:200', 'large'))).toBe(true);
    });
  });

  describe('merge render graphs', () => {
    test('a merge at 2x retimes the joined output', async () => {
      const outFile = outputFor('merge-speed');
      const result = await new Merger().runMerge([clipA, clipB], outFile, null, { speed: 2 });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('concat_filter (playback speed 2x)');
      // 2s + 2s of source on the output clock. The encode can overshoot by a
      // frame or two, so allow a small window rather than an exact match.
      const duration = probeDuration(outFile);
      expect(duration).toBeGreaterThan(1.9);
      expect(duration).toBeLessThan(2.2);
    });

    test('a merge burns the watermark into the joined output', async () => {
      const outFile = outputFor('merge-wm');
      const result = await new Merger().runMerge([clipA, clipB], outFile, null, {
        watermark: { path: logo, position: 'br', sizePct: 25, opacity: 1 }
      });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('concat_filter (watermark)');
      expect(isLogoGreen(averageColor(outFile, 'crop=40:40:250:180', 'merge-logo'))).toBe(true);
      expect(isLogoGreen(averageColor(outFile, 'crop=40:40:14:14', 'merge-ctl'))).toBe(false);
    });

    test('speed and watermark together apply the overlay before the retime', async () => {
      const outFile = outputFor('merge-both');
      const result = await new Merger().runMerge([clipA, clipB], outFile, null, {
        speed: 2,
        watermark: { path: logo, position: 'tl', sizePct: 25, opacity: 1 }
      });

      expect(result.strategy).toBe('concat_filter (playback speed 2x + watermark)');
      // The logo is still on the frame after the retime, at the original
      // corner's coordinates: overlay first, then setpts.
      expect(isLogoGreen(averageColor(outFile, 'crop=40:40:14:14', 'merge-both-logo'))).toBe(true);
      const duration = probeDuration(outFile);
      expect(duration).toBeGreaterThan(1.9);
      expect(duration).toBeLessThan(2.2);
    });

    test('a plain merge still takes the lossless copy path', async () => {
      const outFile = outputFor('merge-lossless');
      const result = await new Merger().runMerge([clipA, clipB], outFile, null, {});

      // Guards the other direction: speed and watermark must be the ONLY
      // reasons a compatible merge gives up `-c copy`.
      expect(result.strategy).toBe('concat_demuxer');
      const duration = probeDuration(outFile);
      expect(duration).toBeGreaterThan(3.9);
      expect(duration).toBeLessThan(4.2);
    });

    test('a muted merge drops the audio branch and still renders', async () => {
      // Muting rebuilds the concat graph with a=0 (no audio inputs at all), so
      // this is the check that the graph FFmpeg is handed is actually valid —
      // an invalid one only ever fails at runtime, never in the arg builder.
      const outFile = outputFor('merge-muted');
      const result = await new Merger().runMerge([clipWithAudio, clipWithAudio], outFile, null, {
        muted: true,
        volume: 1
      });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('concat_filter (muted audio)');
      const types = probeStreams(outFile).map(s => s.codec_type);
      expect(types).toContain('video');
      expect(types).not.toContain('audio');
    });

    test('an unmuted merge of the same clips keeps its audio', async () => {
      const outFile = outputFor('merge-audible');
      const result = await new Merger().runMerge([clipWithAudio, clipWithAudio], outFile, null, {});

      expect(result.success).toBe(true);
      expect(probeStreams(outFile).map(s => s.codec_type)).toContain('audio');
    });
  });

  // The budget math is unit-tested, but only a real encode proves the plan it
  // produces is one FFmpeg will actually run and land under the cap with.
  describe('size-capped export plan', () => {
    test('a plan that squeezed its audio encodes at the squeezed rate, under the cap', () => {
      const plan = calculatePlan({
        filePath: clipWithAudio,
        width: 320,
        height: 240,
        frameRate: 30,
        audioTracks: [{ audioOrdinal: 0, streamIndex: 1 }]
      }, 0, AUDIO_CLIP_SECONDS, {
        mode: 'size-limit',
        targetSizeMB: SQUEEZED_TARGET_MB,
        audioBitrateKbps: 128,
        outputFormat: 'mp4',
        hwAccel: 'cpu',
        encoders: { libx264: true }
      });

      // The shape under test: a budget too small for the requested audio rate.
      expect(plan.audioBitrateKbps).toBeLessThan(128);
      expect(plan.warnings.map(w => w.id)).toContain('audio-squeezed');

      const outFile = outputFor('squeezed');
      runFfmpeg([...plan.pass1Args, '-passlogfile', 'sqz-pass', 'NUL'], dir);
      runFfmpeg([...plan.pass2Args, '-passlogfile', 'sqz-pass', outFile], dir);

      expect(fs.statSync(outFile).size).toBeLessThanOrEqual(SQUEEZED_TARGET_MB * 1024 * 1024);

      // The plan's audio bitrate has to be the one that reaches `-b:a`: on a
      // solid-colour fixture the video undershoots massively, so the audio
      // stream is the part of the budget that is actually observable.
      const audio = probeStreams(outFile).find(s => s.codec_type === 'audio');
      expect(audio).toBeDefined();
      const audioKbps = parseInt(audio.bit_rate, 10) / 1000;
      expect(audioKbps).toBeGreaterThan(20);
      expect(audioKbps).toBeLessThan(60);
    });
  });

  describe('export audio (mute and gain)', () => {
    const audioMediaInfo = () => ({
      filePath: clipWithAudio,
      width: 320,
      height: 240,
      frameRate: 30,
      audioTracks: [{ audioOrdinal: 0, streamIndex: 1, codec: 'aac' }]
    });

    const planWithAudio = (audio) => calculatePlan(audioMediaInfo(), 0, 2, {
      mode: 'auto',
      crfValue: 23,
      outputFormat: 'mp4',
      hwAccel: 'cpu',
      encoders: { libx264: true, atempo: true, volume: true },
      audio
    });

    /** Render a plan and return the stream codec types it actually produced. */
    const renderStreamTypes = (plan, label) => {
      const out = outputFor(label);
      runFfmpeg(plan.singlePassArgs.concat([out]));
      return probeStreams(out).map(s => s.codec_type);
    };

    /** RMS of a file's first audio stream, decoded to mono 8 kHz PCM. */
    function audioRms(file) {
      const raw = execFileSync(FFMPEG, [
        '-v', 'error', '-i', file, '-map', '0:a:0',
        '-ac', '1', '-ar', '8000', '-f', 's16le', '-'
      ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      const buf = Buffer.from(raw);
      const count = Math.floor(buf.length / 2);
      if (count === 0) return 0;
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const v = buf.readInt16LE(i * 2) / 32768;
        sum += v * v;
      }
      return Math.sqrt(sum / count);
    }

    // The volume filter is a built-in FFmpeg filter, but the *bundled* slim
    // binary only has it once scripts/build-ffmpeg.sh was rebuilt and CI
    // republished the artifact (build.yml asserts it). Until then the gain test
    // skips loudly instead of silently passing.
    const hasVolumeFilter = (() => {
      try {
        const out = execFileSync(FFMPEG, ['-hide_banner', '-filters'], {
          stdio: ['ignore', 'pipe', 'pipe']
        }).toString();
        return /\svolume\s/.test(out);
      } catch (e) {
        return false;
      }
    })();
    const gainTest = hasVolumeFilter ? test : test.skip;

    test('a muted export writes no audio stream at all', () => {
      const types = renderStreamTypes(planWithAudio({ muted: true, volume: 1 }), 'muted');
      expect(types).toContain('video');
      expect(types).not.toContain('audio');
    });

    test('the same export without mute keeps its audio stream', () => {
      const types = renderStreamTypes(planWithAudio({ muted: false, volume: 1 }), 'audible');
      expect(types).toContain('audio');
    });

    gainTest('a 0.5x volume export measures about -6 dB against full volume', () => {
      const full = outputFor('gain-full');
      runFfmpeg(planWithAudio({ muted: false, volume: 1 }).singlePassArgs.concat([full]));
      const half = outputFor('gain-half');
      runFfmpeg(planWithAudio({ muted: false, volume: 0.5 }).singlePassArgs.concat([half]));

      const ratio = audioRms(half) / audioRms(full);
      // 0.5 linear gain is -6.02 dB; allow for AAC and rounding slop.
      expect(ratio).toBeGreaterThan(0.42);
      expect(ratio).toBeLessThan(0.58);
    });
  });
});
