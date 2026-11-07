# 0010. Junctions, nets resolved in the engine, file format v2

- Status: Accepted
- Date: 2026-11-07

## Context

Phase 1 wires join two ports. Fanning one output out to many inputs needs a
separate wire back to the output for each reader, and the user cannot shape a
route: every wire bends on the column half-way between its ends, so wires of
different nets can share that column and look joined. ADR 0004 promised
"nets with junction objects" for Phase 2. The brief asks for explicit
junctions, shared nets and orthogonal routing, with geometry never implying a
connection.

## Decision

1. **Junctions are document objects.** `circuit.junctions` lists
   `{ id, position }` in grid units. A wire end is either a port
   `{ component, port }` or a junction `{ junction }`. Wires stay two-ended
   segments; a net is whatever wires, ports and junctions they join.
   Overlap on screen still means nothing.
2. **The engine resolves nets.** The circuit description gains
   `junctions: [{ id }]`, and connection ends may name a junction. `sim-core`
   joins every port and junction that wires connect (union-find) and checks
   each resulting net:
   - one output: it drives every input in the net;
   - two or more outputs: `multipleDrivers` if the net has inputs, else
     `outputToOutput`;
   - no output and two or more inputs: `inputToInput`;
   - no output and at most one input (a dangling branch): valid; the input
     reads 0 and warns as unconnected, the net's wires read 0.

   Every wire in a net reports that net, so `wireNets` and diagnostics keep
   document wire IDs and the frontend does no remapping. Connectivity semantics
   stay in `sim-core` (CLAUDE.md); the frontend only copies IDs.
3. **File format v2** adds `circuit.junctions`. Version 1 files are migrated on
   import by adding an empty list; nothing else changes. Exports are always the
   current version. Bundled examples move to v2.
4. **Routing.** A wire between two ports keeps the half-way bend column. A
   wire with a junction end runs horizontally out of its port and bends on the
   junction's column, so junctions double as route waypoints. Automatic
   avoidance of shared columns is left for later.
5. **Editing.** Dropping a new wire on a port or junction connects to it;
   dropping it on a wire splits that wire with a new junction at the nearest
   grid point and connects there, as one undo step. Junctions are selected,
   moved, copied and deleted like parts; deleting one deletes its wires, and a
   junction left with no wires is removed. A drop, drag, paste, duplicate,
   rotation or placement never puts a junction on a port or another junction (or a port on a
   junction) of the rest of the circuit, since dots on one spot would look
   joined. Items stacked within the moved or pasted group itself (only
   possible in a hand-edited file) are left as they are.

Net names (connection labels) and bus widths are not part of this decision;
they come with multi-bit signals.

## Consequences

- One rule for nets, used by every caller of `sim-core`, including the native
  example tests.
- Duplicate wires and fan-out no longer need per-connection driver tracking.
- Errors are per net, not per wire. `inputToInput` now also covers inputs
  joined through junctions with no output, while a wire between two inputs
  that some output already drives is plain fan-out and valid. A wire from an
  end to itself is harmless to the engine; the editor never draws one and
  import refuses it.
- Diagnostics come out in a stable order (by each net's first port or
  junction), whichever way its wires were drawn.
- A v2 file cannot be opened by a Phase 2-editing build; it reports a newer
  format, as designed.
