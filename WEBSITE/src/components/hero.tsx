import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Play, Pause, Download, Scissors, Zap, ShieldCheck,
  StepBack, StepForward, Volume2, ClipboardCopy,
  Cpu, Check, FileVideo, Gauge, XCircle, CheckCircle2,
} from "lucide-react";
import { REPO_URL, RELEASES_URL, planExport, formatTime } from "../data";
import { useReleases } from "../lib/releases";
import { GithubIcon } from "./ui";

const TOTAL = 48; // fake clip length seconds

function useWaveform(count: number) {
  return useMemo(() => {
    const arr: number[] = [];
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      const wave = Math.sin(i / 9) * 0.25 + Math.sin(i / 3.7) * 0.15 + 0.55;
      arr.push(Math.min(1, Math.max(0.08, wave * (0.6 + rand() * 0.7))));
    }
    return arr;
  }, [count]);
}

function AppMockup() {
  const [inPt, setInPt] = useState(8.4);
  const [outPt, setOutPt] = useState(31.2);
  const [playing, setPlaying] = useState(true);
  const [playhead, setPlayhead] = useState(12);
  const [tier, setTier] = useState(20);
  const [encoding, setEncoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState<null | "in" | "out" | "play">(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const bars = useWaveform(96);

  const dur = Math.max(0.5, outPt - inPt);
  const plan = planExport({ durationSec: dur, targetMB: tier, audioKbps: 128, codec: "h264" });

  // playback loop
  useEffect(() => {
    if (!playing) return;
    let raf: number;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setPlayhead((p) => {
        let n = p + dt;
        if (n >= outPt) n = inPt;
        if (n < inPt - 0.001 || n > outPt + 0.001) n = inPt;
        return n;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, inPt, outPt]);

  // encode simulation
  useEffect(() => {
    if (!encoding) return;
    setProgress(0);
    setDone(false);
    const start = performance.now();
    const D = 2600;
    let raf: number;
    const loop = (t: number) => {
      const p = Math.min(1, (t - start) / D);
      const eased = 1 - Math.pow(1 - p, 2);
      setProgress(eased);
      if (p < 1) raf = requestAnimationFrame(loop);
      else {
        setEncoding(false);
        setDone(true);
        setTimeout(() => setDone(false), 4000);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [encoding]);

  const posToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return pct * TOTAL;
  };

  const onPointerDown = (which: "in" | "out" | "play") => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(which);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const t = posToTime(e.clientX);
      if (dragging === "in") setInPt(Math.min(t, outPt - 0.5));
      else if (dragging === "out") setOutPt(Math.max(t, inPt + 0.5));
      else setPlayhead(Math.min(TOTAL, Math.max(0, t)));
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, inPt, outPt]);

  const pct = (t: number) => `${(t / TOTAL) * 100}%`;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-xl border border-[#2a2a30] bg-[#131316] shadow-2xl shadow-black/60">
        {/* title bar */}
        <div className="flex items-center justify-between border-b border-[#232329] bg-[#17171b] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3f3f46]" />
            </div>
            <span className="ml-2 font-mono text-[11px] text-zinc-400">ClipSend - Trim</span>
          </div>
          <div className="hidden items-center gap-2 rounded-md border border-[#2e2e35] bg-[#101014] px-3 py-1 font-mono text-[10.5px] text-zinc-300 sm:flex">
            <Gauge size={11} className="text-zinc-500" />
            plan: {plan.estMB.toFixed(1)} MB at {plan.videoKbps}k, NVENC
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
            <span className="rounded border border-[#2a2a30] bg-[#101014] px-1.5 py-0.5">MP4</span>
            <span className="rounded border border-[#2a2a30] bg-[#101014] px-1.5 py-0.5">H.264</span>
          </div>
        </div>

        {/* preview, flat like a real paused video frame */}
        <div className="relative aspect-video overflow-hidden bg-[#0a0a0c]">
          {/* faint diagonal texture to suggest footage, not neon art */}
          <div
            className="absolute inset-0 opacity-[0.5]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, rgba(255,255,255,0.025) 0 2px, transparent 2px 9px)",
            }}
          />
          {/* letterbox shading */}
          <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-40">
            <div className="relative h-10 w-10">
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60" />
              <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/60" />
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70" />
            </div>
          </div>
          {/* HUD */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/85 px-2 py-1 font-mono text-[10px] font-medium text-zinc-200">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> REC 1080p60
          </div>
          <div className="absolute right-3 top-3 rounded-md border border-white/10 bg-black/85 px-2 py-1 font-mono text-[10px] text-zinc-200">
            {formatTime(playhead)} / {formatTime(TOTAL)}
          </div>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/85 px-2 py-1 font-mono text-[10px] text-zinc-300">
            <FileVideo size={11} className="text-zinc-500" /> Ayinaki-clipsend.mp4, 247 MB
          </div>
          <div className="absolute bottom-3 right-3 hidden rounded-md border border-white/10 bg-black/85 px-2 py-1 font-mono text-[10px] text-zinc-300 sm:block">
            IN {formatTime(inPt)} → OUT {formatTime(outPt)}
          </div>
          {/* center play */}
          <button
            onClick={() => setPlaying(!playing)}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#3f3f46] bg-[#1c1c21] p-4 text-white transition hover:border-[#5865F2] hover:bg-[#5865F2]"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>
          {/* encode overlay */}
          {encoding && (
            <div className="absolute inset-x-0 bottom-0 top-auto z-30 p-3">
              <div className="rounded-lg border border-[#2e2e35] bg-[#131316] p-3 shadow-xl">
                <div className="flex items-center justify-between font-mono text-[10.5px]">
                  <span className="flex items-center gap-2 text-zinc-200">
                    <Zap size={12} className="text-[#e5b45a]" /> h264_nvenc, single-pass VBR
                  </span>
                  <span className="text-zinc-100">{Math.round(progress * 100)}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#26262c]">
                  <div className="h-full rounded-full bg-[#5865F2]" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            </div>
          )}
          {done && !encoding && (
            <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center">
              <div className="flex items-center gap-2 rounded-lg border border-[#234d35] bg-[#0e1a13] px-4 py-2 font-mono text-[11px] font-medium text-[#8ee6ab] shadow-xl">
                <Check size={13} /> {plan.estMB.toFixed(1)} MB. Ready to paste into Discord.
              </div>
            </div>
          )}
        </div>

        {/* transport */}
        <div className="flex items-center justify-between border-t border-[#232329] bg-[#131316] px-4 py-2.5">
          <div className="flex items-center gap-1">
            {[
              { icon: StepBack, label: "Prev", fn: () => setPlayhead(inPt) },
              { icon: playing ? Pause : Play, label: "Play", fn: () => setPlaying(!playing), primary: true },
              { icon: StepForward, label: "Next", fn: () => setPlayhead(outPt - 0.05) },
            ].map((b, i) => (
              <button
                key={i}
                onClick={b.fn}
                aria-label={b.label}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition ${b.primary ? "bg-[#5865F2] text-white hover:bg-[#4752c4]" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
              >
                <b.icon size={15} />
              </button>
            ))}
            <button onClick={() => setInPt(playhead < outPt - 0.5 ? playhead : inPt)} className="ml-2 rounded-md border border-[#3a3325] bg-[#1b1811] px-2.5 py-1.5 font-mono text-[10px] font-semibold text-[#e5b45a] transition hover:bg-[#242013]">
              SET IN
            </button>
            <button onClick={() => setOutPt(playhead > inPt + 0.5 ? playhead : outPt)} className="rounded-md border border-[#3a3325] bg-[#1b1811] px-2.5 py-1.5 font-mono text-[10px] font-semibold text-[#e5b45a] transition hover:bg-[#242013]">
              SET OUT
            </button>
          </div>
          <div className="hidden items-center gap-3 font-mono text-[10.5px] text-zinc-500 sm:flex">
            <span className="flex items-center gap-1.5"><Volume2 size={12} /> Track 1, 128k</span>
            <span className="rounded border border-[#3a3325] bg-[#1b1811] px-2 py-1 text-[#e5b45a]">SEL {dur.toFixed(1)}s</span>
          </div>
        </div>

        {/* timeline */}
        <div className="border-t border-[#232329] bg-[#101014] px-4 pb-3 pt-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-zinc-500">
            <span>Timeline. Drag the handles.</span>
            <span>{TOTAL}s source</span>
          </div>
          <div ref={trackRef} className="relative h-[64px] select-none overflow-hidden rounded-lg border border-[#26262c] bg-[#0a0a0c]">
            {/* dimmed outside selection */}
            <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: pct(inPt) }} />
            <div className="absolute inset-y-0 right-0 bg-black/70" style={{ left: pct(outPt), right: 0 }} />
            <div className="absolute inset-y-0 bg-white/[0.03]" style={{ left: pct(inPt), width: `${((outPt - inPt) / TOTAL) * 100}%` }} />
            {/* waveform */}
            <div className="absolute inset-0 flex items-center gap-[2px] px-2">
              {bars.map((h, i) => {
                const t = (i / bars.length) * TOTAL;
                const active = t >= inPt && t <= outPt;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{
                      height: `${h * 40}px`,
                      background: active ? "#7c86ff" : "#26262c",
                      opacity: active ? 0.95 : 1,
                    }}
                  />
                );
              })}
            </div>
            {/* ticks */}
            <div className="absolute inset-x-0 top-0 flex justify-between px-2 pt-1 font-mono text-[8.5px] text-zinc-600">
              {[0, 12, 24, 36, 48].map((s) => (
                <span key={s}>0:{String(s).padStart(2, "0")}</span>
              ))}
            </div>
            {/* in handle */}
            <div
              className="timeline-handle absolute inset-y-0 z-10 w-4 -translate-x-1/2"
              style={{ left: pct(inPt) }}
              onPointerDown={onPointerDown("in")}
            >
              <div className={`mx-auto h-full w-[4px] rounded-full ${dragging === "in" ? "bg-[#f5cf7a]" : "bg-[#e5b45a]"}`} />
              <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b bg-[#e5b45a] px-1 font-mono text-[8px] font-bold text-black">IN</div>
            </div>
            {/* out handle */}
            <div
              className="timeline-handle absolute inset-y-0 z-10 w-4 -translate-x-1/2"
              style={{ left: pct(outPt) }}
              onPointerDown={onPointerDown("out")}
            >
              <div className={`mx-auto h-full w-[4px] rounded-full ${dragging === "out" ? "bg-[#f5cf7a]" : "bg-[#e5b45a]"}`} />
              <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b bg-[#e5b45a] px-1 font-mono text-[8px] font-bold text-black">OUT</div>
            </div>
            {/* playhead */}
            <div className="absolute inset-y-0 z-20 w-6 -translate-x-1/2 cursor-ew-resize" style={{ left: pct(playhead) }} onPointerDown={onPointerDown("play")}>
              <div className="mx-auto h-full w-[2px] bg-white" />
              <div className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-white" />
            </div>
          </div>
        </div>

        {/* export bar */}
        <div className="flex flex-col gap-3 border-t border-[#232329] bg-[#131316] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5">
            {[
              { mb: 20, label: "20 MB" },
              { mb: 50, label: "50 MB" },
              { mb: 500, label: "500 MB" },
            ].map((t) => (
              <button
                key={t.mb}
                onClick={() => setTier(t.mb)}
                className={`shrink-0 rounded-md px-3 py-1.5 font-mono text-[11px] font-semibold transition ${
                  tier === t.mb
                    ? "bg-white text-black"
                    : "border border-[#2a2a30] bg-[#1a1a1f] text-zinc-300 hover:border-[#3f3f46] hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
            <span className="ml-1 hidden font-mono text-[10.5px] text-zinc-500 md:inline">
              → {plan.quality.toLowerCase()} at {plan.videoKbps} kbps
            </span>
          </div>
          <div className="flex items-center gap-2 max-w-full">
            <button className="flex items-center gap-1.5 shrink-0 rounded-md border border-[#2a2a30] bg-[#1a1a1f] px-3 py-2 font-mono text-[11px] text-zinc-300 transition hover:border-[#3f3f46] hover:text-white">
              <ClipboardCopy size={13} /> Copy
            </button>
            <button
              onClick={() => !encoding && setEncoding(true)}
              disabled={encoding}
              className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#5865F2] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#4752c4] disabled:opacity-70"
            >
              {encoding ? (
                <><Cpu size={14} className="animate-spin" /> Encoding…</>
              ) : (
                <><Zap size={14} /> Export {plan.estMB.toFixed(1)} MB</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* status chips, solid and tucked inside the frame */}
      <div className="absolute left-3 top-[52px] z-30 hidden items-center gap-2 rounded-lg border border-[#33333a] bg-[#141417] py-1.5 pl-2 pr-3 shadow-xl shadow-black/60 md:flex">
        <XCircle size={15} className="shrink-0 text-[#f87171]" />
        <span className="whitespace-nowrap font-mono text-[11px]"><span className="font-bold text-[#f87171]">247 MB.</span> <span className="text-zinc-200">Too big for Discord.</span></span>
      </div>
      <div className="absolute right-3 top-[52px] z-30 hidden items-center gap-2 rounded-lg border border-[#33333a] bg-[#141417] py-1.5 pl-2 pr-3 shadow-xl shadow-black/60 md:flex">
        <CheckCircle2 size={15} className="shrink-0 text-[#4ade80]" />
        <span className="whitespace-nowrap font-mono text-[11px]"><span className="font-bold text-[#4ade80]">{plan.estMB.toFixed(1)} MB.</span> <span className="text-zinc-200">Pastes straight in.</span></span>
      </div>
    </div>
  );
}

export function Hero() {
  const { latestTag, installer } = useReleases();
  const downloadUrl = installer?.url || RELEASES_URL;
  return (
    <section id="top" className="relative overflow-hidden border-b border-[#1a1a1e] bg-[#0b0b0d] pb-14 pt-28 sm:pt-32">
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          {/* copy */}
          <div>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <p className="font-mono text-[12px] text-zinc-500">
                {latestTag} for windows. ffmpeg ships in the installer.
              </p>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.06 }}
              className="font-display mt-6 text-[38px] font-bold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-[56px]"
            >
              Your clip is{" "}
              <span className="text-[#f87171]">247&nbsp;MB</span>.
              <br />
              Discord allows{" "}
              <span className="underline decoration-[#5865F2] decoration-[5px] underline-offset-[6px]">20.</span>
              <br />
              We fix that.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12 }}
              className="mt-6 max-w-lg text-[15px] leading-relaxed text-zinc-400"
            >
              <span className="font-semibold text-zinc-100">ClipSend</span> cuts the clip, solves the bitrate, and
              lands the file one hair under the limit. 20&nbsp;MB free, 50 Nitro
              Basic, 500 Nitro. Your GPU does the work.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.18 }}
              className="mt-7 flex flex-col gap-2.5 sm:flex-row"
            >
              <a
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-6 py-3.5 text-[14.5px] font-semibold text-white transition hover:bg-[#4752c4]"
              >
                <Download size={17} />
                Download for Windows {latestTag}
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-6 py-3.5 text-[14.5px] font-medium text-zinc-100 transition hover:border-[#3f3f46] hover:bg-[#1a1a1f]"
              >
                <GithubIcon size={17} />
                Star the repo
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-7 grid grid-cols-3 gap-2.5"
            >
              {[
                { icon: Scissors, big: "Trim + Merge", small: "frame-accurate" },
                { icon: Zap, big: "NVENC / QSV / AMF", small: "gpu accelerated" },
                { icon: ShieldCheck, big: "100% local", small: "no upload ever" },
              ].map((s) => (
                <div key={s.big} className="rounded-lg border border-[#232329] bg-[#101014] p-3">
                  <s.icon size={15} className="text-zinc-500" />
                  <div className="font-display mt-2 text-[12.5px] font-bold text-zinc-100 sm:text-[13px]">{s.big}</div>
                  <div className="font-mono text-[10px] text-zinc-600">{s.small}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* mockup */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.15 }}
          >
            <AppMockup />
            <p className="mt-3 text-center font-mono text-[11px] text-zinc-600">
              a simulation of the UI. drag the <span className="text-[#e5b45a]">handles</span>, scrub, switch tiers.
              <br className="hidden sm:block" /> real encodes need the desktop app, because your GPU lives there.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export function Marquee() {
  const items = [
    "Trim mode", "Merge mode", "H.264", "AV1", "VP9", "NVENC", "Quick Sync", "AMF",
    "20 MB free", "50 MB Nitro Basic", "500 MB Nitro", "Copy → paste", "FFmpeg inside",
  ];
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden border-b border-[#1a1a1e] bg-[#0e0e10] py-3">
      <div className="marquee-track flex w-max items-center gap-6 whitespace-nowrap">
        {row.map((t, i) => (
          <span key={i} className="flex items-center gap-6 font-mono text-[11.5px] text-zinc-500">
            {t} <span className="text-zinc-700">/</span>
          </span>
        ))}
      </div>
    </div>
  );
}
