import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, ArrowRight, GitCommitHorizontal } from "lucide-react";
import { REPO_URL } from "../data";
import { useReleases } from "../lib/releases";
import { SectionHeading } from "./ui";

/* ---------------- CHANGELOG ---------------- */

export function Changelog() {
  const { entries } = useReleases();

  return (
    <section id="changelog" className="scroll-mt-24 border-b border-[#1a1a1e] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            align="left"
            title={<>It ships. It says what changed.</>}
            sub="Release notes from the repo, lightly trimmed. Every line links to the pull request that caused it."
          />
          <a
            href={`${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-4 py-2.5 font-mono text-[12px] text-zinc-300 transition hover:border-[#3f3f46] hover:text-white"
          >
            all releases <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
          </a>
        </div>

        <div className="mt-10 space-y-0">
          {entries.map((e, i) => (
            <motion.div
              key={e.tag}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.04 }}
              className="grid gap-4 border-t border-[#1e1e22] py-6 sm:grid-cols-[140px_1fr]"
            >
              <div className="flex items-start gap-2">
                <GitCommitHorizontal size={14} className="mt-1 text-zinc-600" />
                <span className="font-mono text-[13px] font-bold text-zinc-100">{e.tag}</span>
                {e.latest && (
                  <span className="rounded border border-[#234d35] bg-[#0e1a13] px-1.5 py-0.5 font-mono text-[10px] text-[#8ee6ab]">
                    latest
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {e.notes.map((n) => (
                  <li key={n.text} className="flex items-baseline gap-2 text-[13.5px] leading-relaxed text-zinc-400">
                    <span className="text-zinc-700">*</span>
                    <span>{n.text}</span>
                    {n.pr && (
                      <a
                        href={`${REPO_URL}/pull/${n.pr}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[11px] text-zinc-600 underline-offset-2 hover:text-zinc-300 hover:underline"
                      >
                        #{n.pr}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- GPU CHECK ---------------- */

type Gpu = {
  id: string;
  label: string;
  h264: string;
  av1: string | null;
  note: string;
};

const GPUS: Gpu[] = [
  { id: "rtx40", label: "NVIDIA RTX 40 or 50 series", h264: "h264_nvenc", av1: "av1_nvenc", note: "The full set, on silicon. AV1 exports stay on the GPU." },
  { id: "rtxold", label: "NVIDIA GTX 10 series to RTX 30 series", h264: "h264_nvenc", av1: null, note: "H.264 runs on the GPU. AV1 exports fall back to SVT-AV1 on the CPU, slower, same file format." },
  { id: "arc", label: "Intel Arc, or 12th gen and newer iGPU", h264: "h264_qsv", av1: "av1_qsv", note: "Quick Sync handles both codecs. Nothing falls back unless init fails." },
  { id: "intelold", label: "Older Intel integrated graphics", h264: "h264_qsv", av1: null, note: "Quick Sync covers H.264. AV1 goes to SVT-AV1 on the CPU." },
  { id: "rx6000", label: "AMD RX 6000 series or newer", h264: "h264_amf", av1: "av1_amf", note: "AMF covers both. RX 6000 is where AMD's AV1 silicon starts." },
  { id: "amdold", label: "Older AMD GCN or RDNA cards", h264: "h264_amf", av1: null, note: "H.264 on the GPU, AV1 on the CPU through SVT-AV1." },
  { id: "cpu", label: "No usable GPU, or a VM", h264: "libx264, 2-pass", av1: "libsvtav1, 2-pass", note: "Slowest path, and the most accurate. Two-pass ABR hits the size target hardest." },
];

export function GpuCheck() {
  const [sel, setSel] = useState("rtx40");
  const gpu = GPUS.find((g) => g.id === sel) ?? GPUS[0];

  return (
    <section id="gpu" className="scroll-mt-24 border-b border-[#1a1a1e] bg-[#0e0e10] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          align="left"
          title={<>Will your GPU make it?</>}
          sub="Three vendors, one fallback. Click the family you own and see which encoders ClipSend lights up."
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-2">
            {GPUS.map((g) => (
              <button
                key={g.id}
                onClick={() => setSel(g.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                  sel === g.id
                    ? "border-[#5865F2] bg-[#5865F2]/10"
                    : "border-[#232329] bg-[#101014] hover:border-[#3f3f46]"
                }`}
              >
                <span className={`text-[13px] font-semibold ${sel === g.id ? "text-white" : "text-zinc-300"}`}>{g.label}</span>
                <span className="font-mono text-[10.5px] text-zinc-600">{g.av1 ? "hw av1" : "cpu av1"}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={gpu.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="rounded-xl border border-[#232329] bg-[#101014] p-6"
            >
              <div className="font-mono text-[12px] text-zinc-500">{gpu.label.toLowerCase()}</div>

              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-[#232329] bg-[#0b0b0d] px-4 py-3">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-300">H.264 exports</div>
                    <div className="font-mono text-[11px] text-zinc-600">single-pass VBR, maxrate from the planner</div>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-md border border-[#234d35] bg-[#0e1a13] px-2.5 py-1 font-mono text-[11px] font-bold text-[#8ee6ab]">
                    <Check size={12} /> {gpu.h264}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-[#232329] bg-[#0b0b0d] px-4 py-3">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-300">AV1 exports</div>
                    <div className="font-mono text-[11px] text-zinc-600">
                      {gpu.av1 ? "hardware encoder, single-pass VBR" : "no AV1 silicon here, SVT-AV1 two-pass on CPU"}
                    </div>
                  </div>
                  {gpu.av1 ? (
                    <span className="flex items-center gap-1.5 rounded-md border border-[#234d35] bg-[#0e1a13] px-2.5 py-1 font-mono text-[11px] font-bold text-[#8ee6ab]">
                      <Check size={12} /> {gpu.av1}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-md border border-[#2a2a30] bg-[#17171b] px-2.5 py-1 font-mono text-[11px] font-bold text-zinc-400">
                      <X size={12} /> libsvtav1 on CPU
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-5 text-[13px] leading-relaxed text-zinc-500">{gpu.note}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">
                And if hardware init fails mid-export, out of VRAM, bad driver, ClipSend swaps to the matching CPU encoder and the export survives.
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/* ---------------- MERGE PATHS ---------------- */

export function MergePaths() {
  const [sameCodec, setSameCodec] = useState(true);
  const [sameShape, setSameShape] = useState(true);
  const [anyTrim, setAnyTrim] = useState(false);

  const path = anyTrim ? "trim" : sameCodec && sameShape ? "copy" : "normalize";

  const OUT = {
    copy: {
      name: "fast path",
      cmd: "concat demuxer, -c copy",
      body: "Every clip already matches on codec, resolution and framerate, so nothing is re-encoded. The concat demuxer stitches the files as they are. Seconds, and lossless.",
      steps: ["clips as-is", "concat demuxer", "output.mp4"],
    },
    trim: {
      name: "trim first",
      cmd: "accurate -ss and -t re-encode, then concat",
      body: "Trimmed clips are rendered to uniform temp files first, h264 and aac, exact cut points. Untouched clips keep their original files. Then everything concatenates, and the temps delete themselves.",
      steps: ["trimmed clips to temp", "concat", "output.mp4, temps cleaned"],
    },
    normalize: {
      name: "normalize",
      cmd: "concat filter, full re-encode",
      body: "The clips disagree on codec, resolution or framerate, so the concat filter re-encodes everything to the first clip's parameters. NVENC if you configured it. Progress is weighted across the phases.",
      steps: ["clips resampled to the first clip", "concat filter", "output.mp4"],
    },
  }[path];

  const Toggle = ({ on, set, yes, no }: { on: boolean; set: (v: boolean) => void; yes: string; no: string }) => (
    <button
      onClick={() => set(!on)}
      className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
        on ? "border-[#234d35] bg-[#0e1a13]" : "border-[#3a3325] bg-[#15130d]"
      }`}
    >
      <span className="text-[13px] font-semibold text-zinc-200">{on ? yes : no}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-[#5865F2]" : "bg-[#3f3f46]"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );

  return (
    <section id="merge-paths" className="scroll-mt-24 border-b border-[#1a1a1e] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          align="left"
          title={<>Three questions decide every merge.</>}
          sub="merger.js asks them in this order before a single frame is touched. Flip the answers and watch the pipeline change."
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-2">
            <Toggle on={sameCodec} set={setSameCodec} yes="all clips share one codec" no="codecs differ" />
            <Toggle on={sameShape} set={setSameShape} yes="same resolution and framerate" no="resolution or fps differs" />
            <Toggle on={anyTrim} set={setAnyTrim} yes="at least one clip is trimmed" no="no trims, whole clips only" />
            <p className="pt-2 font-mono text-[11px] leading-relaxed text-zinc-600">
              order matters. trims are checked first, because a trimmed clip always needs a render pass.
            </p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="rounded-xl border border-[#232329] bg-[#101014] p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-xl font-bold text-white">{OUT.name}</h3>
                <span className="font-mono text-[11.5px] text-zinc-500">{OUT.cmd}</span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {OUT.steps.map((s, i) => (
                  <span key={s} className="flex items-center gap-2">
                    <span
                      className={`rounded-lg border px-3 py-2 font-mono text-[11.5px] ${
                        i === OUT.steps.length - 1
                          ? "border-[#234d35] bg-[#0e1a13] text-[#8ee6ab]"
                          : "border-[#2a2a30] bg-[#17171b] text-zinc-300"
                      }`}
                    >
                      {s}
                    </span>
                    {i < OUT.steps.length - 1 && <ArrowRight size={13} className="text-zinc-600" />}
                  </span>
                ))}
              </div>

              <p className="mt-5 text-[13.5px] leading-relaxed text-zinc-500">{OUT.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
