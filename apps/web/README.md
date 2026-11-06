# apps/web — Clockyard editor

The browser application: React shell, PixiJS circuit canvas, document store,
local persistence, and the Web Worker that hosts the WASM simulation engine.

> Status: Phase 0 — Vite + React + strict TypeScript shell. A module worker
> (`src/workers/sim.worker.ts`) loads the WASM engine; the UI toggles two inputs
> and shows the AND result computed in Rust. Design tokens live in
> `src/styles/tokens.css` ([ADR 0008](../../docs/decisions/0008-visual-identity.md));
> IBM Plex is not bundled yet, so the font stacks fall back to system fonts.

## Planned layout

Directories are introduced only when code needs them.

| Path | Owns |
|------|------|
| `src/app/` | App shell, layout, toolbar, top-level providers |
| `src/editor/` | Document model, editing commands, selection, undo/redo |
| `src/canvas/` | PixiJS scene: grid, components, ports, wires, hit-testing, pan/zoom |
| `src/components/` | Small shared React UI components (buttons, panels, inspector fields) |
| `src/simulation/` | Main-thread client for the simulation worker; document → circuit description projection |
| `src/storage/` | Project file import/export, schema validation, migrations, later IndexedDB |
| `src/styles/` | Design tokens (CSS variables) and global styles |
| `src/workers/` | Worker entry that loads `sim-wasm` and runs the command loop |

## Rules

- No simulation semantics in TypeScript. The Rust engine is the only evaluator.
  The UI renders signal values it receives from the worker.
- React renders chrome (panels, menus, inspector). Canvas objects live in PixiJS,
  not in the React DOM tree.
- The project file format is owned here and is versioned. See
  [docs/architecture.md](../../docs/architecture.md#circuit-document).
