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
   so links, tests and the share format are untouched. Plain HTML and CSS,
   and one inline module for what moves (item 7) and the live figure; the
   page reads without it.
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
   architecture figure are drawn in the page itself. The hero is a short loop of Catch being played: the script runs
   the CPU in slices of about 500 cycles at the 1,000 Hz setting, pauses
   after each, steps to the start of a fetch so every frame is at the same
   phase, reads the cycle counter and crops the devices (the score digits,
   the keyboard and the screen). Between slices it plays: it reads the
   screen's pixels and holds Left or Right on the keyboard part until the
   paddle is under the block, catches three, then lets one fall, which
   halts the CPU. Its key presses are the only input; every pixel is the
   CPU's. The frames are laid on a timeline of 10,000 cycles a second, 20
   frames a second, and encoded as VP9 WebM with the ffmpeg Playwright
   installs; the miss is held for two seconds before the loop restarts.
   Its poster is the frame where the third block is about to land on the
   paddle. Phones get a crop of the screen alone from the same frames.
   For that picture the reference CPU's devices sit together at the top
   of its sheet (`scripts/reference-cpu.mjs`): the digits with the keyboard
   under them, then the screen, all in the view the sheet opens to, and
   the clock and constants moved below them, and the IR registers two
   rows lower so the crop ends cleanly. Fig. 6's program is typed into the
   ROM's inspector by the script; it is not a shipped example. The script
   also records a failing Check (XOR from NAND gates with A wired straight
   to Y) and a loop that never settles (a NOR fed back into itself), so
   the page shows the diagnostics it describes. Playwright's own video
   capture is at CSS-pixel resolution, too soft for a hero; sampled frames
   are taken at 3x. It also writes each example's
   `#circuit=` link into the page, so the links match the current file
   format. Rerun it when the editor's look or the format changes:
   `node scripts/landing-shots.mjs http://localhost:5173` from `apps/web`.
5. **The half adder answers clicks without loading the engine.** Fig. 2
   holds four captures of the editor, one per combination of switches A and
   B, and buttons over the switches choose which is shown; the table beside
   it is what the editor's readout said for each. Nothing is computed on the
   page, so no evaluator outside `sim-core` (CLAUDE.md), and the editor
   itself is one link away.
6. **Motion stays optional.** The recording plays only while on screen,
   never on its own under `prefers-reduced-motion`, and always has a
   Pause/Play button. Its poster, one of its frames, stays in place until
   it plays, so the figure is never empty.
7. **The page is drawn in the editor's own signals.** A wire down the
   margin (the spine) joins every section's port; the part above the
   reading line is lit, and a section it reaches has its port and rule lit
   and its number, on seven-segment digits, lit segment by segment. Figs. 3
   and 7 open on a capture with every switch off and settle into the
   documented one in view. Fig. 5 is the whole CPU from Reset, stepped by
   the reader with arrows, a slider or Play: 64 frames, one per clock
   cycle, captured from the running editor with the cycle, the Fetch LED
   and the program counter. Under it, Catch's ROM is a tape under a read
   head, each word with its address and line of assembly: the word being
   fetched is outlined, the one executing filled. Blue outlines mark the
   blocks the current instruction uses; they are the page's annotation from
   the opcode and the circuit's layout, and the caption says so. Fig. 9 is a
   timing diagram of the worker protocol (`load`, `setInputs`, `state`)
   for one edit and one click, drawn as the waveform panel draws lanes. The
   challenge ladder marks the challenges passed in this browser, read
   read-only from the editor's IndexedDB store (ADR 0029). With reduced
   motion nothing moves on its own; the spine still follows the scroll.
   The closing shows the first pulse in three captures that come on in
   turn: two switches, an AND gate and an LED placed by their keys, wired,
   and lit.

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
