# 0007. Frontend stack

- Status: Accepted (exact versions pinned at Phase 0)
- Date: 2026-11-06

## Context

The editor needs a fast interactive canvas, conventional application chrome,
a document store with undo/redo, and a small dependency footprint.

## Decision

- **React + TypeScript (strict) + Vite** for the app shell.
- **PixiJS** (current major) for the circuit canvas. Canvas objects are Pixi
  display objects, not React DOM nodes. No React-Pixi binding unless it clearly
  helps; imperative scene code is easier to profile.
- **Zustand** for the document store: small, works outside React (the canvas
  subscribes directly), and makes snapshot-based undo/redo simple.
- **Plain CSS with custom properties** as design tokens. No UI component kit;
  a small set of house components in `src/components/`.
- **Vitest** for unit tests, **Playwright** for browser workflows,
  **ESLint** for linting.

Verify current stable APIs (e.g. PixiJS async `Application.init`) before
writing code rather than following older examples.

## Consequences

- Few dependencies to audit and keep license-compatible.
- Visual identity is ours, not a component library's default look.
- More UI primitives to build by hand; kept deliberately small.
