# Roadmap

Each phase ends with a working, demonstrable result in the browser. A phase is
complete only when its acceptance criteria pass — not when its code is written.

Legend: ✅ done · 🔨 in progress · ⬜ not started

## Current status

**Phase 0 — ✅ done.** pnpm + Cargo workspaces, a Rust AND evaluator called from
the browser through WASM in a Web Worker, linting, tests and a pre-push check hook.

**Phase 1 — ✅ done** (merged in PR #7). Circuits are built on a
PixiJS canvas, simulated by the Rust engine in a worker, exported and imported
as JSON. Every acceptance item is covered by Playwright (`apps/web/e2e/`).

**Phase 4 — ✅ done.** A programmable 8-bit computer: ROM and RAM (ADR 0018),
then the reference CPU of ADR 0019, built from Clockyard parts and checked
against its specification after every cycle, its assembler, *Run until* an
LED for instruction steps (and breakpoints the user wires), and the program
editor (PRs #42 and #47–#51). The demo, a program that sums 1 to 5 through RAM and shows 15
on the output, runs in Playwright. Phase 5 (the computer-building sandbox)
has the seven increments of its plan (ADR 0020) built: devices
(ADR 0021), memory-mapped I/O on the reference CPU (ADR 0022), the game demo,
Catch (ADR 0023), sharing a circuit by link (ADR 0024), challenges 1 to 9
(ADR 0025), waveforms (ADR 0026), and examples with notes and components
from other files (ADR 0027).

**Phase 3 — ✅ done.** Clocks, flip-flops and virtual time (ADR 0017): the
engine and parts (PR #40), then run/pause/step/reset, the cycle counter and
the 8-bit counter demo.

**Phase 2 — ✅ done.**
Editing comfort, labels, junctions and nets, routing and rotation merged (PRs
#8–#14). Custom components and the 4-bit adder target demo merged (PR #16);
pins renamed safely by part ID (ADR 0013, file format v4); definitions can be
renamed and deleted (ADR 0012 amendment). Multi-bit signals, buses and
splitters (ADR 0014) are built: engine, boundary,
format v5, editor and Playwright (PRs #26–#31). Named connections (net
labels, ADR 0015) are built too (PRs #33–#36), so every addition the brief
plans for Phase 2 is in.

## Phase 0 — Foundation ✅

Goal: repository set up; browser ↔ Rust/WASM round trip proven.

- ✅ Repository structure, licenses (MIT OR Apache-2.0), README, contributing guide
- ✅ Architecture, simulation model, roadmap, initial ADRs
- ✅ Visual identity and design tokens (`apps/web/src/styles/tokens.css`, ADR 0008)
- ✅ pnpm workspace + Vite + React + strict TypeScript in `apps/web`
- ✅ Cargo workspace with `sim-core` and `sim-wasm`
- ✅ wasm-bindgen build step wired into `pnpm dev`
- ✅ Worker hosting the WASM module
- ✅ Rust AND evaluator, called from the browser, result shown in the UI
- ✅ Vitest, ESLint, rustfmt, Clippy, `cargo test`
- ✅ Pre-push hook running all checks via `pnpm verify` (replaced GitHub Actions CI, ADR 0009)

Acceptance:

- [x] Frontend builds
- [x] Rust core builds and tests pass
- [x] WASM loads in the browser; browser → Rust call works
- [x] Runs without any backend service
- [x] One documented command starts development

## Phase 1 — First playable circuit editor ✅

Goal: build and run basic combinational circuits.

Scope: canvas with pan/zoom, part placement, switches, LEDs, NOT/AND/NAND/OR/NOR/XOR
(XNOR if trivial), dragging, point-to-point wires, selection and deletion,
real Rust combinational simulation, active/inactive wire colors, JSON
import/export, initial keyboard shortcuts.

First vertical slice (inside Phase 1): two switches → AND → LED, end to end
through the engine. Validate all four input combinations visually and in a
Playwright test.

Progress:

- ✅ Built-in catalog (switch, LED, NOT/AND/NAND/OR/NOR/XOR/XNOR) in `sim-core`
- ✅ Circuit description, validation diagnostics, compile to netlist, bounded settle, oscillation report
- ✅ Worker protocol `load` / `setInput` → `loaded` / `state`
- ✅ Document format v1 types and projection to the description
- ✅ PixiJS canvas with pan/zoom, part placement, dragging, wiring, selection/deletion
- ✅ Active/inactive wire colors from engine nets; validation and unstable loops shown in the status bar and on the canvas
- ✅ Port layouts per kind, checked against the engine catalog (ADR 0004)
- ✅ JSON import/export with validation (no autosave yet: that is a later IndexedDB item)
- ✅ Keyboard shortcuts: Delete, Escape, and part keys S, L, N, A, O, X
- ✅ Playwright tests: the slice built by hand (all four inputs, move, export, reload, import), the cascade/fan-out example, a refused file
- ✅ Examples `and-gate`, `cascade-fanout` and `half-adder`, checked natively; the first two also in the browser

The canvas is pixels only, so a visually hidden list states each switch and
LED for screen readers; the browser tests read the same list.

Acceptance — a user can:

- [x] Open Clockyard
- [x] Place two switches
- [x] Place an AND gate
- [x] Place an LED
- [x] Connect them
- [x] Toggle either switch
- [x] See the correct LED output (`00→0, 01→0, 10→0, 11→1`)
- [x] Move components without breaking connections
- [x] Save the design
- [x] Reload it successfully
- [x] A cascaded circuit with fan-out also evaluates correctly

## Phase 2 — Proper circuit construction ✅

Goal: larger combinational circuits are pleasant to build.

Undo/redo, copy/paste, better wire routing, explicit junctions, named
connections, multi-bit signals and buses, splitters, component properties,
custom reusable components, nested definitions, better validation, example
circuits.

Target demo: a 4-bit adder built from a user-defined full adder instanced four
times. Hierarchical elaboration and per-instance separation are tested.

Planned order: editing comfort first (no engine change), then component
properties and labelled pins, then nets and junctions (file format v2, ADR),
then custom components (ADR), then multi-bit signals (ADR), then examples.

Progress:

- ✅ Undo/redo: Ctrl/⌘ Z, Ctrl/⌘ Shift Z or Ctrl Y; one step per drag; last 200
  edits; switch positions and selection are not edits; importing clears history
- ✅ Copy/cut/paste and duplicate (Ctrl/⌘ C, X, V, D): new IDs, wires between the
  copied parts kept, each paste one step further down-right; clipboard is
  in-memory, same tab only
- ✅ Box selection (drag empty space; Shift adds), Shift+click, select all
  (Ctrl/⌘ A), dragging a selection moves it as one undo step; panning moved to
  Space+drag or middle-button drag
- ✅ Inspector (Properties panel) for a single selected part; label field
  committed on blur or Enter, Escape cancels, one undo step per change
- ✅ Labels (`props.label`, up to 32 characters) drawn under parts and saved in
  the file; unknown props dropped on import
- ✅ Labelled pins: a switch's or LED's label names the circuit's input or output
  pin; the readout and status bar use labels ("Switch A", "(AND carry)").
  No separate pin parts: switches and LEDs become a custom component's ports
  when that lands; duplicate pin names are checked then
- ✅ Junctions and nets (ADR 0010): file format v2 with a v1 migration; the
  engine resolves nets through junctions and checks each net as a whole;
  dropping a wire on a wire splits it with a junction (one undo step);
  junctions are selected, copied and deleted like parts, and one left without
  wires is removed; a selected one drags like a part, and dragging from an
  unselected one draws a wire from it; a junction never lands on a port or another
  junction: a drop there is refused, a drag shows the blocked cell in danger
  and waits at the last free one, paste or duplicate steps further on, and
  placing a part there is refused (its preview turns to the danger colour);
  half-adder example uses junctions
- ✅ Routing (ADR 0011): wires are routed on the grid around part bodies and
  away from other nets (crossings allowed); dragging a wire segment reshapes
  it, kept as `bends` in the file; Reset route in the inspector goes back to
  automatic
- ✅ Rotation: R turns the selection 90° clockwise as a whole (parts,
  junctions and shaped wires between them), Shift R back; a turn and its
  reverse cancel exactly; one undo step; refused where a port would land on a
  junction. While placing, R and Shift R turn the part shown under the
  pointer. Ports, routing, drawing and hit-testing follow `rotation`, which
  files already held
- ✅ Routing keeps nets strictly apart (crossings only), routes again only the
  wires an edit or a drag touches, and Escape cancels a drag in progress
- ✅ Custom reusable components and nested definitions (ADR 0012): format v3
  `definitions`; labelled switches and LEDs are a definition's pins; Make
  component turns a selection into a definition with one instance in its
  place; a Chips section places instances; Edit component opens a definition
  on its own sheet (simulated on its own, own undo history); the engine
  flattens instances (own state each), refusing unknown or recursive
  definitions, bad pins and oversized expansions
- ✅ Rename a definition from an instance's inspector; delete one from Chips
  once nothing uses it (ADR 0012 amendment: not undoable, and undo steps
  holding its instances are dropped)
- ✅ Load time linear for logic that cannot reach a loop: it is evaluated in
  topological order before the first settle (same results), so a
  95,000-gate NOT chain loads in about 0.25 s instead of 48 s (release)
- ✅ Multi-bit signals, buses, splitters (ADR 0014, built in the five steps
  below). Widths are 1 to 32 bits and are declared per part
  (`props.width` on switches, LEDs and gates). A net takes the width of its
  ports, and wires store none. Each net holds a `u32`, and the delta
  scheduler is unchanged. Gates are bitwise. A wide switch or LED is a
  multi-bit input or a hex display, so chip pins widen with no new pin
  kind. `split` and `merge` parts take a `fields` list. New errors are
  `widthMismatch` and `invalidWidth`. File format v5 (the v4 migration only
  bumps the version). Steps, in order:
  1. ✅ Engine, built on the topological presettle (PR #20): `u32` net
     values with per-net widths and masks; compiled primitives separate
     from parts, so a split's fields and a merge each compile to their own;
     bitwise gates; the two new errors (per level before flattening, and
     per flat net); and a ranged `set_input`. Native tests
     (`crates/sim-core/tests/widths.rs`), including the 8-bit adder checked
     for all 131,072 inputs, now loaded from
     `examples/8-bit-adder.clockyard.json` (step 4).
  2. ✅ Boundary: `Uint32Array` net values, `wireWidths` in `loaded`, a
     numeric `setInput` checked in `sim-wasm`, and `MAX_WIDTH`
     (`max_width()`), `sized` and `fieldPorts` in the catalog. The editor
     still projects no widths, so every net it loads is 1 bit; `split` and
     `merge` are in the catalog but have no layouts until step 4.
  3. ✅ Format v5: `props.width` (a whole number from 1 to 32, on switches,
     LEDs and gates only; 1 is not stored) is checked on import and
     projected to the engine; the v4 migration only bumps the version, and
     the examples are v5. The readout already shows a wide switch or LED in
     decimal and hex ("44 (0x2C)"). `split`, `merge` and `fields` are still
     refused on import, since the canvas cannot draw them yet; they move to
     step 4. Until then a wide part draws and toggles like a 1-bit one.
  4. Editor, in two parts (ADR 0014 amendment):
     - ✅ Wide parts: Width in the inspector (one undo step; 1 removes it;
       a switch keeps the bits that still fit); wide switches and LEDs as
       5×2 bodies showing hex; a wide switch is set in the inspector's
       Value field (decimal, `0x…`, `0b…`, ↑ and ↓), which a click on it
       focuses; buses in `signal-bus` at `bus-width` with a "/8" slash, a
       hex tag on hover and "8 bits: 44, 0x2C" in the status bar; layouts
       depend on props, and a width edit that resizes a part re-routes its
       wires (a gate keeps its shape, so its wires keep their routes).
     - ✅ Splitters and mergers: Splitter and Merger in a Wiring section
       of the parts panel (four 1-bit fields when placed); Fields in the
       inspector (a comma list, lowest bits first; one undo step that also
       deletes wires to fields that go); bars 3 cells wide with each
       field's bit range beside its port, outlined in `signal-bus`;
       imported with their `fields` checks. A fields edit that keeps the
       count keeps the routes, since the ports stay where they are. Fields
       sit one cell apart: an
       8-way fan-out routes without wires touching, so the 2-cell fallback
       in ADR 0014 item 10 is not needed. The 8-bit adder is in
       `examples/`, checked natively and opened in the browser by hand
       (A = 200, B = 100 gives Sum 44 (0x2C), Cout on); step 5 makes that a
       Playwright test.
  5. ✅ Playwright (`apps/web/e2e/editor.e2e.ts`): the 8-bit adder example
     opens, A and B are typed in the inspector (A = 200, B = 0x64 gives
     Sum 44 (0x2C), Cout on; ↑ and Cin carry on to 46); and an 8-bit switch
     wired to a 1-bit LED shows the width mismatch until the LED is 8 bits
     too, after which it shows the switch's value.
- ✅ Named connections (net labels, ADR 0015, built in the four steps below). A
  label is a junction with a `name`; same-named junctions on one sheet are
  one net, never across sheets. Steps, in order:
  1. ✅ Engine: the description's junction takes `name`; same-named
     junctions are joined in the level check and in the flat circuit (by
     instance path and name); new warning `unmatchedLabel`. Native tests
     (`crates/sim-core/tests/labels.rs`) cover the ADR's list.
  2. ✅ Format v6: `junctions[].name` in the main circuit and in
     definitions, normalized on import with the label rules plus NFC; a
     blank one is dropped and one over 32 characters refused. The v5
     migration only bumps the version; the examples are v6. The
     projection copies `name` to the engine. Until step 3 a named
     junction (from a file) is drawn as a plain dot.
  3. ✅ Editor: Label in the parts panel's Wiring section places a junction
     named with the first free `n1`, `n2`, … and focuses its Name field;
     Name in the inspector for any selected junction (one undo step;
     clearing it on an unwired label removes it); a named junction is a
     small dot with a tag on the side no wire leaves, outlined in its net's
     tone, or `caution` while `unmatchedLabel` names it; selecting a label
     outlines its same-named partners; labels are kept without wires and
     can be copied, pasted and duplicated on their own, keeping their
     names; the status bar says "A label has no partner on this sheet."
     A click on the tag itself does not select the label (the dot does),
     and routing does not yet avoid tags (ADR 0015 item 7).
  4. ✅ Playwright (`apps/web/e2e/editor.e2e.ts`): a switch and an LED far
     apart, each wired to a Label named `go` (placed from the panel, its
     Name field focused); the switch lights the LED; renaming one label
     `stop` turns it off and the status bar's title lists both labels as
     joining nothing.
- ✅ 4-bit adder example: one full-adder definition instanced four times,
  checked natively for all 512 inputs and in the browser

## Phase 3 — Clocks and sequential logic ✅

Goal: hardware with memory and time.

Deterministic virtual time, clock component, rising-edge D flip-flop, register
primitive, reset, run/pause/step controls, bounded event processing, sequential
tests, clock visualization, cycle counter. Later: counters, more flip-flop
types, simple RAM/ROM, waveform inspector, expanded signal states.

Target demo: an 8-bit counter that can be paused, reset and advanced one cycle
at a time, identical regardless of frame rate.

Built as decided in ADR 0017: one global clock in ticks, a sized `dff` that
is also the register, edge sampling from each settle's starting snapshot,
and a worker-paced run loop.

- ✅ Deterministic virtual time: ticks, one per half period; the state after
  *n* ticks is the same at any speed or frame rate.
- ✅ Clock part; D flip-flop and Register (one sized `dff` kind); format v7.
- ✅ Edge sampling from the pre-edge state, for gated clocks, ripple chains
  and hand-made edges; switches that change together settle once.
- ✅ Run/Pause, Step (one cycle, ending low), Reset (switches kept) and a
  speed from 1 to 10,000 cycles per second, in the toolbar; an unstable
  loop pauses the run.
- ✅ Bounded: every settle keeps its delta limit; a run ticks within a
  budget per slice.
- ✅ Clock visualization (the clock's square wave and wire in its level)
  and a cycle counter with the clock's level in the status bar.
- ✅ Sequential tests (`crates/sim-core/tests/sequential.rs`) and the 8-bit
  counter example, checked natively and in Playwright: Step adds one, Reset
  returns to 0, and after a run the value is exactly the cycles run.

Not yet (ADR 0017 item 11): falling edges, clock enable, per-part reset,
several clocks, keeping state across edits, stepping one delta,
waveforms. RAM and ROM came in Phase 4 (ADR 0018).

## Phase 4 — Programmable 8-bit computer ✅

Goal: the central promise.

Reference CPU built from Clockyard components (accumulator, PC, IR, ALU,
control unit, ROM, RAM, output register). Instruction set and encoding designed
and documented before implementation. Assembly editor, assembler, program
loading, register and memory inspection, cycle stepping vs instruction
stepping, breakpoints if feasible.

Target demo: a small assembly program runs on the simulated CPU and shows its
result on an output device. Instructions are checked against an independent
reference specification in native Rust tests. The CPU runs through the real
netlist.

Design: ADR 0018 (ROM and RAM parts, format v8; accepted) and ADR 0019 (the
reference CPU, specified in `docs/reference-cpu.md`: 8-bit accumulator,
Harvard, 13 instructions, two cycles each; a Rust assembler crate; *Run until
an LED lights* for instruction steps, and for breakpoints as circuits the user
wires, none bundled or tested; accepted). Built in six steps:

1. ✅ ROM and RAM (ADR 0018, accepted): engine, inspection (`readMemory`), the
   ROM, RAM tiles and inspector (address bits, contents, RAM dump), format v8.
2. ✅ `crates/asm`: assembler and disassembler with every syntax rule and
   error tested, and `assemble`/`disassemble` in `sim-wasm`.
3. ✅ The CPU circuit, generated by `scripts/reference-cpu.mjs` into
   `examples/reference-cpu.clockyard.json`, and `crates/sim-core/tests/cpu.rs`:
   a model written from the specification, checked against the sheet's LEDs,
   the phase and the RAM after every cycle of the spec's examples, a program
   per instruction and flag case, a PC wrap, and 200 seeded random programs
   (half with operands near 0, so RAM and jumps meet). `pnpm verify` checks
   the committed file is the generator's output. Runs at the full 10,000 cycles
   per second in the browser.
4. ✅ `tick_until` in `sim-core` and *Run until* in the toolbar: any 1-bit LED on
   the sheet; on the reference CPU, Fetch is the instruction step and Halted
   runs a program to its end.
5. ✅ The program editor: a 16-bit ROM's inspector has an Assembly box and an
   Assemble button (errors listed by line, the ROM unchanged on error), a note
   when the words no longer match the source, and a disassembly listing.
6. ✅ The demo in Playwright: on the reference CPU, a program summing 1 to 5
   through RAM is assembled in the editor; one instruction step is two cycles;
   run until Halted, the output shows 15. ADR 0019 accepted.

## Phase 5 — Computer-building sandbox ✅

Goal: a complete product.

Challenge mode with automated behavioral checks, blueprints, bundled computer
designs, memory-mapped peripherals (seven-segment, LED matrix, keyboard,
character/pixel displays), richer instruction sets, waveform tools,
performance work, file/URL sharing, educational material.

Aspirational demo: a small game running on a processor designed in Clockyard.

Plan (ADR 0020, accepted): increments, each with its own ADR and target:

1. ✅ Devices (ADR 0021, accepted): seven-segment display, pixel screen and
   keyboard as parts; why a run stopped.
   1. ✅ Engine and catalog entries (`seg7`, `screen`, `keyboard`), format
      v9, tiles, and the seven-segment and keyboard bodies. A keyboard
      reads 0 until step 3.
   2. ✅ The screen: per-component memory reads, throttled to one per
      frame, pixels drawn MSB leftmost, `columns` in the inspector (at
      most 256 rows shown; ADR 0021 item 3, amended).
   3. ✅ Keyboard focus and key mapping: a click gives a keyboard the
      keys (accent outline, status bar hint); Esc, Tab, a click elsewhere
      or leaving the window gives them back. The keyboard shows its code,
      and the screen-reader readout lists keyboards and seven-segment
      displays.
   4. ✅ Why a run stopped: the status bar says "Stopped: LED X lit"
      or "Stopped: unstable", and nothing after a pause. The example
      `devices.clockyard.json` shows a held key's code on two
      seven-segment digits through ROM decoders and draws it on the
      screen while the clock runs; Playwright checks both, and a screen's
      inspector lists its words like a RAM's.

   Demo (done): open `devices`, Run, click the keyboard and hold Shift+A:
   the digits show 41 and the screen lights the code's pixels.
2. ✅ Memory-mapped I/O on the reference CPU, with no new instructions
   (ADR 0022, accepted): data addresses `0xF0`–`0xFF` reach the keyboard,
   a screen through a pointer port, and a hex display.
   1. ✅ Specification, reference model, circuit and native tests: an
      I/O decoder ROM on the operand, `SPTR` and `HEX` registers, a read
      bus of multiplexers, and the keyboard, screen and digits on the
      main sheet. The model is given the same keys, and random programs
      aim at the I/O window too.
   2. ✅ The devices in the default view: along the top of the CPU
      sheet, the digits with the keyboard under them, then the screen
      (moved together for the about page's recording), joined to the
      read bus and the digit decoders by net labels rather than wires
      across the sheet. The example's ROM ships "draw the key held";
      Playwright holds a key and checks the digits and the screen.

   Demo (done): open `reference-cpu`, set the speed to 100 Hz or more,
   Run, click the keyboard and hold Shift+A: the program reads `KEY`, the
   digits show 41, and eight pixels light at screen byte 0x41.
3. ✅ The game demo (ADR 0023, accepted): Catch, blocks falling in 8
   lanes onto a paddle moved with the arrow keys, score on `HEX`, a miss
   halts. Shipped as the `catch` example.
   1. ✅ Rules (`docs/reference-cpu.md`, "Catch"), the program
      (`scripts/catch.asm`, 89 words) and native tests on the circuit and
      the model with scripted keys: a catch scores and speeds up, the
      paddle stops at both edges, a miss halts, Reset plays the same game
      again. The CPU still runs at about 10,000 cycles per second.
   2. ✅ The `catch` example, generated with `reference-cpu` from the same
      circuit and checked by `--check`; a native test plays the file as
      shipped. Playwright at 10,000: with no keys the first block is
      caught (01 on the digits) and the second missed, stopping the run
      on Halted; with Right held the paddle goes to the right edge and
      the first block is missed. Demo: import `catch`, set the speed to
      10,000, Run, click the keyboard and steer with Left and Right.
4. ✅ Sharing through a URL fragment (ADR 0024, accepted): the document
   compressed into `#circuit=1.…`, opened through the same validation as
   Import, and a Copy link button next to Export.
   1. ✅ The encoding (`apps/web/src/storage/link.ts`): every example
      round-trips through a link (the `catch` CPU and game in about 7,300
      characters); a link cut short, damaged, of an unknown encoding or
      expanding past 10 MiB is refused with its reason.
   2. ✅ The editor: a link opens on load and when the fragment changes in
      the tab (asking before it replaces a circuit), shows its reason if
      refused, and leaves the address either way. Copy link, next to
      Export, copies the link and says how long it is, warning above 8,000
      characters; if the clipboard is refused the link is shown to copy by
      hand. Playwright: an AND gate's link opens in another page and
      simulates the same way; the `catch` link replaces it after asking,
      and runs; a broken link shows its reason and opens nothing.
5. ✅ Challenges checked by behavioural tests (ADR 0025, accepted): each is a
   custom component to build, checked by `sim-core` on a test bench.
   1. ✅ Engine: `sim_core::check` runs a challenge on a bench of its own,
      reporting passed, the first failing step, or why it cannot run
      (missing definition or pin, wrong width, a part not allowed, errors,
      a loop that does not settle); `sim-wasm`'s `check`. Challenges 1–5
      (inverter, XOR from NAND, half adder, full adder, 8-bit adder) are
      written by `scripts/challenges.mjs` with their solutions and
      starters; native tests pass every solution and fail every starter.
   2. ✅ Editor: a Challenges list under the chips opens a challenge's
      starter (asking before it replaces a circuit) on the sheet of the
      component to build. The Challenge panel under the inspector shows its
      text and Check, which runs the worker's `check` on the whole document
      and reports "Passed, N of N steps.", the first failing step with its
      inputs and outputs, or why it could not run; an edit to a component
      hides the report. `metadata.challenge` (format 10) records the challenge, so an
      exported file or a link reopens with its panel. Playwright: the
      inverter built from a NAND passes and its link reopens it; a wrong
      XOR names its first failing step, and an XOR gate is refused by
      name.
   3. ✅ Challenges 6–9: one-bit register and 8-bit register (`load`),
      8-bit counter (`en`, synchronous `clr`, wrapping at 255), and the ALU
      the reference CPU needs (`A ± B`, carry, zero; 8-bit adder provided).
      Clocked steps come from a model in the script; native tests pass every
      solution, fail every starter, and fail wrong circuits that once passed. Solutions and starters name their
      challenge (format 10). Playwright: the one-bit register's starter fails
      at its first loading edge, and its solution, imported, passes.
   4. ⬜ Challenges 10–12 (CPU, program, output device): later, own ADR.
6. ✅ Waveforms (ADR 0026, accepted): watched wires recorded per tick by
   the engine, in a window of 4,096 ticks, and drawn in a panel below the
   canvas.
   1. ✅ The engine: `watch`, `waves` and `wave(i)` in `sim-core`; `watch`
      and `wave(i)` in `sim-wasm`. Native tests: the record does not depend
      on how ticks are split, an input change lands at its tick and a later
      one replaces it, the window keeps the value in force, a reset or load
      clears it. Recording 16 traces costs nothing measurable on the
      reference CPU (about 120,000 cycles per second natively).
   2. ✅ The editor: Watch in a wire's inspector (at most 16), a waveform
      panel under the canvas with a lane per net (a line for one bit, a band
      with hex digits for a bus), and a cursor placed by a click and moved by
      Left and Right. The worker watches the wires again on every load, so a
      record starts at the load's tick 0. Playwright: the 8-bit counter,
      stepped three times, shows bands `01` to `03` and reads `0x00` to
      `0x03` at the cursor.
7. ✅ Library and teaching (ADR 0027, accepted): examples listed in the
   editor with notes, and components added from another file or example.
   1. ✅ Notes: `metadata.notes` (format 11), plain text of at most 4,000
      characters, in a Notes panel under the inspector; notes in every
      example, which are format 11 now; and an Examples list under the
      challenges, each file loaded when opened. Playwright: the 4-bit adder
      opens from the list with its notes, another example asks before it
      replaces it, and notes edited here travel in a link.
   2. ✅ Add components from a file or an example: a dialog under Chips;
      identical contents under the same or a numbered ID reused, otherwise
      the ID is kept if free or numbered, and containers are rewired; names
      numbered. Import now refuses components that contain themselves.
      Playwright: the counter example's 8-bit adder adds in a new circuit,
      and in challenge 5's starter it arrives as "8-bit adder 2" with
      "Full adder 2", a second add adding nothing.

## Phase 6 — Persistence, scale and depth (ADR 0028, accepted)

A project phase after the brief's five: increments with their own ADRs and
targets, as in Phase 5.

1. ✅ Local persistence (ADR 0029, accepted): projects in IndexedDB as
   project files, autosave after a second and when hidden, recent projects
   with New, rename and delete, a copy when another tab saved first, a
   component library for *Add components*, and challenge progress.
   1. ✅ Projects, autosave, the Projects panel, tabs, unavailable storage:
      IndexedDB with project files as text, a save a second after a change
      and when the page is hidden, the last project reopened on load, New
      circuit, open, rename and delete, a copy when another tab saved
      first, and the old question before replacing only where nothing can
      be saved. Playwright: a reload restores, New and reopen, delete, two
      tabs, and a browser without storage.
   2. ✅ Library and challenge progress: a chip saves to the library with
      what it contains, *Add components* lists the library next to the
      examples (and removes entries), and a passed challenge is ticked and
      remembered, with *Clear progress*. Playwright: the 4-bit adder's full
      adder saved, replaced after asking, and added to a new project; the
      inverter passed stays ticked after a reload.
2. ✅ Benchmarks (ADR 0030, accepted): generated circuits of about 1,000,
   10,000 and 50,000 parts (gate chain, fan-out, wide adder, counters, CPU
   parts), measured natively and in the browser, with results and targets
   in `docs/performance.md`; optimize what they show unmet.
   1. ✅ Generator, native harness, first results: the 1,000-part
      circuits committed and checked in `verify`, every size generated on
      demand; `pnpm bench:native`; `docs/performance.md`. Loads grow about
      linearly (about 130 ms for 10,000 gates); a 50,000-gate ripple
      settles in about 10 ms; ticking slows faster than size grows; two
      limits found (elaboration's 200,000 items, Import's 10 MB).
   2. ✅ Browser measurements (`pnpm bench`, `pnpm bench:check`), first
      results against targets: only the reference CPU's run speed is met.
      Opening 10,000 parts takes 9–20 s, a toggle 1.7–4.6 s, panning runs
      at about one frame a second, a drag step redraws everything, and
      running `counters-10k` at full speed froze the page; the engine and
      sync are cheap. Routing and drawing on the main thread are the cost.
   3. ✅ Optimizations, one per pull request, as the numbers require.
      1. ✅ Panning without redrawing: 60 fps at 1,000 parts, 2.5–5
         times faster at 10,000 (8.6–30 fps on mains power, the target met
         for two of four families in that run; one of four in the loaded
         re-measure); benchmarks on the graphics
         card from now on.
      2. ✅ Rebuilding only the wires that changed (chunks of about 64):
         a drag step 2.3–4.1 times faster at 10,000 parts; a toggle and a
         run of a large circuit are still slow, and where their time goes
         is not yet measured.
      3. ✅ Engine states: parts named once per edit, not per state (the
         list of inputs and outputs was quadratic), and only the latest
         waiting state applied. `counters-10k` runs at about 2,400 cycles
         per second instead of freezing the page.
      4. ✅ The first engine state of a burst shown at once, so a toggle's
         readout no longer waits a frame (`chain-1k` 82 → 22 ms in an
         interleaved comparison); runs on this machine compared
         interleaved, since one run varies up to two times.
      5. ✅ Routing with a tile index of parts and laid routes instead of
         a scan of all of them, the same routes: `chain-10k` opens in
         1.3 s (was 7–10 s), `chain-50k` in 6.3 s (was 136 s);
         `adder`, `counters` and `fanout` at 10,000 parts in 3.7–13 s.
      6. ✅ Canvas labels as bitmap text from installed fonts, not a
         texture each: `adder-10k` opens in 2.8–3.2 s (was 5.0–5.8 s),
         `counters-10k` in 2.7–3.3 s.
      7. ✅ Shapes shared between parts that look alike (256 per look, so
         deleting parts is no slower than before), and a look that holds
         only what a part shows, so a toggle no longer rebuilds gates: on
         mains power
         `chain-10k` opens in 0.6–0.7 s (was 1.3–1.4 s), `counters-10k` in
         2.1–2.2 s (was 2.8–3.2 s).
      8. ✅ Route searches that visit fewer cells: from 2,000 wires the
         estimate counts the bends still needed; smaller sheets route exactly
         as before. On battery, measured just before that limit, `fanout-10k`
         opens in 3.4–3.5 s (was 10.8 s) and `fanout-50k` in 14–15 s (was
         26–30 s).
      9. ✅ ASCII labels skip the full text segmenter, and a new sheet's
         readout rows and "Run until" options go in as one. On mains power
         `adder-10k` opens in 1.8 s (was 2.3 s) and `counters-10k` in 2.3 s
         (was 2.5 s); `fanout-10k` shows no clear change. Every row stays
         in Chromium's accessibility tree.
     10. ✅ An opened sheet is routed first and drawn once, with the engine's
         first state, instead of once unknown and again with the state. On
         mains power, 10,000-part opens are 120–360 ms faster; `counters-10k`
         opens in 1.4 s (was 1.7 s in the same run).
     11. ✅ After an edit, routing looks parts and junctions up by ID
         instead of searching for each: deleting one part on a 10,000-part
         sheet takes 0.38–1.55 s until its state is drawn (was 1.3–2.3 s).
     12. ✅ Three more routing checks that grew with the square of the sheet:
         nets through long chains of junctions, kept routes against many
         moved parts, and comparing large nets. Keeping routes on a sheet with an
         8,000-junction chain takes 0.1 s (was 6.5 s).
     13. ✅ A load (an edit or an open) waits up to 150 ms after routing for
         the engine's answer, so an edit is usually drawn once, with values,
         instead of once dimmed and again. On battery, deleting one part is 0.17–0.76 s
         faster on three of the four 10,000-part benchmarks.
     14. ✅ A toggle waits up to the same 150 ms for its answer, so it is
         drawn once, with values: on mains, a toggle on a 10,000-part sheet
         is drawn 40–150 ms sooner (medians 0.21–0.41 s from the click). Drawing the
         answer is what is left.

      Re-measured after these, on mains power (`docs/performance.md`, the
      new `bench:check` baseline): every 10,000-part sheet opens in
      0.25–1.6 s, and the 50,000-part ones that open in 0.85–5.1 s
      (`adder-50k` is refused after 6.1 s). Still missing or not shown:
      toggles at 10,000 parts (0.09–0.34 s to the readout; medians of
      0.21–0.41 s until drawn after item 14), deleting one part (0.38–1.55 s before item 13),
      edits at 50,000 parts (not measured since), panning `adder-10k`
      (15 fps), and the reference CPU's 10,000 cycles per second (9,614
      here, read a few per cent low).

      Closed after item 14. Real circuits are far smaller (a reference
      CPU is about 300 nets), so the interactive targets now apply at
      1,000 parts, where they are met as far as measured, and the
      10,000- and 50,000-part sheets are stress tests rather than goals
      (ADR 0030 item 4). The reference CPU's run speed stays nearly met.
      What a later step would start from is in `docs/performance.md`,
      "Left for later".
3. ⬜ Editing a running circuit (ADR 0033, accepted): an edit keeps
   flip-flops, memories, time and the waveform record; a file opens fitted
   to its circuit.
   1. ✅ Engine: `Simulator::load_keeping` carries time, switches,
      keyboards, flip-flops, RAMs and screens matched by elaborated ID, and
      the watched wires' records; a load never clocks; `watch` keeps the
      record of a net still watched. Checked natively, the reference CPU
      included; not used by the editor yet.
   2. ✅ `sim-wasm` and the worker: `keep` on `load` carries state, the
      last compiled circuit is kept through an edit's errors and dropped by
      Reset or an open (tested in `sim-wasm`), and the worker watches by
      wire.
   3. ✅ Editor: an edit's load keeps state, so a connectivity edit no
      longer restarts the circuit; an open always loads afresh, and the
      waveform record and cursor survive an edit.
   4. ⬜ Opening fits a large circuit (✅: a file, example, project or
      link that does not fit the start view opens framed, at most at
      100%; one that fits opens at the start view); the readout lists the
      clock and registers (not yet).
   5. ⬜ The target's browser tests and the remaining docs.
4. ⬜ Challenges 10–12: a CPU bench with its own ROM, RAM and device.
5. ⬜ Four-state signals: `X`, `Z`, a multiple-driver rule, a tri-state
   buffer.
6. ⬜ A second reference CPU: bit operations and call/return, specification
   first.

## Outside the phases

- ✅ An about page at `/about/` (ADR 0031): what Clockyard is, every figure a
  capture of the real editor made by `apps/web/scripts/landing-shots.mjs`,
  the half adder loadable in place, and a recording of Catch. The editor's
  wordmark links to it, asking first when the circuit is not saved in this
  browser.
- ✅ Editor chrome redesign (ADR 0032): a three-zone toolbar with Run as its
  one primary action, a tabbed left panel with a palette of part symbols, a
  focusable canvas with keyboard placement, floating messages, a shortcuts
  dialog and a way in from an empty sheet. Amended: a More menu on narrow
  windows, folding notes, a resizable waveform panel and a problems list.

## Out of scope (for now)

Backend, accounts, multiplayer, cloud storage, marketplace, analog/transistor
simulation, PCB design, full Verilog/VHDL, custom GPU renderer, physical timing
analysis, plugin system, full game campaign during the MVP.

## Next increment

Phase 4 is built, with its demo. Phase 5 is planned in ADR 0020 (accepted);
its first four increments, devices (ADR 0021), memory-mapped I/O on the
reference CPU (ADR 0022), the game demo, Catch (ADR 0023), and sharing
through a URL fragment (ADR 0024), are built with their demos, and so is
increment 5, challenges 1 to 9 checked by behavioural tests (ADR 0025);
challenges 10 to 12 wait for their own ADR. Increment 6, waveforms of
watched wires recorded by the engine (ADR 0026), and increment 7, examples
in the editor with notes and components added from other files (ADR 0027),
are built too, which completes the plan of ADR 0020. Phase 6 is planned in
ADR 0028 (accepted); its first increment, local persistence (ADR 0029), is
built. Increment 2, benchmarks (ADR 0030), is built: fourteen
optimizations, mostly of the canvas and routing, after which the
interactive targets apply at 1,000 parts and the larger sheets are kept
as stress tests. Increment 3, editing a running circuit, is next; ADR 0033
(accepted) designs it.
Rough edges still open:

- Wires kept after an edit can stay longer than needed until the file is
  opened again (by design, ADR 0011).
- Routing does not yet avoid label tags (ADR 0015).
- A component made by Make component can cover parts below it (ADR 0016).
- Make component is offered only for two or more selected items.
- The readout for screen readers lists switches, keyboards, LEDs and
  seven-segment displays only, not registers, the clock or screens.
- The program editor is offered for 16-bit ROMs only, the reference CPU's
  word size; other machines would need their own assembler (ADR 0019).
- What Catch showed the reference CPU lacks, for a later richer-CPU ADR
  (ADR 0023): bit operations, to draw single pixels rather than whole
  bytes; and a call, so drawing code is shared rather than repeated.
- Catch reads `KEY` once per step, so a quick tap can be missed while
  blocks fall slowly, and a held key moves the paddle several lanes in a
  moment once they fall fast. Moving only on a new press would fix it, at
  the cost of tapping once per lane.
- The reference CPU's sheet is dense, with long wires; its data RAM sits
  past the right edge at the default view.

Fixed since: deleting a pin no longer leaves `unknownPort` errors (ADR 0013,
amended); a click on a label's tag selects it; below 900px the inspector
moves under the canvas; Make component turns each net crossing the
selection's edge into a new pin, still wired (ADR 0016), leaves junctions
a net only passes through on the sheet, and keeps the chip's ports off
junctions; a load the engine fails on no longer leaves the editor waiting
for it; the status bar says why a run stopped (ADR 0021). UI polish: zoom
controls over the canvas (−, level, +, Fit; F fits the sheet, at most 2x), Undo and Redo in the toolbar, a hint on an empty
sheet and in the status bar while a part is armed, the shortcuts as a
folding list in the parts panel, a Run/Pause button that keeps its width,
and native scrollbars that follow the theme.

Out of scope for now: global labels across sheets and the other items ADR
0015 leaves out; editing several parts' widths at once, signed display and
widths above 32 (ADR 0014).
