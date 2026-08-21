# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop

## Users

Primary user: someone with a gameplay clip (or any video) they want to post on Discord (or Slack), who is annoyed by the multi-step grind of trim, encode settings, bitrate guessing, and size checking that tools like Shutter Encoder and HandBrake require. The app was born from the maintainer's own need. Beyond that, the user is anyone who downloads it; there is no confirmed evidence of a specific audience beyond the maintainer.

## Product Purpose

Cut video down to size in one step. Load a clip, set the trim points, pick a size target (or merge several clips into one), and get a file that fits the upload limit without digging through encoder settings. Success is a file on the clipboard or in the export folder that posts without a "file too large" error.

## Positioning

One-step trim-to-size: the app does the bitrate math, resolution decisions, and encode for you, with presets that match real Discord tiers. The mechanism a neighboring tool cannot truthfully copy is the full pipeline from raw clip to size-capped shareable file with no encoder knowledge required, plus a post-encode size check that re-encodes when the plan overshoots.

## Operating Context

- Runs as a Windows desktop app (Electron, frameless window, tray, close hides to tray). Bundled binaries are `.exe`; CI runs on `windows-latest`.
- Users work with local video files: loading via native file dialog or drag-and-drop, waveform timeline with trim handles, per-clip trims in merge mode, playback in-app, export to a chosen folder.
- Exports are shared to Discord or Slack (or saved/archived locally); the Copy to Clipboard button puts the exported file on the native clipboard for direct paste.
- Target sizes map to real Discord tiers: 20 MB free, 50 MB Nitro Basic, 500 MB Nitro, plus a custom size option. Slack presets are also offered.
- Settings persist locally (electron-store): export directory, volume, hwAccel, codec, quality defaults.

## Capabilities and Constraints

- Windows only. No plan to expand platforms (locked scope).
- Trim single clips, merge multiple clips into one, multi-trim mode (several segments from one file), GIF and MP3 export.
- Size-capped export presets (20/50/500 MB and custom) with automatic bitrate planning, dynamic safety margins, and 1.5% container overhead accounted for.
- Hardware-accelerated encoding where possible (NVENC, QSV, AMF) with CPU fallback; H.264 and AV1 (WebM) codecs; software AV1 decode via bundled libdav1d.
- Post-encode size verification: exports that overshoot the target re-encode at a lower bitrate up to 3 attempts and keep the best result with a warning if it still cannot fit. Merge-mode exports get the same treatment on their post-convert step.
- Everything runs locally with bundled slim FFmpeg/FFprobe/gifski binaries. Media files are never uploaded or transmitted.
- No analytics, no tracking, no advertising, no accounts. Update checks hit GitHub Releases; optional feedback form relays text through a Cloudflare Worker to the maintainer's Discord webhook.
- Free and open source (ISC license), unsigned installer, auto-updater works without a signing certificate.
- No monetization or paid tier planned (locked scope).

## Brand Commitments

- Name: ClipSend (repo `Ayinaki/ClipSend`; npm package name `video-compressor`, current version 2.2.5).
- Voice: plain, human, maintainer's voice. Project policy (AGENTS.md and the README writing pass) bans AI-slop copy: no em dashes, no stock AI vocabulary, no hype, no fabricated numbers.
- Free and open source: ISC license, Copyright (c) 2026 Ayinaki.
- Privacy is a selling point and a commitment: local processing only, nothing uploaded, stated in PRIVACY.md.
- UI follows Windows-native conventions: frameless window with custom title bar, tray integration, Segoe MDL2 icon fonts, dark theme by default with a light theme variant.

## Evidence on Hand

- README.md documents features and workflows; `docs/screenshots/` holds real UI screenshots (trim dark, merge, light theme).
- PRIVACY.md states the data-handling commitments.
- AGENTS.md documents architecture and conventions (renderer/preload/main layers, export pipeline, testing).
- No user testimonials, download counts, star counts, or case studies exist. Future work must not fabricate them.

## Product Principles

- One step from clip to share-ready file: no encoder settings, no bitrate guessing, no post-encode surprises.
- Local first: all processing on-device, nothing uploaded, no accounts.
- Honest and plain: human copy, real facts, real presets, no hype.
- Conservative size planning with verification: plan safely, then check the actual output and re-encode if it overshoots.
- Keep Windows-native behavior: drag-and-drop, clipboard, tray, keyboard shortcuts, familiar controls.

## Accessibility & Inclusion

- Keyboard shortcuts exist and are surfaced in-app (Help button). No formal accessibility standard has been established; Windows-native expectations apply.
