# ClipSend

## App Overview
ClipSend is a Windows desktop app for cutting video down to size: trim a single clip, merge several into one, and export to fit Discord's 20 MB free tier, 50 MB Nitro Basic, or 500 MB Nitro. Exports are GPU-accelerated where possible (NVENC, QSV, AMF), fall back to the CPU otherwise, and use H.264 or AV1.

<p align="center">
  <img src="docs/screenshots/trim-dark.png" alt="ClipSend Trim mode with the export plan in the title bar" width="70%">
</p>

## Tech Stack
- **Framework:** Electron (Target Platform: Windows)
- **Frontend UI:** Vanilla JavaScript, HTML5 Canvas (for timeline rendering), and pure CSS
- **Backend/Processing:** Node.js, FFmpeg & FFprobe (bundled binaries)
- **Settings Persistence:** `electron-store`

## Features

### Trim Mode
Trim Mode loads one video, lets you set in and out points, and exports a compressed clip of just that section.
- **File Loading:** Supports both native file dialog selection and dragging/dropping a file directly onto the window.
- **Open Recent:** The Choose File panel keeps your last ten files. Pick one to reload it, and remove entries you are done with. Files that no longer exist drop off the list on their own. Each entry remembers the trim, preset, format, resolution and speed you last used on that file, so reopening it resumes your edit instead of starting over.
- **Timeline:** A custom `<canvas>`-based interactive timeline with visual waveform/thumbnail support, draggable in/out trim handles, and a playhead synchronized with the `<video>` element.
- **Audio Controls:** Pick a specific audio track from a multi-track video, or mute it and adjust volume. The choices persist across sessions.
- **Export Estimation:** The size, bitrate and resolution readout recalculates on its own as you move the trim handles or change any export setting, so there is no button to press before you know what the export will cost. The Recalculate button forces a refresh.
- **Tighten:** One button trims the silent lead-in and tail of a clip. It reuses the waveform's audio analysis, applies the result as ordinary trim points, and is undoable.
- **Trim to Fit:** When a clip is too long for the selected target size, the refusal explains the problem and offers a button that trims the clip to the longest length that does fit.
- **Copy to Clipboard:** After a Trim Mode export, a Copy to Clipboard button puts the exported file itself on the clipboard (native Windows `CF_HDROP` via PowerShell's `Set-Clipboard`), so you can paste it straight into Discord, Slack, or Windows Explorer.
- **Transport Bar:** Unified flat styling for the playback controls (Play/Pause, Step Frame, Jump to Marker, Set Marker), using Segoe MDL2 icon fonts.

### Merge Mode
Merge Mode takes several clips, arranges them in order, and stitches them into one video.
- **Multi-clip Loading:** Add several clips at once through the Add Clips dialog, or drop multiple files onto the stage or the Clip List sidebar.
- **Clip List Panel:** A visual sidebar of all loaded clips. Reorder clips with native HTML5 drag and drop.
- **Proportional Timeline:** The timeline scrubber draws segments proportional to each clip's duration. Very short clips get a minimum visual width so they stay clickable, with a non-linear mapping that keeps the playhead accurate.
- **Per-Clip Trimming:** Trim each clip in the merge timeline independently. Drag the amber handles on a block, or select a clip and use the Set In / Set Out / Jump transport buttons. Cut-away regions are dimmed, blocks scale to their trimmed length, and the preview player honors the trims during playback and scrubbing.
- **Continuous Playback:** The video source swaps as the playhead crosses clip boundaries. Volume and mute states carry over from clip to clip.
- **Playback Speed:** The merge transport has its own speed dropdown, sharing one value with the Trim transport. It previews the merge at that speed and retimes the export to match. The lossless `concat` copy path cannot retime or overlay, so any speed other than 1x re-encodes (the export modal names the reason).

### Mode Switching
- Switch between Trim Mode and Merge Mode without losing any state.
- **Implementation Detail:** When returning to Trim Mode, the UI forces a `window.resize` event dispatch. This is required because HTML5 `<canvas>` elements lose their dimensional context and render blank after being hidden via `display: none`; the resize event triggers a safe re-measure and repaint of the timeline using the preserved in-memory state.

### Watermark
A shared panel burns a logo into Trim and Merge exports.
- **Placement:** Choose a PNG or JPG, then a corner, a size from 5% to 50% of the output width, and an opacity from 10% to 100%. The preview draws the logo in the corner it will occupy in the export, and follows the crop when cropping is on.
- **Opacity Is Baked Before Encoding:** The bundled FFmpeg is a minimal build that ships `overlay` but no alpha-scaling filter, so the renderer applies the opacity to the image on a canvas and writes a temp PNG before the encode starts. That baked copy is cached and reused across segments, retries, and re-plans. Changing the image or opacity invalidates it.
- **Merge Exports:** The logo is overlaid after the clips are joined, so it lands on the final frame. As with playback speed, a watermark rules out the lossless merge fast path.
- **Availability:** Watermarks are hidden if the bundled FFmpeg has no `overlay` filter. The app probes for it at startup alongside the encoders.

### Drag-and-Drop System
ClipSend supports dragging and dropping files from the OS directly into the app.
- **Path Resolution:** Under `contextIsolation: true`, the `.path` property on DOM `File` objects is stripped. ClipSend uses the Electron 32+ `webUtils.getPathForFile(file)` API, exposed through `preload.js`, to get the real absolute path of a dropped file.

### Export Pipeline
Every export runs on the bundled FFmpeg. A planning step first works out the encode (bitrate, resolution, encoder, exact arguments), then the encode runs and reports progress.
- **Planning (`export-planner.js`):** Works out the video bitrate that lands under the chosen size cap. It keeps a safety margin below the limit (tighter for short clips, where keyframe overhead eats a bigger share), sets aside 1.5% for the container, subtracts the audio bitrate, and produces the exact FFmpeg arguments.
- **Hardware Acceleration (`encoder-profiles.js`, `encoder.js` & `merger.js`):** NVIDIA NVENC (`h264_nvenc`), Intel QSV (`h264_qsv`), and AMD AMF (`h264_amf`) are detected from the bundled FFmpeg and selectable in Settings. Rate control is adjusted per encoder (`-rc vbr`/`-maxrate` for size-targeted hardware exports instead of the 2-pass ABR used by CPU encoders).
- **AV1 Exports:** A Video Codec setting switches exports from H.264 to AV1, roughly double the quality at the same file size. AV1 muxes into the format you pick (MP4 with AAC audio, or WebM with Opus), using SVT-AV1 (2-pass for size targets) on CPU or the GPU's AV1 encoder (`av1_nvenc` / `av1_qsv` / `av1_amf`) when available.
- **WebM Exports:** The format picker includes WebM for web-friendly sharing (Slack, HTML5 embeds, browsers). WebM cannot contain H.264, so picking WebM with the H.264 codec setting exports VP9 (`libvpx-vp9`, software, 2-pass for size targets) with Opus audio; the AV1 setting exports AV1-in-WebM and keeps the hardware AV1 encoders. VP9 has no hardware encoder in this app, so WebM+H.264 exports run on the CPU (a plan warning calls this out).
- **Merge Fallback (`merger.js`):** When exporting merged clips, the pipeline tries a lossless fast path (`concat` demuxer with `-c copy`) if all clips share the same codecs, resolution, and framerate. If they differ, it falls back to a re-encode with the `concat` filter, normalizing every clip to the first clip's parameters and using NVENC when configured.
- **Merge Trimming (`merger.js`):** When any clip has a trim range, that clip is first re-encoded to a uniform temporary file (accurate `-ss`/`-t` trim, h264/aac, NVENC or CPU) before the concat step, so the merged output contains exactly the selected sections. Untouched clips keep the original files, and all temp files are cleaned up automatically. Progress is weighted across the trim + concat phases.
- **Free Space Check (`ipc-handlers.js`):** Before FFmpeg spawns, the export works out the worst case it needs on the target drive (the output itself, GIF raw-frame extraction, multi-trim segment temps, a merge intermediate, and the 2-pass stats log) and compares that against the free space the drive reports. A shortfall stops the export with one message naming both numbers, instead of a failure partway through the write.
- **Playback Speed (`export-planner.js` & `merger.js`):** A speed other than 1x retimes the video with `setpts` and the audio with a chained `atempo`, and the size budget follows the output duration, so a sped-up export gets more bitrate for the same file size.
- **Export Audio (`export-planner.js` & `merger.js`):** The transport volume slider and mute button reach the file, not just the preview. Muting (`-an`) writes no audio stream at all and drops the audio share of a size budget; a volume below 100 percent encodes the gain with FFmpeg's `volume` filter. Both force the merge re-encode path, since a lossless copy can neither gain-scale nor drop a stream.
- **Waveform Cache (`waveform-service.js`):** Peaks are cached in memory and on disk (under the app's user data, keyed by path, size and modified time), so reopening a clip you have worked on before draws its waveform without decoding the audio again.
- **Diagnostics (`diagnostics.js`):** Settings can write a plain-text support report (versions, detected encoders, settings, the update log, the last export error). It is generated locally and never uploaded.

<p align="center">
  <img src="docs/screenshots/merge-dark.png" alt="ClipSend Merge mode with per-clip trims" width="70%">
</p>

## Themes

ClipSend follows your Windows theme, with a dark and a light variant for every screen.

<p align="center">
  <img src="docs/screenshots/trim-light.png" alt="ClipSend in light theme" width="70%">
</p>

## Architecture Notes
- **Process Communication:** The application maintains strict isolation. The UI (`renderer/`) communicates with the Node.js backend (`main/`) exclusively via asynchronous IPC invocations defined in `preload.js` and handled in `ipc-handlers.js`.
- **FFmpeg Execution:** `Encoder` and `Merger` classes wrap the native Node.js `child_process.spawn`, parsing stderr text streams in real-time to extract timecode progress updates.
- **Two-Pass Path Workaround:** FFmpeg/x264 on Windows suffers from a long-standing bug where it fails to interpret backslashes correctly in the pass logfile path. ClipSend bypasses this by setting the Node child process `cwd` to the target output directory and using a relative filename (`ffmpeg2pass-0.log`) for the pass logs.

## Privacy & Updates

ClipSend's installer is unsigned, so Windows SmartScreen may show an "unrecognized publisher" warning when you install or update. Click More info, then Run anyway. The auto-updater works without a signing certificate.

- [Privacy Policy](PRIVACY.md)

## Known Limitations / Future Work
- **Hardware Acceleration Fallback:** The export pipeline detects hardware encoder initialization failures (e.g. out of VRAM, missing drivers, or an unsupported GPU generation) and falls back gracefully to the matching CPU encoder (`libx264` for H.264, `libsvtav1` for AV1).
- **Single-Pass Hardware Encoder Restriction:** FFmpeg's hardware encoders (NVENC/QSV/AMF) do not support traditional 2-pass encoding, so size-targeted hardware exports use single-pass VBR. Hitting exact file size targets is slightly less accurate than the CPU 2-pass path; the CPU 2-pass path is always available by selecting CPU in Settings.
- **Hardware AV1 requires newer GPUs:** AV1 hardware encoding needs an RTX 40-series (or newer) GPU, an Intel Arc / 12th-gen+ iGPU, or an AMD Radeon RX 6000-series (or newer) GPU. On older GPUs the app automatically uses software SVT-AV1 instead, which is slower but produces the same file format.
