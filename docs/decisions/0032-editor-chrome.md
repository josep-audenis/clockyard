# 0032. Editor chrome: one primary action, a palette of symbols

- Status: Accepted
- Date: 2026-11-18
- Depends on: ADR 0007 (frontend stack); ADR 0008 (visual identity)

## Context

The bars around the canvas grew one feature at a time. Every toolbar control
had the same weight, so nothing said where to start. The parts panel opened
with Projects, kept Examples and Challenges below everything else, and took
some sixty Tab stops to cross. File messages squeezed into the toolbar and were
cut off. At 900px the file buttons fell off the end of the toolbar.

## Decision

- **The toolbar has three zones:** where you are on the left (mark, project,
  sheet path), the transport in the centre, and history, files and help on the
  right. The transport is one inset well that stays centred. Run is the
  toolbar's one filled control, which is what ADR 0008 keeps `--accent` for.
  It is disabled until the sheet has a part, and turns into a quiet accent Pause
  while running.
- **The left panel has three tabs:** Parts (the palette and chips), Projects and
  Learn (examples and challenges). Opening something from a tab returns to
  Parts, to build with it.
- **The palette is drawn in schematic symbols,** three to a row, and is one
  keyboard stop: arrow keys move between tiles. Enter on a tile places the part
  on the sheet, because the keyboard has no pointer to place it with.
- **The canvas takes keyboard focus.** Part and canvas keys act only while it
  has focus or nothing does, so a letter typed on a focused control does nothing
  surprising. F6 steps through toolbar, panel, canvas and inspector.
- **Fields say why.** A refused value stays in its field, marked invalid, with
  the reason, until it is corrected or Escape restores the old one.
- **Messages float.** Import, Export and Copy link report in a dismissible
  message under the toolbar. Tips explain each control on hover and focus, and
  Escape hides them.
- **Shortcuts get a dialog,** from the toolbar or `?`. **An empty sheet offers a
  way in:** the place, wire, run loop, with links to examples and challenges.
- **The status bar keeps time:** the cycle counter sits beside a small live trace
  of the clock, amber where it is 1.
- **Section headings are silkscreen:** a mono label with a trace running from it
  to the panel's edge.
- **House glyphs** live in `apps/web/src/app/icons.tsx`, all stroked in
  `currentColor`. This passes ADR 0008's dozen-icon mark for choosing an icon
  set, on purpose: the part symbols are specific to Clockyard, no set has them,
  and the toolbar glyphs are a few short paths in the same stroke.
- **New tokens** are derived from the palette (`--wash`, `--hover`, `--press`,
  `--accent-strong`, `--scrim`), plus motion (`--ease-out`, `--duration-*`),
  `--space-5`, `--library-nav-height` and `--toolbar-offset`. Motion is limited
  to state changes and stops under `prefers-reduced-motion`.

## Amendment, 2026-11-19

A second set of review rounds added:

- **A More menu.** Below 800px, history, files and help fold into a popover
  behind More, so the toolbar keeps one row. It is the same element as the
  desktop controls, laid out inline by CSS, so nothing is duplicated.
- **Room for the canvas.** Notes are a disclosure, closed by default below
  900px. The waveform panel has a grip that resizes it by drag or arrow keys.
  The empty Properties panel steps aside on narrow windows.
- **Clearer problems.** The status bar counts warnings. Warnings use a hollow
  dot, never amber. A dialog lists each distinct problem once, with how often
  it occurs, the parts it names and a Select button.
- **Controls that wait.** Run, Step, Reset and Run until stay focusable while
  unavailable, and say why.
- **Fields.** Escape first restores a field's old value; a second Escape hands
  the keyboard to the canvas.

## Consequences

- Projects and Learn are hidden until chosen, so browser tests and
  `apps/web/scripts/landing-shots.mjs` open the tab they need first.
- Selecting and wiring on the sheet still need a pointer. A keyboard user can
  place and configure parts, not connect them.
- The design system artifact (ADR 0008) does not yet have these tokens or the
  glyphs, and should be brought up to date from `tokens.css` and `icons.tsx`.
- The about page's screenshots show the previous chrome until
  `apps/web/scripts/landing-shots.mjs` is run again.
- Tips are hidden from the accessibility tree and repeated as
  `aria-description`, so a control's name stays its label.
