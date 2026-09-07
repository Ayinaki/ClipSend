import { useEffect, useState } from "react";

export type Note = { text: string; pr?: number };
export type ReleaseEntry = { tag: string; notes: Note[]; latest?: boolean };
export type Installer = { filename: string; sizeMB: number; sha256: string | null; url: string };
export type Releases = { entries: ReleaseEntry[]; latestTag: string; installer: Installer | null };

/* The data the page shows before the API answers, and if the API can't be reached.
   Kept current to the last release so the page never renders empty or broken. */
export const FALLBACK: Releases = {
  entries: [
    { tag: "v2.2.6", latest: true, notes: [{ text: "Fix missing gifski binary, add existence checks and harden CI", pr: 19 }] },
    { tag: "v2.2.5", notes: [{ text: "Add post-encode size retry to video exports", pr: 16 }, { text: "Fix multi-trim readout overlap, polish the transport and settings UI", pr: 17 }, { text: "Drop the SignPath signing plan", pr: 12 }] },
    { tag: "v2.2.4", notes: [{ text: "Fix multi-trim merged exports: segPlan is not defined", pr: 9 }] },
    { tag: "v2.2.3", notes: [{ text: "Add WebM export support, VP9 and AV1 with Opus audio", pr: 6 }, { text: "Fix AV1 size-limit exports and the libvpx cross-compile", pr: 7 }] },
    { tag: "v2.2.0", notes: [{ text: "Remappable shortcuts, undo and redo, playback speed, new icon", pr: 2 }] },
    { tag: "v2.1.1", notes: [{ text: "AV1 in any format, unified progress, tray, encoder profiles", pr: 1 }] },
    { tag: "v2.0.0", notes: [{ text: "UI and workflow overhaul: onboarding, timeline zoom, taskbar progress, window state" }] },
  ],
  latestTag: "v2.2.6",
  installer: {
    filename: "ClipSend.Setup.2.2.6.exe",
    sizeMB: 111.6,
    sha256: "d23795bf780e5cd0ac33b8fa03dd44760420d4466664f8931638806cf673c575",
    url: "https://github.com/Ayinaki/ClipSend/releases/download/v2.2.6/ClipSend.Setup.2.2.6.exe",
  },
};

const API = "https://api.github.com/repos/Ayinaki/ClipSend/releases?per_page=12";
const TTL = 15 * 60 * 1000; // 15 minutes
const KEY = "clipsend-releases-v1";

function parseNotes(body: string): Note[] {
  const notes: Note[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("* ")) continue;
    let text = line.slice(2);
    let pr: number | undefined;
    const prMatch = text.match(/pull\/(\d+)/);
    if (prMatch) {
      pr = Number(prMatch[1]);
      text = text.replace(/https?:\/\/github\.com\/Ayinaki\/ClipSend\/pull\/\d+\/?$/, "");
    }
    text = text.replace(/\s+by\s+@\S+\s+in\s*$/, "");
    text = text.replace(/\s+by\s+@\S+$/, "");
    text = text.replace(/\s+in\s*$/, "").trim();
    if (text) notes.push({ text, pr });
  }
  return notes;
}

type ApiRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body: string | null;
  assets: { name: string; size: number; browser_download_url: string; digest?: string | null }[];
};

function toInstaller(rel: ApiRelease): Installer | null {
  const asset = rel.assets.find((a) => a.name.endsWith(".exe") && !a.name.endsWith(".blockmap"));
  if (!asset) return null;
  return {
    filename: asset.name,
    sizeMB: Math.round((asset.size / 1048576) * 10) / 10,
    sha256: asset.digest?.replace(/^sha256:/i, "") ?? null,
    url: asset.browser_download_url,
  };
}

function normalize(json: ApiRelease[]): Releases {
  const published = json.filter((r) => !r.draft);
  const stable = published.filter((r) => !r.prerelease);
  const latest = stable[0] ?? published[0];
  if (!latest) return FALLBACK;
  const entries: ReleaseEntry[] = published.slice(0, 8).map((r) => ({
    tag: r.tag_name,
    latest: r.tag_name === latest.tag_name,
    notes: parseNotes(r.body ?? ""),
  }));
  return {
    entries,
    latestTag: latest.tag_name,
    installer: toInstaller(latest),
  };
}

let memory: { data: Releases; at: number } | null = null;
let inflight: Promise<Releases> | null = null;

function readCache(): Releases | null {
  const mem = memory && Date.now() - memory.at < TTL ? memory.data : null;
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.at && Date.now() - parsed.at < TTL) {
        memory = { data: parsed.data, at: parsed.at };
        return parsed.data;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function writeCache(data: Releases) {
  memory = { data, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify({ data, at: Date.now() }));
  } catch { /* ignore */ }
}

async function getReleases(): Promise<Releases> {
  const cached = readCache();
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as ApiRelease[];
      const data = normalize(json);
      writeCache(data);
      return data;
    } catch {
      return FALLBACK;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useReleases(): Releases {
  const [data, setData] = useState<Releases>(FALLBACK);
  useEffect(() => {
    let alive = true;
    getReleases().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
