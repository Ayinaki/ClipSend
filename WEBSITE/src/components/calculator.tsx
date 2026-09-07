import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calculator as CalcIcon, Copy, Check, TriangleAlert, Cpu, Zap,
  Info, Film, Music, MonitorPlay, Braces,
} from "lucide-react";
import { planExport, buildFfmpegCommand, DISCORD_TIERS } from "../data";

type Codec = "h264" | "av1";
type Format = "mp4" | "webm";
type Encoder = "nvenc" | "qsv" | "amf" | "cpu";

const ENCODERS: { id: Encoder; name: string; vendor: string; hw: boolean }[] = [
  { id: "nvenc", name: "NVENC", vendor: "NVIDIA", hw: true },
  { id: "qsv", name: "Quick Sync", vendor: "Intel", hw: true },
  { id: "amf", name: "AMF", vendor: "AMD", hw: true },
  { id: "cpu", name: "CPU 2-pass", vendor: "x264 / SVT-AV1", hw: false },
];

const PRESETS = [
  { label: "Valorant clutch", dur: 24, desc: "25s, 1080p60" },
  { label: "Speedrun split", dur: 65, desc: "1:05, 1440p" },
  { label: "Tutorial", dur: 150, desc: "2:30, 1080p" },
  { label: "Montage", dur: 12, desc: "12s, short" },
];

const idleBtn = "border-[#26262c] bg-[#17171b] hover:border-[#3f3f46]";

export function Calculator() {
  const [duration, setDuration] = useState(24);
  const [tierMB, setTierMB] = useState(20);
  const [customMB, setCustomMB] = useState(25);
  const [useCustom, setUseCustom] = useState(false);
  const [codec, setCodec] = useState<Codec>("h264");
  const [format, setFormat] = useState<Format>("mp4");
  const [encoder, setEncoder] = useState<Encoder>("nvenc");
  const [audioKbps, setAudioKbps] = useState(128);
  const [copied, setCopied] = useState(false);

  const targetMB = useCustom ? customMB : tierMB;
  const plan = useMemo(
    () => planExport({ durationSec: duration, targetMB, audioKbps, codec, encoder }),
    [duration, targetMB, audioKbps, codec, encoder]
  );

  const isVp9Fallback = format === "webm" && codec === "h264";
  const hwAv1 = codec === "av1" && (encoder as string) !== "cpu";
  const twoPass = (encoder as string) === "cpu" || isVp9Fallback;

  const cmd = buildFfmpegCommand({
    videoKbps: plan.videoKbps,
    audioKbps,
    encoder,
    codec,
    format,
    inSec: 8.4,
    outSec: 8.4 + duration,
  });

  const fitPct = Math.min(100, (plan.estMB / targetMB) * 100);
  const over = plan.estMB > targetMB;

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const warnings: string[] = [];
  if (isVp9Fallback) warnings.push("WebM can't hold H.264. ClipSend exports VP9 (libvpx, CPU 2-pass) with Opus audio instead.");
  if (hwAv1) warnings.push("Hardware AV1 needs an RTX 40-series, Intel Arc or 12th-gen+, or an RX 6000-series GPU. Older cards fall back to SVT-AV1 on their own.");
  if (encoder !== "cpu" && !isVp9Fallback) warnings.push("NVENC, QSV and AMF have no 2-pass mode, so they run single-pass VBR. CPU 2-pass hits the target most precisely.");
  if (duration < 10) warnings.push("Short clip: keyframe overhead eats a bigger share, so the planner keeps a wider safety margin.");
  if (plan.capped) warnings.push("Large target on a short clip: the planner caps video at 25,000 kbps like the desktop app, so the output lands smaller than the cap.");

  return (
    <section id="calculator" className="scroll-mt-24 border-b border-[#1a1a1e] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[12px] text-zinc-500">usable = cap × margin − mux − audio</p>
          <h2 className="font-display mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">Will it fit?</h2>
          <p className="mx-auto mt-4 max-w-xl text-[14.5px] leading-relaxed text-zinc-400">
            The arithmetic ClipSend runs before every encode. Safety margin, 1.5% container overhead, audio subtracted first. The bitrate falls out of what is left.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          {/* controls */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
            className="rounded-xl border border-[#232329] bg-[#101014] p-6"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2a2a30] bg-[#17171b] text-zinc-400">
                <CalcIcon size={16} />
              </div>
              <div>
                <div className="text-[14.5px] font-semibold text-white">Encode parameters</div>
                <div className="font-mono text-[11px] text-zinc-600">mirrors export-planner.js</div>
              </div>
            </div>

            {/* presets */}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setDuration(p.dur)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    duration === p.dur
                      ? "border-[#5865F2] bg-[#5865F2]/15"
                      : idleBtn
                  }`}
                >
                  <div className="text-[12px] font-semibold text-zinc-100">{p.label}</div>
                  <div className="font-mono text-[10px] text-zinc-500">{p.desc}</div>
                </button>
              ))}
            </div>

            {/* duration */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
                  <Film size={13} className="text-zinc-500" /> Clip duration
                </label>
                <span className="rounded-md border border-[#2a2a30] bg-[#17171b] px-2 py-0.5 font-mono text-[12px] font-semibold text-zinc-100">
                  {duration}s <span className="font-normal text-zinc-500">, {(duration / 60).toFixed(1)} min</span>
                </span>
              </div>
              <input
                type="range" min={3} max={300} value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full" style={{ ["--fill" as string]: `${((duration - 3) / 297) * 100}%` }}
              />
              <div className="mt-1.5 flex justify-between font-mono text-[10px] text-zinc-600">
                <span>3s</span><span>2:30</span><span>5:00</span>
              </div>
            </div>

            {/* tier */}
            <div className="mt-5">
              <label className="mb-2 block text-[13px] font-medium text-zinc-200">Discord size target</label>
              <div className="grid grid-cols-3 gap-2">
                {DISCORD_TIERS.map((t) => {
                  const active = !useCustom && tierMB === t.limitMB;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTierMB(t.limitMB); setUseCustom(false); }}
                      className={`rounded-lg border px-3 py-2.5 text-left transition ${
                        active ? "border-[#5865F2] bg-[#5865F2]" : idleBtn
                      }`}
                    >
                      <div className={`font-mono text-[10px] ${active ? "text-white/70" : "text-zinc-500"}`}>{t.name}</div>
                      <div className={`font-display text-lg font-bold ${active ? "text-white" : "text-zinc-100"}`}>{t.limitMB} MB</div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setUseCustom(!useCustom)}
                className="mt-2 flex w-full items-center justify-between rounded-lg border border-dashed border-[#34343c] bg-transparent px-3.5 py-2 font-mono text-[12px] text-zinc-500 transition hover:border-[#52525b] hover:text-zinc-300"
              >
                <span>Custom limit (boosted servers go higher…)</span>
                <span className={`font-bold ${useCustom ? "text-zinc-100" : ""}`}>{useCustom ? `${customMB} MB ✓` : "set"}</span>
              </button>
              {useCustom && (
                <input
                  type="range" min={5} max={500} value={customMB}
                  onChange={(e) => setCustomMB(Number(e.target.value))}
                  className="mt-3 w-full" style={{ ["--fill" as string]: `${((customMB - 5) / 495) * 100}%` }}
                />
              )}
            </div>

            {/* codec + format */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-[13px] font-medium text-zinc-200">Video codec</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["h264", "av1"] as Codec[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCodec(c)}
                      className={`rounded-lg border px-3 py-2 transition ${
                        codec === c ? "border-zinc-400 bg-[#1e1e24]" : idleBtn
                      }`}
                    >
                      <div className="font-mono text-[13px] font-bold text-zinc-100">
                        {c === "h264" ? "H.264" : "AV1"}
                      </div>
                      <div className="font-mono text-[9.5px] text-zinc-500">{c === "h264" ? "universal" : "≈2× quality"}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[13px] font-medium text-zinc-200">Container</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["mp4", "webm"] as Format[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`rounded-lg border px-3 py-2 transition ${
                        format === f ? "border-zinc-400 bg-[#1e1e24]" : idleBtn
                      }`}
                    >
                      <div className="font-mono text-[13px] font-bold uppercase text-zinc-100">.{f}</div>
                      <div className="font-mono text-[9.5px] text-zinc-500">{f === "mp4" ? "AAC audio" : "Opus audio"}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* encoder */}
            <div className="mt-5">
              <label className="mb-2 block text-[13px] font-medium text-zinc-200">Encoder hardware</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ENCODERS.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEncoder(e.id)}
                    className={`rounded-lg border px-2 py-2 text-center transition ${
                      encoder === e.id ? "border-zinc-400 bg-[#1e1e24]" : idleBtn
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {e.hw ? <Zap size={11} className="text-zinc-500" /> : <Cpu size={11} className="text-zinc-500" />}
                      <span className="text-[12px] font-semibold text-zinc-100">{e.name}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-zinc-500">{e.vendor}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* audio */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
                  <Music size={13} className="text-zinc-500" /> Audio bitrate
                </label>
                <span className="rounded-md border border-[#2a2a30] bg-[#17171b] px-2 py-0.5 font-mono text-[12px] font-semibold text-zinc-100">{audioKbps} kbps</span>
              </div>
              <input
                type="range" min={0} max={320} step={32} value={audioKbps}
                onChange={(e) => setAudioKbps(Number(e.target.value))}
                className="w-full" style={{ ["--fill" as string]: `${(audioKbps / 320) * 100}%` }}
              />
              <div className="mt-1 font-mono text-[10px] text-zinc-600">0 mutes the track. audio is subtracted before video gets a byte</div>
            </div>
          </motion.div>

          {/* results */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-col gap-4"
          >
            {/* verdict */}
            <div className="rounded-xl border border-[#232329] bg-[#101014] p-6">
              <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-zinc-500">calculated plan</span>
                <span className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold ${over ? "border-[#5a2b2b] bg-[#221114] text-[#f87171]" : "border-[#234d35] bg-[#0e1a13] text-[#8ee6ab]"}`}>
                  {over ? <TriangleAlert size={12} /> : <Check size={12} />}
                  {over ? "OVER LIMIT" : "FITS"}
                </span>
              </div>
              <div className="mt-3 flex items-end gap-2.5">
                <span className="font-display text-6xl font-bold tracking-tight text-white">{plan.estMB.toFixed(1)}</span>
                <span className="pb-2 font-mono text-[13px] text-zinc-500">MB / {targetMB} MB cap</span>
                <span className="mb-1.5 ml-auto hidden rounded-md border border-[#2a2a30] bg-[#17171b] px-2.5 py-1 font-mono text-[11px] text-zinc-400 sm:block">
                  quality: <span className="font-bold text-zinc-100">{plan.quality.toLowerCase()}</span>
                </span>
              </div>
              {/* fit bar */}
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#1e1e22]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: over ? "#f87171" : "#5865F2" }}
                  animate={{ width: `${fitPct}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[10.5px] text-zinc-600">
                <span>0</span>
                <span className={over ? "text-[#f87171]" : "text-zinc-400"}>{fitPct.toFixed(0)}% of budget, {(targetMB - plan.estMB).toFixed(1)} MB headroom</span>
                <span>{targetMB} MB</span>
              </div>
              {/* stats grid */}
              <div className="mt-5 grid grid-cols-3 gap-2">
                {[
                  { k: "video", v: `${plan.videoKbps}k`, s: "bitrate" },
                  { k: "total", v: `${plan.totalKbps}k`, s: "with audio" },
                  { k: "margin", v: `${Math.round((1 - plan.safetyPct) * 100 + 1.5)}%`, s: "safety + mux" },
                ].map((s) => (
                  <div key={s.k} className="rounded-lg border border-[#232329] bg-[#0b0b0d] p-2.5 text-center">
                    <div className="font-mono text-[17px] font-bold text-zinc-100">{s.v}</div>
                    <div className="font-mono text-[10px] text-zinc-600">{s.s}</div>
                  </div>
                ))}
              </div>
              {codec === "av1" && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#2a2a30] bg-[#17171b] px-3 py-2 font-mono text-[11px] text-zinc-300">
                  <Info size={13} className="shrink-0 text-zinc-500" /> AV1 at this bitrate ≈ 2× the visual quality of H.264
                </div>
              )}
            </div>

            {/* ffmpeg */}
            <div className="overflow-hidden rounded-xl border border-[#232329] bg-[#0b0b0d]">
              <div className="flex items-center justify-between border-b border-[#1e1e22] px-4 py-3">
                <span className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                  <Braces size={12} />
                  exact ffmpeg args, {twoPass ? "2-pass" : "single-pass VBR"}
                </span>
                <button
                  onClick={copyCmd}
                  className="flex items-center gap-1.5 rounded-md border border-[#2a2a30] bg-[#17171b] px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 transition hover:border-[#3f3f46] hover:text-white"
                >
                  {copied ? <><Check size={12} className="text-[#8ee6ab]" /> copied</> : <><Copy size={12} /> copy</>}
                </button>
              </div>
              <div className="overflow-x-auto p-4">
                <code className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-zinc-400">
                  <span className="font-bold text-zinc-100">ffmpeg</span> {cmd.replace(/^ffmpeg\s/, "")}
                </code>
              </div>
              <div className="flex items-center gap-2 border-t border-[#1e1e22] px-4 py-2.5 font-mono text-[10.5px] text-zinc-600">
                <MonitorPlay size={12} /> ClipSend ships its own FFmpeg binary. Nothing to install, nothing leaves the PC.
              </div>
            </div>

            {/* warnings */}
            {warnings.length > 0 && (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg border border-[#3a3325] bg-[#15130d] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#d9c08a]">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[#e5b45a]" />
                    {w}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
