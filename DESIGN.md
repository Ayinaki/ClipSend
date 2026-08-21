---
name: ClipSend
description: A Windows desktop app for cutting video down to size.
colors:
  signal-teal: "#2ba87e"
  signal-teal-hover: "#23946d"
  deep-teal: "#00796b"
  deep-teal-hover: "#00685c"
  mint-readout: "#3ddc97"
  caution-amber: "#d9a441"
  error-red: "#ef5350"
  graphite-void: "#0a0a0a"
  graphite-base: "#0d0d0d"
  graphite-raised: "#1a1a1a"
  graphite-panel: "#141414"
  graphite-tooltip: "#2a2a2a"
  graphite-stage: "#050505"
  text-primary: "#ffffff"
  text-secondary: "#bbbbbb"
  text-tertiary: "#888888"
  text-muted: "#888888"
  text-muted-light: "#717171"
  text-tertiary-light: "#717171"
  error-red-light: "#d32f2f"
  border-soft: "#2a2a2a"
  border-strong: "#444444"
  hover-fill: "#333333"
  hover-fill-soft: "rgba(255, 255, 255, 0.08)"
  sunken-fill: "rgba(0, 0, 0, 0.35)"
typography:
  display:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "12px"
  label:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "1px"
  mono:
    fontFamily: "'Consolas', 'Courier New', monospace"
    fontSize: "11px"
  input:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "13px"
  icon:
    fontFamily: "'Segoe MDL2 Assets', 'Segoe UI Symbol', sans-serif"
    fontSize: "14px"
  icon-sm:
    fontFamily: "'Segoe MDL2 Assets', 'Segoe UI Symbol', sans-serif"
    fontSize: "10px"
rounded:
  control: "4px"
  micro: "3px"
  chip: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "12px"
components:
  button-primary:
    backgroundColor: "{colors.deep-teal}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.deep-teal-hover}"
  button-secondary:
    backgroundColor: "{colors.hover-fill}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.border-strong}"
  button-cancel:
    backgroundColor: "transparent"
    textColor: "{colors.error-red}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input-field:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  dropdown-menu:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.graphite-panel}"
    rounded: "{rounded.control}"
  tooltip:
    backgroundColor: "{colors.graphite-tooltip}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.chip}"
  checkbox:
    backgroundColor: "{colors.graphite-base}"
    rounded: "{rounded.micro}"
  checkbox-checked:
    backgroundColor: "{colors.deep-teal}"
    textColor: "#ffffff"
  toast:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.chip}"
  pill-active:
    backgroundColor: "{colors.deep-teal}"
    textColor: "#ffffff"
    rounded: "{rounded.chip}"
---

# Design System: ClipSend

## Overview

**Creative North Star: "The Workbench"**

ClipSend looks like a tool that is always ready: near-black surfaces, a single calm teal that never shouts, small dense controls sized for speed over spectacle. The app is a workbench for video, not a media player, and it reads that way at a glance. The video itself is the brightest thing in the room; the chrome stays quiet and lets the content work.

The palette is deliberately restrained. One accent hue (teal) does all the signaling: focus rings, active states, readouts, warnings kept to a single amber. Depth comes from tonal steps, not decoration, and shadows appear only on floating layers. Density is tight but never cramped; 12px controls with 8-10px gaps keep a full export workflow inside one screen. In the light theme every surface and text token flips, but the teals are shared because they clear WCAG AA on both backgrounds, and the video letterbox stays dark in both themes (media areas read as "content", like a video editor).

The system is Windows-native first: Segoe UI, MDL2 icon glyphs, a frameless custom title bar, tray behavior. Minimal is the point, and the anti-reference is any glossy media-app skin, gradient-heavy chrome, or browser-default widget.

**Key Characteristics:**
- Near-black graphite surfaces with one calm teal accent
- Small, dense, uppercase micro-labels; mono readouts for timecode
- Flat by default; tonal layering for depth; shadows only on floating layers
- Strict 4px radius lock on controls and panels
- Windows-native conventions (Segoe UI, MDL2, frameless title bar)
- Dark theme default, light variant; video letterbox always dark

## Colors

A graphite-and-teal system: cool near-black neutrals, a single accent hue in two working shades, one mint readout, one amber warning.

### Primary
- **Signal Teal** (#2ba87e): the bright accent for chrome only, where white text is not needed. Focus borders and rings, slider thumbs, open-dropdown borders, loop-active tint, toast left edges, active shortcut-group titles. Never a filled button.
- **Signal Teal Hover** (#23946d): hover variant of the accent for interactive chrome.
- **Deep Teal** (#00796b): the filled-action shade. Primary buttons, active mode-toggle segment, play button, checked checkboxes, active pills, update badge. White text sits on it at 5.3:1 (WCAG AA). Hover darkens to #00685c (6.7:1).

### Secondary
- **Mint Readout** (#3ddc97): the timecode family, a bright teal-mint from the same hue family. Timecode readouts, trim values, size estimates, loop-active icons. In the light theme it flips to Deep Teal (#00796b), which still clears AA on light surfaces.
- **Caution Amber** (#d9a441): warnings only. Warning icons, the titlebar warning badge (fixed mid-amber fill with dark #141414 text, theme-neutral). Darkens to #9a6f00 in light theme.
- **Error Red** (#ef5350): error text, cancel-button outline, error toasts and warning cards (5.2:1 on dark). In light theme it darkens to #d32f2f (4.98:1 on white, since #ef5350 is only 3.49:1 there).

### Neutral
- **Graphite Void** (#0a0a0a): the sunken wells, timecode strips, inputs at rest (surface-0).
- **Graphite Base** (#0d0d0d): the app background (bg-color).
- **Graphite Raised** (#1a1a1a): panels, form inputs, toasts (panel-bg, surface-1).
- **Graphite Panel** (#141414): sidebar panels, dropdown menus (surface-2).
- **Graphite Tooltip** (#2a2a2a): tooltips, chips (surface-3).
- **Graphite Stage** (#050505): the video stage and letterbox, darker than everything, in both themes.
- **Text**: white (#ffffff) primary, #bbbbbb secondary, #888888 tertiary, #888888 muted (4.9:1 on #1a1a1a). In light: #1c1c1c primary, #555555 secondary, #717171 tertiary and muted (4.88:1 on white, 4.68:1 on the #fafafa sidebar panels — the AA floor for these).
- **Borders**: #2a2a2a soft (panel-border), #444444 strong (border-strong, focus-adjacent edges, modal outlines).
- **Hover fills**: solid #333333, soft rgba(255,255,255,0.08).

### Named Rules
**The One Teal Rule.** One accent hue, used everywhere. Two working shades of it: bright Signal Teal for chrome and rings, deep Success Teal for filled surfaces where white text must pass AA. Never introduce a second accent hue.

**The White-Text Rule.** White text only on Deep Teal (or the fixed amber badge with dark text). On any other fill, use text-secondary or text-primary depending on the surface.

**The Letterbox Rule.** The video stage and timeline canvas stay dark in both themes. Media areas are "content", like a video editor, not chrome.

## Typography

**Display Font:** Segoe UI (with Tahoma, Geneva, Verdana fallbacks)
**Body Font:** Segoe UI (same stack)
**Label/Mono Font:** Consolas (with Courier New fallback), for readouts only

**Character:** The Windows system face, sized small and dense, doing quiet work. No display face, no serifs, no hero sizes: the largest text in the app is a 15px card heading. Hierarchy is made with weight, case, and mono, not size.

### Hierarchy
- **Display** (600, 15px): the drop-card empty-state heading, the largest text in the app.
- **Body** (400, 12px): default control and UI text, including buttons (600 weight), toasts, hints, form field labels, and helper prose. Form inputs bump to 13px for legibility.
- **Label** (700, 11px, +1px letter-spacing, uppercase): panel headers, settings section titles, shortcut-group titles, segment indicators. The micro-label is the workbench's way of labeling without adding boxes.
- **Input** (400, 13px): form fields and text inputs, one step above control text for legibility.
- **Icon** (Segoe MDL2 Assets, 14px; titlebar glyphs 10px): icon-only controls and modal header glyphs. Icons are exempt from the text-size floor.
- **Mono** (400, 11px): timecode readouts, trim values, speed select (12px with 0.5px tracking so the × glyph stays legible). The mono voice is the machine talking: exact numbers, no ambiguity.

### Named Rules
**The Mono Readout Rule.** Monospace is reserved for numeric readouts and machine values (timecode, speed, trim points). If it is a number the user must read precisely, it is Consolas; if it is prose, it is Segoe UI.

**The Micro-Label Rule.** Small-print uppercase labels (11px minimum, 700, 1-1.2px tracking) mark sections and panels; 11px is the floor for micro-labels. Sentence-case prose is body-sized (12px minimum), never 11px: field labels, helper hints, and descriptions all read at body size. Decorative exceptions are limited to badge numerals (10px in a 14px pill) and MDL2 icon glyphs. Never scale labels up into body size; if a label needs to be bigger, it stops being a label.

## Layout

A single fixed window (1500 x 800 default) with a three-band shell: a 28px custom title bar on top, a 260px settings sidebar on the left, and a flexible stage on the right. The title bar holds the app title, the mode toggle (Trim / Merge), the export estimate bar, the progress bar, and the window controls. The sidebar is a stack of collapsible panels (spacing gap 6px, padding 10px, panel margin-bottom 10px); the stage hosts the video preview, the canvas timeline, and the transport bar in Trim mode, or the clip list, timeline strip, and transport in Merge mode.

The spacing rhythm is 4/8/10/12px: 4px inside micro-controls, 8px between panel rows and control groups, 10px around panels and stage edges, 12px between control clusters. Everything is sized for one-screen density; the settings modal widens to 720px with a two-column grid (8px vertical, 20px horizontal gap) so the whole list fits the fixed 800px workbench without scrolling, while standard modals are 500px. The stage scrolls internally rather than widening the layout (`min-width: 0` on the stage).

## Elevation & Depth

Flat by default, layered by function. Depth is conveyed by tonal steps of graphite, not shadows: sunken wells are darker than the app background (inset-bg rgba(0,0,0,0.35) over surface), raised surfaces are lighter, floating layers darker with a shadow. Real shadows appear on exactly four floating layers:

### Shadow Vocabulary
All float blurs stay under 16px: wide blurs on thin-bordered floats read as an AI default, and the layering still reads with tight radii. Depth comes from offset, alpha, and z-index instead of glow.
- **Dropdown menu** (`0 8px 14px rgba(0,0,0,0.5)`): the only shadow that must beat modals (z-index 2000, above the modal overlay's 1000).
- **Tooltip** (`0 6px 12px rgba(0,0,0,0.55)`): floating hint, 11px, no pointer events.
- **Toast** (`0 6px 12px rgba(0,0,0,0.55)`): bottom-right transient notice.
- **Modal** (`0 10px 14px rgba(0,0,0,0.8)`): the heaviest shadow for the heaviest layer, with a `rgba(0,0,0,0.55)` dim plus 5px backdrop blur over the whole window.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to float (menus, tooltips, toasts, modals). No shadow on a resting button, card, or panel.

**The Inset Rule.** Anything read-only and numeric (timecode strips, trim-info chips, segment indicators) sits in a sunken well (inset-bg on the surface) with a 1px soft border, so the machine's numbers read as embedded in the workbench, not floating on it.

## Shapes

A strict 4px radius lock on controls and panels (buttons, inputs, selects, dropdowns, panels, cards, modals), 6px for the softer floating and chip shapes (tooltips, toasts, pills, the mode-toggle container), and 3px for micro-controls (transport buttons, checkboxes, trim-reset chips, scrollbar thumbs at 4px). Borders are 1px, in the soft or strong border tokens; the only filled-border exceptions are state fills (deep teal on active controls). No clipping, no rounded media corners: the video and timeline canvas are square, which keeps them unmistakably "content".

## Components

### Buttons
- **Shape:** 4px radius, 1px border (rgba(0,0,0,0.2)), 6px 12px padding, 12px/600 text.
- **Primary:** Deep Teal fill, white text. Hover deepens to #00685c. Used for the single decisive action per surface (Start Export, Export Merged Video, Apply).
- **Secondary:** #333333 fill (hover #444444), text-primary text. Supporting actions.
- **Cancel / Danger:** transparent fill, 1px Error Red border, red text; hover gets a red-tinted fill (rgba(244,67,54,0.1)).
- **Titlebar (win-btn):** 46 x 28px transparent icon buttons using Segoe MDL2 Assets glyphs at 10px; hover fills with hover-bg; the close button fills #e81123 on hover (the one Windows-red moment in the app).
- **Transport:** 24 x 24px transparent square icon buttons (13px MDL2 glyphs), hover fills hover-bg. Play is the anchor: 30px wide, Deep Teal fill, white glyph, subtle inner top highlight (`inset 0 1px 0 rgba(255,255,255,0.18)`).
- **Hover / Focus:** fills transition in 0.15s; keyboard focus gets a 2px Signal Teal outline at 2px offset (`button:focus-visible`). No glow, no lift, no scale.

### Inputs & Selects
- **Style:** graphite-raised fill, 1px soft border, 4px radius, 8px 10px padding; text 13px (12px for selects and dropdowns).
- **Focus:** border flips to Signal Teal with a 1px ring (`box-shadow: 0 0 0 1px`). Transitions at 0.15-0.2s ease.
- **Selects:** `appearance: none` kills the OS arrow; a per-theme data-URI chevron replaces it; the open popup is OS-drawn but inherits the app's color-scheme so it renders dark/light with the app.
- **Custom dropdown (cs-dropdown):** the button mirrors the select exactly; the menu floats at z-index 2000 on graphite-panel with a 1px strong border, 4px radius, and the 0 8px 14px shadow. Options highlight with hover-fill; the selected option is marked with the accent.
- **Disabled:** graphite fill, tertiary text, no pointer.

### Checkboxes
- **Style:** 16 x 16px, 3px radius, graphite-base fill with a 1px soft border. Checked flips to Deep Teal fill with a white checkmark that pops in (0.2s `checkmark-pop`, overshoot bezier 0.175/0.885/0.32/1.275). Hover and keyboard focus tint the border with Success Teal.

### Panels & Cards
- **Corner Style:** 4px.
- **Background:** graphite-panel (sidebar panels), graphite-raised (drop card).
- **Border:** 1px soft.
- **Header:** 11px/700 uppercase, +1px tracking, muted; no header background.
- **Internal Padding:** 8px 10px (content), 8px 10px 0 (header).
- **Shadow Strategy:** none at rest (Flat-By-Default Rule).

### Chips & Pills
- **Style:** hover-fill-soft background, 1px soft border, 6px radius, 11px/600 text (crop presets, speed dropdown cluster).
- **Active:** Deep Teal fill, white text, border merges to Deep Teal. The pill is the only chip that goes solid.

### Mode Toggle
A segmented control: 1px soft border, 6px container radius on graphite-base, 2px padding; each segment is a 4px-radius flat button (12px/500, text-secondary). The active segment fills Deep Teal with white text and a subtle inner top highlight plus a small drop (`0 1px 3px rgba(0,0,0,0.4)`) so it reads pressed into the track. Pressing any segment scales to 0.96.

### Tooltip
- **Style:** graphite-tooltip fill, 1px strong border, 6px radius, 11px/500 with 0.2px tracking, 6px 10px padding, shadow. A rotated-square arrow points at the hovered element, offset by a CSS var so the tip stays accurate even when edge-clamped. Entrance is a 150ms rise-and-settle animation; prefers-reduced-motion collapses it to a straight fade.

### Modals
- **Overlay:** full-window rgba(0,0,0,0.55) dim with a 5px backdrop blur (dropped to a 0.7 dim with no blur under prefers-reduced-transparency), fading in over 0.18s.
- **Content:** graphite-raised (panel-bg), 1px strong border, 4px radius, 500px wide (max 90%), settling in with a 0.22s scale-and-rise (`cubic-bezier(0.16, 1, 0.3, 1)`). Settings widens to 720px with the two-column grid; section titles are the 10px uppercase micro-labels with a trailing hairline that fills the row.

### Toasts
- **Style:** graphite-raised fill, 1px soft border, 6px radius, 12px text, 9px 14px padding, shadow. A 3px left edge carries the status color: Signal Teal (default), Deep Teal (success), Error Red (error). Slide up 8px on entry, 0.2s.

### The Timeline Canvas (signature component)
The trim timeline is a hand-drawn HTML5 canvas: a near-black track on graphite-raised, a white playhead with a soft glow, waveforms in two white-opacity layers (dim 0.2 / bright 0.8), kept/trim regions outlined in white, faint grid lines, and a ruler with major/minor ticks and muted labels. The merge timeline renders each clip as a block with a Deep Teal keep-window border and white trim handles (2px radius, dark ring so they survive bright frames). The canvas stays dark in both themes. Everything on it is drawn from the same token vocabulary, never a color outside the palette.

## Do's and Don'ts

### Do:
- **Do** use one teal hue for all signaling: Signal Teal for chrome, Deep Teal for filled actions. Stay inside the palette; the canvas colors are the only sanctioned additions and they stay monochrome white-on-graphite.
- **Do** keep the 4px radius on controls and panels, 6px on chips and floating layers, 3px on micro-controls. The shape lock is the system's quiet signature.
- **Do** put white text only on Deep Teal fills (5.3:1 AA) and reserve the bright accent for non-text chrome.
- **Do** set numeric readouts in Consolas and section labels in 10px uppercase with tracking.
- **Do** keep the video letterbox and timeline dark in both themes.
- **Do** honor prefers-reduced-motion (collapse slide/settle animations) and prefers-reduced-transparency (drop the backdrop blur) and keep the 2px keyboard focus ring.

### Don't:
- **Don't** add a second accent hue, gradients, glow, or drop shadows on resting surfaces. No neon, no lift, no decorative geometry.
- **Don't** leave browser-default widgets visible: selects get the custom chevron, scrollbars are the thin styled thumbs, checkboxes are custom.
- **Don't** use Mint Readout on light surfaces (it flips to Deep Teal in the light theme) or put the bright accent where white text must sit on it.
- **Don't** scale the micro-labels up or the mono readouts down to prose; the hierarchy is by weight, case, and mono, not by growing type.
