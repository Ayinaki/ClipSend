import { motion } from "framer-motion";
import { Hash, Play, Flame, Skull, TriangleAlert, FileVideo } from "lucide-react";
import { REPO_URL } from "../data";

/* Discord-authentic palette (this block deliberately looks like Discord, not like our site) */
const D = {
  body: "#313338",
  header: "#2b2d31",
  attach: "#2b2d31",
  attachBorder: "#1e1f22",
  text: "#dbdee1",
  muted: "#949ba4",
  faint: "#6d7178",
  red: "#fa777c",
  blurple: "#5865f2",
};

function Avatar({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold text-white"
      style={{ background: color }}
    >
      {label}
    </div>
  );
}

function Msg({
  color, name, time, children, delay,
}: {
  color: string; name: string; time: string; children: React.ReactNode; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, delay }}
      className="flex gap-4 px-4 py-2 hover:bg-white/[0.015]"
    >
      <Avatar color={color} label={name[0].toUpperCase()} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold" style={{ color: D.text }}>{name}</span>
          <span className="text-[11px]" style={{ color: D.faint }}>{time}</span>
        </div>
        <div className="mt-0.5">{children}</div>
      </div>
    </motion.div>
  );
}

export function DiscordStory() {
  return (
    <section className="border-b border-[#1a1a1e] py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="font-mono text-[12px] text-zinc-500">friday, 23:41. recreated from memory.</p>
          <h2 className="font-display mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Everyone has this chat.
          </h2>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55 }}
          className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-xl shadow-2xl shadow-black/60"
          style={{ background: D.body }}
        >
          {/* channel header */}
          <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ background: D.header, borderColor: D.attachBorder }}>
            <Hash size={18} style={{ color: D.faint }} />
            <span className="text-[15px] font-semibold" style={{ color: D.text }}>clips-and-frags</span>
            <span className="mx-1 h-5 w-px" style={{ background: D.attachBorder }} />
            <span className="truncate text-[13px]" style={{ color: D.muted }}>post your best moments</span>
          </div>

          <div className="py-4">
            <Msg color="#3ba55c" name="m4tt" time="Today at 23:41" delay={0.1}>
              <p className="text-[15px] leading-relaxed" style={{ color: D.text }}>yo post that 1v5 from tonight, im not letting this die in vc</p>
            </Msg>

            <Msg color={D.blurple} name="you" time="Today at 23:42" delay={0.35}>
              {/* failed attachment */}
              <div className="max-w-md rounded-md border p-3" style={{ background: D.attach, borderColor: D.attachBorder }}>
                <div className="flex items-center gap-2.5">
                  <FileVideo size={20} style={{ color: D.muted }} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium" style={{ color: D.muted, textDecoration: "line-through" }}>Ayinaki-clipsend.mp4</div>
                    <div className="font-mono text-[11px]" style={{ color: D.faint }}>247.00 MB</div>
                  </div>
                </div>
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.7, duration: 0.3 }}
                className="mt-2 flex items-start gap-2 text-[14px]"
                style={{ color: D.red }}
              >
                <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">File too powerful to send.</span> Maximum file size is 20 MB. Boost the server or get Nitro for up to 500 MB.
                </span>
              </motion.div>
            </Msg>

            <Msg color={D.blurple} name="you" time="Today at 23:42" delay={0.9}>
              <p className="text-[15px]" style={{ color: D.text }}>give me 5 seconds</p>
            </Msg>

            {/* time divider */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 1.1 }}
              className="my-3 flex items-center gap-3 px-4"
            >
              <div className="h-px flex-1" style={{ background: D.attachBorder }} />
              <span className="rounded px-2 py-0.5 font-mono text-[10.5px] font-semibold" style={{ color: D.faint, background: D.header }}>
                4 seconds later
              </span>
              <div className="h-px flex-1" style={{ background: D.attachBorder }} />
            </motion.div>

            <Msg color={D.blurple} name="you" time="Today at 23:43" delay={1.25}>
              {/* successful video attachment */}
              <div className="max-w-md overflow-hidden rounded-md border" style={{ background: D.attach, borderColor: D.attachBorder }}>
                <div className="relative flex aspect-video items-center justify-center bg-[#111214]">
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{ backgroundImage: "repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 9px)" }}
                  />
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(0,0,0,0.65)" }}>
                    <Play size={20} className="ml-0.5 text-white" />
                  </div>
                  <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10.5px] text-white">0:22</span>
                </div>
                <div className="px-3 py-2">
                  <div className="truncate text-[14px] font-medium" style={{ color: "#00a8fc" }}>Ayinaki-clipsend-trimmed.mp4</div>
                  <div className="font-mono text-[11px]" style={{ color: D.faint }}>19.20 MB, 1080p60, h264_nvenc</div>
                </div>
              </div>
              {/* reactions */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 1.6, type: "spring", stiffness: 300, damping: 20 }}
                className="mt-2 flex gap-1.5"
              >
                <span className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold" style={{ background: "rgba(88,101,242,0.15)", borderColor: D.blurple, color: D.text }}>
                  <Flame size={14} style={{ color: "#faa61a" }} /> 4
                </span>
                <span className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold" style={{ background: D.header, borderColor: D.attachBorder, color: D.text }}>
                  <Skull size={14} style={{ color: D.muted }} /> 2
                </span>
              </motion.div>
            </Msg>

            <Msg color="#3ba55c" name="m4tt" time="Today at 23:43" delay={1.75}>
              <p className="text-[15px]" style={{ color: D.text }}>how did you fit that lmaoo nitro??</p>
            </Msg>

            <Msg color={D.blurple} name="you" time="Today at 23:44" delay={1.95}>
              <p className="text-[15px] leading-relaxed" style={{ color: D.text }}>
                nah, ClipSend trimmed + re-encoded it on my GPU in 4s. free, open source:{" "}
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:brightness-125" style={{ color: "#00a8fc" }}>
                  github.com/Ayinaki/ClipSend
                </a>
              </p>
            </Msg>
          </div>

          {/* input bar */}
          <div className="px-4 pb-4">
            <div className="rounded-lg px-4 py-2.5 text-[14px]" style={{ background: "#383a40", color: D.faint }}>
              Message #clips-and-frags
            </div>
          </div>
        </motion.div>

        <p className="mt-4 text-center font-mono text-[11px] text-zinc-600">
          a simulated chat. the emotions are documentary.
        </p>
      </div>
    </section>
  );
}
