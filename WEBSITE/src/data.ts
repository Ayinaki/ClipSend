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
}) {
  const { durationSec, targetMB, audioKbps, codec } = opts;
  // Safety margin: tighter for short clips where keyframe overhead dominates
  // (matches repo docs: "tighter for short clips")
  const safetyPct = durationSec < 10 ? 0.94 : durationSec < 30 ? 0.96 : 0.97;
  const containerOverhead = 0.985; // 1.5% for container
  const usableMB = targetMB * safetyPct * containerOverhead;
  const totalKbps = (usableMB * 8192) / Math.max(durationSec, 0.5);
  const videoKbps = Math.max(150, Math.floor(totalKbps - audioKbps));
  const estMB = ((videoKbps + audioKbps) * durationSec) / 8192 / containerOverhead;
  const quality =
    videoKbps > 12000 ? "Lossless-ish" : videoKbps > 6000 ? "Excellent" : videoKbps > 2800 ? "Great" : videoKbps > 1200 ? "Good" : "Watchable";
  const av1Note = codec === "av1" ? "≈2× quality of H.264 at this bitrate" : undefined;
  return { usableMB, totalKbps: Math.floor(totalKbps), videoKbps, estMB, quality, safetyPct, av1Note };
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
  const isHw = opts.encoder !== "cpu";
  const vcodec =
    opts.format === "webm" && opts.codec === "h264"
      ? "libvpx-vp9"
      : opts.codec === "av1"
        ? isHw
          ? opts.encoder === "nvenc"
            ? "av1_nvenc"
            : opts.encoder === "qsv"
              ? "av1_qsv"
              : opts.encoder === "amf"
                ? "av1_amf"
                : "libsvtav1"
          : "libsvtav1"
        : isHw
          ? opts.encoder === "nvenc"
            ? "h264_nvenc"
            : opts.encoder === "qsv"
              ? "h264_qsv"
              : "h264_amf"
          : "libx264";
  const rc = isHw ? `-rc vbr -maxrate ${opts.videoKbps}k` : `-b:v ${opts.videoKbps}k -pass 2`;
  const acodec = opts.format === "webm" ? "libopus" : "aac";
  return `ffmpeg -ss ${opts.inSec.toFixed(2)} -i input.mp4 -t ${dur} -c:v ${vcodec} ${rc} -c:a ${acodec} -b:a ${opts.audioKbps}k output.${opts.format}`;
}
