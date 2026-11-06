# sim-wasm — WebAssembly adapter

Thin `wasm-bindgen` layer that exposes [`sim-core`](../sim-core) to
TypeScript. It converts between JS values and engine types and contains no
simulation logic of its own.

> Status: Phase 1 — exposes `Engine` (`load`, `set_input`, `nets`); structured values cross as JSON,
> net values as a `Uint8Array`. Built by `pnpm wasm` (`scripts/build-wasm.mjs`).

## Responsibilities

- Accept a circuit description (JSON at first) and return compile diagnostics
  plus the ID → net-index mapping the renderer needs.
- Forward commands (`setInput`, `settle`, `stepClock`, `runCycles`, `reset`).
- Return signal state as typed arrays (`Uint8Array` of net values first;
  changed-net deltas once measurements justify it).
- Export the built-in component catalog (kinds, port names, directions, widths)
  so the editor never redefines port semantics.

## Build

Run `pnpm wasm` from the repo root. It does the equivalent of
([ADR 0003](../../docs/decisions/0003-wasm-toolchain.md)):

```bash
cargo build -p sim-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir apps/web/src/generated/sim-wasm target/wasm32-unknown-unknown/release/sim_wasm.wasm
```

The generated output is gitignored and rebuilt by the dev script.
