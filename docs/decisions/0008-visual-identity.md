# 0008. Visual identity and design tokens

- Status: Accepted
- Date: 2026-11-06

## Context

The brief (§6.4) asks for an original identity: precise, clear, technically
sophisticated, playful without looking childish, with active and inactive
signals clearly distinct and a limited palette. ADR 0007 chose plain CSS custom
properties and a small set of house components. No UI code exists yet, so the
identity is decided before the first component is written.

## Decision

- **Source of truth** is the Clockyard design system artifact
  (https://claude.ai/artifact/BQfqcrHThHjvqt23xbAyqN): tokens with usage notes,
  brand book, house component guidelines and previews, canvas drawing rules
  (CanvasKit) and the editor layout. Its values are mirrored in
  `apps/web/src/styles/tokens.css`, which components consume through
  `var(--name)` only. A new colour, size or component changes the system first.
- **Signal is the hero.** Chrome is neutral. `--signal-high` (amber) means a
  logic 1 and is used for nothing else. 0, X, Z and buses each have their own
  token. State never rests on colour alone: 1 wires are thicker than 0, X and Z
  are dashed and lettered, buses show a hex value tag.
- **Blue is intent, amber is state.** `--accent` marks selection, focus and the
  single primary action, so what the user did and what the circuit does never
  share a colour.
- **Two themes:** Bench (dark, default) and Paper (light), switched by
  `data-theme` on `<html>`, falling back to `prefers-color-scheme`. Every text
  pair named in the token notes meets WCAG AA in both themes; wires, control
  borders and the focus ring meet 3:1.
- **Type:** IBM Plex Sans for the interface, IBM Plex Mono for machine output
  (values, counts, code, canvas labels) and the wordmark. Both OFL; self-host
  the WOFF2 files so the app makes no network requests.
- **Geometry:** 4px spacing scale, 16px canvas grid, small radii (3/6/10px),
  flat chrome divided by hairlines; shadows only for floating or lit things.
- **Canvas palette** is read from the CSS custom properties at start-up and on
  theme change; PixiJS scene code holds no colour literals.
- Type styles are emitted as `.type-<name>` classes to avoid clashing with
  component class names.

## Consequences

- Components and canvas code share one palette, so theming and accessibility
  fixes happen in one place.
- `tokens.css` is a mirror; it must be updated by hand (or by a small script)
  when the system changes. Revisit if drift becomes a problem.
- No logo and no third-party icon set yet: the wordmark is plain Plex Mono and
  a handful of house glyphs cover the toolbar. Choose a licence-compatible icon
  set (MIT, ISC or Apache-2.0) when more than a dozen icons are needed.
- X and the amber 1 are close in luminance in the light theme; the dash
  pattern and letter carry the difference. Do not drop them.
