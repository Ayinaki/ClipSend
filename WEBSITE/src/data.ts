export const REPO_URL = "https://github.com/Ayinaki/ClipSend";
export const RELEASES_URL = "https://github.com/Ayinaki/ClipSend/releases";
export const PRIVACY_URL = "https://github.com/Ayinaki/ClipSend/blob/main/PRIVACY.md";

export const SCREENSHOTS = {
  trimDark: "https://raw.githubusercontent.com/Ayinaki/ClipSend/main/docs/screenshots/trim-dark.png",
  mergeDark: "https://raw.githubusercontent.com/Ayinaki/ClipSend/main/docs/screenshots/merge-dark.png",
  trimLight: "https://raw.githubusercontent.com/Ayinaki/ClipSend/main/docs/screenshots/trim-light.png",
};

export type DiscordTier = {
  id: string;
  name: string;
  limitMB: number;
  color: string;
  glow: string;
  blurb: string;
  icon: string;
};

export const DISCORD_TIERS: DiscordTier[] = [
  {
    id: "free",
    name: "Free",
    limitMB: 20,
    color: "#8b93a7",
    glow: "rgba(139,147,167,0.25)",
    blurb: "The classic squeeze. ~50s of crisp 1080p.",
    icon: "user",
  },
  {
    id: "basic",
    name: "Nitro Basic",
    limitMB: 50,
    color: "#8ee6ab",
    glow: "rgba(142,230,171,0.14)",
    blurb: "Room to breathe. Full rounds, full quality.",
    icon: "zap",
  },
  {
    id: "nitro",
    name: "Nitro",
    limitMB: 500,
    color: "#e5b45a",
    glow: "rgba(229,180,90,0.14)",
    blurb: "Half a gig. Basically a short film.",
    icon: "crown",
  },
];

/** Mirrors the real export-planner.js logic in simplified form */
export function planExport(opts: {
  durationSec: number;
  targetMB: number;
  audioKbps: number;
  codec: "h264" | "av1";
  /** Resolved encoder; CPU AV1 goes through libsvtav1. Defaults to cpu for av1. */
  encoder?: "nvenc" | "qsv" | "amf" | "cpu";
}) {
  const { durationSec, targetMB, audioKbps } = opts;
  // Safety margin: matches export-planner.js (wider for short clips, keyframe overhead)
  const safetyPct = durationSec < 2 ? 0.85 : durationSec < 3.5 ? 0.88 : durationSec < 6 ? 0.92 : durationSec < 10 ? 0.94 : 0.95;
  const containerOverhead = 0.985; // 1.5% for container, matches MUXING_OVERHEAD
  const usableMB = targetMB * safetyPct * containerOverhead;
  // MB -> bytes (1024^2) -> bits -> /1000 kbps, matching export-planner.js
  const totalKbps = (usableMB * 8388.608) / Math.max(durationSec, 0.5);
  let videoKbps = Math.floor(totalKbps - audioKbps);
  // Cap at 25 Mbps like the desktop planner, to prevent rate-control overshoot
  const capped = videoKbps > 25000;
  if (capped) videoKbps = 25000;
  videoKbps = Math.max(150, videoKbps);
  // SVT-AV1 2-pass runs hot on short high-detail clips, so the desktop planner
  // discounts its budget by 0.92 (SVT_SAFETY_FACTOR) after the cap. Hardware
  // and libx264/VP9 keep the full budget.
  if (opts.codec === "av1" && (opts.encoder ?? "cpu") === "cpu") {
    videoKbps = Math.max(150, Math.floor(videoKbps * 0.92));
  }
  const estMB = ((videoKbps + audioKbps) * durationSec) / 8388.608;
  const quality =
    videoKbps > 12000 ? "Lossless-ish" : videoKbps > 6000 ? "Excellent" : videoKbps > 2800 ? "Great" : videoKbps > 1200 ? "Good" : "Watchable";
  const av1Note = opts.codec === "av1" ? "≈2× quality of H.264 at this bitrate" : undefined;
  return { usableMB, totalKbps: videoKbps + audioKbps, videoKbps, estMB, quality, safetyPct, av1Note, capped };
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

export function buildFfmpegCommand(opts: {
  videoKbps: number;
  audioKbps: number;
  encoder: string;
  codec: "h264" | "av1";
  format: "mp4" | "webm";
  inSec: number;
  outSec: number;
}) {
  const dur = (opts.outSec - opts.inSec).toFixed(2);
  const k = opts.videoKbps;
  // WebM cannot hold H.264, so the command must target the codec that actually
  // runs (CPU VP9, 2-pass), not the hardware encoder the user picked.
  const vp9Fallback = opts.format === "webm" && opts.codec === "h264";
  const isHw = !vp9Fallback && opts.encoder !== "cpu";
  const vcodec = isHw
    ? opts.codec === "av1"
      ? opts.encoder === "nvenc" ? "av1_nvenc" : opts.encoder === "qsv" ? "av1_qsv" : "av1_amf"
      : opts.encoder === "nvenc" ? "h264_nvenc" : opts.encoder === "qsv" ? "h264_qsv" : "h264_amf"
    : vp9Fallback ? "libvpx-vp9" : opts.codec === "av1" ? "libsvtav1" : "libx264";
  // Args mirror encoder-profiles.js per resolved codec, balanced presets and
  // bufsize = 1.5x bitrate: hardware runs single-pass VBR; CPU encoders run
  // 2-pass (SVT-AV1 rejects -maxrate in 2-pass mode, so no -maxrate there).
  const bufsize = Math.round(k * 1.5);
  let vcArgs: string;
  if (isHw) {
    vcArgs = opts.encoder === "nvenc"
      ? `-preset p5 -rc vbr -b:v ${k}k -maxrate ${k}k -bufsize ${bufsize}k`
      : opts.encoder === "qsv"
        ? `-preset medium -b:v ${k}k -maxrate ${k}k -bufsize ${bufsize}k`
        : `-quality balanced -rc vbr_peak -b:v ${k}k -maxrate ${k}k`;
  } else if (vcodec === "libvpx-vp9") {
    vcArgs = `-deadline good -cpu-used 4 -row-mt 1 -b:v ${k}k -maxrate ${k}k -bufsize ${bufsize}k`;
  } else if (vcodec === "libsvtav1") {
    vcArgs = `-preset 6 -b:v ${k}k -bufsize ${bufsize}k`;
  } else {
    vcArgs = `-preset slow -b:v ${k}k -maxrate ${k}k -bufsize ${bufsize}k`;
  }
  // WebM audio is the native opus encoder (experimental: -strict -2), matching
  // the slim bundled FFmpeg build. MP4 uses AAC.
  const acodecArgs = opts.format === "webm" ? "-c:a opus -strict -2" : "-c:a aac";
  const input = `-ss ${opts.inSec.toFixed(2)} -i input.mp4 -t ${dur}`;
  if (isHw) {
    return `ffmpeg ${input} -c:v ${vcodec} ${vcArgs} ${acodecArgs} -b:a ${opts.audioKbps}k output.${opts.format}`;
  }
  // Two-pass needs both runs: pass 1 writes the stats file, pass 2 reads it.
  return [
    `ffmpeg ${input} -c:v ${vcodec} ${vcArgs} -pass 1 -an -f null NUL`,
    `ffmpeg ${input} -c:v ${vcodec} ${vcArgs} -pass 2 ${acodecArgs} -b:a ${opts.audioKbps}k output.${opts.format}`,
  ].join("\n");
}
