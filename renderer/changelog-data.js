window.changelogData = [
  {
    "version": "v1.6.3: Duplicate Draft Release Elimination",
    "date": "July 2026",
    "changes": [
      "Fix: Added --publish never to build script to prevent electron-builder from creating duplicate draft releases on GitHub."
    ]
  },
  {
    "version": "v1.6.2: Auto-Updater Modal & Public Release Publishing Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Resolved HTML modal nesting issue preventing the update modal dialog from displaying when clicking the titlebar update badge.",
      "Fix: Configured GitHub release workflow to publish non-draft releases automatically for instant API visibility."
    ]
  },
  {
    "version": "v1.6.1: Direct GitHub Issues & Template Integration",
    "date": "July 2026",
    "changes": [
      "Feature: Added direct 'Create GitHub Issue' option in the feedback modal for bug reports and feature requests.",
      "Feature: Added structured GitHub Issue templates (.github/ISSUE_TEMPLATE) for Bug Reports and Feature Requests."
    ]
  },
  {
    "version": "v1.6.0: Automated GitHub Auto-Updater",
    "date": "July 2026",
    "changes": [
      "Feature: Introduced automated GitHub Release auto-updates with background version checking.",
      "Feature: Added titlebar update badge and modal displaying release notes, live download progress, and silent installation."
    ]
  },
  {
    "version": "v1.5.6: Automated Native PNG-to-ICO Packaging Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Configured electron-builder to automatically convert high-resolution icon.png into native 32-bit ARGB Windows executable icons during build."
    ]
  },
  {
    "version": "v1.5.5: Medium Clip Safety Margin Refinement",
    "date": "July 2026",
    "changes": [
      "Fix: Expanded short-to-medium clip safety margin curve (up to 10s duration) to ensure clips between 5s–10s stay strictly under target file size caps."
    ]
  },
  {
    "version": "v1.5.4: Short Clip Target Size & VBV Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Implemented dynamic safety margins for ultra-short video clips (< 5s) to compensate for keyframe/IDR overhead.",
      "Fix: Enforced VBV rate-control constraints (-maxrate & -bufsize) on 2-pass libx264 exports to eliminate file size overshoots on short clips.",
      "Fix: Capped maximum video bitrate ceiling to 25 Mbps to prevent rate controller saturation."
    ]
  },
  {
    "version": "v1.5.3: True 32-bit ARGB Windows Icon Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Replaced low-color palettized ICO format with a crisp, multi-resolution 32-bit ARGB icon containing 256x256, 128x128, 64x64, 48x48, 32x32, and 16x16 alpha-transparent icon layers."
    ]
  },
  {
    "version": "v1.5.2: CI Test Execution & Stdin Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Added -nostdin and -y to FFmpeg arguments in waveform-service to prevent child processes from hanging on unclosed stdio streams during CI automated testing."
    ]
  },
  {
    "version": "v1.5.1: Windows App Icon Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Added high-resolution Windows app icon (icon.ico) and un-ignored build assets directory so installer and executable display custom ClipSend branding."
    ]
  },
  {
    "version": "v1.5.0: Performance & Stability Refactor",
    "date": "July 2026",
    "changes": [
      "Feature: Implemented streaming bucket waveform extraction, reducing RAM usage during waveform generation by 98%+.",
      "Feature: Added zero-copy TypedArray IPC transmission for instant waveform rendering.",
      "Feature: Added a 5MB / 50-entry bounded LRU cache for waveforms with automatic eviction.",
      "Feature: Added bounded parallel clip probing (concurrency limit = 3) and probe caching in Merge Mode.",
      "Feature: Implemented rolling 16KB stderr window and cross-chunk timecode parsing in FFmpeg processes.",
      "Feature: Converted file system operations to non-blocking fs.promises to eliminate main thread UI freezes.",
      "Feature: Added automated GitHub Actions CI build and release pipelines."
    ]
  },
  {
    "version": "Phase 10: GIF Export & App Branding",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: Introduced GIF export as a new Output Format option, powered by gifski for high-quality palette-based encoding.",
      "Feature: Implemented an FFmpeg-to-gifski pipeline using an intermediate YUV4MPEG2 (y4m) raw video handoff, reusing the existing crop, resolution override, and multi-segment concat logic ahead of the GIF encode step.",
      "Feature: Added an iterative \"descension loop\" to hit target file size constraints for GIF exports, automatically stepping down frame rate, then resolution, then quality across up to 8 attempts, with a graceful best-effort fallback and warning if the target size can't be reached.",
      "Feature: Added a pre-flight feasibility warning that flags GIF exports likely to fail a target size (e.g. long clips targeting small Discord size presets) before the export begins.",
      "Feature: Added a disk space guardrail that blocks or warns against y4m extraction when estimated uncompressed temp file size would be excessive.",
      "Feature: Added indeterminate \"Encoding GIF (Attempt X)...\" progress reporting in the title bar for the GIF export phase, replacing the standard percentage bar during the descension loop.",
      "Feature: Disabled/hid Audio Track and Mute controls when GIF output is selected, since GIF files cannot contain audio.",
      "Feature: Relocated the \"Max Quality\" toggle from the Export Settings sidebar into the Settings modal, and made its state persistent across app restarts via electron-store, defaulting to ON.",
      "Feature: Added the current app version number next to the app title in the title bar, styled small and muted.",
      "Fix: Resolved a \"w.startsWith is not a function\"-style regression in the Duration/In/Out readout, caused by app.js still listening for deprecated single-segment trim callbacks instead of the unified multi-segment onSegmentChange event, which meant dragging trim handles no longer updated the displayed values.",
      "Fix: Resolved a GIF export failure (\"FFmpeg exited with code 3199971767\" / AVERROR_INVALIDDATA) caused by the y4m extraction pass forcing an incompatible pixel format on certain 10-bit/HDR source files.",
      "Fix: Resolved odd-dimension crop values being passed into the y4m extraction step, which violated YUV4MPEG2's strict even-dimension requirement.",
      "Fix: Resolved a codec/container mismatch where an incorrectly nested conditional caused the h264_nvenc video codec to be applied to y4m extraction output when Hardware Acceleration was enabled, despite y4m being a raw, codec-less container \u2014 GIF exports now explicitly bypass all video codec selection during extraction regardless of the Hardware Acceleration setting.",
      "Fix: Hardened FFmpeg/gifski child process error reporting to capture and surface full stderr output in export failure messages, instead of only displaying an opaque numeric exit code.",
      "Fix: Raised the GIF descension loop's frame rate floor from 10fps to 24fps and reordered priority so resolution and quality are reduced before frame rate, preventing choppy playback on fast-motion gaming clips.",
      "Fix: Set the app's author/publisher metadata to \"Ayinaki\" so it correctly appears in the Windows installer and Apps & Features listing."
    ]
  },
  {
    "version": "Phase 9: Multi-Segment Trim Mode",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: Introduced Multi-Segment Trim, allowing multiple independent trim ranges to be created from a single source clip, gated behind a \"Multi-Trim\" toggle in Trim Settings.",
      "Feature: Added color-coded trim brackets on the timeline, with each segment rendered in a distinct high-contrast color and a per-segment delete icon.",
      "Feature: Implemented segment-aware \"Set In\"/\"Set Out\" logic that creates a new segment when the playhead is outside existing ranges, and adjusts the active segment when inside one, with overlap clamping against neighboring segments.",
      "Feature: Added an \"Output Mode\" selector allowing multi-segment exports as either separate individually-numbered clips or a single merged clip.",
      "Feature: Integrated the multi-segment merged export path with the existing smart concat backend from Merge Mode, trimming each segment to temporary files before lossless concatenation.",
      "Feature: Added proportional multi-segment progress reporting, scaling the title bar progress bar by each segment's duration relative to the total.",
      "Feature: Added automatic temporary file cleanup on export success, failure, and cancellation for multi-segment merged exports.",
      "Feature: Added a \"Max Quality\" toggle to Export Settings that forces the libx264 \"veryslow\" encoding preset for maximum quality-per-bitrate at the cost of longer export times.",
      "Fix: Resolved a bug where merged multi-segment exports incorrectly repeated the same portion of the source video across all segments instead of using each segment's distinct in/out points.",
      "Fix: Resolved a bug where target file size accuracy was broken on merged multi-segment exports as a downstream effect of the segment content bug.",
      "Fix: Resolved manual resolution overrides being silently ignored on merged multi-segment exports, caused by resolution scaling being skipped during the per-segment temp-file trim pass and lost during the subsequent lossless stream-copy concat.",
      "Fix: Replaced the original multi-segment color palette's visually similar brown/green tones with a distinct, high-contrast color set for clearer segment differentiation."
    ]
  },
  {
    "version": "Phase 8: Video Cropping & UI Refinements",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: Introduced a full video cropping tool in Trim Mode with an interactive, draggable, 8-handle resize overlay directly on the video preview.",
      "Feature: Added aspect ratio lock support (16:9, 9:16, 1:1, 4:3 presets) that constrains resize handles and proportionally scales the crop box during drag.",
      "Feature: Integrated the crop filter into the FFmpeg export pipeline, correctly chaining `crop` before `scale`/`pad` for both CPU (libx264) and NVENC hardware-accelerated encoding paths.",
      "Feature: Updated the Export Planner's 2-pass VBR bitrate math to calculate targets using the cropped resolution rather than the original source resolution.",
      "Feature: Added a \"Re-center\" button to instantly re-center the crop box within the video frame while preserving its current size, and removed manual position/size numeric inputs in favor of drag-only interaction.",
      "Feature: Relocated the export progress bar and percentage display from the sidebar into the title bar for persistent visibility without affecting sidebar scroll behavior.",
      "Feature: Converted the Audio Settings panel into a collapsible section, matching the Cropping panel's expand/collapse pattern.",
      "Feature: Replaced inline sidebar warning banners with a title bar warning status indicator that opens a dedicated modal listing all active export warnings.",
      "Feature: Redesigned warning messages into structured cards with plain-language titles and explanations, replacing raw concatenated debug-style strings.",
      "Feature: Added a custom-themed scrollbar to the sidebar and warnings modal, replacing the default OS scrollbar.",
      "Fix: Corrected the checkbox checked-state accent color from an unintended blue to the app's established green accent color.",
      "Fix: Resolved a regression where all UI buttons and file-loading became unresponsive due to an uncaught error during crop overlay initialization blocking subsequent event listener setup.",
      "Fix: Fixed the Cropping panel's collapsed-state padding/alignment inconsistency versus other sidebar panels.",
      "Fix: Disabled the Cropping \"Enable\" checkbox until a video clip is loaded, preventing an unrecoverable state where cropping was activated with no video metadata available.",
      "Fix: Changed the default crop box size from matching full video resolution to 50% of native dimensions, centered, for clearer visual affordance that cropping is active.",
      "Fix: Cleared the aspect ratio lock state when cropping is disabled and re-enabled, preventing a stale ratio constraint from persisting after the Pre-settings dropdown visually reset to \"None.\"",
      "Fix: Resolved a layout regression where the sidebar, mode toggle, and video preview stacked incorrectly after the title bar progress bar relocation.",
      "Fix: Eliminated sidebar content shift when the scrollbar appears/disappears using `scrollbar-gutter: stable`.",
      "Fix: Resolved a \"w.startsWith is not a function\" runtime error caused by leftover string-based logic after warnings were refactored into structured objects.",
      "Fix: Replaced the small-scale warning icon (previously a Unicode glyph, prone to distortion at small sizes) with a crisp, properly scaling inline SVG icon."
    ]
  },
  {
    "version": "Phase 7: Feedback System & Packaging",
    "date": "Early-Mid July 2026",
    "changes": [
      "Feature: Added a \"Send Feedback\" button and modal (Bug Report / Feature Request / General Feedback types) that submits directly to a Discord webhook as a formatted embed.",
      "Feature: Added minimum and maximum character length validation on feedback submissions, enforced both client-side and server-side.",
      "Feature: Added a toggle to disable automatic resolution downscaling on low-bitrate exports, with an inline warning shown when enabled.",
      "Fix: Resolved the Discord webhook URL failing to load in packaged/built versions due to incorrect .env path resolution.",
      "Fix: Resolved NVENC hardware acceleration failing to be detected in packaged builds due to binary path resolution issues.",
      "Fix: Corrected inconsistent spacing/margins on the low-bitrate warning message when it wrapped to multiple lines.",
      "Fix: Significantly reduced the packaged application's installer size by removing the unused ffplay.exe binary, excluding stray test/log artifacts from the build, and stripping unused Electron locale files."
    ]
  },
  {
    "version": "Phase 6: Merge Mode & Hardware Acceleration",
    "date": "",
    "changes": [
      "Feature: Added a toggle to switch the app workspace into \"Merge Mode\" for stitching multiple clips together.",
      "Feature: Enabled multi-file import alongside a vertically scrolling Clip List sidebar with extracted thumbnail previews.",
      "Feature: Built a proportional, fixed-width timeline strip supporting drag-to-reorder block functionality.",
      "Feature: Created a seamless sequential preview playback engine (MergePlayer) that handles mismatched aspect ratios and preserves volume state across clips.",
      "Feature: Implemented a smart concat backend that defaults to fast lossless stream copying, but automatically falls back to re-encoding filter graphs if clip formats mismatch.",
      "Feature: Added real hardware acceleration encoding via NVIDIA NVENC (h264_nvenc) with an automated fallback to CPU (libx264) if hardware initialization fails.",
      "Fix: Eliminated a canvas rendering bug where the Trim timeline disappeared after switching modes by explicitly forcing a redraw on visibility change.",
      "Fix: Corrected drop target zones in Merge Mode so dragging files directly into the Clip List accurately triggers the import event."
    ]
  },
  {
    "version": "Phase 5: Advanced UX & File Handling",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: Replaced the intrusive native OS dialog with a custom in-app \"Export Complete\" modal.",
      "Feature: Added a \"Copy to Clipboard\" button on export completion that utilizes Windows CF_HDROP to copy the actual video file for instant pasting into chat apps.",
      "Feature: Implemented robust drag-and-drop file support using Electron's webUtils.getPathForFile() to bypass security path restrictions.",
      "Feature: Added visually distinct dashed drop-zone borders to clearly indicate drag-and-drop capability in empty states.",
      "Feature: Auto-generated .ico and .icns app icons from a single master PNG via electron-builder.",
      "Fix: Resolved post-export UI unresponsiveness by ensuring disabled state flags properly reset after the modal closes.",
      "Fix: Corrected a layout overflow bug caused by missing box-sizing on the dashed drop-zone element."
    ]
  },
  {
    "version": "Phase 4: Settings, Overrides & Quality of Life",
    "date": "",
    "changes": [
      "Feature: Added a persistent volume slider and mute toggle powered by electron-store.",
      "Feature: Implemented a persistent \"Default Export Directory\" setting.",
      "Feature: Standardized the export filename convention to append \"- Trimmed.mp4\" with automatic collision handling.",
      "Feature: Added a manual resolution override dropdown with standard scaling options.",
      "Feature: Created an \"Auto (Best Quality)\" preset utilizing a single-pass CRF 19 encode for size-agnostic exports.",
      "Fix: Reined in target file size overshoots by tightening the safety margin to 5% and capping -maxrate and -bufsize bursts.",
      "Fix: Cleaned up the UI by hiding the resolution warning banner for standard \"Native\" resolution exports."
    ]
  },
  {
    "version": "Phase 3: Visual Redesign & App Polish",
    "date": "",
    "changes": [
      "Feature: Transitioned to a custom frameless window with draggable title bar regions and native window controls.",
      "Feature: Overhauled the UI into a dark, compact, desktop-tool aesthetic inspired by Shutter Encoder and LosslessCut.",
      "Feature: Reorganized the transport control row into a balanced three-zone layout (timecode left, buttons center, duration right).",
      "Feature: Added eight dedicated transport buttons for precise playhead and trim marker manipulation.",
      "Fix: Updated \"Step Back/Forward\" icons to < and > to avoid visual collision with the trim bracket icons.",
      "Fix: Unified the Play button styling so it sits flush and consistent with the rest of the transport bar."
    ]
  },
  {
    "version": "Phase 2: Trim UI & Audio Handling",
    "date": "",
    "changes": [
      "Feature: Built a center video preview player with accurate timecode parsing.",
      "Feature: Added an interactive timeline canvas with draggable in/out trim handles.",
      "Feature: Enabled audio track detection, allowing users to select a specific audio stream from multi-track videos.",
      "Fix: Eliminated \"Could not open encoder\" errors by standardizing trim command math and avoiding mixed absolute/relative seeks.",
      "Fix: Resolved silent output failures by mapping correct FFmpeg audio stream ordinals instead of generic UI list indices.",
      "Fix: Bypassed Chromium's track-switching limitations by generating a near-instant FFmpeg stream-copy remux for accurate audio previewing."
    ]
  },
  {
    "version": "Phase 1: Core Architecture & FFmpeg Integration",
    "date": "Early July 2026",
    "changes": [
      "Feature: Established initial Electron project scaffold tailored for a Windows desktop environment.",
      "Feature: Bundled FFmpeg and FFprobe binaries natively to ensure out-of-the-box functionality.",
      "Feature: Created ProbeService for accurate media metadata extraction.",
      "Feature: Implemented ExportPlanner to calculate deterministic 2-pass VBR bitrate budgets for strict file size limits (like Discord's 10MB cap).",
      "Fix: Resolved FFprobe execution failures on file paths with spaces by switching to process spawn argument arrays instead of shell strings."
    ]
  }
];

if (typeof module !== 'undefined') {
  module.exports = window.changelogData;
}
