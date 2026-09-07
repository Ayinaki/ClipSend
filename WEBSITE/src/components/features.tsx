import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, ShieldCheck,
  FileVideo, ChevronDown, Download, Monitor, TriangleAlert, Check,
  ArrowRight, Sparkles, Clapperboard, HardDrive, Globe,
} from "lucide-react";
import { REPO_URL, RELEASES_URL, SCREENSHOTS } from "../data";
import { useReleases } from "../lib/releases";
import { SectionHeading, GithubIcon } from "./ui";

/* ---------------- ENGINE ---------------- */

const PIPELINE = [
  { n: "01", t: "Plan", d: "Safety margin, wider for short clips. Subtract 1.5% container overhead. Subtract audio. What is left becomes the video bitrate." },
  { n: "02", t: "Encode", d: "NVENC, QSV or AMF in single-pass VBR, or CPU in 2-pass ABR. AV1 through SVT or the GPU. Progress is parsed live from stderr." },
  { n: "03", t: "Paste", d: "The file lands in your folder. One click puts it on the clipboard. Ctrl+V into Discord. Done." },
];

const CODEC_MATRIX = [
  { fmt: ".mp4", h264: "H.264 ✓", av1: "AV1 ✓", audio: "AAC" },
  { fmt: ".webm", h264: "VP9 (CPU)", av1: "AV1 ✓", audio: "Opus" },
];

export function Engine() {
  return (
    <section id="engine" className="scroll-mt-24 border-b border-[#1a1a1e] bg-[#0e0e10] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <p className="font-mono text-[12px] text-zinc-500">$ ffmpeg -hide_banner -encoders | findstr nvenc</p>
        <h2 className="font-display mt-3 max-w-2xl text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">
          Size-targeted encoding, down to the kilobit.
        </h2>
        <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-zinc-400">
          Every export is planned first, then encoded with progress parsed from stderr. No installs, no PATH edits, no cloud.
        </p>

        {/* pipeline */}
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <motion.div
              key={p.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="rounded-xl border border-[#232329] bg-[#101014] p-5"
            >
              <div className="font-mono text-[11px] font-bold text-zinc-600">{p.n}</div>
              <h3 className="font-display mt-1.5 text-xl font-bold text-white">{p.t}</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-500">{p.d}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* encoders */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="rounded-xl border border-[#232329] bg-[#101014] p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white">Hardware acceleration</h3>
              <span className="flex items-center gap-1.5 rounded-md border border-[#234d35] bg-[#0e1a13] px-2.5 py-1 font-mono text-[10.5px] text-[#8ee6ab]">
                <Zap size={11} /> auto-detected
              </span>
            </div>
            <p className="mt-2 text-[12.5px] text-zinc-500">ClipSend probes the bundled FFmpeg and lights up whatever your GPU can do.</p>
            <div className="mt-4 space-y-2">
              {[
                { name: "NVIDIA NVENC", chip: "h264_nvenc / av1_nvenc", speed: "fastest", pct: 96 },
                { name: "Intel Quick Sync", chip: "h264_qsv / av1_qsv", speed: "fast", pct: 82 },
                { name: "AMD AMF", chip: "h264_amf / av1_amf", speed: "fast", pct: 80 },
                { name: "CPU fallback", chip: "libx264 / libsvtav1, 2-pass", speed: "slowest, most accurate", pct: 45 },
              ].map((e) => (
                <div key={e.name} className="rounded-lg border border-[#232329] bg-[#0b0b0d] p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-semibold text-zinc-100">{e.name}</div>
                      <div className="font-mono text-[10.5px] text-zinc-600">{e.chip}</div>
                    </div>
                    <span className="font-mono text-[10.5px] text-zinc-500">{e.speed}</span>
                  </div>
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#1e1e22]">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${e.pct}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.9, delay: 0.15 }}
                      className="h-full rounded-full bg-zinc-400"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[9.5px] text-zinc-600">
              <span>bars are ballpark, not benchmarks</span>
              <span>hardware speed varies by card</span>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#232329] bg-[#17171b] p-3 text-[12px] leading-relaxed text-zinc-400">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-zinc-500" />
              VRAM exhausted, driver missing, old GPU? The pipeline catches init failures and falls back to the matching CPU encoder mid-flight.
            </div>
          </motion.div>

          {/* formats + stack */}
          <div className="flex flex-col gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0.08 }}
              className="rounded-xl border border-[#232329] bg-[#101014] p-6"
            >
              <h3 className="text-[15px] font-semibold text-white">Codec and container matrix</h3>
              <p className="mt-2 text-[12.5px] text-zinc-500">AV1 roughly doubles quality at the same size. The catch: hardware AV1 wants a newer GPU.</p>
              <div className="mt-4 overflow-hidden rounded-lg border border-[#232329]">
                <div className="grid grid-cols-4 bg-[#17171b] font-mono text-[10px] text-zinc-500">
                  <div className="px-4 py-2.5">format</div>
                  <div className="px-4 py-2.5">+ H.264</div>
                  <div className="px-4 py-2.5">+ AV1</div>
                  <div className="px-4 py-2.5">audio</div>
                </div>
                {CODEC_MATRIX.map((r) => (
                  <div key={r.fmt} className="grid grid-cols-4 border-t border-[#232329] font-mono text-[12px]">
                    <div className="px-4 py-3 font-bold text-zinc-100">{r.fmt}</div>
                    <div className="px-4 py-3 text-zinc-400">{r.h264}</div>
                    <div className="px-4 py-3 text-zinc-100">{r.av1}</div>
                    <div className="px-4 py-3 text-zinc-500">{r.audio}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 font-mono text-[10.5px] text-zinc-400">
                <div className="rounded-lg border border-[#232329] bg-[#0b0b0d] px-3 py-2">.mp4 plays natively in Discord</div>
                <div className="rounded-lg border border-[#232329] bg-[#0b0b0d] px-3 py-2">.webm suits Slack and browsers</div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0.12 }}
              className="rounded-xl border border-[#232329] bg-[#101014] p-6"
            >
              <h3 className="text-[15px] font-semibold text-white">Under the hood</h3>
              <ul className="mt-3.5 space-y-2.5 text-[12.5px] leading-relaxed text-zinc-400">
                {[
                  "Strict process isolation. The renderer talks to Node only through async IPC in preload.js.",
                  <>Encoder and Merger wrap <span className="font-mono text-zinc-300">child_process.spawn</span> and parse stderr timecodes for live progress.</>,
                  "Two-pass logfile workaround: set cwd to the output folder and use relative names, dodging the x64 backslash bug.",
                  <>Dropped-file paths resolved with <span className="font-mono text-zinc-300">webUtils.getPathForFile</span> under contextIsolation.</>,
                ].map((t, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check size={13} className="mt-0.5 shrink-0 text-zinc-500" /> <span>{t}</span>
                  </li>
                ))}
              </ul>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 font-mono text-[12px] font-medium text-zinc-300 hover:text-white">
                read the source <ArrowRight size={13} />
              </a>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- SHOWCASE ---------------- */

export function Showcase() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<"trim" | "merge">("trim");

  const src = view === "trim" ? (theme === "dark" ? SCREENSHOTS.trimDark : SCREENSHOTS.trimLight) : SCREENSHOTS.mergeDark;

  return (
    <section id="showcase" className="scroll-mt-24 border-b border-[#1a1a1e] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            align="left"
            title={<>It follows your Windows theme.</>}
            sub="Pulled straight from the repo docs, so what you see is what ships."
          />
          <div className="flex flex-wrap gap-2.5">
            <div className="inline-flex rounded-lg border border-[#232329] bg-[#101014] p-1">
              {(["trim", "merge"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-5 py-1.5 font-mono text-[12px] font-bold transition ${view === v ? "bg-[#e4e4e7] text-black" : "text-zinc-500 hover:text-zinc-200"}`}
                >
                  {v}
                </button>
              ))}
            </div>
            {view === "trim" && (
              <div className="inline-flex rounded-lg border border-[#232329] bg-[#101014] p-1">
                {(["dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`rounded-md px-5 py-1.5 font-mono text-[12px] font-bold transition ${theme === t ? "bg-[#26262c] text-white" : "text-zinc-500 hover:text-zinc-200"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
          className="mx-auto mt-8 max-w-4xl"
        >
          <div className="overflow-hidden rounded-xl border border-[#2a2a30] bg-[#101014] shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 border-b border-[#232329] bg-[#17171b] px-4 py-2.5 font-mono text-[11px] text-zinc-500">
              <FileVideo size={12} />
              docs/screenshots/{view}-{view === "merge" ? "dark" : theme}.png
              <span className="ml-auto hidden sm:block">live from GitHub</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.img
                key={src}
                src={src}
                alt={`ClipSend ${view} mode, ${theme} theme`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="w-full"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </AnimatePresence>
          </div>
        </motion.div>

        <div className="mx-auto mt-6 grid max-w-4xl gap-2.5 sm:grid-cols-3">
          {[
            { icon: Clapperboard, t: "Native transport bar", d: "Segoe MDL2 icons, flat styling" },
            { icon: HardDrive, t: "electron-store", d: "Settings survive restarts" },
            { icon: Globe, t: "Auto-updates", d: "Works even unsigned" },
          ].map((c) => (
            <div key={c.t} className="flex items-center gap-3 rounded-lg border border-[#232329] bg-[#101014] px-4 py-3">
              <c.icon size={15} className="shrink-0 text-zinc-500" />
              <div>
                <div className="text-[12.5px] font-semibold text-zinc-100">{c.t}</div>
                <div className="font-mono text-[10.5px] text-zinc-600">{c.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- DOWNLOAD ---------------- */

export function DownloadSection() {
  const { latestTag, installer } = useReleases();
  const steps = [
    { t: "Grab the installer", d: "The .exe from Releases. FFmpeg and FFprobe ride along." },
    { t: "Run anyway, once", d: "SmartScreen complains about the missing signature. More info, then Run anyway." },
    { t: "Drop, trim, paste", d: "Drag a clip in, set IN and OUT, pick 20, 50 or 500 MB, export, Ctrl+V in Discord." },
  ];
  const downloadUrl = installer?.url || RELEASES_URL;
  return (
    <section id="download" className="scroll-mt-24 border-b border-[#1a1a1e] bg-[#0e0e10] py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <div className="overflow-hidden rounded-xl border border-[#2a2a30] bg-[#101014]">
          <div className="grid lg:grid-cols-2">
            <div className="p-7 sm:p-10">
              <p className="font-mono text-[12px] text-zinc-500">windows 10/11, electron, ISC licensed</p>
              <h2 className="font-display mt-3 text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">
                Windows will scare you <span className="text-[#f87171]">once</span>.
              </h2>
              <p className="mt-3 text-[13.5px] leading-relaxed text-zinc-500">
                The installer is unsigned, so SmartScreen flags it the first time. After that it updates itself and stays out of your way.
              </p>
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-5 py-3.5 text-[14px] font-semibold text-white transition hover:bg-[#4752c4]"
                >
                  <Download size={17} />
                  Latest release {latestTag}
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2a2a30] bg-[#17171b] px-5 py-3.5 text-[14px] font-medium text-zinc-100 transition hover:border-[#3f3f46]"
                >
                  <GithubIcon size={17} /> Source code
                </a>
              </div>
              <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-[#3a3325] bg-[#15130d] p-3.5 text-[12px] leading-relaxed text-[#d9c08a]">
                <TriangleAlert size={15} className="mt-0.5 shrink-0 text-[#e5b45a]" />
                <span><span className="font-semibold">SmartScreen heads-up:</span> an unsigned installer triggers the unrecognized publisher warning. Click More info, then Run anyway. Auto-updates work without a certificate.</span>
              </div>
              <div className="mt-5">
                <div className="font-mono text-[11px] text-zinc-600">roadmap</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">
                  The README keeps an honest list of known limits and what's still worth trying. Hit something it doesn't cover? Open an issue.
                </p>
                <a
                  href={`${REPO_URL}/issues`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[12px] text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                >
                  open issues <ArrowRight size={12} />
                </a>
              </div>
            </div>
            <div className="border-t border-[#232329] bg-[#0b0b0d] p-7 sm:p-10 lg:border-l lg:border-t-0">
              <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-600">
                <Monitor size={12} /> getting started
              </div>
              <div className="mt-4 space-y-4">
                {steps.map((s, i) => (
                  <div key={s.t} className="flex gap-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2a2a30] bg-[#17171b] font-mono text-[12px] font-bold text-zinc-300">
                      {i + 1}
                    </div>
                    <div>
                      <div className="text-[13.5px] font-semibold text-zinc-100">{s.t}</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div className="rounded-lg border border-[#232329] bg-[#101014] px-3 py-2.5"><span className="text-zinc-600">OS</span><br /><span className="font-bold text-zinc-100">Windows 10/11 x64</span></div>
                <div className="rounded-lg border border-[#232329] bg-[#101014] px-3 py-2.5"><span className="text-zinc-600">GPU</span><br /><span className="font-bold text-zinc-100">any, CPU fallback</span></div>
                <div className="col-span-2 rounded-lg border border-[#232329] bg-[#101014] px-3 py-2.5">
                  <span className="text-zinc-600">latest asset</span><br />
                  <span className="font-bold text-zinc-100">{installer?.filename ?? "ClipSend.Setup.exe"}</span><br />
                  <span className="font-mono text-[10px] leading-relaxed text-zinc-500">
                    {installer ? `${installer.sizeMB} MB` : "size on release"}
                    {installer?.sha256 ? ` · sha256 ${installer.sha256}` : ""}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */

const FAQS = [
  {
    q: "What are Discord's actual upload limits?",
    a: "Free is 20 MB per file. Nitro Basic is 50. Full Nitro is 500, and server boosts can raise it further. ClipSend presets all three plus custom targets, and solves the bitrate to land under whichever you pick.",
  },
  {
    q: "Will my clips look like garbage after compression?",
    a: "Better than you'd fear. The planner spends the whole budget on your exact duration, and AV1 buys roughly double the quality per megabyte. A 25 second 1080p60 clutch at 20 MB lands above 6,000 kbps.",
  },
  {
    q: "Do I need to install FFmpeg or a GPU driver pack?",
    a: "No. FFmpeg and FFprobe ship inside the installer. GPU encoders are detected from drivers you already have, and a failed hardware init falls back to libx264 or SVT-AV1 mid-export.",
  },
  {
    q: "How does Merge Mode handle mismatched clips?",
    a: "Same codec, resolution and framerate across all clips? Concat demuxer with -c copy, instant and lossless. Otherwise everything is normalized to the first clip and re-encoded. Trimmed clips are pre-rendered to temp files first, then cleaned up.",
  },
  {
    q: "Why does Windows SmartScreen warn me?",
    a: "Certificates cost money and this app is free, so the installer is unsigned. More info, then Run anyway. The source is public if you want to audit it first.",
  },
  {
    q: "Is anything uploaded anywhere?",
    a: "Never. Planning, trimming, merging and encoding all run on your machine through the bundled FFmpeg. PRIVACY.md in the repo has the long version.",
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="scroll-mt-24 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <SectionHeading title={<>Short answers.</>} />
        <div className="mt-8 space-y-2.5">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className={`overflow-hidden rounded-xl border transition ${isOpen ? "border-[#34343c] bg-[#131316]" : "border-[#232329] bg-[#101014]"}`}>
                <button onClick={() => setOpen(isOpen ? -1 : i)} className="flex w-full items-center justify-between gap-4 p-4 text-left sm:px-5">
                  <span className={`text-[14px] font-semibold ${isOpen ? "text-white" : "text-zinc-200"}`}>{f.q}</span>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition ${isOpen ? "rotate-180 border-[#3f3f46] bg-[#1e1e24] text-white" : "border-[#2a2a30] text-zinc-500"}`}>
                    <ChevronDown size={15} />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                    >
                      <p className="px-4 pb-4 text-[13px] leading-relaxed text-zinc-500 sm:px-5">{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <div className="mt-8 text-center">
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-4 py-2.5 font-mono text-[12px] text-zinc-300 transition hover:border-[#3f3f46] hover:text-white">
            <Sparkles size={13} className="text-zinc-500" /> Found a bug? Open an issue on GitHub <ArrowRight size={12} />
          </a>
        </div>
      </div>
    </section>
  );
}
