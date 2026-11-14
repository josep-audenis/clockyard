<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/clockyard-mark-light.svg">
  <img src="docs/assets/clockyard-mark.svg" alt="" width="64" height="64">
</picture>

# Clockyard

**Build computers from their very first pulse.**

Clockyard is an open-source, browser-based digital logic and computer-building
sandbox. Wire up logic gates, combine them into adders, registers and memory,
assemble a programmable CPU, then write a program and watch your own hardware
execute it — one clock edge at a time.

Everything runs locally in your browser. No accounts, no servers, no cloud.

> **Status: pre-alpha — Phases 0–4 done.** Build circuits from gates, buses,
> custom components, clocks, flip-flops and memories, and run the bundled
> 8-bit reference CPU, programmed in its own assembly, with a keyboard,
> screen and hex display mapped into its memory. Phase 5, the
> computer-building sandbox, is in progress. See the [roadmap](docs/roadmap.md).

## Why

Computers are usually black boxes. Clockyard makes every layer something you
can build, inspect and change:

1. **Digital playground** — place switches, gates and LEDs; see signals propagate instantly.
2. **Hardware workshop** — clocks, flip-flops, registers, counters, ALUs, RAM and ROM with correct sequential semantics.
3. **Computer lab** — build a CPU from those parts, assemble a program, load it into ROM, and step through execution while inspecting the program counter, registers, buses and control signals.

A user-built CPU runs through the actual simulated components and wires.
Clockyard never swaps in a hidden software emulator.

## How it works

```
┌──────────────────────── Browser main thread ────────────────────────┐
│  React shell (panels, toolbar, inspector)                           │
│  PixiJS canvas (components, wires, signal colors, pan/zoom)         │
│  Circuit document (editable design, undo/redo, save/load)           │
└───────────────┬─────────────────────────────────────▲───────────────┘
                │ circuit description, commands       │ signal values,
                ▼                                     │ diagnostics
┌──────────────────────────── Web Worker ─────────────┴───────────────┐
│  sim-wasm  — thin wasm-bindgen adapter                              │
│  sim-core  — Rust engine: validate, elaborate, simulate             │
└─────────────────────────────────────────────────────────────────────┘
```

Two representations are kept strictly apart:

- **Circuit document** — what you design: component instances, positions,
  orientations, wires, labels, custom component definitions. Versioned JSON,
  portable across machines.
- **Compiled netlist** — what the engine runs: a flat graph of primitive
  components and nets produced by validating and elaborating the document.
  No coordinates, no visuals.

The Rust engine is the single source of truth for simulation behavior. The UI
only renders what the engine reports. Details: [architecture](docs/architecture.md),
[simulation model](docs/simulation-model.md).

## Tech stack

| Area | Choice |
|------|--------|
| App | React, TypeScript (strict), Vite |
| Canvas | PixiJS |
| State | Zustand (document store) |
| Engine | Rust → WebAssembly via `wasm-bindgen`, hosted in a Web Worker |
| Storage | JSON project files; IndexedDB later |
| Tooling | pnpm, Cargo, Vitest, Playwright, ESLint, rustfmt, Clippy, pre-push hook |

Exact versions are pinned in `package.json` and `Cargo.toml` (see
[ADR 0007](docs/decisions/0007-frontend-stack.md)).

## Repository layout

```
clockyard/
├── apps/web/          Browser app (React + PixiJS + worker)
├── crates/sim-core/   Pure Rust simulation engine
├── crates/sim-wasm/   WASM adapter over sim-core
├── examples/          Example project files (also test fixtures)
└── docs/              Architecture, simulation model, roadmap, ADRs, project brief
```

## Getting started

Prerequisites: Node.js 22.13+, pnpm 10, a stable Rust toolchain with the
`wasm32-unknown-unknown` target, and the `wasm-bindgen` CLI matching the crate
pin:

```bash
rustup target add wasm32-unknown-unknown
```

```bash
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

Then:

```bash
pnpm install
```

```bash
pnpm dev
```

For the browser tests, install Chromium for Playwright once:

```bash
pnpm --filter web exec playwright install chromium
```

`pnpm dev` builds the WASM engine and starts Vite at http://localhost:5173.
After changing Rust code, run `pnpm wasm` (the page reloads). `pnpm build`
produces a static site in `apps/web/dist`.

## Documentation

- [Project brief](docs/brief.md) — product vision and engineering instructions
- [Architecture](docs/architecture.md) — components, boundaries, data flow
- [Simulation model](docs/simulation-model.md) — signals, settling, clocks, determinism
- [Roadmap](docs/roadmap.md) — phases and acceptance criteria
- [Decisions](docs/decisions/) — architecture decision records
- [Contributing](CONTRIBUTING.md)

## Inspirations

Clockyard learns from Sebastian Lague's Digital Logic Sim, Turing Complete,
Nand2Tetris, Logisim Evolution, Ben Eater's breadboard computer, Zachtronics
puzzles and Factorio. It shares no code, artwork or branding with any of them.

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
