import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SectionHeading } from "./ui";

type Hotspot = { id: number; x: number; y: number; title: string; body: string };

const TRIM_SPOTS: Hotspot[] = [
  { id: 1, x: 52, y: 5, title: "Calculate Plan badge", body: "Before a single frame encodes, the planner solves expected size + video bitrate for your target tier and shows it in the title bar. No export → check → re-export loops." },
  { id: 2, x: 10, y: 22, title: "Preview HUD", body: "A real <video> element under the hood. The playhead, timecode and IN/OUT readouts stay frame-locked to it while you scrub." },
  { id: 3, x: 16, y: 55, title: "Flat transport bar", body: "Play/pause, step-frame, jump-to-marker and set-marker in one unified strip with Segoe MDL2 icons. SET IN / SET OUT stamp the playhead position." },
  { id: 4, x: 34, y: 78, title: "Canvas timeline handles", body: "Custom <canvas> waveform with draggable amber IN/OUT handles. Everything outside the selection dims so your cut is always obvious." },
  { id: 5, x: 80, y: 93, title: "Export bar + clipboard", body: "Pick 20, 50 or 500 MB and hit Export. Copy then puts the finished file on the Windows clipboard as CF_HDROP, so Ctrl+V lands it straight in Discord." },
];

const MERGE_SPOTS: Hotspot[] = [
  { id: 1, x: 13, y: 16, title: "Clip list sidebar", body: "Drop a folder of clips in. Reorder with native HTML5 drag and drop, and the timeline mirrors the new order instantly." },
  { id: 2, x: 58, y: 30, title: "Proportional blocks", body: "Each segment's width maps to its duration. Very short clips get a minimum visual width so they stay grabbable, with a non-linear map that keeps the playhead accurate." },
  { id: 3, x: 40, y: 34, title: "Per-clip trim handles", body: "Amber handles on every block. Cut-away regions dim, blocks rescale to their trimmed length, and the preview honors the trims during playback." },
  { id: 4, x: 60, y: 66, title: "Continuous playback", body: "The video source swaps the instant the playhead crosses a clip boundary. Volume and mute carry over from clip to clip." },
  { id: 5, x: 82, y: 93, title: "Smart concat on export", body: "Identical codec + resolution + fps? Lossless concat demuxer with -c copy. Mismatched? Normalized re-encode, trimming first where needed. Temp files clean themselves up." },
];

function Wave({ dim }: { dim?: boolean }) {
  return (
    <div className={`absolute inset-0 flex items-center gap-[2px] px-2 ${dim ? "opacity-40" : ""}`}>
      {Array.from({ length: 60 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-[#3f3f66]"
          style={{ height: `${18 + ((i * 37) % 58)}%` }}
        />
      ))}
    </div>
  );
}

function TrimSchematic() {
  return (
    <div className="flex h-full flex-col">
      {/* title bar */}
      <div className="flex h-9 items-center justify-between border-b border-[#232329] bg-[#17171b] px-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="ml-2 font-mono text-[10px] text-zinc-500">ClipSend - Trim</span>
        </div>
        <span className="rounded border border-[#2e2e35] bg-[#101014] px-2 py-0.5 font-mono text-[9.5px] text-zinc-400">
          plan: 19.2 MB at 6667k, NVENC
        </span>
      </div>
      {/* preview */}
      <div className="relative flex-1 bg-[#0a0a0c]">
        <div className="absolute left-2 top-2 rounded border border-white/10 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">● REC 1080p60</div>
        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 opacity-40">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/60" />
        </div>
        <div className="absolute bottom-2 left-2 rounded border border-white/10 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">Ayinaki-clipsend.mp4</div>
      </div>
      {/* transport */}
      <div className="flex h-10 items-center gap-1.5 border-t border-[#232329] bg-[#131316] px-3">
        <span className="h-5 w-5 rounded bg-zinc-700" />
        <span className="h-5 w-5 rounded bg-[#5865F2]" />
        <span className="h-5 w-5 rounded bg-zinc-700" />
        <span className="ml-2 rounded border border-[#3a3325] bg-[#1b1811] px-1.5 py-0.5 font-mono text-[9px] text-[#e5b45a]">SET IN</span>
        <span className="rounded border border-[#3a3325] bg-[#1b1811] px-1.5 py-0.5 font-mono text-[9px] text-[#e5b45a]">SET OUT</span>
        <span className="ml-auto font-mono text-[9px] text-zinc-600">Track 1, 128k</span>
      </div>
      {/* timeline */}
      <div className="relative mx-3 my-2 h-14 overflow-hidden rounded border border-[#26262c] bg-[#0a0a0c]">
        <Wave />
        <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: "18%" }} />
        <div className="absolute inset-y-0 right-0 bg-black/70" style={{ width: "26%" }} />
        <div className="absolute inset-y-0 left-[18%] w-[4px] bg-[#e5b45a]" />
        <div className="absolute inset-y-0 left-[74%] w-[4px] bg-[#e5b45a]" />
        <div className="absolute inset-y-0 left-[46%] w-[2px] bg-white" />
      </div>
      {/* export bar */}
      <div className="flex h-11 items-center justify-between border-t border-[#232329] bg-[#131316] px-3">
        <div className="flex gap-1">
          <span className="rounded bg-white px-2 py-1 font-mono text-[9px] font-bold text-black">20 MB</span>
          <span className="rounded border border-[#2a2a30] bg-[#1a1a1f] px-2 py-1 font-mono text-[9px] text-zinc-400">50 MB</span>
          <span className="rounded border border-[#2a2a30] bg-[#1a1a1f] px-2 py-1 font-mono text-[9px] text-zinc-400">500 MB</span>
        </div>
        <span className="rounded bg-[#5865F2] px-3 py-1.5 font-mono text-[9px] font-bold text-white">Export 19.2 MB</span>
      </div>
    </div>
  );
}

function MergeSchematic() {
  return (
    <div className="flex h-full flex-col">
      {/* title bar */}
      <div className="flex h-9 items-center justify-between border-b border-[#232329] bg-[#17171b] px-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="ml-2 font-mono text-[10px] text-zinc-500">ClipSend - Merge</span>
        </div>
        <span className="rounded border border-[#2e2e35] bg-[#101014] px-2 py-0.5 font-mono text-[9.5px] text-zinc-400">4 clips, 58.2s</span>
      </div>
      <div className="flex flex-1">
        {/* sidebar */}
        <div className="w-[26%] space-y-1.5 border-r border-[#232329] bg-[#101014] p-2">
          {["match_intro.mp4", "clutch_r4.mp4", "victory.mp4", "outro.mp4"].map((n, i) => (
            <div key={n} className={`flex items-center gap-1.5 rounded border px-1.5 py-1.5 font-mono text-[8.5px] ${i === 1 ? "border-[#5865F2]/50 bg-[#5865F2]/10 text-zinc-200" : "border-[#232329] bg-[#0b0b0d] text-zinc-500"}`}>
              <span className="text-zinc-700"></span> {n}
            </div>
          ))}
        </div>
        {/* main */}
        <div className="flex flex-1 flex-col">
          {/* blocks */}
          <div className="flex h-16 gap-1 p-2">
            {[
              { w: "26%", c: "border-[#3d435f] bg-[#1a1e2e]" },
              { w: "14%", c: "border-[#2e4a44] bg-[#121d1b]" },
              { w: "36%", c: "border-[#4a4130] bg-[#1e1a12]" },
              { w: "20%", c: "border-[#4d3138] bg-[#1f1418]" },
            ].map((b, i) => (
              <div key={i} style={{ width: b.w }} className={`relative rounded border ${b.c}`}>
                <div className="absolute left-0 top-0 h-full w-[3px] bg-[#e5b45a]" />
                <div className="absolute right-0 top-0 h-full w-[3px] bg-[#e5b45a]" />
                <div className="absolute inset-x-1.5 bottom-1.5 top-3 flex items-end gap-[2px] opacity-40">
                  {Array.from({ length: 12 }).map((_, j) => (
                    <div key={j} className="flex-1 rounded-sm bg-zinc-400" style={{ height: `${25 + ((j * 41 + i * 17) % 55)}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* preview */}
          <div className="relative flex-1 bg-[#0a0a0c]">
            <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 opacity-40">
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60" />
              <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/60" />
            </div>
            <div className="absolute bottom-2 right-2 rounded border border-white/10 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">playing clip 2/4</div>
          </div>
        </div>
      </div>
      {/* export bar */}
      <div className="flex h-11 items-center justify-between border-t border-[#232329] bg-[#131316] px-3">
        <span className="font-mono text-[9px] text-zinc-600">concat demuxer → re-encode fallback</span>
        <span className="rounded bg-[#5865F2] px-3 py-1.5 font-mono text-[9px] font-bold text-white">Merge → 19.1 MB</span>
      </div>
    </div>
  );
}

export function Anatomy() {
  const [view, setView] = useState<"trim" | "merge">("trim");
  const [active, setActive] = useState(1);
  const spots = view === "trim" ? TRIM_SPOTS : MERGE_SPOTS;

  return (
    <section id="modes" className="scroll-mt-24 border-b border-[#1a1a1e] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          align="left"
          title={<>Learn the window before you install it.</>}
          sub="Five parts do all the work. Click the numbers."
        />

        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-lg border border-[#232329] bg-[#101014] p-1">
            {(["trim", "merge"] as const).map((v) => (
              <button
                key={v}
                onClick={() => { setView(v); setActive(1); }}
                className={`rounded-md px-6 py-1.5 font-mono text-[12px] font-bold transition ${
                  view === v ? "bg-[#e4e4e7] text-black" : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          {/* schematic with hotspots */}
          <div className="relative aspect-[16/11] overflow-hidden rounded-xl border border-[#2a2a30] bg-[#101014] shadow-2xl shadow-black/50">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0"
              >
                {view === "trim" ? <TrimSchematic /> : <MergeSchematic />}
              </motion.div>
            </AnimatePresence>
            {spots.map((s) => (
              <button
                key={`${view}-${s.id}`}
                onClick={() => setActive(s.id)}
                aria-label={s.title}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  {active !== s.id && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5865F2]/40" />}
                  <span
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold transition ${
                      active === s.id ? "bg-white text-black" : "bg-[#5865F2] text-white hover:bg-[#6b76ff]"
                    }`}
                  >
                    {s.id}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* detail list */}
          <div className="flex flex-col rounded-xl border border-[#232329] bg-[#101014]">
            <div className="border-b border-[#1e1e22] px-5 py-3">
              <span className="font-mono text-[11px] text-zinc-500">
                {view} mode, {spots.length} numbered parts
              </span>
            </div>
            <div className="flex-1 divide-y divide-[#1e1e22]">
              {spots.map((s) => {
                const open = active === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    className={`block w-full px-5 py-3.5 text-left transition ${open ? "bg-[#131316]" : "hover:bg-[#131316]/60"}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                          open ? "bg-white text-black" : "bg-[#1e1e24] text-zinc-400"
                        }`}
                      >
                        {s.id}
                      </span>
                      <span className={`text-[13.5px] font-semibold ${open ? "text-white" : "text-zinc-300"}`}>{s.title}</span>
                    </div>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: "easeInOut" }}
                        >
                          <p className="mt-2 pl-8 text-[12.5px] leading-relaxed text-zinc-500">{s.body}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
