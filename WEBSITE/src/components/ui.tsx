import { useEffect, useState } from "react";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { Menu, X, Download, ArrowUpRight } from "lucide-react";
import { REPO_URL, RELEASES_URL } from "../data";

export function GithubIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label="ClipSend"
      style={{ borderRadius: size * 0.22 }}
    >
      <rect width="256" height="256" rx="56" fill="#131313" />
      <path d="M96 64 L64 64 L64 192 L96 192" stroke="#2ba87e" strokeWidth="17" strokeLinecap="round" fill="none" />
      <path d="M160 64 L192 64 L192 192 L160 192" stroke="#2ba87e" strokeWidth="17" strokeLinecap="round" fill="none" />
      <path d="M112 102 L112 154 L154 128 Z" fill="#3ddc97" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <Mark size={32} />
      <div className="leading-none">
        <div className="font-display text-[16px] font-bold tracking-tight text-white">
          ClipSend
        </div>
        <div className="mt-1 font-mono text-[10px] text-zinc-500">for discord</div>
      </div>
    </div>
  );
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: "Export replay", href: "#replay" },
    { label: "Calculator", href: "#calculator" },
    { label: "Merge paths", href: "#merge-paths" },
    { label: "GPU check", href: "#gpu" },
    { label: "Changelog", href: "#changelog" },
    { label: "FAQ", href: "#faq" },
  ];

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });

  return (
    <>
    <motion.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-[#5865F2]"
      style={{ scaleX: progress }}
    />
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-200 ${scrolled ? "border-b border-[#1e1e22] bg-[#0b0b0d] py-3" : "border-b border-transparent bg-[#0b0b0d]/80 py-4 backdrop-blur-sm"}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" aria-label="ClipSend home">
          <Logo />
        </a>
        <nav className="hidden items-center gap-0.5 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-md px-3.5 py-2 text-[13.5px] font-medium text-zinc-400 transition hover:bg-white/5 hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition hover:border-[#3f3f46] hover:text-white"
          >
            <GithubIcon size={15} />
            <span className="font-mono text-xs">Ayinaki/ClipSend</span>
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#4752c4]"
          >
            <Download size={14} />
            Download
          </a>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2a2a30] bg-[#131316] text-zinc-200 lg:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X size={17} /> : <Menu size={17} />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-[#1e1e22] bg-[#0e0e10] lg:hidden"
          >
            <div className="space-y-0.5 px-5 py-4">
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-4 py-2.5 text-[14px] font-medium text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </a>
              ))}
              <div className="flex gap-2 pt-2">
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-4 py-2.5 text-sm font-semibold text-zinc-200">
                  <GithubIcon size={15} /> GitHub
                </a>
                <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white">
                  <Download size={15} /> Download
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
    </>
  );
}

export function SectionHeading({
  title,
  sub,
  align = "center",
}: {
  title: React.ReactNode;
  sub?: string;
  align?: "center" | "left";
}) {
  const wrap = align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl";
  const subWrap = align === "center" ? "mx-auto max-w-xl" : "max-w-xl";
  return (
    <div className={wrap}>
      <h2 className="font-display text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">{title}</h2>
      {sub && <p className={`mt-4 text-[14.5px] leading-relaxed text-zinc-400 ${subWrap}`}>{sub}</p>}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[#1e1e22] bg-[#08080a]">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500">
              Trim, merge, and shrink video clips so they fit Discord's upload limit. Free, open-source, GPU-accelerated.
            </p>
            <div className="mt-5 flex gap-2">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-[#2a2a30] bg-[#131316] px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:border-[#3f3f46] hover:text-white"
              >
                <GithubIcon size={13} /> Star on GitHub <ArrowUpRight size={12} className="opacity-60" />
              </a>
            </div>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-zinc-300">On this page</div>
            <ul className="mt-4 space-y-2.5 text-sm text-zinc-400">
              <li><a href="#replay" className="hover:text-white">Export replay</a></li>
              <li><a href="#calculator" className="hover:text-white">Size calculator</a></li>
              <li><a href="#merge-paths" className="hover:text-white">Merge decision tree</a></li>
              <li><a href="#gpu" className="hover:text-white">GPU check</a></li>
              <li><a href="#changelog" className="hover:text-white">Changelog</a></li>
            </ul>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-zinc-300">Repository</div>
            <ul className="mt-4 space-y-2.5 text-sm text-zinc-400">
              <li><a href={RELEASES_URL} target="_blank" rel="noreferrer" className="hover:text-white">Releases</a></li>
              <li><a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-white">Source code</a></li>
              <li><a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="hover:text-white">Report an issue</a></li>
              <li><a href="https://github.com/Ayinaki/ClipSend/blob/main/PRIVACY.md" target="_blank" rel="noreferrer" className="hover:text-white">Privacy policy</a></li>
            </ul>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-zinc-300">Stack</div>
            <ul className="mt-4 space-y-2.5 font-mono text-xs text-zinc-500">
              <li>Electron + Windows</li>
              <li>FFmpeg & FFprobe bundled</li>
              <li>NVENC, QSV, AMF, CPU</li>
              <li>H.264, AV1, VP9</li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[#1e1e22] pt-6 sm:flex-row">
          <p className="text-xs text-zinc-600">
            A landing page for the <span className="text-zinc-400">Ayinaki/ClipSend</span> repo. Not affiliated with Discord Inc.
          </p>
          <p className="text-xs text-zinc-700">Everything runs local. Your clips never leave the PC.</p>
        </div>
      </div>
    </footer>
  );
}
