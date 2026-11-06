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

**Phase 2 — 🔨 in progress** (branch `feat/phase-2-properties`). Editing
comfort merged in PR #8. Component labels, the inspector and labelled pins done.
Next: explicit junctions and nets (format v2).

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

## Phase 2 — Proper circuit construction

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
- ⬜ Explicit junctions and nets, better wire routing (format v2 + migration)
- ⬜ Custom reusable components and nested definitions
- ⬜ Multi-bit signals, buses, splitters
- ⬜ 4-bit adder example and tests

## Phase 3 — Clocks and sequential logic

Goal: hardware with memory and time.

Deterministic virtual time, clock component, rising-edge D flip-flop, register
primitive, reset, run/pause/step controls, bounded event processing, sequential
tests, clock visualization, cycle counter. Later: counters, more flip-flop
types, simple RAM/ROM, waveform inspector, expanded signal states.

Target demo: an 8-bit counter that can be paused, reset and advanced one cycle
at a time, identical regardless of frame rate.

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

Phase 2 explicit junctions and nets, with better wire routing: file format v2
with a migration from v1, and an ADR. Known limits still open: wires from
different nets can share a bend column, no part rotation, no autosave, the
inspector does not collapse on narrow screens yet.
