# ClipSend

## App Overview
ClipSend is a lightweight, responsive desktop application designed for quickly preparing and sharing video clips. Built with Electron, it focuses on rapid video trimming, multi-clip merging, and highly optimized hardware-accelerated exports tailored for sharing directly into chat applications like Discord and Slack.

## Tech Stack
- **Framework:** Electron (Target Platform: Windows)
- **Frontend UI:** Vanilla JavaScript, HTML5 Canvas (for timeline rendering), and pure CSS
- **Backend/Processing:** Node.js, FFmpeg & FFprobe (bundled binaries)
- **Settings Persistence:** `electron-store`

## Features

### Trim Mode
Trim Mode allows users to load a single video file, set precise in and out points, and quickly export a compressed, trimmed clip.
- **File Loading:** Supports both native file dialog selection and dragging/dropping a file directly onto the window.
- **Timeline:** A custom `<canvas>`-based interactive timeline with visual waveform/thumbnail support, draggable in/out trim handles, and a playhead synchronized with the `<video>` element.
- **Audio Controls:** Extracts and allows selection of specific audio tracks from multi-track videos, as well as a mute toggle and volume slider that persist across sessions.
- **Export Estimation:** A "Calculate Plan" function computes expected target file size and bitrate based on the chosen preset, displaying a clean estimation panel prior to export.
- **Copy to Clipboard:** Upon successful Trim Mode export, a "Copy to Clipboard" button is available. This uses native Windows `CF_HDROP` clipboard formatting (via PowerShell's `Set-Clipboard`) to copy the *actual exported file* to the clipboard, allowing instant pasting into Discord, Slack, or Windows Explorer as an attachment.
- **Transport Bar:** Unified flat styling for playback controls (Play/Pause, Step Frame, Jump to Marker, Set Marker), utilizing Segoe MDL2 icon fonts.

### Merge Mode
Merge Mode allows users to select multiple video clips, arrange them in sequence, and stitch them together into a single continuous video.
- **Multi-clip Loading:** Supports adding multiple clips simultaneously via the "Add Clips" dialog or by drag-and-dropping multiple files onto the stage or the Clip List sidebar.
- **Clip List Panel:** A visual sidebar showing all loaded clips, allowing users to reorder clips intuitively via native HTML5 Drag and Drop.
- **Proportional Timeline:** The timeline scrubber visually represents the stitched video, drawing segments proportional to each clip's duration. Extremely short clips are enforced a minimum visual width (in pixels) to ensure they remain clickable and discoverable, with a non-linear mapping system keeping the playhead accurate.
- **Per-Clip Trimming:** Each clip in the merge timeline can be trimmed independently — drag the amber trim handles on a block, or select a clip and use the Set In / Set Out / Jump transport buttons. Trimmed-away regions are dimmed, blocks scale to their trimmed length, and the preview player honors the trims during playback and scrubbing.
- **Continuous Playback:** Smoothly swaps the video source during playback as the playhead crosses clip boundaries. Volume and mute states persist seamlessly across clip transitions.

### Mode Switching
- ClipSend allows switching back and forth between Trim Mode and Merge Mode without losing any state.
- **Implementation Detail:** When returning to Trim Mode, the UI forces a `window.resize` event dispatch. This is required because HTML5 `<canvas>` elements lose their dimensional context and render blank after being hidden via `display: none`; the resize event triggers a safe re-measure and repaint of the timeline using the preserved in-memory state.

### Drag-and-Drop System
ClipSend supports dragging and dropping files from the OS directly into the app.
- **Path Resolution:** Because the app runs with modern Electron security settings (`contextIsolation: true`), the `.path` property on standard DOM `File` objects is stripped for security reasons. ClipSend uses the Electron 32+ `webUtils.getPathForFile(file)` API, exposed securely via `preload.js`, to resolve the actual absolute file path of dropped files without compromising context isolation.

### Export Pipeline
The export system relies heavily on FFmpeg, governed by a multi-step planning and execution pipeline.
- **Planning (`export-planner.js`):** Calculates the exact video bitrate needed to hit the target file size (e.g. 8MB or 25MB for Discord), applying a 5% safety margin and accounting for audio track size and 1.5% muxing overhead. Generates the exact FFmpeg argument array.
- **Hardware Acceleration (`encoder-profiles.js`, `encoder.js` & `merger.js`):** Supports NVIDIA NVENC (`h264_nvenc`), Intel QSV (`h264_qsv`), and AMD AMF (`h264_amf`) — all detected automatically from the bundled FFmpeg and selectable in Settings. The pipeline adjusts rate-control per encoder (e.g. `-rc vbr`/`-maxrate` for size-targeted hardware exports instead of the 2-pass ABR used by CPU encoders).
- **AV1 Exports:** A Video Codec setting switches exports from H.264 to AV1 — roughly double the quality at the same byte budget, great for Discord. AV1 muxes into the format you pick (MP4 with AAC audio, since the app's format selector is MP4/GIF/MP3). AV1 uses SVT-AV1 (2-pass for size targets) on CPU, or the GPU's AV1 encoder (`av1_nvenc` / `av1_qsv` / `av1_amf`) when available.
- **Merge Fallback (`merger.js`):** When exporting merged clips, the pipeline attempts a lossless fast path (`concat` demuxer with `-c copy`) if all clips share identical video/audio codecs, resolutions, and framerates. If they differ, it falls back to a complex re-encode using the `concat` filter to normalize all clips to the first clip's parameters, automatically utilizing NVENC if configured.
- **Merge Trimming (`merger.js`):** When any clip has a trim range, that clip is first re-encoded to a uniform temporary file (accurate `-ss`/`-t` trim, h264/aac, NVENC or CPU) before the concat step, so the merged output contains exactly the selected sections. Untouched clips keep the original files, and all temp files are cleaned up automatically. Progress is weighted across the trim + concat phases.

## Architecture Notes
- **Process Communication:** The application maintains strict isolation. The UI (`renderer/`) communicates with the Node.js backend (`main/`) exclusively via asynchronous IPC invocations defined in `preload.js` and handled in `ipc-handlers.js`.
- **FFmpeg Execution:** `Encoder` and `Merger` classes wrap the native Node.js `child_process.spawn`, parsing stderr text streams in real-time to extract timecode progress updates. 
- **Two-Pass Path Workaround:** FFmpeg/x264 on Windows suffers from a long-standing bug where it fails to interpret backslashes correctly in the pass logfile path. ClipSend bypasses this by setting the Node child process `cwd` to the target output directory and using a relative filename (`ffmpeg2pass-0.log`) for the pass logs.

## Code Signing & Privacy

ClipSend's Windows installer is code-signed for release builds.

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- [Code Signing Policy](CODE_SIGNING.md)
- [Privacy Policy](PRIVACY.md)

## Known Limitations / Future Work
- **Hardware Acceleration Fallback:** The export pipeline detects hardware encoder initialization failures (e.g. out of VRAM, missing drivers, or an unsupported GPU generation) and falls back gracefully to the matching CPU encoder (`libx264` for H.264, `libsvtav1` for AV1).
- **Single-Pass Hardware Encoder Restriction:** FFmpeg's hardware encoders (NVENC/QSV/AMF) do not support traditional 2-pass encoding, so size-targeted hardware exports use single-pass VBR. Hitting exact file size targets is slightly less accurate than the CPU 2-pass path; the CPU 2-pass path is always available by selecting CPU in Settings.
- **Hardware AV1 requires newer GPUs:** AV1 hardware encoding needs an RTX 40-series (or newer) GPU, an Intel Arc / 12th-gen+ iGPU, or an AMD Radeon RX 6000-series (or newer) GPU. On older GPUs the app automatically uses software SVT-AV1 instead, which is slower but produces the same file format.
