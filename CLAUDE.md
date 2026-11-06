# Clockyard — agent notes

Browser-based digital logic and computer-building sandbox. Rust engine → WASM
in a Web Worker; React + PixiJS editor. Fully client-side.

Read first: [docs/brief.md](docs/brief.md) (master brief), then
[docs/architecture.md](docs/architecture.md),
[docs/simulation-model.md](docs/simulation-model.md),
[docs/roadmap.md](docs/roadmap.md) (current phase and status).

## Hard rules

- All simulation semantics live in `crates/sim-core`. No TypeScript evaluator, no fake demo outputs.
- `sim-core` has no DOM/browser/wasm-bindgen dependencies. `sim-wasm` is a thin adapter.
- Editable document and compiled netlist stay separate. Wires reference ports by ID; never infer connectivity from geometry.
- Deterministic, bounded settling. Never hang on oscillating loops; report a diagnostic.
- A user-built CPU runs through its simulated components. No hidden software CPU.
- No backend, accounts, or network calls with user data.
- Build incrementally; each phase meets its acceptance criteria in the browser before moving on.
- Significant design choices or deviations from the brief → ADR in `docs/decisions/`.
- Keep docs aligned with actual behavior; update `docs/roadmap.md` status after each increment.
- Do not publish packages or deploy without explicit authorization.
