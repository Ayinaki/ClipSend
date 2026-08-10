// First-run onboarding tour.
//
// A skippable, multi-step modal shown once per install that walks new users
// through the two modes (Trim / Merge), the export settings, and the keyboard
// shortcuts. Persistence uses the existing electron-store settings bridge
// (`hasSeenOnboarding`), so no main-process changes are needed. The tour can
// always be replayed from the Settings modal via `show()`.

import { openModal, closeModal } from './utils/modals.js';

const AUTO_SHOW_DELAY_MS = 700;
const SETTING_KEY = 'hasSeenOnboarding';

// --- Step visuals (ghost mocks of the real UI, hand-authored) ---

// A play button framed by two trim brackets: "trim + playback" in one glyph.
const VISUAL_WELCOME = `
<svg viewBox="0 0 380 96" fill="none" aria-hidden="true">
  <rect x="110" y="14" width="160" height="68" rx="6" fill="#141414" stroke="#2a2a2a"/>
  <rect x="110" y="14" width="160" height="68" rx="6" fill="#2ba87e" opacity="0.08"/>
  <rect x="122" y="26" width="136" height="44" rx="3" fill="#000"/>
  <path d="M172 38v20l16-10z" fill="#3ddc97"/>
  <path d="M110 26v44M96 26h28M96 70h28" stroke="#3ddc97" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M270 26v44M256 26h28M256 70h28" stroke="#3ddc97" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

// Waveform with the kept-window highlight, trim brackets and playhead.
const VISUAL_TRIM = `
<svg viewBox="0 0 380 96" fill="none" aria-hidden="true">
  <rect x="16" y="16" width="348" height="54" rx="4" fill="#121212" stroke="#2a2a2a"/>
  <rect x="102" y="16" width="104" height="54" fill="#2ba87e" opacity="0.1"/>
  <rect x="24" y="58" width="3" height="12" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="34" y="54" width="3" height="16" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="44" y="50" width="3" height="20" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="54" y="56" width="3" height="14" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="64" y="61" width="3" height="9" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="74" y="48" width="3" height="22" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="84" y="39" width="3" height="31" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="94" y="53" width="3" height="17" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="104" y="58" width="3" height="12" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="114" y="44" width="3" height="26" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="124" y="35" width="3" height="35" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="134" y="46" width="3" height="24" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="144" y="56" width="3" height="14" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="154" y="42" width="3" height="28" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="164" y="51" width="3" height="19" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="174" y="38" width="3" height="32" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="184" y="46" width="3" height="24" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="194" y="58" width="3" height="12" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="204" y="52" width="3" height="18" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="214" y="44" width="3" height="26" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="224" y="40" width="3" height="30" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="234" y="49" width="3" height="21" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="244" y="57" width="3" height="13" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <rect x="254" y="60" width="3" height="10" rx="1.5" fill="#1d8f6b" opacity="0.9"/>
  <rect x="264" y="55" width="3" height="15" rx="1.5" fill="#3ddc97" opacity="0.9"/>
  <rect x="274" y="59" width="3" height="11" rx="1.5" fill="#2ba87e" opacity="0.9"/>
  <path d="M102 22v42M90 22h24M90 64h24" stroke="#3ddc97" stroke-width="2" stroke-linecap="round"/>
  <path d="M206 22v42M194 22h24M194 64h24" stroke="#3ddc97" stroke-width="2" stroke-linecap="round"/>
  <line x1="150" y1="16" x2="150" y2="70" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  <path d="M144 16h12l-6 6z" fill="#fff"/>
  <rect x="26" y="76" width="2" height="3" rx="1" fill="#333"/>
  <rect x="86" y="76" width="2" height="3" rx="1" fill="#333"/>
  <rect x="146" y="76" width="2" height="3" rx="1" fill="#333"/>
  <rect x="206" y="76" width="2" height="3" rx="1" fill="#333"/>
  <rect x="266" y="76" width="2" height="3" rx="1" fill="#333"/>
  <rect x="326" y="76" width="2" height="3" rx="1" fill="#333"/>
</svg>`;

// Three merge blocks (first selected in teal) with an insertion caret showing reorder.
const VISUAL_MERGE = `
<svg viewBox="0 0 380 96" fill="none" aria-hidden="true">
  <defs>
    <pattern id="onb-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="3" height="6" fill="#2ba87e" opacity="0.15"/>
    </pattern>
  </defs>
  <rect x="18" y="22" width="96" height="52" rx="4" fill="#171717" stroke="#2ba87e"/>
  <rect x="18" y="22" width="96" height="52" rx="4" fill="url(#onb-stripe)"/>
  <rect x="23" y="27" width="16" height="16" rx="3" fill="#eee"/>
  <text x="31" y="39" text-anchor="middle" font-size="9" font-weight="700" fill="#111" font-family="Segoe UI, sans-serif">1</text>
  <rect x="18" y="64" width="96" height="10" fill="#000" opacity="0.45"/>
  <text x="66" y="71.5" text-anchor="middle" font-size="7" fill="#bbb" font-family="Consolas, monospace">2:39</text>
  <rect x="122" y="22" width="110" height="52" rx="4" fill="#171717" stroke="#2f2f2f"/>
  <rect x="122" y="22" width="110" height="52" rx="4" fill="url(#onb-stripe)"/>
  <rect x="127" y="27" width="16" height="16" rx="3" fill="#eee"/>
  <text x="135" y="39" text-anchor="middle" font-size="9" font-weight="700" fill="#111" font-family="Segoe UI, sans-serif">2</text>
  <rect x="122" y="64" width="110" height="10" fill="#000" opacity="0.45"/>
  <text x="177" y="71.5" text-anchor="middle" font-size="7" fill="#bbb" font-family="Consolas, monospace">2:41</text>
  <rect x="240" y="22" width="82" height="52" rx="4" fill="#171717" stroke="#2f2f2f"/>
  <rect x="240" y="22" width="82" height="52" rx="4" fill="url(#onb-stripe)"/>
  <rect x="245" y="27" width="16" height="16" rx="3" fill="#eee"/>
  <text x="253" y="39" text-anchor="middle" font-size="9" font-weight="700" fill="#111" font-family="Segoe UI, sans-serif">3</text>
  <rect x="240" y="64" width="82" height="10" fill="#000" opacity="0.45"/>
  <text x="281" y="71.5" text-anchor="middle" font-size="7" fill="#bbb" font-family="Consolas, monospace">0:47</text>
  <rect x="236" y="38" width="2" height="20" rx="1" fill="#3ddc97"/>
  <path d="M238 44l5 3-5 3z" fill="#3ddc97"/>
</svg>`;

// Mock of the shared Export Settings panel (three selects + export button).
const VISUAL_EXPORT = `
<svg viewBox="0 0 380 96" fill="none" aria-hidden="true">
  <rect x="70" y="8" width="244" height="80" rx="4" fill="#141414" stroke="#2a2a2a"/>
  <text x="82" y="21" font-size="7" font-weight="700" letter-spacing="1.5" fill="#666" font-family="Segoe UI, sans-serif">EXPORT SETTINGS</text>
  <rect x="82" y="27" width="220" height="15" rx="3" fill="#1d1d1d" stroke="#333"/>
  <text x="90" y="37.5" font-size="8" fill="#aaa" font-family="Segoe UI, sans-serif">MP4 (Video)</text>
  <path d="M288 31l6 6 6-6" stroke="#666" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="82" y="46" width="220" height="15" rx="3" fill="#1d1d1d" stroke="#333"/>
  <text x="90" y="56.5" font-size="8" fill="#aaa" font-family="Segoe UI, sans-serif">10 MB - Discord (Free)</text>
  <path d="M288 50l6 6 6-6" stroke="#666" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="82" y="65" width="220" height="15" rx="3" fill="#1d1d1d" stroke="#333"/>
  <text x="90" y="75.5" font-size="8" fill="#aaa" font-family="Segoe UI, sans-serif">Native</text>
  <path d="M288 69l6 6 6-6" stroke="#666" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="30" y="65" width="30" height="15" rx="3" fill="#2ba87e"/>
  <path d="M40 69v7l6-3.5z" fill="#fff"/>
</svg>`;

// GPU card with an AV1 chip and a "2x quality per MB" badge: the encoding
// step's visual for hardware acceleration + the AV1 codec choice.
const VISUAL_ENCODING = `
<svg viewBox="0 0 380 96" fill="none" aria-hidden="true">
  <rect x="94" y="18" width="190" height="60" rx="6" fill="#141414" stroke="#2a2a2a"/>
  <rect x="94" y="18" width="190" height="60" rx="6" fill="#2ba87e" opacity="0.06"/>
  <rect x="112" y="24" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="128" y="24" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="112" y="68" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="128" y="68" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="240" y="24" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="256" y="24" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="240" y="68" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="256" y="68" width="10" height="4" rx="1" fill="#2f2f2f"/>
  <rect x="150" y="32" width="78" height="32" rx="3" fill="#1d1d1d" stroke="#3ddc97"/>
  <text x="189" y="54" text-anchor="middle" font-size="13" font-weight="700" fill="#3ddc97" font-family="Consolas, monospace">AV1</text>
  <rect x="256" y="46" width="100" height="20" rx="10" fill="#2ba87e"/>
  <text x="306" y="60" text-anchor="middle" font-size="9" font-weight="700" fill="#0d1f1a" font-family="Segoe UI, sans-serif">2x quality per MB</text>
</svg>`;

// A decorative keyboard mock (keycaps only - the labeled list lives in the
// step body, so the same content is never shown twice). The teal-accented
// keys are the ones that set / step trim points.
const VISUAL_SHORTCUTS = `
<svg viewBox="0 0 380 96" fill="none" aria-hidden="true">
  <rect x="34" y="22" width="112" height="18" rx="4" fill="#1d1d1d" stroke="#3a3a3a"/>
  <text x="90" y="36.5" text-anchor="middle" font-size="8" fill="#bbb" font-family="Consolas, monospace">Space</text>
  <rect x="154" y="22" width="30" height="18" rx="4" fill="#161616" stroke="#2ba87e"/>
  <text x="169" y="36.5" text-anchor="middle" font-size="9" fill="#3ddc97" font-family="Consolas, monospace">I</text>
  <rect x="188" y="22" width="30" height="18" rx="4" fill="#161616" stroke="#2ba87e"/>
  <text x="203" y="36.5" text-anchor="middle" font-size="9" fill="#3ddc97" font-family="Consolas, monospace">O</text>
  <rect x="232" y="22" width="54" height="18" rx="4" fill="#1d1d1d" stroke="#3a3a3a"/>
  <text x="259" y="36.5" text-anchor="middle" font-size="8" fill="#bbb" font-family="Consolas, monospace">Home</text>
  <rect x="290" y="22" width="54" height="18" rx="4" fill="#1d1d1d" stroke="#3a3a3a"/>
  <text x="317" y="36.5" text-anchor="middle" font-size="8" fill="#bbb" font-family="Consolas, monospace">End</text>
  <rect x="67" y="54" width="52" height="18" rx="4" fill="#1d1d1d" stroke="#3a3a3a"/>
  <text x="93" y="68.5" text-anchor="middle" font-size="8" fill="#bbb" font-family="Consolas, monospace">Ctrl</text>
  <rect x="127" y="54" width="26" height="18" rx="4" fill="#161616" stroke="#2ba87e"/>
  <text x="140" y="68.5" text-anchor="middle" font-size="10" fill="#3ddc97" font-family="Consolas, monospace">+</text>
  <rect x="161" y="54" width="76" height="18" rx="4" fill="#1d1d1d" stroke="#3a3a3a"/>
  <text x="199" y="68.5" text-anchor="middle" font-size="8" fill="#bbb" font-family="Consolas, monospace">Wheel</text>
  <rect x="245" y="54" width="30" height="18" rx="4" fill="#161616" stroke="#2ba87e"/>
  <text x="260" y="68.5" text-anchor="middle" font-size="10" fill="#3ddc97" font-family="Consolas, monospace">&larr;</text>
  <rect x="283" y="54" width="30" height="18" rx="4" fill="#161616" stroke="#2ba87e"/>
  <text x="298" y="68.5" text-anchor="middle" font-size="10" fill="#3ddc97" font-family="Consolas, monospace">&rarr;</text>
</svg>`;

/** Tour steps: title, body (HTML, may include <kbd>/shortcut chips), visual. */
export const ONBOARDING_STEPS = [
  {
    title: 'Welcome to ClipSend',
    body: 'Trim your videos to the best moments, or merge several clips into one file. Everything runs locally, with no watermarks and nothing uploaded.',
    visual: VISUAL_WELCOME
  },
  {
    title: 'Trim any part of a video',
    body: 'Pull the handles on the timeline to keep only what you want - the teal window is what gets exported. Press <kbd>I</kbd> / <kbd>O</kbd> at the playhead, or enable Multi-Trim to keep several sections.',
    visual: VISUAL_TRIM
  },
  {
    title: 'Merge clips into one video',
    body: 'Add videos and drag the blocks to reorder them. Trim each clip on its own block, and your In / Out ranges carry into the merged export.',
    visual: VISUAL_MERGE
  },
  {
    title: 'Export your way',
    body: 'Pick MP4, GIF, or MP3, cap the size for Discord, or choose a resolution. Loop playback replays your trimmed range before you export.',
    visual: VISUAL_EXPORT
  },
  {
    title: 'Smaller files, better quality',
    body: 'Exports default to H.264 MP4 for maximum compatibility. Switch to AV1 in Settings for roughly double the quality at the same file size - ideal for Discord clips - and pick your GPU encoder: NVIDIA NVENC, Intel QSV, or AMD AMF, all detected automatically. AV1 exports stay in the format you choose (MP4).',
    visual: VISUAL_ENCODING
  },
  {
    title: 'Shortcuts to speed you up',
    body: '<p>Your trim points and frame controls work in both Trim and Merge mode.</p>' +
      '<ul class="onboarding-shortcuts">' +
      '<li><kbd>Space</kbd><span>Play / Pause</span></li>' +
      '<li><kbd>I</kbd> / <kbd>O</kbd><span>Set In / Out point</span></li>' +
      '<li><kbd>Home</kbd> / <kbd>End</kbd><span>Jump to In / Out</span></li>' +
      '<li><kbd>&larr;</kbd> / <kbd>&rarr;</kbd><span>Step one frame</span></li>' +
      '<li><kbd>Ctrl</kbd> + <kbd>Wheel</kbd><span>Zoom timeline</span></li>' +
      '</ul>',
    visual: VISUAL_SHORTCUTS
  }
];

/**
 * Create the onboarding controller.
 *
 * @param {object} context
 * @param {object} context.api - window.clipSend IPC bridge
 * @param {object} context.elements - DOM element references (modal, buttons, step slots)
 * @param {() => void} [context.onCompleted] - fired once when the user finishes or skips the tour
 */
export function createOnboardingController(context) {
  const { api, elements, onCompleted } = context;
  const {
    modal,
    closeBtn,
    skipBtn,
    prevBtn,
    nextBtn,
    dots,
    stepTitle,
    stepBody,
    stepVisual
  } = elements || {};

  let step = 0;
  let seen = false;

  function isOpen() {
    return !!(modal && modal.isConnected && modal.style.display === 'flex');
  }

  /** Persist "tour seen" once so the auto-show never fires again. */
  async function markSeen() {
    if (seen) return;
    seen = true;
    try {
      if (api && api.setSetting) await api.setSetting(SETTING_KEY, true);
    } catch (e) { /* persistence is best-effort */ }
    if (onCompleted) onCompleted();
  }

  function render() {
    const s = ONBOARDING_STEPS[step];
    if (stepTitle) stepTitle.textContent = s.title;
    if (stepBody) stepBody.innerHTML = s.body;
    if (stepVisual) stepVisual.innerHTML = s.visual;
    if (dots) {
      dots.innerHTML = '';
      ONBOARDING_STEPS.forEach((_, i) => {
        const d = document.createElement('span');
        d.className = 'onboarding-dot' + (i === step ? ' active' : '');
        d.setAttribute('aria-hidden', 'true');
        dots.appendChild(d);
      });
    }
    if (prevBtn) prevBtn.disabled = step === 0;
    if (nextBtn) nextBtn.textContent = step === ONBOARDING_STEPS.length - 1 ? 'Get Started' : 'Next';
  }

  function show() {
    if (!modal) return;
    step = 0;
    openModal(modal);
    render();
  }

  function hide() {
    step = 0;
    markSeen();
    closeModal(modal);
  }

  function next() {
    if (step < ONBOARDING_STEPS.length - 1) {
      step++;
      render();
    } else {
      hide(); // finished the tour
    }
  }

  function prev() {
    if (step > 0) {
      step--;
      render();
    }
  }

  closeBtn?.addEventListener('click', () => hide());
  skipBtn?.addEventListener('click', () => hide());
  prevBtn?.addEventListener('click', prev);
  nextBtn?.addEventListener('click', next);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) hide(); // click the backdrop to dismiss
  });

  // Keyboard handling at the document capture phase so we beat the app's
  // global handlers (frame-step arrows, Escape -> closeAllModals) while the
  // tour is open. stopPropagation keeps those from also firing. isConnected
  // guards against stale controllers whose modal was replaced by a DOM reset.
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.stopPropagation();
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.stopPropagation();
      e.preventDefault();
      prev();
    }
  }, true);

  /** Check the first-run flag and auto-show the tour if this is a first launch. */
  async function init() {
    let firstRun = false;
    try {
      const v = api && api.getSetting ? await api.getSetting(SETTING_KEY) : true;
      firstRun = v !== true;
    } catch (e) {
      firstRun = false;
    }
    if (!firstRun) return;
    // Never stack the tour on top of a modal that opened during startup: the
    // check runs again when the timer fires, covering the window between init
    // and the auto-show (e.g. the update prompt arriving first).
    setTimeout(() => {
      const anyModalOpen = Array.from(document.querySelectorAll('.modal-overlay'))
        .some(o => o.style.display === 'flex');
      if (anyModalOpen) return;
      show();
    }, AUTO_SHOW_DELAY_MS);
  }

  return { init, show, hide, isOpen, markSeen, next, prev, getStep: () => step };
}
