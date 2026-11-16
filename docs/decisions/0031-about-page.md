# 0031. An about page built from the running app

- Status: Accepted
- Date: 2026-11-16
- Depends on: ADR 0008 (visual identity); ADR 0024 (links); ADR 0027
  (examples and notes); ADR 0029 (projects saved in the browser)

## Context

Clockyard has no page that explains it. Someone given the address lands in
an empty editor. A landing page has to say what the project is, show what
it can do, and stay honest about its state, without breaking the rules the
editor follows: no network calls with user data, no faked simulation
output, the design system as the source of truth.

## Decision

1. **A second page in `apps/web`, at `/about/`.** `about/index.html` and
   `about/landing.css` are a Vite input next to `index.html`
   (`vite.config.ts`), so `pnpm build` writes both. The editor stays at `/`,
   so links, tests and the share format are untouched. Plain HTML and CSS;
   the only script is a small inline module for the two interactive
   figures.
2. **Design system tokens, page-sized type.** The page imports
   `src/styles/tokens.css` and uses its colours, radii and families. Type
   sizes above the system's `title` are the page's own. Amber still means
   a logic 1 and nothing else, and blue is intent. A crop of the canvas
   has no box: it shares the page's ground and dot grid, and its edges fade
   out. Only the editor's panels, the live figure and the architecture
   diagram are framed.
3. **IBM Plex, self-hosted, in the page and the editor.** `@fontsource/ibm-plex-sans`,
   `-mono` and `-sans-condensed` (exact versions) give the WOFF2 files ADR
   0008 asks for, served from the site's own origin. The editor imports
   Sans and Mono in `main.tsx` and redraws its canvas labels once Mono has
   loaded; the page also uses Plex Sans Condensed for its headings, a
   face the design system keeps for pages ("Pages" in its brand book).
   With it, two small editor fixes the captures showed: canvas captions
   get a halo in the ground colour so wires behind them do not strike
   them through, and a part whose label repeats its kind is named once
   ("Clock", not "Clock Clock").
4. **Every screenshot is the real editor.** `apps/web/scripts/landing-shots.mjs`
   drives the editor with Playwright against a running dev server, opens
   the shipped examples and a challenge solution, and writes the
   screenshots under `about/shots/` in both themes. No screenshot is drawn
   by hand; the CPU shot only hides the zoom controls. The wire legend and the
   architecture figure are drawn in the page itself. The hero is a short loop of Catch: the script runs the CPU in
   short slices at the 1,000 Hz setting, pauses after each, steps to the
   start of a fetch so every frame is at the same phase, reads the cycle
   counter and crops the part of the circuit around the screen: the
   screen, the score digits, the keyboard, the ROM and the wiring between
   them, so the game is seen running on gates and wires (phones get the
   screen alone, from the same frames); the frames are then laid on a timeline
   of 10,000 cycles a second, 20 frames a second, and encoded as VP9 WebM
   with the ffmpeg Playwright installs. The last frame is held for a
   moment before the loop restarts. Fig. 6's program is typed into the
   ROM's inspector by the script; it is not a shipped example. The script
   also records a failing Check (XOR from NAND gates with A wired straight
   to Y) and a loop that never settles (a NOR fed back into itself), so
   the page shows the diagnostics it describes. Playwright's own video
   capture is at CSS-pixel resolution, too soft for a hero; sampled frames
   are taken at 3x. It also writes each example's
   `#circuit=` link into the page, so the links match the current file
   format. Rerun it when the editor's look or the format changes:
   `node scripts/landing-shots.mjs http://localhost:5173` from `apps/web`.
5. **The live figure loads the real editor on request.** A button (or a
   click on the picture, or the hero's "Load a half adder") replaces
   a screenshot with the editor in an iframe at `../#circuit=…`, the half
   adder. Nothing loads until it is pressed, it is offered only on wide
   screens, and until the editor is clicked the wheel scrolls the page.
6. **Motion stays optional.** The recording plays only while on screen,
   never on its own under `prefers-reduced-motion`, and always has a
   Pause/Play button. Its poster, one of its frames, stays in place until
   it plays, so the figure is never empty.

## Consequences

- Screenshots go stale when the editor changes. The script makes
  refreshing them one command, but someone has to run it; the page shows
  what the editor looked like on its date.
- Frame sampling makes the loop smooth but slow to capture: about two
  minutes per theme.
- The shot script depends on Playwright's bundled ffmpeg reading MJPEG and
  having a VP9 encoder. If a Playwright update drops it, point the script at a system
  ffmpeg.
- The Fig. 5 block outlines are placed by hand, as percentages of the
  picture; check them whenever `cpu-*.png` is regenerated.
- The live figure reaches into the editor's page: it waits for the
  project name (`.project-name`), clicks the Fit button by its text, and holds the wheel
  until the editor is clicked. An editor change can break it quietly.
- There is no `og:image` yet: social cards need an absolute URL, which
  needs the site deployed (out of scope until authorised).
