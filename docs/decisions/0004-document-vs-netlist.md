# 0004. Separate circuit document and compiled netlist

- Status: Accepted
- Date: 2026-11-06

## Context

The user edits a visual design (positions, orientation, labels, wire shapes).
The engine needs an efficient connectivity graph. Mixing the two couples the
engine to visuals and makes file-format changes ripple into Rust.

## Decision

1. The **circuit document** is the authoritative, versioned, serializable
   design. Owned by the frontend.
2. Connectivity in the document is **explicit**: wires (later nets with
   junction objects) reference component ports by ID. Geometry never implies a
   connection.
3. The frontend projects the document into a geometry-free **circuit
   description** for the engine. This is the Rust ↔ TS contract.
4. `sim-core` validates, elaborates hierarchy, and compiles the description
   into an index-based **netlist**, returning an ID → net map for rendering.
5. The **built-in catalog** (kinds, port names, directions, widths) is defined
   once in `sim-core` and exported through `sim-wasm`. The frontend defines
   only port *layout*. A test asserts every catalog kind has a layout with
   matching port names.

## Consequences

- File-format migrations stay in TypeScript; the engine contract changes rarely.
- The engine can be tested natively from description fixtures and examples.
- Port names exist in two places (catalog and layout); the consistency test
  catches drift.
- Transient simulation state never leaks into saved files.
