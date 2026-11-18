# 0032. Editor chrome: one primary action, a palette of symbols

- Status: Accepted
- Date: 2026-11-18
- Depends on: ADR 0007 (frontend stack); ADR 0008 (visual identity)

## Context

The bars around the canvas grew one feature at a time. Every toolbar control
had the same weight, so nothing said where to start. The parts panel opened
with Projects, kept Examples and Challenges below everything else, and had no
way to reach them but scrolling. File messages squeezed into the toolbar and
were cut off. At 900px the file buttons fell off the end of the toolbar.

## Decision

- **The toolbar has three zones:** where you are on the left (mark, project,
  sheet path), the simulation in the centre, and history, files and help on the
  right. Run is the toolbar's one filled control, which is what ADR 0008 keeps
  `--accent` for. While running it turns into a quiet accent Pause.
- **The parts panel leads with parts.** Parts are tiles with their schematic
  symbol over their name, three to a row, so the whole palette fits a laptop
  screen. Chips, Projects and Learn (challenges, examples) follow, and a sticky
  header jumps to each and marks the one in view. Every section stays in the
  page, not behind tabs, so screen readers, search and tests read one list.
- **Messages float.** Import, Export and Copy link report in a dismissible
  message under the toolbar, and tips on hover or focus explain each control.
  Escape hides a tip.
- **Shortcuts get a dialog,** from the toolbar or `?`, in place of a folded list
  at the bottom of the panel.
- **An empty sheet offers a way in:** examples and challenges, beside the hint.
- **House glyphs** live in `apps/web/src/app/icons.tsx`, all stroked in
  `currentColor`. This passes ADR 0008's dozen-icon mark for choosing an icon
  set, on purpose: the part symbols are specific to Clockyard, no set has them,
  and the toolbar glyphs are a few short paths in the same stroke.
- **New tokens** are derived from the palette (`--hover`, `--press`,
  `--accent-strong`, `--scrim`), plus motion (`--ease-out`, `--duration-*`),
  `--space-5` and `--library-nav-height`. Motion is limited to state changes
  and stops under `prefers-reduced-motion`.

## Consequences

- The design system artifact (ADR 0008) does not yet have these tokens or the
  glyphs, and should be brought up to date from `tokens.css` and `icons.tsx`.
- The about page's screenshots show the previous chrome until
  `apps/web/scripts/landing-shots.mjs` is run again.
- Tips are hidden from the accessibility tree and repeated as
  `aria-description`, so a control's name stays its label.
