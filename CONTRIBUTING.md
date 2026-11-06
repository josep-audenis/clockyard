# Contributing to Clockyard

Thanks for your interest. Clockyard is early: the structure and design docs
exist, the code does not yet. The [roadmap](docs/roadmap.md) shows what is
being worked on.

## Principles

- **Correctness first.** A simulator that is subtly wrong is worse than one
  that clearly reports unsupported behavior.
- **One engine.** All simulation semantics live in `crates/sim-core` (Rust).
  Never add a second evaluator in TypeScript.
- **Document ≠ netlist.** The editable design and the compiled simulation graph
  are separate models. Connectivity is never inferred from geometry.
- **Deterministic.** Results never depend on frame rate, timers or evaluation order.
- **Small, working increments.** Every change keeps the app building and
  running. No placeholder UI that looks functional but does nothing.
- **No speculative abstraction.** Add complexity when a concrete requirement
  needs it.

## Workflow

1. Open an issue or comment on an existing one before large changes.
2. Branch from `main`.
3. Keep the change focused; include tests with engine changes.
4. Run all checks locally (below).
5. Update docs when behavior changes. Docs must describe what the code
   actually does.
6. Significant design choices get an ADR in [docs/decisions](docs/decisions/).

## Checks

Planned commands (available once Phase 0 lands):

```bash
cargo fmt --all --check
```

```bash
cargo clippy --workspace --all-targets -- -D warnings
```

```bash
cargo test --workspace
```

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:e2e
```

CI runs the same set on every pull request.

## Code style

- Rust: `rustfmt` defaults, Clippy clean, no `unsafe` without an ADR,
  no panics on user-supplied input.
- TypeScript: `strict` mode, no `any` without a comment explaining why,
  ESLint clean.
- Names say what things are. Comments explain why, not what.

## Tests

- Engine: unit tests for every gate truth table, propagation, fan-out,
  order independence, oscillation handling, clocking, elaboration.
  Property-based tests where an invariant exists.
- Frontend: document editing, serialization, import validation, worker protocol.
- End-to-end: Playwright for core browser workflows.
- Example circuits in `examples/` double as fixtures.
- Performance claims need a reproducible benchmark.

## Commits

Use clear, imperative subjects (`Add NAND gate truth table tests`). One logical
change per commit.

## Licensing

Clockyard is dual-licensed under MIT OR Apache-2.0. Unless you explicitly state
otherwise, any contribution intentionally submitted for inclusion in the work
by you, as defined in the Apache-2.0 license, shall be dual licensed as above,
without any additional terms or conditions.

New dependencies and bundled assets must use licenses compatible with both.
