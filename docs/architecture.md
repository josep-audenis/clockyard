# Architecture

Status: **proposed** — describes the target design for Phase 0–1. Sections are
updated as code lands; anything not yet built is marked *planned*.

## Goals

- Entirely client-side, deployable as static files.
- One simulation engine, in Rust, compiled to WebAssembly.
- Editor, rendering and persistence in TypeScript.
- Clear seams so the engine can be tested natively and reused outside the browser.

## System overview

```
┌──────────────────────────── Main thread ────────────────────────────┐
│                                                                     │
│  app/        React shell: toolbar, parts panel, inspector, status   │
│  editor/     Document store (Zustand), editing commands, undo/redo  │
│  canvas/     PixiJS scene, hit-testing, pan/zoom, signal colors     │
│  storage/    Import/export, schema validation, migrations           │
│  simulation/ Worker client; document → circuit description          │
│                                                                     │
└──────────────┬──────────────────────────────────────▲───────────────┘
               │ postMessage (typed commands)         │ postMessage (results)
┌──────────────▼──────────────── Worker ──────────────┴───────────────┐
│  workers/sim.worker.ts   command loop, run pacing                   │
│  sim-wasm                wasm-bindgen adapter (JSON / typed arrays) │
│  sim-core                validate → elaborate → compile → simulate  │
└─────────────────────────────────────────────────────────────────────┘
```

## Ownership

| Concern | Owner |
|---------|-------|
| Canvas rendering, positions, wire geometry, selection, input handling | `apps/web` (canvas, editor) |
| Menus, panels, inspector | `apps/web` (app, components) |
| Undo/redo of editing actions (circuit snapshots in the store; transient state is not history) | `apps/web` (editor) |
| Project file format, versions, migrations, persistence | `apps/web` (storage) |
| Built-in component catalog: kinds, port names, directions, widths | `sim-core` (exported via `sim-wasm`) |
| Port *layout* (where a port sits on a component's body) | `apps/web` (canvas) |
| Validation of connectivity, elaboration of custom components | `sim-core` |
| Signal state, propagation, scheduling, clocks, sequential state, virtual time | `sim-core` |
| Stability/oscillation detection, runtime diagnostics | `sim-core` |

The UI never computes a signal value. It renders values received from the worker.

## Circuit document

The editable design. Owned by the frontend, serialized as JSON, versioned.

Format version 4 (ADRs 0010, 0012, 0013; exact schema fixed in code with validation):

```json
{
  "format": "clockyard",
  "version": 4,
  "metadata": { "name": "AND demo", "createdAt": "2026-11-06T12:00:00Z", "modifiedAt": "2026-11-06T12:00:00Z" },
  "circuit": {
    "components": [
      { "id": "k3f9a", "kind": "switch", "position": { "x": 0, "y": 0 }, "rotation": 0, "props": { "label": "A" } },
      { "id": "p81c2", "kind": "and",    "position": { "x": 6, "y": 1 }, "rotation": 0, "props": {} },
      { "id": "m02de", "kind": "led",    "position": { "x": 12, "y": 1 }, "rotation": 0, "props": {} }
    ],
    "junctions": [
      { "id": "j4c01", "position": { "x": 4, "y": 1 } }
    ],
    "wires": [
      { "id": "w7a10", "from": { "component": "k3f9a", "port": "out" }, "to": { "junction": "j4c01" } },
      { "id": "w7a12", "from": { "junction": "j4c01" }, "to": { "component": "p81c2", "port": "a" } },
      { "id": "w7a13", "from": { "junction": "j4c01" }, "to": { "component": "p81c2", "port": "b" } },
      { "id": "w7a11", "from": { "component": "p81c2", "port": "out" }, "to": { "component": "m02de", "port": "in" } }
    ]
  },
  "definitions": [
    { "id": "d1", "name": "Full adder", "circuit": { "components": [], "junctions": [], "wires": [] } }
  ]
}
```

Rules:

- IDs are stable, opaque strings generated in the browser. Never array indices.
- Positions are in grid units; rendering scales them.
- **Wires reference their ends explicitly**: a port `{ component, port }` or a
  junction `{ junction }`. Connectivity comes from references, never from
  geometry. Two wires crossing on screen are not connected.
- A **junction** is a document object, not an overlap. Wires that share a port
  or junction form one net; the engine resolves nets (ADR 0010). Bus widths
  join the format with multi-bit signals.
- `rotation` (0, 90, 180, 270, clockwise) turns a part about its box; the
  canvas derives the turned port positions (`canvas/layout.ts`, `layoutOf`).
- A wire's route is geometry only. It is routed on the grid automatically
  (`canvas/routing.ts`), unless the user shaped it: then its optional `bends`
  lists the route's interior grid points (at most 64; ADR 0011).
- **Custom components** (ADR 0012): `definitions` lists `{ id, name, circuit }`;
  an instance is a part with `kind: "custom"` and `definition: id`. Inside a
  definition, every switch is an input pin and every LED an output pin, in
  top-to-bottom order; their labels are what the chip shows. An instance's ports are named by those
  pin parts' IDs, so relabelling a pin keeps its wires (ADR 0013).
  IDs never contain `/`, which separates instance paths once expanded.
- Transient simulation data (signal values, clock count) is never part of the
  document.
- Loading an older `version` runs explicit migrations in `storage/`
  (v1 → v2 adds an empty `junctions` list, v2 → v3 an empty `definitions`
  list, v3 → v4 renames instance ports from pin labels to pin part IDs). Unknown future versions are
  rejected with a clear message. Export always writes the current version.
- Import (`storage/file.ts`) treats the file as untrusted: every field is
  type-checked, unknown fields are dropped, IDs must be unique across parts,
  junctions and wires, wires must reference existing parts and junctions, and
  positions are whole numbers within ±1,000,000 grid cells. Port names are checked by the engine on load.
  Switch positions are transient and never saved.
- `props` holds editor-only properties; the engine never sees them. Today that
  is `label`: one line of text, at most 32 characters, edited in the inspector
  and drawn under the part. Control characters become spaces, bidi and
  zero-width characters are removed and the ends are trimmed, both in the
  editor and on import. The editor stops at 32 characters; an imported file
  with a longer label is refused. A switch's or LED's label names the
  circuit's input or output pin, for the readout, the status bar and the pin names drawn on a custom
  component built from the circuit (ADR 0013). Unknown props are dropped on import.

## Circuit description (engine input)

The worker does not receive the document. `simulation/` projects the document
into a geometry-free **circuit description**: component IDs, kinds, properties,
definitions and connections. This keeps the engine contract small and lets the
file format evolve (migrations, layout fields) without touching Rust.

```ts
// apps/web/src/simulation/protocol.ts ↔ sim-core `description`
type CircuitBody = {
  components: { id: string; kind: string; definition?: string }[];
  junctions: { id: string }[];
  connections: { id: string; from: Endpoint; to: Endpoint }[]; // id = document wire ID
};
type CircuitDescription = CircuitBody & {
  // Pins listed explicitly: { name, component } for each switch (inputs) and LED (outputs).
  definitions: (CircuitBody & { id: string; inputs: PinDesc[]; outputs: PinDesc[] })[];
};
type Endpoint = { component: string; port: string } | { junction: string };
```

A connection may list its output end in either `from` or `to`. The engine
joins every port and junction that connections share into nets and checks each
net as a whole (`docs/simulation-model.md#nets`); `wireNets` reports the net of
every wire, so the frontend never remaps IDs. Component `props` join the description when a kind needs
one.

The projection is a pure function with unit tests.

## Compiled netlist

Produced inside `sim-core` from a circuit description:

```
circuit description
   → validate (known kinds, existing ports, directions, widths, single driver)
   → resolve definitions (missing / recursive definitions and bad pins are errors; ADR 0012)
   → elaborate hierarchy into flat primitives (each instance gets its own state)
   → build nets (one driver, N readers)
   → compiled netlist: dense arrays indexed by u32
```

Compile returns either a list of validation diagnostics (each pointing at
document IDs) or a netlist plus **ID maps**: wire ID → net index and
component ID → port name → net index. Net 0 is an undriven ground that
unconnected inputs read. The renderer uses the maps to color wires and LEDs
from the net value array.

## Worker protocol

Typed discriminated unions over `postMessage`. No RPC library at first.

```ts
// main → worker
type Command =
  | { type: "load"; circuit: CircuitDescription }
  | { type: "setInput"; component: string; value: 0 | 1 }
  | { type: "reset" }                  // planned
  | { type: "stepClock" }              // Phase 3
  | { type: "run"; cyclesPerSecond: number } // Phase 3
  | { type: "pause" };                 // Phase 3

// worker → main
type Result =
  | { type: "ready" }
  | { type: "loaded"; netCount: number; wireNets: Record<string, number>;
      portNets: Record<string, Record<string, number>>; diagnostics: Diagnostic[] }
  | { type: "state"; nets: Uint8Array; diagnostics: Diagnostic[] }
  | { type: "error"; message: string };
```

- Commands are processed in order. The engine settles after each input change
  and replies with state.
- `simulation/sync.ts` sends `load` only when the projected description
  changes, so moving a part keeps the engine's state. Switch positions live in
  the editor store (transient, never saved) and are re-sent after each load.
  States that arrive while a newer load is pending are dropped.
- `loaded.diagnostics` holds validation results only. The initial settle's
  runtime result (an unstable loop) arrives with the first `state`, so the
  settles that follow, such as restored switch positions, replace it.
- Phase 1 sends the full net value array (small circuits). Changed-net deltas
  or transferable buffers come when measurements justify them.
- During continuous runs (Phase 3) the worker advances virtual time in batches
  and posts state at most once per animation frame's worth of wall time. The
  main thread renders the latest state it has; frame rate never affects results.

## Rendering

- PixiJS owns the canvas: component bodies, ports, wires, selection, hover,
  signal coloring (`canvas/scene.ts`, drawn to the design system's CanvasKit
  spec). The dot grid is the host element's CSS background, moved with the view.
- Phase 1 redraws three `Graphics` layers (wires, bodies, overlay) on the next
  animation frame after any store change; the render loop is otherwise idle.
  Per-object updates replace this when profiling says so.
- Hit-testing is pure geometry in grid units (`canvas/geometry.ts`); it decides
  only what the pointer is over, never connectivity.
- React subscribes to the document store for panels; the canvas subscribes
  outside React render to avoid re-rendering per signal change.
- High-DPI via Pixi `resolution` = `devicePixelRatio` and `autoDensity`.
- Optimizations (batching, culling, caching) only after profiling.

## Build and run

`scripts/build-wasm.mjs` (`pnpm wasm`):

1. Checks the installed `wasm-bindgen` CLI matches the crate pin in `crates/sim-wasm/Cargo.toml`.
2. `cargo build -p sim-wasm --target wasm32-unknown-unknown --release`
3. `wasm-bindgen --target web` → `apps/web/src/generated/sim-wasm/` (gitignored)

`pnpm dev` at the repo root runs `pnpm wasm` once, then the Vite dev server; the
module worker (`src/workers/sim.worker.ts`) imports the generated module. Rust
changes need a `pnpm wasm` (or restart of `pnpm dev`); there is no Rust watch
mode yet. `pnpm build` writes a static directory (`apps/web/dist`) deployable
to any static host.

## Testing

| Layer | Tool | Covers |
|-------|------|--------|
| `sim-core` | `cargo test`, property tests | Truth tables, propagation, fan-out, order independence, oscillation, clocking, elaboration |
| `sim-wasm` | `cargo test` + a small Vitest smoke test loading the built module | Boundary conversions |
| `apps/web` | Vitest | Document edits, projection, serialization, import validation, worker protocol |
| Browser | Playwright | Switch → gate → LED workflow; later save/load and clock stepping |
| Performance | Criterion-style benchmarks (chosen at Phase 1) | Cascades, fan-out, large combinational, registers, counters |

## Decisions

See [decisions/](decisions/). Key ones:
[monorepo layout](decisions/0002-monorepo-layout.md),
[WASM toolchain](decisions/0003-wasm-toolchain.md),
[document vs netlist](decisions/0004-document-vs-netlist.md),
[engine in a worker](decisions/0005-simulation-in-worker.md),
[delta-cycle evaluation](decisions/0006-delta-cycle-evaluation.md),
[frontend stack](decisions/0007-frontend-stack.md).
