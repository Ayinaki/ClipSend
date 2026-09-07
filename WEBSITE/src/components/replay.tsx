import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Play, RotateCcw, UploadCloud, Download, ClipboardCopy } from "lucide-react";
import { planExport, RELEASES_URL } from "../data";

type ClipMeta = { name: string; sizeMB: number; duration: number; width: number; height: number };

const DEFAULT_CLIP: ClipMeta = { name: "Ayinaki-clipsend.mp4", sizeMB: 247, duration: 48, width: 1920, height: 1080 };

const STAGES = [
  { id: "probe", label: "probe", from: 0, to: 0.12 },
  { id: "plan", label: "plan", from: 0.12, to: 0.22 },
  { id: "encode", label: "encode", from: 0.22, to: 0.9 },
  { id: "paste", label: "paste", from: 0.9, to: 1 },
];

export function ExportReplay() {
  const [clip, setClip] = useState<ClipMeta>(DEFAULT_CLIP);
  const [t, setT] = useState(0); // 0..1 replay position
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const fileRef = useRef<HTMLInputElement>(null);

  const plan = planExport({ durationSec: clip.duration, targetMB: 20, audioKbps: 128, codec: "h264" });
  const speed = 8; // nvenc-ish realtime factor for 1080p60
  const total = 0.9 + clip.duration / speed + 0.4; // simulated seconds

  const start = () => {
    setT(0);
    setStarted(true);
    setRunning(true);
  };

  // autoplay once when scrolled into view
  useEffect(() => {
    if (inView && !started) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  // replay clock: 5s wall clock maps to `total` simulated seconds
  useEffect(() => {
    if (!running) return;
    const WALL = 5000;
    const t0 = performance.now();
    let raf: number;
    const loop = (now: number) => {
      const p = Math.min(1, (now - t0) / WALL);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(loop);
      else setRunning(false);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const analyze = async (f: File) => {
    setReadError(null);
    const looksVideo = f.type.startsWith("video/") || /\.(mp4|mkv|webm|mov|m4v|avi)$/i.test(f.name);
    if (!looksVideo) {
      setReadError(`"${f.name}" is not a video file. The replay kept the sample clip.`);
      return;
    }
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    try {
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error("decode"));
        v.src = url;
      });
      if (!isFinite(v.duration) || v.duration <= 0) throw new Error("duration");
      setClip({ name: f.name, sizeMB: f.size / 1048576, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      setT(0);
      setStarted(true);
      setRunning(true);
    } catch {
      setReadError(`Couldn't read "${f.name}". The replay kept the sample clip.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const sim = t * total; // simulated seconds right now
  const stage = STAGES.find((s) => t >= s.from && t < s.to) ?? (t >= 1 ? STAGES[3] : STAGES[0]);
  const encodeP = Math.min(1, Math.max(0, (t - 0.22) / 0.68));
  const done = t >= 1;

  const frameAt = (p: number) => Math.round(clip.duration * 60 * p);

  const log: { at: number; kind: "dim" | "info" | "good" | "cmd"; text: string }[] = [
    { at: 0, kind: "cmd", text: `clipsend "${clip.name}" --target 20MB` },
    { at: 0.02, kind: "dim", text: `drop: ${clip.sizeMB.toFixed(1)} MB from windows explorer` },
    { at: 0.06, kind: "info", text: `ffprobe: ${clip.width}x${clip.height}, 60 fps, ${clip.duration.toFixed(2)}s, aac stereo` },
    { at: 0.14, kind: "info", text: `plan: cap 20 MB, margin 4%, mux 1.5%, audio 128k` },
    { at: 0.18, kind: "good", text: `plan: video bitrate solved at ${plan.videoKbps.toLocaleString()}k` },
    { at: 0.24, kind: "info", text: `encoder: h264_nvenc init ok, single-pass vbr, maxrate ${plan.videoKbps.toLocaleString()}k` },
    { at: 0.34, kind: "dim", text: `frame= ${frameAt(0.2).toLocaleString()} fps= 214 q= 28.0 speed= 7.9x` },
    { at: 0.5, kind: "dim", text: `frame= ${frameAt(0.45).toLocaleString()} fps= 219 q= 28.0 speed= 8.1x` },
    { at: 0.66, kind: "dim", text: `frame= ${frameAt(0.7).toLocaleString()} fps= 221 q= 28.0 speed= 8.2x` },
    { at: 0.82, kind: "dim", text: `frame= ${frameAt(0.92).toLocaleString()} fps= 223 q= 28.0 speed= 8.3x` },
    { at: 0.91, kind: "info", text: `mux: ${clip.name.replace(/\.mp4$/i, "")}_discord.mp4 written, ${plan.estMB.toFixed(1)} MB` },
    { at: 0.95, kind: "good", text: `clipboard: CF_HDROP set. ctrl+v in discord.` },
  ];

  return (
    <section id="replay" className="scroll-mt-24 border-b border-[#1a1a1e] bg-[#0e0e10] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8" ref={ref}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="font-mono text-[12px] text-zinc-500">$ clipsend "{clip.name}" --target 20MB</p>
            <h2 className="font-display mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">
              Four seconds, drop to paste.
            </h2>
            <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-zinc-400">
              A replay of one export, stage by stage. Feed it a clip of your own and the numbers become yours. The real run needs the desktop app, because the real run needs your GPU.
            </p>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void analyze(f); }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-4 py-3 font-mono text-[12px] transition ${
              dragOver ? "border-[#5865F2] bg-[#5865F2]/8 text-zinc-100" : "border-[#34343c] bg-[#101014] text-zinc-400 hover:border-[#52525b] hover:text-zinc-200"
            }`}
          >
            <UploadCloud size={15} />
            drop your own clip, it never leaves this tab
            <input
              ref={fileRef}
              type="file"
              accept="video/*,.mkv,.mov"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyze(f); e.target.value = ""; }}
            />
          </div>
        </div>

        {readError && (
          <p className="mt-3 font-mono text-[11.5px] text-[#f8a1a1]">{readError}</p>
        )}

        <div className="mt-8 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          {/* stage panel */}
          <div className="rounded-xl border border-[#232329] bg-[#101014] p-6">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] text-zinc-500">elapsed</span>
              <span className="font-display text-5xl font-bold tabular-nums tracking-tight text-white">
                {sim.toFixed(2)}<span className="ml-1 text-lg font-semibold text-zinc-600">s</span>
              </span>
            </div>

            {/* stage rail */}
            <div className="mt-6 space-y-2.5">
              {STAGES.map((s) => {
                const active = stage.id === s.id && !done;
                const passed = done || t >= s.to;
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold transition ${
                        passed
                          ? "border-[#234d35] bg-[#0e1a13] text-[#8ee6ab]"
                          : active
                            ? "border-[#5865F2] bg-[#5865F2] text-white"
                            : "border-[#2a2a30] bg-[#17171b] text-zinc-600"
                      }`}
                    >
                      {passed ? "✓" : s.label[0]}
                    </span>
                    <span className={`font-mono text-[12.5px] ${passed ? "text-zinc-300" : active ? "text-white" : "text-zinc-600"}`}>
                      {s.label}
                    </span>
                    <span className="ml-auto font-mono text-[10.5px] text-zinc-600">
                      {s.from === 0 ? "0.00" : (s.from * total).toFixed(2)}s
                    </span>
                  </div>
                );
              })}
            </div>

            {/* encode progress */}
            <div className="mt-6">
              <div className="flex justify-between font-mono text-[10.5px] text-zinc-600">
                <span>h264_nvenc</span>
                <span>{Math.round(encodeP * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1e1e22]">
                <div className="h-full rounded-full bg-[#5865F2]" style={{ width: `${encodeP * 100}%` }} />
              </div>
            </div>

            {/* result stamp */}
            <AnimatePresence>
              {done && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 rounded-lg border border-[#234d35] bg-[#0e1a13] p-4"
                >
                  <div className="flex items-center justify-between font-mono text-[12px]">
                    <span className="text-zinc-400">output</span>
                    <span className="font-bold text-[#8ee6ab]">{plan.estMB.toFixed(1)} MB of 20 MB</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[12px]">
                    <span className="text-zinc-400">clipboard</span>
                    <span className="flex items-center gap-1.5 text-zinc-200"><ClipboardCopy size={12} /> CF_HDROP set</span>
                  </div>
                  <a
                    href={RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#4752c4]"
                  >
                    <Download size={15} /> Run it for real on your GPU
                  </a>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={start}
              disabled={running}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-[#2a2a30] bg-[#17171b] py-2.5 font-mono text-[12px] text-zinc-300 transition hover:border-[#3f3f46] hover:text-white disabled:opacity-50"
            >
              {running ? <><Play size={13} /> replaying…</> : done ? <><RotateCcw size={13} /> replay it</> : <><Play size={13} /> play the export</>}
            </button>
          </div>

          {/* log stream */}
          <div className="overflow-hidden rounded-xl border border-[#232329] bg-[#070709]">
            <div className="flex items-center justify-between border-b border-[#1e1e22] px-4 py-2.5">
              <span className="font-mono text-[11px] text-zinc-500">stdout, abridged</span>
              <span className="font-mono text-[11px] text-zinc-600">{clip.name}</span>
            </div>
            <div className="min-h-[340px] space-y-1.5 p-4 font-mono text-[11.5px] leading-relaxed">
              {log.filter((l) => sim >= l.at * total).map((l, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex gap-3"
                >
                  <span className="shrink-0 text-zinc-700">{(l.at * total).toFixed(2)}</span>
                  <span
                    className={
                      l.kind === "cmd"
                        ? "text-zinc-100"
                        : l.kind === "good"
                          ? "text-[#8ee6ab]"
                          : l.kind === "info"
                            ? "text-zinc-300"
                            : "text-zinc-500"
                    }
                  >
                    {l.kind === "cmd" ? `$ ${l.text}` : l.text}
                  </span>
                </motion.div>
              ))}
              {running && <span className="inline-block h-3.5 w-2 animate-pulse bg-zinc-500 align-middle" />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
