# 0003. WASM toolchain

- Status: Accepted (confirmed in Phase 0 with wasm-bindgen 0.2.130)
- Date: 2026-11-06

## Context

The engine compiles to `wasm32-unknown-unknown` and is called from TypeScript.
Options: `wasm-pack`, the `wasm-bindgen` CLI directly, or a Vite plugin.
Tool maintenance status has shifted in recent years, so the choice must be
checked against current releases rather than older tutorials.

## Decision

Use `cargo build --target wasm32-unknown-unknown` followed by the
`wasm-bindgen` CLI with `--target web`, invoked from a root script. Pin the CLI
version to the `wasm-bindgen` crate version (they must match exactly). Output
goes to `apps/web/src/generated/sim-wasm/` (gitignored) and is imported by the
worker. Add `wasm-opt` for release builds only if size measurements justify it.

## Consequences

- Fewest moving parts; no dependency on a wrapper tool's release cadence.
- `--target web` output is a plain ES module that works in a module worker.
- CI must install the matching `wasm-bindgen-cli` version.
- `scripts/build-wasm.mjs` fails early with the install command when the CLI
  version does not match the crate pin.
- Revisit if a maintained tool clearly simplifies the dev loop (e.g. watch mode).
