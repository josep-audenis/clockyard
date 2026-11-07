# 0015. Named connections: net labels on junctions

- Status: Proposed
- Date: 2026-11-07

## Context

Phase 2 lists named connections, and §6.3 of the brief asks for connection
labels. Today two distant points join only through a drawn wire, so a clock,
a reset or a data bus that many parts read crosses the whole sheet. ADR 0010
left net names out, and ADR 0014 left them for a decision of their own.

Constraints from earlier records:

- Connectivity comes from references, never from geometry (ADR 0004). A name
  is a reference, so it fits.
- The engine resolves nets (ADR 0010). The frontend copies IDs and computes
  no connectivity (CLAUDE.md).
- Wires and junctions carry no width; a net takes the width of its ports
  (ADR 0014).
- A custom component's interface is its pins (ADRs 0012 and 0013).
- Each level's wiring is checked as drawn before flattening, then the flat
  circuit is checked again (ADRs 0012 and 0014).

## Decision

1. **A net label is a junction with a name.** A junction gains an optional
   `name`. Junctions on one sheet with the same name are one net, exactly as
   if a wire joined them. A junction with no name behaves as today. A label
   is not a part with a port: a port would need a width (ADR 0014), and a
   label should take the width of whatever it joins, as wires and junctions
   do. It also reuses everything junctions already have: selection, drag,
   copy, deletion, rotation of a selection and the rule that no junction
   lands on a port or another junction (ADR 0010).
2. **Names are scoped to their sheet.** Labels join only within the main
   circuit or within one definition. A label inside a definition never meets
   the same name outside it, and each instance has its own copy. Pins stay
   the only way into a component. Global names that cross sheets are not
   part of this decision.
3. **Matching is exact.** Two names match when their stored text is equal,
   case included. The editor and import normalize names with the label rules
   (control characters to spaces, bidi and zero-width characters removed,
   ends trimmed, at most 32 characters), so equal-looking names are equal
   strings. `clk` and `CLK` are different nets, as they look different.
4. **The engine resolves labels.** The description's junction gains
   `name?: string`. An empty name counts as no name. Union-find (ADR 0010)
   also joins junctions that share a name and a sheet, in both places nets
   are built:
   - **The per-level check** (`check_wiring`) joins same-named junctions of
     that level before it counts drivers and readers. Without this, a
     label between two pin LEDs and a pin switch would be judged as two
     halves.
   - **The flat circuit** (`compile`). Elaboration keys each name by the
     instance path its junction was copied under, so `i1`'s `carry` and
     `i2`'s `carry` stay apart. A circuit with no definitions uses the same
     rule with an empty path.

   All existing net rules then apply unchanged: one driver, `multipleDrivers`,
   `outputToOutput`, `inputToInput` and `widthMismatch`. A rule broken
   across a label names every wire of the net, on both sides, so the canvas
   highlights the far half too.
5. **New warning `unmatchedLabel`.** A name that only one junction on a
   sheet carries warns, naming that junction. It catches a typo that would
   otherwise leave a net silently cut. Like other level checks, a definition
   warns once, at its first instance in elaboration order, with the ID
   lifted to that instance (`lift`).
6. **File format.** `circuit.junctions[]` gains an optional `name`, in the
   main circuit and in definitions. Import normalizes it with the label
   rules, drops a blank one and refuses one over 32 characters, as for
   labels. Export omits it when absent. This needs a format version bump:
   an older build drops unknown fields on import and would silently cut
   every labelled net. It is the next version after ADR 0014's v5 (v6); if
   both land in one release they share one bump. The migration changes only
   the version. The projection copies `name` into the description.
7. **Drawing.** A named junction is drawn as a tag holding its name in the
   canvas label style, instead of a dot. The tag sits on the side of the
   point that none of its wires leave from, trying right, left, below and
   above in that order, so it needs no rotation of its own. Signal colour
   comes from `wireNets` as for any junction's wires, so both halves of a
   label net light together. Routing (ADR 0011) does not yet treat tags as
   obstacles; a wire may pass under one.
8. **Editing.**
   - The parts panel gains **Label**, which places a named junction. It
     gets the first unused name of the form `n1`, `n2`, … on that sheet,
     and the inspector's Name field takes focus.
   - Selecting a single junction shows **Name** in the inspector. It
     commits on blur or Enter, Escape cancels, and each change is one undo
     step, as labels on parts are. Naming a junction made by splitting a
     wire turns it into a label in place.
   - A named junction with no wires is kept: a label is placed before it is
     wired. Clearing the name of a junction with no wires removes it, as
     ADR 0010 removes any plain junction left without wires.
   - Selecting a label highlights the other labels with the same name on
     the sheet. That lookup is a display aid with the rule in item 3, not
     connectivity; signals and diagnostics still come from the engine.
   - Copy, paste and duplicate keep names, so a pasted label joins the
     original's net, as a tunnel should.
   - *Make component* moves labels like other junctions. A name left on
     both sides of the selection's edge becomes two nets on two sheets,
     like a wire crossing the edge (ADR 0012), and each side reports
     `unmatchedLabel` if it is left alone.

### Out of scope

Global labels across sheets, picking bits of a bus by name (`D[3]`), labels
as routing obstacles, renaming every label of a net at once, and
case-insensitive matching.

## Acceptance

Native (`sim-core`):

- Two junctions named `a`, one wired from a switch and one to an LED: the
  LED follows the switch. Named `a` and `A`: the LED stays 0, warns
  unconnected, and each label warns `unmatchedLabel`.
- An empty name behaves as no name.
- A definition with a label between its pins, instanced twice: each
  instance passes its own signal, and labels never cross instances.
- Inside a definition, two pin switches driving one label name report
  `multipleDrivers` once, at the level check, with the wires of both sides.
- An 8-bit switch and a 1-bit LED joined only by a label report
  `widthMismatch`.
- `unmatchedLabel` in a definition used twice is reported once, named by
  the first instance.

Web (Vitest):

- A v5 file migrates to v6 with only the version changed. Names round-trip
  through export and import. Import normalizes names, drops a blank one and
  refuses one over 32 characters.
- Projection copies `name`.
- Deleting the last wire of a named junction keeps it; of a plain one
  removes it.

Browser (Playwright):

- A switch and an LED far apart, each wired to a Label named `go`: toggling
  the switch lights the LED. Renaming one label to `stop` turns the LED off
  and shows `unmatchedLabel` on both.

## Consequences

- Long and many-reader nets no longer need drawn wires, and labels cost the
  engine one extra union per named junction, with no change to the
  scheduler or the net rules.
- A label adds no width and no port, so it works on buses from day one.
- Connections can now be invisible on screen. The tag, the same-name
  highlight, `unmatchedLabel` and diagnostics naming both halves are what
  keep them readable.
- The editor holds a name lookup for highlighting, alongside the engine's
  rule. If the rule grows (global scope, case folding), both change.
- A v6 file cannot be opened by a v5 build, as designed.
