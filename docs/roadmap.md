# Roadmap

Each phase ends with a working, demonstrable result in the browser. A phase is
complete only when its acceptance criteria pass — not when its code is written.

Legend: ✅ done · 🔨 in progress · ⬜ not started

## Current status

**Phase 0 — 🔨 in progress.** Repository structure, licenses and design docs
are in place. No code yet.

## Phase 0 — Foundation

Goal: repository set up; browser ↔ Rust/WASM round trip proven.

- ✅ Repository structure, licenses (MIT OR Apache-2.0), README, contributing guide
- ✅ Architecture, simulation model, roadmap, initial ADRs
- ✅ Visual identity and design tokens (`apps/web/src/styles/tokens.css`, ADR 0008)
- ⬜ pnpm workspace + Vite + React + strict TypeScript in `apps/web`
- ⬜ Cargo workspace with `sim-core` and `sim-wasm`
- ⬜ wasm-bindgen build step wired into `pnpm dev`
- ⬜ Worker hosting the WASM module
- ⬜ Rust AND evaluator, called from the browser, result shown in the UI
- ⬜ Vitest, ESLint, rustfmt, Clippy, `cargo test`
- ⬜ GitHub Actions CI running all checks

Acceptance:

- [ ] Frontend builds
- [ ] Rust core builds and tests pass
- [ ] WASM loads in the browser; browser → Rust call works
- [ ] Runs without any backend service
- [ ] One documented command starts development

## Phase 1 — First playable circuit editor

Goal: build and run basic combinational circuits.

Scope: canvas with pan/zoom, part placement, switches, LEDs, NOT/AND/NAND/OR/NOR/XOR
(XNOR if trivial), dragging, point-to-point wires, selection and deletion,
real Rust combinational simulation, active/inactive wire colors, JSON
import/export, initial keyboard shortcuts.

First vertical slice (inside Phase 1): two switches → AND → LED, end to end
through the engine. Validate all four input combinations visually and in a
Playwright test.

Acceptance — a user can:

- [ ] Open Clockyard
- [ ] Place two switches
- [ ] Place an AND gate
- [ ] Place an LED
- [ ] Connect them
- [ ] Toggle either switch
- [ ] See the correct LED output (`00→0, 01→0, 10→0, 11→1`)
- [ ] Move components without breaking connections
- [ ] Save the design
- [ ] Reload it successfully
- [ ] A cascaded circuit with fan-out also evaluates correctly

## Phase 2 — Proper circuit construction

Goal: larger combinational circuits are pleasant to build.

Undo/redo, copy/paste, better wire routing, explicit junctions, named
connections, multi-bit signals and buses, splitters, component properties,
custom reusable components, nested definitions, better validation, example
circuits.

Target demo: a 4-bit adder built from a user-defined full adder instanced four
times. Hierarchical elaboration and per-instance separation are tested.

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

Phase 0 scaffolding: workspaces, Vite app shell, `sim-core` with an AND
evaluator and tests, `sim-wasm`, build script, worker round trip, CI.
