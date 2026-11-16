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
     `cpu` family is 4, 34 and 170 copies, for about as many nets as the
     others have parts. `counters` at 50,000 parts would be an 11 MB file,
     over Import's 10 MB limit, so it is generated at 44,000.
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
     own. The first results showed two limits: elaboration's 200,000
     items, which counts instances, pins and wires, refuses `adder-50k`
     and `cpu-50k`; and Import's 10 MB caps a file at about 45,000 parts.
     Both are recorded in `docs/performance.md`, for step 3 to weigh.
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
   - Every benchmark is still loaded and run once in `verify`, as a
     correctness check (the circuits settle, the counters count), so the
     benchmarks never rot.
7. **Order of work.** Each step is one pull request:
   1. The generator, the native harness, and their first results in
      `docs/performance.md`.
   2. The browser measurements, `pnpm bench`, and their first results,
      against the targets.
   3. Optimizations, one per pull request, each against a target the
      measurements show unmet. If the targets are all met, this step is
      empty and the increment closes at step 2.

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
- Benchmark files add a few megabytes to the repository. They are
  generated and checked, never edited by hand. The 50,000-part ones may
  instead be generated on demand, if their size is a problem; the as-built
  note will say so.
- Increments 4 and 5 (four-state signals, the second CPU) measure their
  cost against these benchmarks, as ADR 0028 intends.
