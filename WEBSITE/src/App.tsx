import { motion } from "framer-motion";
import { Crown, User, Zap, ArrowRight, Scissors, Terminal, Cpu } from "lucide-react";
import { Navbar, Footer } from "./components/ui";
import { Hero, Marquee } from "./components/hero";
import { useEffect } from "react";
import { ExportReplay } from "./components/replay";
import { DiscordStory } from "./components/discord-story";
import { Calculator } from "./components/calculator";
import { Anatomy } from "./components/anatomy";
import { Changelog, GpuCheck, MergePaths } from "./components/extras";
import { Engine, Showcase, DownloadSection, Faq } from "./components/features";
import { DISCORD_TIERS } from "./data";

function TiersBand() {
  const icons = [User, Zap, Crown];
  const maxMB = 500;
  return (
    <section className="border-b border-[#1a1a1e] py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid items-end justify-between gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="font-display max-w-xl text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">
              One 60-second raw clip is <span className="text-[#f87171]">~400 MB</span>. Pick your cage.
            </h2>
          </div>
          <a href="#replay" className="group hidden items-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-[#3f3f46] hover:text-white lg:flex">
            Watch an export replay
            <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
          </a>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {DISCORD_TIERS.map((t, i) => {
            const Icon = icons[i];
            const pct = Math.max(6, (t.limitMB / maxMB) * 100);
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                className="rounded-xl border border-[#232329] bg-[#101014] p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2a2a30] bg-[#17171b]" style={{ color: t.color }}>
                    <Icon size={16} />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-600">tier 0{i + 1}</span>
                </div>
                <div className="mt-4 text-[13px] font-semibold text-zinc-400">{t.name}</div>
                <div className="font-display text-4xl font-bold tracking-tight text-white">
                  {t.limitMB}<span className="ml-1 text-base font-semibold text-zinc-600">MB</span>
                </div>
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#1e1e22]">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${pct}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.9, delay: 0.2 + i * 0.1, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{ background: t.color }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between font-mono text-[10px] text-zinc-600">
                    <span>limit</span>
                    <span>raw 60s ≈ 400 MB</span>
                  </div>
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-500">{t.blurb}</p>
                <div className="mt-3 rounded-lg border border-[#232329] bg-[#0b0b0d] px-3 py-2 font-mono text-[11px] text-zinc-500">
                  ClipSend preset → <span className="font-bold" style={{ color: t.color }}>{(t.limitMB * 0.96).toFixed(1)} MB</span> target
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ArchitectureBanner() {
  return (
    <section className="border-b border-[#1a1a1e] bg-[#0e0e10] py-14">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-[#232329] bg-[#101014] p-5">
            <Cpu size={18} className="text-[#5865F2]" />
            <h3 className="mt-3 text-[14px] font-bold text-white">Strict process isolation</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">
              The renderer never touches Node directly. Everything crosses async IPC defined in preload.js.
            </p>
          </div>
          <div className="rounded-xl border border-[#232329] bg-[#101014] p-5">
            <Terminal size={18} className="text-[#5865F2]" />
            <h3 className="mt-3 text-[14px] font-bold text-white">Stderr timecode parser</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">
              Encoder and Merger spawn FFmpeg as a child process and read stderr line by line for progress.
            </p>
          </div>
          <div className="rounded-xl border border-[#232329] bg-[#101014] p-5">
            <Scissors size={18} className="text-[#5865F2]" />
            <h3 className="mt-3 text-[14px] font-bold text-white">Pass logfile workaround</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">
              x264 on Windows chokes on backslashes in pass-log paths. ClipSend sets cwd to the output folder and uses relative names.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  useEffect(() => {
    // for whoever opens devtools on a landing page. you know who you are.
    console.log(
      "%cclipsend landing page %c\nthe pass-log workaround lives in main/encoder.js.\n" +
      "the planner math is main/export-planner.js.\n" +
      "nothing on this page uploads anywhere, including this console.",
      "background:#5865F2;color:#fff;padding:2px 6px;border-radius:3px;font-weight:700",
      "color:#8b8b93"
    );
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0b0d]">
      <Navbar />
      <main>
        <Hero />
        <Marquee />
        <DiscordStory />
        <TiersBand />
        <ExportReplay />
        <Calculator />
        <Anatomy />
        <MergePaths />
        <Engine />
        <GpuCheck />
        <ArchitectureBanner />
        <Showcase />
        <Changelog />
        <DownloadSection />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
