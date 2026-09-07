/* Generates public/og-image.png (1200x630) for Discord/Twitter link unfurls.
   One-off tool: sharp is intentionally NOT a dependency. Regenerate with:
     npm i --no-save sharp && node scripts/make-og.mjs
   The PNG is committed, so this only needs to run when the card changes. */
import sharp from "sharp";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Waveform bars across the bottom, echoing the app timeline motif. */
function waveform(n, width, height, color) {
  let bars = "";
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 9) * 0.25 + Math.sin(i / 3.7) * 0.15 + 0.55;
    const h = Math.min(1, Math.max(0.08, wave * (0.6 + rand() * 0.7)));
    const x = 40 + i * (width - 80) / n;
    bars += `<rect x="${x.toFixed(1)}" y="${(height - h * 90).toFixed(1)}" width="${((width - 80) / n - 6).toFixed(1)}" height="${(h * 90).toFixed(1)}" rx="3" fill="${color}" opacity="${(0.35 + h * 0.5).toFixed(2)}"/>`;
  }
  return bars;
}

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0b0b0d"/>
  <rect x="0" y="0" width="1200" height="4" fill="#5865F2"/>
  ${waveform(56, 1200, 630, "#5865F2")}

  <!-- logo mark: same geometry as the site's Mark component -->
  <g transform="translate(64, 56)">
    <rect width="88" height="88" rx="19" fill="#131313" stroke="#2a2a30"/>
    <path d="M33 22 L22 22 L22 66 L33 66" stroke="#2ba87e" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M55 22 L66 22 L66 66 L55 66" stroke="#2ba87e" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M38 37 L38 51 L53 44 Z" fill="#3ddc97"/>
    <text x="104" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">ClipSend</text>
    <text x="104" y="70" font-family="Consolas, monospace" font-size="19" fill="#8b8b93">for discord</text>
  </g>

  <!-- headline -->
  <text x="64" y="258" font-family="Segoe UI, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff">Your clip is <tspan fill="#f87171">247 MB</tspan>.</text>
  <text x="64" y="352" font-family="Segoe UI, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff">Discord allows <tspan fill="#5865F2">20</tspan>.</text>
  <rect x="64" y="376" width="118" height="8" rx="4" fill="#5865F2"/>

  <!-- subline -->
  <text x="64" y="446" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#9d9da6">Cuts it, solves the bitrate, lands one hair under the limit.</text>
  <text x="64" y="490" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#9d9da6">NVENC, QSV or AMF. Free and open source.</text>

  <text x="1136" y="100" text-anchor="end" font-family="Consolas, monospace" font-size="22" fill="#6d6d76">github.com/Ayinaki/ClipSend</text>
</svg>`;

const out = path.join(__dirname, "..", "public", "og-image.png");
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote", out);
