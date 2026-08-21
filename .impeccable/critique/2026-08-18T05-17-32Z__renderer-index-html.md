---
target: the ClipSend renderer UI
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-18T05-17-32Z
slug: renderer-index-html
---
# ClipSend Renderer — Design Critique

Method: DEGRADED: single-context (no sub-agent tool exposed in this session). Assessment A (design review from source) ran before Assessment B (CLI detector + in-browser detector on a harness-rendered app) entered synthesis.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Progress in titlebar with % + cancel, loading overlays, toasts, warnings badge |
| 2 | Match System / Real World | 3 | Discord-tier presets excellent; "Mbps" jargon in estimate bar |
| 3 | User Control and Freedom | 3 | Cancel everywhere, skippable tour, non-destructive trims; no undo |
| 4 | Consistency and Standards | 4 | One teal, one radius lock, one panel language |
| 5 | Error Prevention | 3 | Disabled-until-ready, size validation, plan gate, size retry with warning |
| 6 | Recognition Rather Than Recall | 3 | Tooltip shortcut hints; 7 icon-only titlebar buttons |
| 7 | Flexibility and Efficiency | 4 | Remappable shortcuts, multi-trim, bulk merge, speed-to-export |
| 8 | Aesthetic and Minimalist Design | 3 | Minimal and disciplined; dense 9px header stack at the edge |
| 9 | Error Recovery | 3 | Translated FFmpeg errors, CPU fallback, temp cleanup, surfaced warnings |
| 10 | Help and Documentation | 4 | Tour, shortcuts modal + editor, tooltips, changelog, feedback |
| Total | | 34/40 | Good |

## Design Specificity Verdict

High specificity. The workbench metaphor is executed: hand-drawn SVG waveform drop card, mono timecode readouts, live export estimate in the titlebar, always-dark letterbox. Not category-interchangeable.

CLI detector: 19 findings (regex-fallback, undercount) — 8x design-system-font (Segoe MDL2 Assets not in DESIGN.md), 9x design-system-font-size (13/14px off ramp), 1x layout-transition, 1x flat-type-hierarchy. Mostly documentation drift from the new DESIGN.md, not UI defects.

In-browser detector (harness, both themes): undersized functional text cluster (9-10px modal/section titles below 11px floor), layout transitions, 11x gpt-thin-border-wide-shadow on dropdown menus, zero contrast violations.

## Priority Issues

[P1] Functional text below the readable floor: modal titles ("What's New", "Send Feedback", "Export Complete", "Warnings", "Error", "Quick Tour") and settings section labels at 9-10px; panel headers 9px. Raise functional labels to 11px+; update DESIGN.md Micro-Label Rule. Command: typeset.

[P1] Mandatory "Calculate Plan" gate in the core loop: auto-calculate on load so the titlebar estimate is live; keep button as refresh. Command: distill.

[P2] Jargon in main workflow: "Video 4.6 Mbps" in the estimate bar. Keep size + res; soften bitrate. Command: clarify.

[P2] Titlebar overload: 7 icon-only buttons + estimate + progress in 28px. Consider grouping changelog/feedback; keep close prominent. Command: layout.

[P3] contenteditable timecode with zero affordance or validation. Add hover/focus ring + inline error. Command: harden.

[P3] Em dash in settings copy ("Tokens: ... — e.g."), violating the anti-slop copy rule. One-line fix. Command: clarify.

[P3] Dropdown shadow (1px border + 24px blur) is the strongest shadow in the system on the most common control. Tighten. Command: quieter.

## Persona Red Flags

Alex: mandatory Calculate Plan gate breaks 60s goal; sidebar stacks six controls.
Jordan: titlebar icon cluster tooltip-only; "Calculate Plan"/"Mbps" unexplained; canvas handles mouse-only (transport provides alternative).
Sam: 9-10px functional text; contenteditable timecode affordance; 10px slider thumb; dropdown arrow-key behavior unverified. Strong baseline otherwise.

## Minor Observations

- transition:width on update progress bar and a body rule (layout thrash)
- Quick Tour header at 10px reads as section label, not dialog title
- "Native" resolution option ambiguous vs "Source (1920x1080)"
- No contrast violations live; light theme held

## Questions to Consider

- Auto-plan on file load so the estimate is always live?
- Raise functional labels 1-2px (identity is in case + tracking, not size)?
- Is a 24px-blur shadow the calmest float for menus?
