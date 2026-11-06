# 0002. Monorepo layout

- Status: Accepted
- Date: 2026-11-06

## Context

The project combines a TypeScript web app and Rust crates that must build
together. The engine must be testable natively and reusable outside the browser.

## Decision

One repository with two workspaces side by side:

- **pnpm workspace** — `apps/web` (more packages only if a real need appears).
- **Cargo workspace** — `crates/sim-core` (pure engine, no browser dependencies)
  and `crates/sim-wasm` (thin wasm-bindgen adapter).

Root scripts orchestrate both (`pnpm dev`, `pnpm build`, `pnpm test`).
Directories from the proposed layout are created only when code needs them.

## Consequences

- One clone, one PR can change engine and UI together.
- `sim-core` stays free of `wasm-bindgen`, `web-sys`, `js-sys`; enforced by its
  `Cargo.toml` having no such dependencies.
- Contributors need both Node and Rust toolchains.
