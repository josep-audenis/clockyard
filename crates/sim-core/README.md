# sim-core — Clockyard simulation engine

Pure Rust digital logic simulation engine. No DOM, no browser APIs, no
`wasm-bindgen`. Runs natively for tests and benchmarks, and in the browser
through [`sim-wasm`](../sim-wasm).

> Status: Phase 0 — a single `and_gate` evaluator with a truth-table test.

## Planned modules

Introduced as code requires them.

| Module | Owns |
|--------|------|
| `circuit/` | Input circuit description types, validation, definition resolution, hierarchical elaboration |
| `logic/` | Signal values, component kinds and their evaluation functions, the built-in catalog |
| `simulation/` | Compiled netlist, event scheduling, settling, clocking, virtual time, diagnostics |

## Contract

- Deterministic: the same circuit and the same command sequence always produce
  the same state, independent of host, frame rate, or evaluation order.
- Never hangs: settling is bounded and reports instability as a diagnostic.
- Never panics on user input: malformed circuits return validation errors.
- Public API kept small and clean enough to publish as a standalone library later.

See [docs/simulation-model.md](../../docs/simulation-model.md).
