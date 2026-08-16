# AGENTS.md — ClipSend

Guidance for AI coding agents (and humans) working in this repository.

## What this project is

**ClipSend** is a Windows desktop app (Electron) for rapidly preparing and sharing video clips:
trimming single files, merging multiple clips, and exporting to size-capped targets (Discord/Slack
presets: 20 MB, 50 MB, 500 MB) or to GIF/MP3. Exports are hardware-accelerated when possible
(NVENC / QSV / AMF) with CPU fallback, and H.264 or AV1 codecs are supported. See `README.md`
for the full feature description.

- Repo: `Ayinaki/ClipSend` (package name: `video-compressor`, version 2.2.3)
- **Windows-only target.** Bundled binaries are `.exe` files; CI runs on `windows-latest`.
- Plain JavaScript everywhere. **No TypeScript**, no framework, no bundler for the main process.

## Commands

```bash
npm start                 # build renderer bundle, then launch Electron
npm run build:renderer    # esbuild: renderer/app.js -> renderer/dist/app.bundle.js (ESM) + .cjs
npm test                  # build:renderer, then jest (unit tests only)
npm run build             # build:renderer, then electron-builder (--win) -> dist/
```

No linter or formatter is configured. The codebase is heavily commented — keep that style:
comments explain *why*, not *what*.

## Architecture

Three layers, strictly separated by Electron security boundaries:

```
renderer/  (ESM, browser sandbox, contextIsolation: true, nodeIntegration: false)
   |  window.clipSend.* (contextBridge API, see preload.js)
   v
preload.js (contextBridge: the ONLY bridge between renderer and main)
   |
   v
main/      (CommonJS, Node.js + Electron APIs)
```

- **Renderer** (`renderer/`): vanilla JS modules, HTML5 Canvas timeline, pure CSS.
  `app.js` (≈2750 lines) is the orchestrator — mode switching, drag-and-drop, export flow.
  Other modules: `timeline.js`, `control-bar.js`, `video-preview.js`, `merge-player.js`,
  `crop-manager.js`, `titlebar.js`, `settings.js`, `onboarding.js`, `export-flow.js`,
  `changelog-data.js`; utilities in `renderer/utils/` (`modals.js`, `timecode.js`, `toast.js`).
  Renderer sources are **ESM** (`import`/`export`) and run unbundled in the browser via
  `<script type="module">`; esbuild bundles them only for tests and packaging.
- **Preload** (`preload.js`): exposes `window.clipSend` with one function per IPC channel.
  If you add an IPC channel, add it here AND in `main/ipc-handlers.js`. Naming convention:
  `domain:action` (e.g. `export:start`, `merge:export`, `settings:get`).
- **Main** (`main/`): all Node/FFmpeg work. Key modules:
  - `main.js` — app entry: window creation, frameless window, tray (close hides to tray),
    window-state persistence, media-key disabling.
  - `ipc-handlers.js` — **every** `ipcMain.handle` lives here. Also owns the shared
    `electron-store` instance (settings keys like `hwAccel`, `videoCodec`,
    `defaultExportDirectory`, `maxQuality`).
  - `export-planner.js` — pure computation (no I/O): bitrate math, resolution downscale
    decisions, FFmpeg arg arrays. Exposes `_internals` for unit tests.
  - `encoder-profiles.js` — single source of truth for encoder names (nvenc/qsv/amf/cpu,
    h264/av1), per-encoder FFmpeg arg builders, capability detection via `ffmpeg -encoders`.
  - `encoder.js` — `Encoder` class: spawns FFmpeg for trim exports, 2-pass or single-pass.
  - `merger.js` — `Merger` class: merge exports. Lossless `concat` demuxer fast path when
    clips match codecs/res/fps; `concat` filter re-encode fallback otherwise; per-clip trim
    pre-encode; `postConvertMerged` for format/resolution/size post-processing.
  - `gif-exporter.js` — GIF path: FFmpeg y4m extraction → gifski "descension loop"
    (iteratively lowers fps/scale/quality up to 8 attempts to hit the size target).
  - `probe-service.js` — ffprobe wrapper producing `mediaInfo` (dims, fps, VFR flag,
    `videoDuration`, `audioTracks[]` with `audioOrdinal`); merge-clip thumbnails.
  - `waveform-service.js` / `waveform-worker.js` — waveform peaks via worker_threads,
    bounded LRU cache.
  - `updater.js` — electron-updater wrapper (see its header comment: prior hand-rolled
    updater was fragile; keep electron-updater).
  - `presets.js`, `taskbar.js`, `tray.js`, `window-state.js`, `file-manager.js` — small
    support modules. `window-state.js` uses a **separate** electron-store (`window-state`)
    because conf stores clobber each other — don't merge stores.

**Bundled binaries** (`bin/`): `ffmpeg.exe`, `ffprobe.exe`, `gifski.exe` (gitignored).
Main-process modules resolve them relative to `__dirname` and swap `app.asar` →
`app.asar.unpacked` in packaged builds (electron-builder unpacks `bin/**`). Keep that
pattern in any new module that spawns FFmpeg.

## The export pipeline (the heart of the app)

1. Renderer probes the file → `probe-service` returns `mediaInfo`.
2. Renderer calls `export:calculatePlan` → `export-planner.calculatePlan(mediaInfo, trimIn,
   trimOut, settings)` returns a plan: bitrate budget (size-limit mode with dynamic safety
   margin + 1.5% muxing overhead), quality-floor resolution table, warnings, and exact
   FFmpeg arg arrays (`pass1Args`/`pass2Args` or `singlePassArgs`).
3. Renderer calls `export:start` → `Encoder.runEncode` spawns FFmpeg (2-pass CPU or
   single-pass hardware/GIF/MP3), parses stderr `time=` progress, cleans up pass logs and
   partial output. Multi-segment trim-mode exports pre-encode each segment to
   `clipsend-seg-*` temp MP4s, then merge via `merge:export` with `skipConvert: true`.
4. Hardware encoder init failures are detected from stderr patterns
   (`HW_ENCODER_FAILURE_PATTERNS` in ipc-handlers.js) → renderer retries the whole export
   with `hwAccel: 'cpu'`.

Two-pass on Windows gotcha (applies to `encoder.js` and `merger.postConvertMerged`): pass
logs must use a **relative** `-passlogfile` name with the child process `cwd` set to the
output directory — absolute Windows backslash paths break x264's pass 2. Preserve this.

## Testing

- Jest, no mocks required for pure modules. `npm test` builds the renderer bundle first.
- Main-process tests live in `test/*.test.js` (plain `require`).
- Renderer tests live in `test/renderer/*.test.js`; jest transforms renderer ESM sources to
  CJS via esbuild (`test/renderer/esbuild-transform.js`). The renderer bundle
  (`renderer/dist/`) is exercised by `smoke.bundle.test.js`.
- Pure/computable logic is deliberately isolated (e.g. `export-planner._internals`,
  `merger.normalizeTrimPlan`, `window-state.isOnAnyDisplay`) so it can be tested without
  spawning FFmpeg. Keep new testable logic pure and export internals when useful.
- Tests must not rely on Electron APIs at runtime (modules guard for that, e.g. `updater.js`
  requires electron-updater lazily, `taskbar.js` no-ops without Electron).
- jsdom's `document.documentElement.innerHTML = html` does not run `<script src>` tags, so
  `window.changelogData` is undefined in `smoke.bundle.test.js` and `renderChangelog()` no-ops.
  The changelog timeline is never actually rendered by any test.

## Conventions & gotchas

- **Renderer ESM, main CJS.** Don't mix them. New renderer files: `import`/`export`.
  New main files: `require`/`module.exports`.
- Windows-first code: `NUL` (not `/dev/null`), `\\` path handling, `ffmpeg.exe`.
- Progress is reported as `(percent, statusString)` and throttled (encoder: ≥200 ms or ≥1%
  change; ipc-handlers wraps with `createProgressThrottler`). Negative percent = indeterminate
  taskbar state (used by the GIF descension loop).
- Cancellation: `Encoder.cancel()` / `Merger.cancel()` / `gifExporter.cancel()` set a flag and
  SIGKILL the child process. Temp files (`clipsend-*`, thumbnails, preview remuxes) are
  registered before use and cleaned up on success, failure, AND cancel — extend this pattern.
- Errors surface through the in-app error modal (`showErrorDialog`), never `window.alert()`
  (native modals wedge frameless Electron windows). FFmpeg failures attach
  `err.ffmpegStderr` + translated `details` (`translateFfmpegError` in encoder.js).
- Drag-and-drop file paths require `webUtils.getPathForFile` (via preload) — `.path` is
  stripped under contextIsolation.
- The renderer hardcodes presets to match `main/presets.js` (`SIZE_PRESETS`) — keep in sync.
- `app.js` dispatches `window.resize` on mode switch back to Trim (canvas re-measure workaround).
- User-facing copy must read human, not AI-generated: no em dashes, no stock AI vocabulary,
  no filler. "De-slop" / "fix the writing" requests mean apply the `anti-slop-writing` skill.
- Open external URLs through `window.clipSend.openExternalUrl` (`shell:openExternal`), never by
  navigating the app window (an `<a href>` click or `window.location`): the frameless window
  has no back/chrome, so a navigation strands the user.
- `renderer/changelog-data.js` breaks the renderer-ESM rule: a plain `<script src>` in
  `index.html` that sets `window.changelogData` (plus a `module.exports` guard). It is not
  esbuild-bundled; validate with `node --check`, never `require` it in Node (`window` undefined).
- Untracked workspace dirs `.freebuff/`, `.agents/`, `skills-lock.json` are agent tooling,
  not app code — leave them alone.

## CI / Release

`.github/workflows/`:

- `build-ffmpeg.yml` — builds the **slim FFmpeg** (~30 MB vs ~196 MB gyan builds) and uploads
  the `ffmpeg-minimal-win64` artifact. Any FFmpeg component the app needs (encoders, muxers,
  decoders like `libdav1d` for software AV1 decode, filters like palettegen) must be enabled
  in `scripts/build-ffmpeg.sh`; the app ships a minimal build, not a full FFmpeg.
- `build.yml` — CI on push/PR to `main`: fetches the slim FFmpeg artifact (falls back to
  gyan builds), verifies `libdav1d` presence, `npm test`, `npm run build`.
- `release.yml` — on `v*` tags: same checks, then publishes the installer + `latest.yml` +
  blockmap to a GitHub Release (electron-updater source).

Releases: bump `version` in `package.json` (and the changelog in
`renderer/changelog-data.js`), tag `vX.Y.Z`. Installer signing is handled via SignPath —
see `CODE_SIGNING.md`.

## Feedback service

`serverless/` contains a Cloudflare Worker (`feedback-worker.js`, `wrangler.toml`) that
proxies in-app feedback to a Discord webhook. The worker URL is hardcoded in
`ipc-handlers.js` (`FEEDBACK_PROXY_URL`); the webhook secret lives only on the worker.
