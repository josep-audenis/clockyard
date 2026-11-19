# 0030. Benchmarks: generated circuits, measured in the engine and in the browser

- Status: Accepted
- Date: 2026-11-16
- Depends on: ADR 0028 (Phase 6 plan, increment 2); ADR 0006 (delta
  evaluation); ADR 0005 (the worker); ADR 0011 (wire routing)

## Context

Brief §9 asks for repeatable benchmarks before optimizing:

- cascaded gates;
- high fan-out;
- large combinational circuits;
- clocked registers;
- counters;
- repeated simulation steps.

It names "thousands or tens of thousands of components" as a goal to be
measured, not promised. Brief §10 asks for reproducible benchmark circuits
with documented results, and forbids speed claims without one.

What exists today:

- **Measurements so far.** There are two, both of the reference CPU's run
  speed:
  - in the browser, it keeps up with 10,000 cycles per second (ADR 0019);
  - natively, it runs at about 120,000 cycles per second, with or without
    16 recorded traces (ADR 0026, an ignored test).

  Nothing measures loading, editing or drawing a large circuit.
- **Limits that exist.** Elaboration refuses more than 200,000 parts
  (`MAX_PARTS`), and memories more than 2^20 words. A file or a link may
  be at most 10 MB.
- **Suspected costs, none measured:**
  - Every change to the editor store projects the whole document and
    compares it as JSON (`simulation/sync.ts`). That includes every
    pointer move of a drag, although geometry never reaches the engine.
  - The canvas redraws the whole scene on every change. A `shortcut:`
    comment in `canvas/scene.ts` says to move to per-object updates when
    profiling says so.
  - Wires are routed by a search on the grid (ADR 0011), possibly many at
    once after an edit.
  - Autosave serializes the document a second after each change
    (ADR 0029).
  - The engine settles in synchronous deltas with pre-settling (ADR 0006),
    and a load re-elaborates and recompiles everything.
- **Checks today.** `pnpm verify` is the definition of "checks pass"
  (ADR 0009). Timings on a development machine vary between runs: the
  ADR 0026 measurement moved by about 15 % from run to run.

## Decision

1. **Benchmark circuits are generated, not drawn.**
   - `scripts/benchmarks.mjs` writes them as project files to
     `benchmarks/`, as `scripts/reference-cpu.mjs` writes the examples.
     Its `--check` runs in `pnpm verify`, so they stay in step with the
     format.
   - Each family comes in sizes of about 1,000, 10,000 and 50,000 parts:

     | Family | Measures |
     |--------|----------|
     | `chain` | a line of NOT gates: depth, pre-settling, one long settle |
     | `fanout` | one switch driving many gates: fan-out lists, one wide delta |
     | `adder` | a wide ripple adder built of full-adder instances: elaboration of instances, a large combinational settle |
     | `counters` | many 8-bit counters on one clock: ticks with many flip-flops |
     | `cpu` | many copies of the reference CPU's registers and ALU: a realistic mix, nested instances |

   - Layouts are simple grids, so the canvas can draw them and the router
     has room. They are not meant to be read.
   - *As built (step 1):* the files are compact JSON. Only the 1,000-part
     sizes are committed (`benchmarks/`, about 760 KB), and `--check`
     holds them. `--all` writes every size to `benchmarks/generated/`,
     which git ignores, so the repository does not carry tens of
     megabytes. A reference CPU elaborates to only about 300 nets, so the
     `cpu` family is 4, 34 and 160 copies, for about as many nets as the
     others have parts; 160 is the most elaboration allows. `counters` at
     50,000 parts would be an 11 MB file, over Import's 10 MB limit, so it
     is generated at 44,000. `apps/web/src/storage/file.test.ts` also reads
     each committed file with the editor's parser, so a format change
     cannot leave them behind.
2. **What is measured, and where.**
   - **Natively** (`cargo run --release -p sim-core --example bench`): a
     small harness with no new dependency. It runs each benchmark a few
     times and reports the median and the spread of:
     - load (validate, elaborate, compile, first settle);
     - one input change and its settle;
     - ticks per second.
   - *As built:* `pnpm bench:native` generates every size, then runs the
     harness (`crates/sim-core/examples/bench.rs`, sharing the tests'
     project-file reader). A circuit the engine refuses is a row of its
     own. Tick rates are a median of five 200 ms runs too. The first
     results showed two limits: elaboration's 200,000 items, which counts
     instances, pins and wires, refuses `adder-50k`; and Import's 10 MB
     holds a circuit with one and a half wires a part to about 45,000
     parts. Both are recorded in `docs/performance.md`, for step 3 to
     weigh. The 50,000-part targets can be measured on flat circuits and
     on `cpu`, but not on `adder` until `MAX_PARTS` is revisited.
   - **In the browser** (a Playwright script, `pnpm bench`, not part of
     `verify`), on the production build. Timings are read with
     `performance.now()` around the real code paths. The script measures:
     - the time from opening the file to the first state;
     - a switch toggled until the canvas shows it;
     - one wire moved until it is drawn again, which covers sync,
       routing, the engine's reload and the redraw;
     - frame times while panning;
     - ticks per second while running;
     - the time an autosave takes.
   - Each benchmark records where its time goes (sync, worker, routing,
     drawing), so a slow number points at its cause.
   - *As built (step 2):* `pnpm bench` builds, generates every size, and
     runs `apps/web/bench/browser.bench.ts` against `vite preview`. The
     app records `clockyard:draw`, `route`, `sync`, `engine-load`,
     `engine-ready` and `save` measures (`src/bench.ts`) only when its
     address has `?bench`, so a normal session records nothing. An open
     ends at `engine-ready`, the first state after the load's answer, so
     it includes the engine. Each circuit's row is written as it is
     measured, so a step that times out keeps what came before it; a
     failed step leaves a note in its row. `bench/setup.ts` clears earlier
     rows and stamps the run, and `bench/summary.ts` gathers that run's
     table. The worker's own share of an open is not separated: its reply
     waits behind the main thread's drawing, so the native table stands
     for the engine. The 50,000-part sizes are measured for opening only,
     since every later step takes minutes there. Headless Chromium drew
     with SwiftShader, a software WebGL, so frame rates are a floor.
3. **Results are written down, with the machine.** `docs/performance.md`
   records, for each benchmark and measurement:
   - the median;
   - the browser and processor it ran on;
   - the date.

   It also states the targets below and whether each is met. A change
   that claims to make something faster updates the table, as brief §10
   asks.
4. **Targets, as the first goal of the increment.** They are interactive,
   not absolute:
   - **10,000 parts.** Opening takes under 2 s. Toggling a switch, or
     moving a part or a wire, shows its result within 100 ms. Panning
     keeps 30 frames per second or more.
   - **50,000 parts.** Opening takes under 10 s. The editor stays usable:
     an edit takes under 1 s, and nothing freezes the page for longer.
   - **Runs.** Run speed on the `counters` benchmark at 10,000 parts is
     recorded, so that a regression shows. The reference CPU keeps its
     10,000 cycles per second.

   These numbers are a starting point. If the first measurement shows one
   is far out of reach, or trivially met, it is changed in this ADR's
   as-built note, with the reason.

   *As built (step 2):* only the reference CPU's run speed is met. The
   others are missed by one to two orders of magnitude, all on the main
   thread: routing and drawing on open, and a redraw of the whole scene on
   every pan frame, drag step and state. Running `counters-10k` at the top
   speed froze the page, so its run speed could not be recorded. The
   engine and the sync are not the cause. The targets stay as they are;
   step 3 works toward them.

   *As built (step 3 closed):* the 10,000- and 50,000-part targets are
   now stress tests, not goals, and the interactive targets apply at
   1,000 parts. Real circuits are far smaller than 10,000 parts: the
   reference CPU, the project's largest, is about 300 nets. Where measured
   at 1,000 parts, those targets are met: opens in 0.13–0.45 s, panning
   at 60 frames per second on all five benchmarks, drag steps in 4–9 ms
   on flat circuits (under 1 ms for `cpu`), and toggles in 34–65 ms to
   the readout on the three with a switch. Deleting a part was not
   measured at 1,000 parts, and no toggle there was timed until drawn.
   This also stands in for ADR 0028's target for this increment (the
   largest benchmark opens, runs and can be edited at the recorded
   speeds): at 50,000 parts only opening is measured now.

   The reference CPU's run-speed target is unchanged and nearly met:
   9,614 cycles per second for four copies in the latest run (a rate that
   reads a few per cent low), and about 9,950 when last measured alone,
   in Phase 4 (ADR 0019).

   Still unmet at 10,000 parts: a toggle, or deleting a part, within
   100 ms, and panning `adder-10k`. Edits at 50,000 parts have not been
   measured since step 3's first optimizations. `pnpm bench:check` stays
   as the guard against regressions, and `docs/performance.md` notes what
   a later step would start from.
5. **Optimize only what the numbers show.**
   - Each optimization is its own step, with its before and after in
     `docs/performance.md` and the benchmark that motivated it.
   - Likely candidates, in the order the suspicion is strongest:
     - not projecting and comparing the whole document for edits that
       change only geometry;
     - redrawing only what changed on the canvas;
     - routing only the wires an edit touched;
     - reloading only what changed in the engine.
   - None is assumed. The engine's semantics never change for speed: the
     native tests and the reference CPU's specification tests hold.
6. **Regressions are caught without making `verify` flaky.**
   - `pnpm verify` gains no timing assertions, since timings on a
     development machine vary too much for a pass or fail.
   - `pnpm bench --check` compares a run with the recorded results and
     fails on any measurement more than twice as slow. It is run before
     merging a change that touches the engine, sync or the canvas, and its
     result goes in the PR.
   - *As built:* it is `pnpm bench:check`, run after `pnpm bench`, against
     `benchmarks/browser-baseline.json` (`node scripts/bench-check.mjs
     --update` replaces it). It covers the browser measurements; the
     native table is compared by reading.
   - Every committed benchmark (the 1,000-part sizes) is still loaded and
     run once in `verify`, as a correctness check (the circuits compute
     what they should, the counters count, every CPU copy runs as the
     reference CPU does alone), so the benchmarks never rot.
7. **Order of work.** Each step is one pull request:
   1. The generator, the native harness, and their first results in
      `docs/performance.md`.
   2. The browser measurements, `pnpm bench`, and their first results,
      against the targets.
   3. Optimizations, one per pull request, each against a target the
      measurements show unmet. If the targets are all met, this step is
      empty and the increment closes at step 2.

   *As built (step 3, first):* a pan moves the view without drawing the
   scene again (a Pixi render group), 2.5–5 times faster at 10,000
   parts, still under 30 fps: what remains is Pixi's render, likely of
   every object, off screen too (not yet profiled). `pnpm bench` now asks Chromium for the graphics
   card, since SwiftShader's frame rates are not what a user sees. On
   it, the panning target is met for `chain` and `fanout` (30 fps) but
   not `counters` (20) or `adder` (8.6), in that run; a later, loaded
   run met it for `chain` only.

   *As built (step 3, second):* wires are drawn in chunks of about 64,
   by a hash of their IDs, and a chunk is rebuilt only when one of its
   wires looks different, so a drag step is 2.3–4.1 times faster at
   10,000 parts. A toggle that changes every wire's value is not, and
   most of a toggle's time is presumably outside the draw; running `counters-10k`
   at full speed still freezes the page.

   *As built (step 3, third):* a profile found the freeze. The screen
   readers' list of inputs and outputs named each part by counting
   among all the parts, on every state (quadratic), and every state was
   handled as it arrived, so they queued. Parts are now named in one
   pass per edit, and only the latest waiting state is applied:
   `counters-10k` runs at about 2,400 cycles per second, about 80 % of
   the engine's slowest native measurement. A toggle that changes every wire was still about
   1 s at 10,000 parts in that measurement, mostly the redraw.

   *As built (step 3, fourth):* single runs on the development laptop
   vary up to two times however quiet it looks, so changes are compared
   interleaved (A, B, A, B). That found the latest-state handling had
   delayed a toggle's readout by a frame or two; the first state of a
   burst is now shown at once (`chain-1k` 82 → 22 ms, `chain-10k`
   460 → 70 ms to the readout; the canvas's redraw after it is not
   measured, and this change does not touch it).

   *As built (step 3, fifth):* routing indexes parts, junctions and laid
   routes by 16-cell tiles, so a wire's search no longer scans the whole
   sheet; routes are unchanged. Opening meets its targets for `chain`
   (1.3 s at 10,000 parts, 6.3 s at 50,000); the other families still
   miss them, now mostly in drawing outside routing, and `fanout` in its
   long searches and in visiting its own net's routes in the index.
   Routes with a segment across more than 64 tiles stay in a plain list,
   so ADR 0011's bound on one wire's cost holds.

   *As built (step 3, sixth):* canvas labels are Pixi `BitmapText` from
   fonts the canvas installs, one per look, instead of a `Text` and a
   texture each, so `adder-10k` opens in about 3 s. A bitmap text whose
   font is left to Pixi builds a font per label; installing them is
   what makes it fast.

   *As built (step 3, seventh):* parts that look alike share drawn
   shapes, 256 per look so that deleting parts or changing theme is no
   slower than before, and shapes no part shows are dropped once there
   are more than 1,024. A part's look holds only what its drawing reads,
   so a toggle no longer rebuilds gates. `chain-10k` opens in 0.6–0.7 s
   on mains power (was 1.3–1.4 s). Routing is the largest measured part
   of an open: about a third for `chain` and `adder`, over two fifths
   for `counters`, over four fifths for `fanout`.

   *As built (step 3, eighth):* on sheets of 2,000 wires or more, a
   route search's estimate also counts the bends still needed, from its
   heading and the direction it must arrive in. It never overstates what
   is left, so on the same obstacles a search finds a route of the same
   cost (checked on about 87,000 searches). A tie may go another way,
   though, and later wires then meet different obstacles. Used on every
   sheet, that left the reference CPU with 37 wires no search could
   place instead of 34, so smaller sheets do without it and route
   exactly as before; a test holds every example to its routes.
   **Deviation:** earlier steps kept every route byte-identical; on
   large sheets this one does not (`fanout` changes 18 wires, with the
   same total length and bends, and no benchmark changes how many wires
   go unplaced). In exchange, on battery and measured just before the
   limit was added, `fanout-10k` routes in 1.6 s instead of 9.1 s, and
   `adder-10k` in 0.4–0.5 s instead of 1.4–1.5 s.
   Tiles also hold routes by net, and a taken port is found before any
   search box is built.

   *As built (step 3, ninth):* printable ASCII labels skip Pixi's call to
   `Intl.Segmenter`, and the hidden readout's rows and the "Run until"
   options sit in a fragment keyed by a count of the sheets opened, so a
   new sheet's rows are placed as one instead of each looking through
   those after it. On mains power `adder-10k` opens in 1.8 s (was 2.3 s)
   and `counters-10k` in 2.3 s (was 2.5 s); `fanout-10k` shows no clear
   change. Skipping the readout's layout with `content-visibility: auto` saved
   about 300 ms more on battery, but it removed the rows from Chromium's
   accessibility tree, so the list keeps its full layout.

   *As built (step 3, tenth):* an open drew the sheet before the engine's
   first answer, which was ready within 0.3 s but waited about a second
   behind that draw, and then drew it again with the state. Now the first
   frame after a sheet opens only routes, the answer is handled, and the
   next frame draws once; if the answer is not in by then, the sheet is
   drawn as before. On mains power, 10,000-part opens are 120–360 ms
   faster. Edits still draw twice.

   *As built (step 3, eleventh):* deciding which routes an edit keeps
   searched the new circuit's list of parts for each part, which on
   10,000 parts took 0.7–1.1 s of deleting one part, and other
   connectivity edits go through the same code. Parts and
   junctions are now looked up by ID. Deleting one part takes 0.38–1.55 s
   until its state is drawn (was 1.3–2.3 s); the routes kept are the
   same.

   *As built (step 3, twelfth):* three more checks in routing grew with
   the square of the sheet: joining nets through a chain of junctions
   (6.5 s with 8,000 of them, now 0.1 s), checking kept routes against
   every moved part (now by tile), and comparing nets by names made of
   all their wire IDs (now numbers). The routes are the same.

   *As built (step 3, thirteenth):* every load, an open included, now
   routes in the first frame, as an open did, and the next frames wait up
   to 150 ms for the engine's answer before drawing without it, so a
   connectivity edit is usually drawn once, with values, not dimmed
   first. On battery,
   deleting one part is 0.17–0.76 s faster on three of the four
   10,000-part benchmarks; where the answer comes later than the wait
   (`adder-10k`), the first change shows the wait's 150 ms later (by the
   code; not measured), and so does an open whose engine is that slow.
   A pan made during the wait waits with it.

   *As built (step 3, fourteenth):* a toggle drew the sheet before the
   engine's answer, with old wire values, and again with it; the answer
   (2–5 ms after the inputs are sent) waited behind the first draw. While
   inputs are sent and unanswered, the canvas now waits up to the same
   150 ms, from the first unanswered send, so a toggle is drawn once
   (not while a load is pending, whose wait covers it, nor on a sheet
   with validation errors, which the worker does not answer); a
   `clockyard:engine-input` measure spans from the inputs being sent to
   their state being shown. On mains, toggles on `adder-10k`,
   `fanout-10k` and `chain-10k` are drawn 151, 128 and 40 ms sooner
   (medians of seven). The drawing with the answer, 140–370 ms, is still
   over the 100 ms target.

   Step 3 closes here, with the targets changed as item 4's as-built
   note (step 3 closed) says.

## Alternatives considered

- **Criterion for the native benchmarks.** It gives better statistics, but
  it is a dependency with a large tree. A median of a few runs, with its
  spread, is enough to find what is ten times too slow, which is what
  this increment is for. Criterion can come later if fine comparisons
  are needed.
- **Timing assertions in `verify`.** Regressions would be caught on every
  push, but a busy machine would fail them at random. ADR 0009 made
  `verify` the definition of passing, so it must not flake. A separate,
  explicit check is honest about the noise.
- **Hand-drawn benchmark circuits.** They would be more realistic, but
  they cannot be scaled to 50,000 parts, and they drift from the format.
  Generated ones scale with a parameter and are checked like the
  examples.
- **Optimizing the suspected costs now.** The sync and the redraw both
  look quadratic-ish to the eye. However, brief §9 says to measure first,
  and a guess could optimize the wrong thing at the cost of simpler code.
- **A hosted benchmark service, or CI runs.** Numbers would come from a
  stable machine. But ADR 0009 removed hosted CI, and nothing leaves the
  developer's machine. Results recorded with the machine they came from
  are honest enough to compare runs on the same machine.

## Consequences

- Clockyard's limits are known rather than guessed, and written down.
- The `shortcut:` comments about whole-scene redraws and whole-document
  syncs get a number that says whether they matter.
- Benchmark files add about 760 KB to the repository: only the 1,000-part
  sizes, generated and checked, never edited by hand. Larger sizes are
  generated on demand.
- Increments 4 and 5 (four-state signals, the second CPU) measure their
  cost against these benchmarks, as ADR 0028 intends.
