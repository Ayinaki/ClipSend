window.changelogData = [
  {
    "version": "v2.2.5: Layout & Readability Polish",
    "date": "August 2026",
    "changes": [
      "Fix: The multi-trim segment counter no longer pushes the In/Out/Dur readout over the playback controls. It moved to the timeline header, next to the clip info it belongs with.",
      "Fix: The settings modal fits the window without a scrollbar, so every setting stays on screen.",
      "Fix: A finished update install now shows a full progress bar instead of an empty one.",
      "Fix: The character counter in the feedback form is readable in light mode.",
      "Enhancement: Labels and helper text are larger, muted and error colors clear contrast requirements in both themes, and floating menus cast tighter shadows.",
      "Enhancement: Progress bars update smoothly instead of causing layout jumps."
    ]
  },
  {
    "version": "v2.2.4: Multi-Trim WebM Fix",
    "date": "August 2026",
    "changes": [
      "Fix: Multi-trim exports to WebM no longer fail. Merging multiple trimmed segments crashed before the merge started, so the export never completed. Segments now carry the destination format and codec through to the merge, and the final file matches what you picked."
    ]
  },
  {
    "version": "v2.2.3: WebM Export & AV1 Size Fixes",
    "date": "August 2026",
    "changes": [
      "Feature: New WebM output format for Trim and Merge exports. WebM cannot hold H.264, so the H.264 codec setting exports VP9 with Opus audio, and the AV1 setting keeps the hardware AV1 encoders in a WebM container.",
      "Fix: Size-capped AV1 exports no longer fail. SVT-AV1 rejected the max bitrate flag in two-pass mode, and its rate control ran hot on short, detailed clips, pushing the output past the size limit.",
      "Fix: WebM exports work in installed builds. VP9 encoding was missing from the bundled FFmpeg due to a cross-compile issue.",
      "Fix: Merged WebM exports re-encode with the destination codec when clips don't match, and cancelling a post-export conversion keeps the intermediate file under an honest .mp4 name."
    ]
  },
  {
    "version": "v2.2.2: Update Notes & Light Theme Polish",
    "date": "August 2026",
    "changes": [
      "Fix: Release notes in the update dialog render as a formatted list instead of raw HTML markup, and links open in your browser.",
      "Enhancement: The update badge is a flat teal chip, and the warning icon, error details, and download progress bar follow the light theme.",
      "Enhancement: Buttons show a focus ring when you tab through the app.",
      "Enhancement: Title bar icons are one size, and the onboarding illustrations match the active theme."
    ]
  },
  {
    "version": "v2.2.1: Discord Free Tier Raised to 20 MB",
    "date": "August 2026",
    "changes": [
      "Enhancement: The Discord (Free) preset targets 20 MB to match Discord's raised upload limit."
    ]
  },
  {
    "version": "v2.2.0: Remappable Shortcuts, Undo & New Icon",
    "date": "August 2026",
    "changes": [
      "Feature: Remap shortcuts in Settings. Click a binding, press a new key, and it saves immediately. Conflicts are blocked, Esc cancels, Delete clears, and the ? help modal always shows your current keys.",
      "Feature: Undo and redo (Ctrl+Z / Ctrl+Y) for trims, crops, and merge edits.",
      "Feature: Custom export filenames with tokens like {name}, {date}, and {res} for Trim and Merge exports.",
      "Feature: Playback speed (0.5×–3×) in the transport bar. Exports keep the speed you set.",
      "Feature: Optional OpenDyslexic accessibility font, bundled with the app.",
      "Feature: New app icon (Set In/Out brackets with a play triangle) on the window, taskbar, tray, and installer.",
      "Enhancement: Settings are grouped into sections, and every dropdown uses the custom styled menus.",
      "Enhancement: Theme changes crossfade instead of snapping.",
      "Enhancement: Merge exports have a Copy to Clipboard button, like Trim exports.",
      "Enhancement: Transport buttons are grouped by function (In / Playback / Out / Loop) with clearer Set In/Out icons.",
      "Fix: The window is a fixed 1500×800 again. It was accidentally made resizable.",
      "Fix: Modal backdrops now blur the whole window, including the title bar."
    ]
  },
  {
    "version": "v2.1.1: AV1 Format Fix & Unified Progress",
    "date": "August 2026",
    "changes": [
      "Fix: AV1 exports now use the format you picked, saving as MP4 with audio instead of WebM, so they play wherever MP4 plays, including Discord.",
      "Fix: The Merge Mode size estimate matches the selected target size, even with the default preset.",
      "Enhancement: Merge exports show progress and a cancel button in the title bar, like Trim exports."
    ]
  },
  {
    "version": "v2.1.0: AV1 Encoding & Hardware Acceleration",
    "date": "August 2026",
    "changes": [
      "Feature: New Video Codec setting. AV1 gives roughly double the quality at the same size and plays natively in Discord.",
      "Feature: Hardware acceleration detects Intel, AMD, and NVIDIA GPUs, and falls back to the CPU encoder if a GPU encoder fails to start.",
      "Feature: AV1 exports use your GPU's AV1 encoder when available, or a high-quality CPU encoder otherwise.",
      "Enhancement: Settings lists the hardware encoders detected on your PC and greys out the unavailable ones.",
      "Enhancement: The first-run tour introduces AV1 and hardware acceleration.",
      "Fix: A failed hardware encode retries with the CPU encoder instead of repeating the same failure."
    ]
  },
  {
    "version": "v2.0.1: AV1 Playback Fix & Lighter App",
    "date": "August 2026",
    "changes": [
      "Fix: AV1 videos now load, preview, and export throughout the app. Merge Mode thumbnails and trims previously failed silently.",
      "Enhancement: The installer shrank from about 145 MB to 110 MB, and the installed app uses roughly 130 MB less disk space."
    ]
  },
  {
    "version": "v2.0.0: Major UI & Workflow Overhaul",
    "date": "August 2026",
    "changes": [
      "Feature: New first-run tour walks you through Trim, Merge, Export, and shortcuts with UI previews. Skip it anytime or replay it from Settings.",
      "Feature: Timeline zoom via Ctrl+wheel or the plus/minus buttons, centered on your cursor, with auto-follow keeping the playhead visible during playback.",
      "Feature: Exports drive the Windows taskbar progress bar and show a native notification with the output file and size when finished. Clicking it brings the app to the foreground.",
      "Feature: The window remembers its position, size, and maximized state across restarts, and recenters itself if the saved position is off-screen.",
      "Feature: Merge Mode now uses the shared export settings: output format (MP4, GIF, MP3), resolution override, and target size, with the panel visible without scrolling.",
      "Feature: Added loop playback for merged sequences, aligned scrubbing, and sharper timeline thumbnails.",
      "Enhancement: All dialogs share a blurred backdrop and a subtle entrance animation, disabled under reduced motion.",
      "Enhancement: The custom target size field is a plain input instead of the native number spinner.",
      "Enhancement: Added toast notifications for quick feedback, like trims reset, clips added, and clipboard copy.",
      "Fix: Automated tests run reliably without interference from scratch worktree copies."
    ]
  },
  {
    "version": "v1.9.1: Merge Mode Per-Clip Trimming",
    "date": "August 2026",
    "changes": [
      "Feature: Trim each clip inside Merge Mode. Drag the amber handles on a timeline block or use Set In, Set Out, and Jump to pick the section that goes into the merged output.",
      "Feature: Trimmed-away parts are dimmed on the timeline. Blocks keep their full-length size, so adjusting a trim never shifts the rest of the timeline, and the total readout shows the final merged length.",
      "Feature: The merge preview honors trims during playback and scrubbing, and exports use the fastest path when clips are compatible.",
      "Feature: A Reset button clears the active clip's trim, and each clip's trim range is listed in the clip list."
    ]
  },
  {
    "version": "v1.9.0: Auto-Updates & Dialog Overlap Fixes",
    "date": "August 2026",
    "changes": [
      "Fix: Auto-updates work again. The installer is named to match the update metadata, so downloads no longer 404.",
      "Fix: Dialogs no longer stack on top of each other; opening one closes any other."
    ]
  },
  {
    "version": "v1.8.20: Live Feedback Proxy",
    "date": "August 2026",
    "changes": [
      "Feature: Feedback submissions go through a live proxy."
    ]
  },
  {
    "version": "v1.8.19: Feedback Relayed Through Secure Proxy",
    "date": "August 2026",
    "changes": [
      "Security: The Discord webhook URL no longer ships inside the app. Submissions go through a proxy that holds the endpoint, so it can be rotated without a new build and can't be extracted."
    ]
  },
  {
    "version": "v1.8.18: Auto-Updater Overhaul",
    "date": "August 2026",
    "changes": [
      "Fix: Rebuilt the updater on a maintained update engine. Updates install reliably, downloads are verified against the published checksum, per-machine installs prompt for permission, and the app relaunches after install.",
      "Fix: The update dialog reports at next launch whether a previous update applied, so silent failures become visible.",
      "Note: After download, the installer opens for you to finish the update. If SmartScreen flags the publisher as unrecognized, click More info, then Run anyway. A trusted signing certificate would remove this prompt."
    ]
  },
  {
    "version": "v1.8.17: Title Bar Window Dragging Fix",
    "date": "August 2026",
    "changes": [
      "Fix: You can drag the window from anywhere on the title bar again. The center and right sections are draggable while buttons and controls stay clickable."
    ]
  },
  {
    "version": "v1.8.16: Updater Fix, Title Bar Estimates & MP3 Export",
    "date": "August 2026",
    "changes": [
      "Fix: Auto-updates now apply. The installer runs in update mode, the app relaunches, and the update waits for the new executable to be in place.",
      "Fix: Update results are shown in the update dialog instead of failing silently.",
      "Feature: The export estimate (bitrate, resolution, size) and Start Export button sit in the center of the title bar instead of the sidebar.",
      "Feature: New MP3 output format. Export audio only from any selected track at 192 kbps."
    ]
  },
  {
    "version": "v1.8.15: Export Fixes",
    "date": "August 2026",
    "changes": [
      "Fix: Exports no longer loop forever when NVIDIA hardware encoding fails. Retries use the CPU encoder, so exports finish even without working GPU encoding.",
      "Fix: The export complete dialog shows the merge strategy (lossless vs re-encode) instead of dropping it."
    ]
  },
  {
    "version": "v1.8.13: Update Relaunch Fixes",
    "date": "July 2026",
    "changes": [
      "Fix: The app relaunches after an update, fixing a rare failure in the relaunch step.",
      "Fix: A failed relaunch no longer crashes the app."
    ]
  },
  {
    "version": "v1.8.11: Update Status Tracking",
    "date": "July 2026",
    "changes": [
      "Feature: The app records the installer's result so it can report whether an update applied.",
      "Feature: On startup, the app reports whether the last update succeeded and cleans up leftover result files."
    ]
  },
  {
    "version": "v1.8.10: Update Logging Improvements",
    "date": "July 2026",
    "changes": [
      "Feature: The updater records the installer's exit code and logs update results for easier troubleshooting."
    ]
  },
  {
    "version": "v1.8.9: Safer Update Downloads",
    "date": "July 2026",
    "changes": [
      "Feature: The updater verifies that downloaded files match their expected size before installing.",
      "Feature: Update commands run only on Windows.",
      "Feature: Update failures report clearer errors."
    ]
  },
  {
    "version": "v1.8.8: Updater Compatibility & Logging",
    "date": "July 2026",
    "changes": [
      "Feature: Updates work on machines that restrict PowerShell, with a fallback command path for environments that block scripts.",
      "Feature: The updater keeps a timestamped log of downloads and runs for troubleshooting."
    ]
  },
  {
    "version": "v1.8.7: Update Install Fix",
    "date": "July 2026",
    "changes": [
      "Fix: The app waits for the installer to finish before relaunching, so updates apply completely."
    ]
  },
  {
    "version": "v1.8.6: In-App Changelog",
    "date": "July 2026",
    "changes": [
      "Feature: Added the in-app changelog, kept in sync with release notes."
    ]
  },
  {
    "version": "v1.8.5: Changelog Updates",
    "date": "July 2026",
    "changes": [
      "Feature: Updated the in-app changelog with the latest release notes."
    ]
  },
  {
    "version": "v1.8.4: Update & GIF Export Fixes",
    "date": "July 2026",
    "changes": [
      "Fix: The updater waits for the app to close before installing, avoiding file-lock conflicts during updates.",
      "Fix: GIF export works in installed builds, since the GIF encoder is bundled with the app."
    ]
  },
  {
    "version": "v1.8.3: Better Error Reporting",
    "date": "July 2026",
    "changes": [
      "Feature: Export failures include detailed error messages.",
      "Performance: Title bar progress updates are smoother during exports."
    ]
  },
  {
    "version": "v1.8.2: Media Key Fix & Faster Timeline",
    "date": "July 2026",
    "changes": [
      "Fix: OS media keys no longer interrupt video playback in the app.",
      "Performance: The timeline redraws faster by caching track dimensions.",
      "Performance: File and cleanup operations no longer block the interface."
    ]
  },
  {
    "version": "v1.8.1: Smoother Waveforms",
    "date": "July 2026",
    "changes": [
      "Performance: Waveform generation runs in the background so the app stays responsive.",
      "Performance: Export progress updates are throttled for smoother title bar updates.",
      "Fix: Restored the trash icon color and simplified the timeline internals.",
      "Enhancement: Importing multiple files at once is more reliable."
    ]
  },
  {
    "version": "v1.8.0: Performance & Rendering Improvements",
    "date": "July 2026",
    "changes": [
      "Performance: Timeline dragging is smoother thanks to more efficient canvas redraws.",
      "Performance: Fixed high-DPI canvas scaling for sharper rendering on scaled displays.",
      "Performance: Export progress parsing and updates are faster and smoother.",
      "Performance: Multi-file import and thumbnail generation are parallelized.",
      "Fix: Output handling works consistently across platforms."
    ]
  },
  {
    "version": "v1.7.2: Media Key Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Keyboard and headset media keys no longer interrupt video playback in the app."
    ]
  },
  {
    "version": "v1.7.1: Automatic Post-Update Relaunch",
    "date": "July 2026",
    "changes": [
      "Fix: The app relaunches itself after a silent update completes."
    ]
  },
  {
    "version": "v1.7.0: Custom Target File Size Limit",
    "date": "July 2026",
    "changes": [
      "Feature: New Custom Target Size option in the size dropdown. Enter any size limit in MB, like 25 MB or 250 MB.",
      "Enhancement: Custom sizes work with two-pass encoding and automatic resolution scaling."
    ]
  },
  {
    "version": "v1.6.3: Release Publishing Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Builds no longer create duplicate draft releases on GitHub."
    ]
  },
  {
    "version": "v1.6.2: Update Dialog & Publishing Fixes",
    "date": "July 2026",
    "changes": [
      "Fix: The update dialog opens when you click the update badge in the title bar.",
      "Fix: Released builds publish automatically as public releases."
    ]
  },
  {
    "version": "v1.6.1: Report Bugs on GitHub",
    "date": "July 2026",
    "changes": [
      "Feature: The feedback dialog can create a GitHub issue directly for bug reports and feature requests.",
      "Feature: Added structured templates for bug reports and feature requests."
    ]
  },
  {
    "version": "v1.6.0: Automatic Updates",
    "date": "July 2026",
    "changes": [
      "Feature: The app checks for updates automatically and installs them from GitHub Releases.",
      "Feature: Added an update badge in the title bar with a dialog showing release notes, live download progress, and silent installation."
    ]
  },
  {
    "version": "v1.5.6: App Icon Fix",
    "date": "July 2026",
    "changes": [
      "Fix: The app icon is converted to a native Windows icon during build, so it displays correctly in the taskbar and file explorer."
    ]
  },
  {
    "version": "v1.5.5: Size Accuracy for 5-10s Clips",
    "date": "July 2026",
    "changes": [
      "Fix: Clips between 5 and 10 seconds stay strictly under the target file size."
    ]
  },
  {
    "version": "v1.5.4: Size Accuracy for Short Clips",
    "date": "July 2026",
    "changes": [
      "Fix: Very short clips (under 5 seconds) hit their target file size accurately.",
      "Fix: Tightened bitrate limits so exports stay under the size cap.",
      "Fix: Capped the maximum video bitrate at 25 Mbps to prevent overshoot on short clips."
    ]
  },
  {
    "version": "v1.5.3: Sharper App Icon",
    "date": "July 2026",
    "changes": [
      "Fix: The Windows app icon is crisp at every size, from small taskbar icons to large previews."
    ]
  },
  {
    "version": "v1.5.2: Export Stability Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Exports no longer hang on unclosed input streams during automated testing."
    ]
  },
  {
    "version": "v1.5.1: Windows App Icon Fix",
    "date": "July 2026",
    "changes": [
      "Fix: Added a high-resolution Windows app icon for the installer and executable."
    ]
  },
  {
    "version": "v1.5.0: Performance & Stability Improvements",
    "date": "July 2026",
    "changes": [
      "Feature: Waveform generation uses 98% less memory.",
      "Feature: Waveforms render instantly.",
      "Feature: Waveforms are cached (up to 50 entries) so repeat views load instantly.",
      "Feature: Faster media probing when importing multiple files in Merge Mode.",
      "Feature: Export progress parsing is more accurate and stable.",
      "Feature: File operations no longer freeze the interface.",
      "Feature: Added automated build and release pipelines."
    ]
  },
  {
    "version": "Phase 10: GIF Export & App Branding",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New GIF output format, powered by gifski.",
      "Feature: GIFs hit your target file size by stepping down frame rate, then resolution, then quality across several attempts.",
      "Feature: You get a warning before starting a GIF export that is unlikely to fit the target size.",
      "Feature: Exports check for enough free disk space before extracting frames.",
      "Feature: GIF encoding shows its progress in the title bar.",
      "Feature: Audio controls are hidden for GIF output, since GIFs cannot contain audio.",
      "Feature: The Max Quality toggle moved into Settings and remembers its state across restarts.",
      "Feature: The app version appears next to the title in the title bar.",
      "Fix: Dragging trim handles updates the duration and in/out readouts.",
      "Fix: GIF export no longer fails on certain high-color-depth videos.",
      "Fix: GIF export no longer fails on odd-sized crops.",
      "Fix: GIF export works with hardware acceleration enabled.",
      "Fix: Export failures show the full error instead of an opaque numeric code.",
      "Fix: GIFs keep a smooth frame rate (at least 24 fps) and reduce quality and resolution before dropping frames.",
      "Fix: The app shows the correct publisher name in the Windows installer and Apps and Features."
    ]
  },
  {
    "version": "Phase 9: Multi-Segment Trim Mode",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New Multi-Trim mode. Create several independent trim ranges from one clip with a toggle in Trim Settings.",
      "Feature: Each segment gets its own color and delete button on the timeline.",
      "Feature: Set In and Set Out create a new segment when the playhead is outside existing ranges, and adjust the active segment when inside one.",
      "Feature: Output Mode lets you export segments as separate clips or one merged clip.",
      "Feature: Merged multi-segment exports use fast lossless joining when the clips are compatible.",
      "Feature: Export progress scales with each segment's length.",
      "Feature: Temporary files are cleaned up after merged exports, whether they succeed, fail, or are cancelled.",
      "Feature: New Max Quality toggle that uses a slower, higher-quality encoder preset.",
      "Fix: Merged exports use each segment's own start and end points instead of repeating the same section.",
      "Fix: Target file size is accurate on merged multi-segment exports.",
      "Fix: Custom resolution overrides apply to merged multi-segment exports.",
      "Fix: Segment colors are distinct from each other."
    ]
  },
  {
    "version": "Phase 8: Video Cropping & UI Refinements",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New cropping tool in Trim Mode. Drag the eight handles on the video preview to crop.",
      "Feature: Aspect ratio presets (16:9, 9:16, 1:1, 4:3) constrain the crop box while dragging.",
      "Feature: Cropping is applied in exports on both CPU and GPU encoding paths.",
      "Feature: Size estimates use the cropped resolution instead of the original.",
      "Feature: A Re-center button returns the crop box to the center without changing its size.",
      "Feature: Export progress moved from the sidebar into the title bar, so it is always visible.",
      "Feature: Audio settings are a collapsible section, matching the cropping panel.",
      "Feature: Warnings moved from the sidebar to a title bar indicator that opens a dedicated dialog.",
      "Feature: Warnings are plain-language cards instead of technical strings.",
      "Feature: Custom scrollbar styling for the sidebar and warnings dialog.",
      "Fix: Checkboxes use the app's accent color.",
      "Fix: The app no longer becomes unresponsive after loading files.",
      "Fix: Cropping panel spacing is consistent with other panels.",
      "Fix: Cropping cannot be enabled before a video is loaded.",
      "Fix: The default crop box is half the video size and centered.",
      "Fix: The aspect ratio lock resets when cropping is toggled off and on.",
      "Fix: The sidebar, mode toggle, and preview no longer stack incorrectly.",
      "Fix: The sidebar no longer shifts when the scrollbar appears or disappears.",
      "Fix: Fixed a runtime error in the warning display.",
      "Fix: The warning icon scales at small sizes without distortion."
    ]
  },
  {
    "version": "Phase 7: Feedback System & Packaging",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New Send Feedback button and dialog (bug report, feature request, or general) that submits directly to the team.",
      "Feature: Feedback length is validated on both the app and server side.",
      "Feature: New toggle to disable automatic resolution downscaling on low-bitrate exports, with an inline warning.",
      "Fix: Feedback works in installed builds.",
      "Fix: NVIDIA hardware acceleration is detected in installed builds.",
      "Fix: Cleaned up spacing on the low-bitrate warning message.",
      "Fix: Removed unused components and files, shrinking the installer."
    ]
  },
  {
    "version": "Phase 6: Merge Mode & Hardware Acceleration",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New Merge Mode for stitching multiple clips into one video.",
      "Feature: Import several files at once into a scrollable clip list with thumbnail previews.",
      "Feature: Drag timeline blocks to reorder clips.",
      "Feature: Preview plays clips back-to-back, handling different aspect ratios and keeping your volume setting.",
      "Feature: Merges use fast lossless joining when clips match, and re-encode automatically when they don't.",
      "Feature: Hardware-accelerated encoding via NVIDIA GPUs, with automatic CPU fallback.",
      "Fix: The trim timeline no longer disappears after switching modes.",
      "Fix: Dragging files onto the clip list in Merge Mode imports them."
    ]
  },
  {
    "version": "Phase 5: Export Completion & File Handling",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: Replaced the system dialog with a custom Export Complete dialog.",
      "Feature: Copy to Clipboard button on export completion, so you can paste the video straight into chat apps.",
      "Feature: Drag-and-drop file support.",
      "Feature: Dashed borders show where to drop files when the app is empty.",
      "Feature: App icons are generated automatically from one master image.",
      "Fix: The interface stays responsive after exports finish.",
      "Fix: The empty drop zone no longer overflows its layout."
    ]
  },
  {
    "version": "Phase 4: Settings & Export Overrides",
    "date": "Early July 2026",
    "changes": [
      "Feature: Persistent volume slider and mute toggle.",
      "Feature: Persistent default export directory setting.",
      "Feature: Export filenames follow a standard format with automatic collision handling.",
      "Feature: Manual resolution override dropdown with standard scaling options.",
      "Feature: Auto (Best Quality) preset for exports without a size limit.",
      "Fix: Export sizes stay under the target by a tighter margin.",
      "Fix: Resolution warnings are hidden for native resolution exports."
    ]
  },
  {
    "version": "Phase 3: Visual Redesign & App Polish",
    "date": "Early July 2026",
    "changes": [
      "Feature: Custom frameless window with a draggable title bar and native window controls.",
      "Feature: New dark, compact interface.",
      "Feature: Transport controls reorganized into a three-zone layout (timecode left, buttons center, duration right).",
      "Feature: Eight transport buttons for playhead and trim control.",
      "Fix: Step Back and Step Forward icons no longer clash with the trim bracket icons.",
      "Fix: Play button styling is consistent with the rest of the transport bar."
    ]
  },
  {
    "version": "Phase 2: Trim UI & Audio Handling",
    "date": "Early July 2026",
    "changes": [
      "Feature: Centered video preview with accurate timecode parsing.",
      "Feature: Interactive timeline with draggable in/out trim handles.",
      "Feature: Audio track detection, so you can pick a specific audio stream from multi-track videos.",
      "Fix: No more 'could not open encoder' errors when trimming.",
      "Fix: Audio exports from the selected track.",
      "Fix: Audio previews are fast and accurate."
    ]
  },
  {
    "version": "Phase 1: Core Architecture & FFmpeg Integration",
    "date": "Early July 2026",
    "changes": [
      "Feature: Initial Windows desktop app built with Electron.",
      "Feature: FFmpeg and FFprobe bundled, so the app works out of the box.",
      "Feature: Accurate media metadata extraction.",
      "Feature: Export planning that hits strict file size limits like Discord's 10 MB cap.",
      "Fix: Files with spaces in their paths load correctly."
    ]
  }
];

if (typeof module !== 'undefined') {
  module.exports = window.changelogData;
}
