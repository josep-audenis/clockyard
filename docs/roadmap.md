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

**Phase 3 — ✅ done.** Clocks, flip-flops and virtual time (ADR 0017): the
engine and parts (PR #40), then run/pause/step/reset, the cycle counter and
the 8-bit counter demo. Phase 4 (a programmable 8-bit computer) is next.

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
several clocks, keeping state across edits, stepping one delta, RAM/ROM,
waveforms.

## Phase 4 — Programmable 8-bit computer

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
an LED lights* for instruction steps and breakpoints; proposed). Built in six steps:

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
5. ⬜ The program editor and disassembly.
6. ⬜ Playwright and docs.

## Phase 5 — Computer-building sandbox

Goal: a complete product.

Challenge mode with automated behavioral checks, blueprints, bundled computer
designs, memory-mapped peripherals (seven-segment, LED matrix, keyboard,
character/pixel displays), richer instruction sets, waveform tools,
performance work, file/URL sharing, educational material.

Aspirational demo: a small game running on a processor designed in Clockyard.

## Out of scope (for now)

Backend, accounts, multiplayer, cloud storage, marketplace, analog/transistor
simulation, PCB design, full Verilog/VHDL, custom GPU renderer, physical timing
analysis, plugin system, full game campaign during the MVP.

## Next increment

Phase 3 is built, with its 8-bit counter demo. Phase 4 (a programmable 8-bit
computer) is designed in ADRs 0018 and 0019 (proposed); ROM and RAM come
first. Rough edges still open:

- No autosave yet (a later IndexedDB item).
- Wires kept after an edit can stay longer than needed until the file is
  opened again (by design, ADR 0011).
- Routing does not yet avoid label tags (ADR 0015).
- A component made by Make component can cover parts below it (ADR 0016).
- Make component is offered only for two or more selected items.
- Every connectivity edit resets registers and time (ADR 0017).
- The readout for screen readers lists switches and LEDs only, not
  registers or the clock.
- An imported file or opened sheet keeps the current view; Fit (F) frames
  it. Fitting on open would move the grid the Playwright tests click by.

Fixed since: deleting a pin no longer leaves `unknownPort` errors (ADR 0013,
amended); a click on a label's tag selects it; below 900px the inspector
moves under the canvas; Make component turns each net crossing the
selection's edge into a new pin, still wired (ADR 0016), leaves junctions
a net only passes through on the sheet, and keeps the chip's ports off
junctions; a load the engine fails on no longer leaves the editor waiting
for it. UI polish: zoom controls over the canvas (−, level, +, Fit; F fits
the sheet, at most 2x), Undo and Redo in the toolbar, a hint on an empty
sheet and in the status bar while a part is armed, the shortcuts as a
folding list in the parts panel, a Run/Pause button that keeps its width,
and native scrollbars that follow the theme.

Out of scope for now: global labels across sheets and the other items ADR
0015 leaves out; editing several parts' widths at once, signed display and
widths above 32 (ADR 0014).
