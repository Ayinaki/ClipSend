window.changelogData = [
  {
    "version": "v2.2.0: Remappable Shortcuts, Undo & New Icon",
    "date": "August 2026",
    "changes": [
      "Feature: Remap any keyboard shortcut from Settings — click a key, press its replacement, and it's saved instantly. Keys already in use are blocked, Esc cancels, and Delete clears a binding. The ? help modal always shows your real keys.",
      "Feature: Undo and redo (Ctrl+Z / Ctrl+Y) for trims, cropping, and merge edits.",
      "Feature: Custom export filenames with tokens like {name}, {date}, and {res} for both Trim and Merge exports.",
      "Feature: Playback speed control (0.5×–3×) in the transport bar — exports match the speed you set.",
      "Feature: Accessibility font setting — OpenDyslexic ships with the app and switches the whole interface.",
      "Feature: New app icon — the Set In/Out brackets with a play triangle — across the window, taskbar, tray, and installer.",
      "Enhancement: Settings reorganized into clear sections, and every dropdown in the app now uses the custom styled menus.",
      "Enhancement: Theme changes crossfade smoothly instead of snapping.",
      "Enhancement: Merge exports get a Copy to Clipboard button, matching Trim exports.",
      "Enhancement: Transport bar buttons regrouped by job (In / Playback / Out / Loop) with cleaner Set In/Out icons.",
      "Fix: The app window is a fixed 1500×800 again — it was accidentally made resizable.",
      "Fix: Modal backdrops now blur the whole window, including the title bar.",
      "Enhancement: The default Discord (Free) preset now targets 20 MB — Discord raised the free tier upload limit from 10 MB to 20 MB."
    ]
  },
  {
    "version": "v2.1.1: AV1 In Your Chosen Format + Unified Progress",
    "date": "August 2026",
    "changes": [
      "Fix: AV1 exports now use the output format you picked. AV1 files save as MP4 with audio instead of being forced into WebM, so they play anywhere MP4 does, including Discord.",
      "Fix: The size estimate in Merge Mode now always matches the target size you selected, even when you keep the default preset.",
      "Enhancement: Merge exports show their progress and cancel button in the title bar, like Trim exports, instead of in a side panel."
    ]
  },
  {
    "version": "v2.1.0: AV1 Encoding & Hardware Acceleration",
    "date": "August 2026",
    "changes": [
      "Feature: New Video Codec setting. Export as AV1 for about double the quality at the same file size, and Discord plays it natively.",
      "Feature: Hardware acceleration now supports Intel and AMD GPUs as well as NVIDIA, with automatic detection. If a GPU encoder fails to start, the export retries with the CPU encoder.",
      "Feature: AV1 exports use the fastest available path, your GPU's AV1 encoder when the hardware supports it, or a high-quality CPU encoder otherwise.",
      "Enhancement: Settings now shows which hardware encoders were detected on your PC and greys out the ones that are not available.",
      "Enhancement: The first-run tour now introduces AV1 and hardware acceleration.",
      "Fix: When a hardware encoder fails during a single-clip export, the retry now uses the CPU encoder properly instead of repeating the same failure."
    ]
  },
  {
    "version": "v2.0.1: AV1 Playback Fix & Lighter App",
    "date": "August 2026",
    "changes": [
      "Fix: AV1 videos now load, preview, and export correctly everywhere in the app. Merge Mode thumbnails and trims on AV1 files previously failed silently.",
      "Smaller: The installer dropped from about 145 MB to 110 MB, and the installed app takes up roughly 130 MB less disk space."
    ]
  },
  {
    "version": "v2.0.0: Major UI & Workflow Overhaul",
    "date": "August 2026",
    "changes": [
      "Feature: New first-run tour walks you through Trim, Merge, Export, and shortcuts with UI previews. Skip it anytime or replay it from Settings.",
      "Feature: Timeline zoom with Ctrl+wheel or the plus and minus buttons. The ruler zooms around your cursor with a zoom readout, and auto-follow keeps the playhead on screen during playback.",
      "Feature: Exports now drive the Windows taskbar progress bar and fire a native notification with the output file and size when done. Clicking the notification brings the app back to the foreground.",
      "Feature: The app window remembers its position, size, and maximized state across restarts, and recenters itself if the saved position is off-screen.",
      "Feature: Merge Mode now uses the shared export settings. Output format (MP4, GIF, MP3), resolution override, and target size apply to the merged result, and the settings panel is visible without scrolling.",
      "Feature: Added loop playback for merged sequences, aligned scrubbing, and sharper timeline thumbnails.",
      "Enhancement: All dialogs now share the same focus treatment, a blurred backdrop with a subtle entrance animation, disabled under reduced motion.",
      "Enhancement: The custom target size field uses a clean plain input instead of the native number spinner.",
      "Enhancement: Added toast notifications for light feedback, like trims reset, clips added, and clipboard copy.",
      "Fix: Automated tests now run reliably without interference from scratch worktree copies."
    ]
  },
  {
    "version": "v1.9.1: Merge Mode Per-Clip Trimming",
    "date": "August 2026",
    "changes": [
      "Feature: Trim each clip inside Merge Mode. Drag the amber handles on a timeline block or use the Set In, Set Out, and Jump buttons to pick the section that goes into the merged output.",
      "Feature: Trimmed-away parts are dimmed on the timeline while blocks stay fixed in place. Blocks are sized by each clip's full length, so adjusting a trim never shifts the rest of the timeline, and the total readout shows the final merged length.",
      "Feature: The merge preview honors trims during playback and scrubbing, and exports use the fastest path when clips are compatible.",
      "Feature: Added a Reset button to clear the active clip's trim, and each clip's trim range shows in the clip list."
    ]
  },
  {
    "version": "v1.9.0: Updater Fix & Dialog Overlap Fix",
    "date": "August 2026",
    "changes": [
      "Fix: Auto-updates now work. The published installer is named consistently with the update metadata, so the app can download and install updates in-app instead of failing with a 404.",
      "Fix: Dialogs can no longer stack on top of each other. Opening one closes any other."
    ]
  },
  {
    "version": "v1.8.20: Live Feedback Proxy",
    "date": "August 2026",
    "changes": [
      "Feature: Feedback is now relayed through a live proxy so submissions reach the team reliably."
    ]
  },
  {
    "version": "v1.8.19: Feedback Relayed Through Secure Proxy",
    "date": "August 2026",
    "changes": [
      "Security: Feedback no longer ships the Discord webhook URL inside the app. Submissions go through a secure proxy that holds the endpoint, so it can be rotated without a new build and can't be extracted from the app files."
    ]
  },
  {
    "version": "v1.8.18: Auto-Updater Overhaul",
    "date": "August 2026",
    "changes": [
      "Fix: Rebuilt the updater on a maintained update engine. Updates now install reliably, downloads are verified against the published checksum, per-machine installs prompt for permission properly, and the app relaunches after install.",
      "Fix: The update dialog now reports whether a previous update actually applied at the next start, so silent failures are visible.",
      "Note: The installer opens on screen after download so you can finish the update manually. If Windows SmartScreen flags the publisher as unrecognized, click More info then Run anyway. Signing with a trusted certificate would remove this prompt."
    ]
  },
  {
    "version": "v1.8.17: Title Bar Window Dragging Fix",
    "date": "August 2026",
    "changes": [
      "Fix: You can drag the window from anywhere on the title bar again. The center and right sections are draggable while buttons and controls stay fully clickable."
    ]
  },
  {
    "version": "v1.8.16: Updater Fix, Title Bar Estimates & MP3 Export",
    "date": "August 2026",
    "changes": [
      "Fix: Auto-updates now apply. The installer runs in update mode, the app relaunches visibly, and the update waits until the new executable is fully in place.",
      "Fix: Update results are now shown in the update dialog instead of failing silently.",
      "Feature: The export estimate (bitrate, resolution, size) and Start Export button now sit in the center of the title bar instead of the sidebar.",
      "Feature: New MP3 output format. Export audio only from any selected track at 192 kbps."
    ]
  },
  {
    "version": "v1.8.15: Export Fixes",
    "date": "August 2026",
    "changes": [
      "Fix: Exports no longer loop forever when NVIDIA hardware encoding fails. Retries now use the CPU encoder, so exports finish on systems without working GPU encoding.",
      "Fix: The export complete dialog now shows the merge strategy (lossless vs re-encode) instead of dropping it."
    ]
  },
  {
    "version": "v1.8.13: Update Relaunch Fixes",
    "date": "July 2026",
    "changes": [
      "Fix: The app now relaunches correctly after an update, fixing a rare failure in the relaunch step.",
      "Fix: A failed relaunch no longer crashes the app."
    ]
  },
  {
    "version": "v1.8.11: Update Status Tracking",
    "date": "July 2026",
    "changes": [
      "Feature: The app now records the installer's result so it can report whether an update applied.",
      "Feature: On startup, the app reports whether the last update succeeded and cleans up leftover result files."
    ]
  },
  {
    "version": "v1.8.10: Update Logging Improvements",
    "date": "July 2026",
    "changes": [
      "Feature: The updater now records the installer's exit code and logs update results for easier troubleshooting."
    ]
  },
  {
    "version": "v1.8.9: Safer Update Downloads",
    "date": "July 2026",
    "changes": [
      "Feature: The updater now verifies that downloaded files match their expected size before installing.",
      "Feature: Added safeguards so update commands only run on Windows, where they belong.",
      "Feature: Improved command handling and error details for update failures."
    ]
  },
  {
    "version": "v1.8.8: Updater Compatibility & Logging",
    "date": "July 2026",
    "changes": [
      "Feature: Updates now work on machines that restrict PowerShell, with a fallback command path for environments that block scripts.",
      "Feature: The updater keeps a timestamped log of downloads and runs for troubleshooting."
    ]
  },
  {
    "version": "v1.8.7: Update Install Fix",
    "date": "July 2026",
    "changes": [
      "Fix: The app now waits for the installer to fully finish before relaunching, so updates apply completely.",
      "Fix: Fixed a case where the app relaunched before the new files were in place."
    ]
  },
  {
    "version": "v1.8.6: In-App Changelog",
    "date": "July 2026",
    "changes": [
      "Feature: Added the in-app changelog, kept in sync with recent release notes."
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
      "Fix: The updater now waits for the running app to fully close before installing, avoiding file lock conflicts during updates.",
      "Fix: GIF export now works in installed builds, since the GIF encoder is bundled with the app."
    ]
  },
  {
    "version": "v1.8.3: Better Error Reporting",
    "date": "July 2026",
    "changes": [
      "Feature: Export failures now include detailed error details for clearer diagnosis.",
      "Performance: Title bar progress updates are smoother during exports."
    ]
  },
  {
    "version": "v1.8.2: Media Key Fix & Faster Timeline",
    "date": "July 2026",
    "changes": [
      "Fix: OS media keys no longer hijack video playback while a video is playing in the app.",
      "Performance: The timeline redraws faster by caching track dimensions.",
      "Performance: File and cleanup operations no longer block the interface."
    ]
  },
  {
    "version": "v1.8.1: Smoother Waveforms",
    "date": "July 2026",
    "changes": [
      "Performance: Waveform generation now runs in the background so the app stays responsive.",
      "Performance: Export progress updates are throttled for smoother title bar updates.",
      "Fix: Restored the trash icon color and cleaned up timeline internals.",
      "Enhancement: Importing multiple files at once is more reliable."
    ]
  },
  {
    "version": "v1.8.0: Performance & Rendering Improvements",
    "date": "July 2026",
    "changes": [
      "Performance: Timeline dragging is smoother thanks to smarter canvas redraws.",
      "Performance: Fixed high-DPI canvas scaling for sharper rendering on scaled displays.",
      "Performance: Export progress parsing and updates are faster and smoother.",
      "Performance: Multi-file import and thumbnail generation are parallelized.",
      "Fix: Fixed output handling across platforms."
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
      "Fix: The app now relaunches itself automatically after a silent update completes."
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
      "Fix: The update dialog now opens correctly when clicking the update badge in the title bar.",
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
      "Feature: The app now checks for updates automatically and installs them from GitHub Releases.",
      "Feature: Added an update badge in the title bar with a dialog showing release notes, live download progress, and silent installation."
    ]
  },
  {
    "version": "v1.5.6: App Icon Fix",
    "date": "July 2026",
    "changes": [
      "Fix: The app icon is now converted to a native Windows icon automatically during build, so it displays correctly in the taskbar and file explorer."
    ]
  },
  {
    "version": "v1.5.5: Size Accuracy for 5-10s Clips",
    "date": "July 2026",
    "changes": [
      "Fix: Clips between 5 and 10 seconds now stay strictly under the target file size."
    ]
  },
  {
    "version": "v1.5.4: Size Accuracy for Short Clips",
    "date": "July 2026",
    "changes": [
      "Fix: Very short clips (under 5 seconds) now hit their target file size accurately.",
      "Fix: Tightened bitrate limits so exports stay under the size cap.",
      "Fix: Capped the maximum video bitrate at 25 Mbps to prevent overshoot on short clips."
    ]
  },
  {
    "version": "v1.5.3: Sharper App Icon",
    "date": "July 2026",
    "changes": [
      "Fix: The Windows app icon is now crisp at every size, from small taskbar icons to large previews."
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
      "Fix: Added a high-resolution Windows app icon so the installer and executable show custom branding."
    ]
  },
  {
    "version": "v1.5.0: Performance & Stability Improvements",
    "date": "July 2026",
    "changes": [
      "Feature: Waveform generation uses over 98 percent less memory.",
      "Feature: Waveforms render instantly with efficient data transfer.",
      "Feature: Waveforms are cached (up to 50 entries) so repeat views are instant.",
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
      "Feature: New GIF output format, powered by gifski for high-quality GIFs.",
      "Feature: GIFs hit your target file size automatically by stepping down frame rate, then resolution, then quality across several attempts.",
      "Feature: You get a warning before starting a GIF export that is unlikely to fit the target size.",
      "Feature: Exports check for enough free disk space before extracting frames.",
      "Feature: GIF encoding shows its progress in the title bar.",
      "Feature: Audio controls are hidden for GIF output, since GIFs cannot contain audio.",
      "Feature: The Max Quality toggle moved into Settings and now remembers its state across restarts.",
      "Feature: The app version now appears next to the title in the title bar.",
      "Fix: Dragging trim handles now updates the duration and in/out readouts correctly.",
      "Fix: GIF export no longer fails on certain high-color-depth videos.",
      "Fix: GIF export no longer fails on odd-sized crops.",
      "Fix: GIF export works correctly with hardware acceleration enabled.",
      "Fix: Export failures now show the full error instead of an opaque numeric code.",
      "Fix: GIFs keep a smooth frame rate (at least 24 fps) and reduce quality and resolution before dropping frames.",
      "Fix: The app now shows the correct publisher name in the Windows installer and Apps and Features."
    ]
  },
  {
    "version": "Phase 9: Multi-Segment Trim Mode",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New Multi-Trim mode. Create several independent trim ranges from one clip with a toggle in Trim Settings.",
      "Feature: Each segment gets its own color and delete button on the timeline.",
      "Feature: Set In and Set Out create a new segment when the playhead is outside existing ranges and adjust the active segment when inside one.",
      "Feature: Output Mode lets you export segments as separate clips or one merged clip.",
      "Feature: Merged multi-segment exports use fast lossless joining when the clips are compatible.",
      "Feature: Export progress scales with each segment's length.",
      "Feature: Temporary files are cleaned up after merged exports, whether they succeed, fail, or are cancelled.",
      "Feature: New Max Quality toggle that uses a slower, higher-quality encoder preset.",
      "Fix: Merged exports now use each segment's own start and end points instead of repeating the same section.",
      "Fix: Target file size is now accurate on merged multi-segment exports.",
      "Fix: Custom resolution overrides now apply to merged multi-segment exports.",
      "Fix: Segment colors are now clearly distinct from each other."
    ]
  },
  {
    "version": "Phase 8: Video Cropping & UI Refinements",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: New cropping tool in Trim Mode. Drag the eight handles on the video preview to crop.",
      "Feature: Aspect ratio presets (16:9, 9:16, 1:1, 4:3) constrain the crop box while dragging.",
      "Feature: Cropping applies correctly in exports, on both CPU and GPU encoding paths.",
      "Feature: Size estimates use the cropped resolution instead of the original.",
      "Feature: Re-center button returns the crop box to the center without changing its size.",
      "Feature: Export progress moved from the sidebar into the title bar, so it is always visible.",
      "Feature: Audio settings are now a collapsible section, matching the cropping panel.",
      "Feature: Warnings moved from the sidebar to a title bar indicator that opens a dedicated dialog.",
      "Feature: Warnings are now plain-language cards instead of technical strings.",
      "Feature: Custom scrollbar styling for the sidebar and warnings dialog.",
      "Fix: Checkboxes now use the app's green accent color.",
      "Fix: Fixed a bug where the app could become unresponsive after loading files.",
      "Fix: Cropping panel spacing is consistent with other panels.",
      "Fix: Cropping cannot be enabled before a video is loaded.",
      "Fix: The default crop box is now half the video size, centered, so cropping is clearly visible.",
      "Fix: The aspect ratio lock resets correctly when cropping is toggled off and on.",
      "Fix: Fixed a layout issue where the sidebar, mode toggle, and preview stacked incorrectly.",
      "Fix: The sidebar no longer shifts when the scrollbar appears or disappears.",
      "Fix: Resolved a runtime error in the warning display.",
      "Fix: The warning icon now scales cleanly at small sizes."
    ]
  },
  {
    "version": "Phase 7: Feedback System & Packaging",
    "date": "Early-Mid July 2026",
    "changes": [
      "Feature: New Send Feedback button and dialog (bug report, feature request, or general) that submits directly to the team.",
      "Feature: Feedback length is validated on both the app and server side.",
      "Feature: New toggle to disable automatic resolution downscaling on low-bitrate exports, with an inline warning.",
      "Fix: Feedback now works in installed builds.",
      "Fix: NVIDIA hardware acceleration is detected correctly in installed builds.",
      "Fix: Cleaned up spacing on the low-bitrate warning message.",
      "Fix: The installer is significantly smaller after removing unused components and files."
    ]
  },
  {
    "version": "Phase 6: Merge Mode & Hardware Acceleration",
    "date": "",
    "changes": [
      "Feature: New Merge Mode for stitching multiple clips into one video.",
      "Feature: Import several files at once into a scrollable clip list with thumbnail previews.",
      "Feature: Drag timeline blocks to reorder clips.",
      "Feature: Preview plays clips back to back, handling different aspect ratios and keeping your volume setting.",
      "Feature: Merges use fast lossless joining when clips match, and re-encode automatically when they don't.",
      "Feature: Hardware-accelerated encoding via NVIDIA GPUs, with automatic CPU fallback.",
      "Fix: The trim timeline no longer disappears after switching modes.",
      "Fix: Dragging files onto the clip list in Merge Mode now imports them correctly."
    ]
  },
  {
    "version": "Phase 5: Advanced UX & File Handling",
    "date": "Mid-July 2026",
    "changes": [
      "Feature: Replaced the system dialog with a custom Export Complete dialog.",
      "Feature: Copy to Clipboard button on export completion, so you can paste the video straight into chat apps.",
      "Feature: Drag-and-drop file support with proper file path handling.",
      "Feature: Clear dashed borders show where to drop files when the app is empty.",
      "Feature: App icons are generated automatically from one master image.",
      "Fix: The interface stays responsive after exports finish.",
      "Fix: Fixed a layout overflow bug in the empty drop zone."
    ]
  },
  {
    "version": "Phase 4: Settings, Overrides & Quality of Life",
    "date": "",
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
    "date": "",
    "changes": [
      "Feature: Custom frameless window with a draggable title bar and native window controls.",
      "Feature: New dark, compact, desktop-tool look.",
      "Feature: Transport controls reorganized into a balanced three-zone layout (timecode left, buttons center, duration right).",
      "Feature: Eight dedicated transport buttons for precise playhead and trim control.",
      "Fix: Step Back and Step Forward icons no longer clash with the trim bracket icons.",
      "Fix: Play button styling is consistent with the rest of the transport bar."
    ]
  },
  {
    "version": "Phase 2: Trim UI & Audio Handling",
    "date": "",
    "changes": [
      "Feature: Center video preview with accurate timecode parsing.",
      "Feature: Interactive timeline with draggable in and out trim handles.",
      "Feature: Audio track detection, so you can pick a specific audio stream from multi-track videos.",
      "Fix: No more 'could not open encoder' errors when trimming.",
      "Fix: Audio now exports from the correct track.",
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
      "Feature: Smart export planning that hits strict file size limits like Discord's 10 MB cap.",
      "Fix: Files with spaces in their paths now load correctly."
    ]
  }
];

if (typeof module !== 'undefined') {
  module.exports = window.changelogData;
}
