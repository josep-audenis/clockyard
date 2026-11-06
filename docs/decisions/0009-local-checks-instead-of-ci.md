# 0009. Local pre-push checks instead of hosted CI

- Status: Accepted
- Date: 2026-11-06

## Context

The brief (§ tooling) lists GitHub Actions for CI, and Phase 0 shipped a
workflow running rustfmt, Clippy, `cargo test`, the WASM build, ESLint,
TypeScript, Vitest and the web build. The project is developed by a small
team; we prefer the checks to fail on the developer's machine before the code
leaves it, instead of waiting for a hosted run.

## Decision

- Remove `.github/workflows/ci.yml`.
- `pnpm verify` runs the full former CI set, in the same order.
- `.githooks/pre-push` runs `pnpm verify`. `pnpm install` sets
  `core.hooksPath` to `.githooks` through the root `prepare` script, so no
  hook-manager dependency is needed.

## Consequences

- One command, `pnpm verify`, is the definition of "checks pass".
- Pushes take as long as the full check set.
- Nothing enforces the checks on the server: `git push --no-verify`, or a clone
  without `pnpm install`, skips them. Pull-request reviewers cannot see a check
  result. Revisit (re-add hosted CI) if outside contributions grow.
- Every contributor needs the full toolchain locally, including the pinned
  `wasm-bindgen-cli` (ADR 0003).
