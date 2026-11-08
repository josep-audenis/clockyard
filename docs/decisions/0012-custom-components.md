# 0012. Custom components: definitions, pins and flat elaboration

- Status: Accepted; port naming amended by ADR 0013; renaming and deleting
  definitions added by the amendment below; crossing wires by ADR 0016
- Date: 2026-11-07

## Context

The brief (§4.3, Phase 2) asks for reusable components built from existing
circuits: build a full adder from gates, give it input and output ports, save
it, and place it many times, with definitions distinct from instances, nesting
allowed, recursion refused, and missing definitions reported. Elaborating to a
flat netlist is acceptable at first. Phase 2's target is a 4-bit adder made of
four full adders. ADR 0004 already says `sim-core` elaborates hierarchy.

## Decision

1. **Document format v3.** A document gains `definitions`: a list of
   `{ id, name, circuit }`, where `circuit` has the same shape as the main one.
   An instance is an ordinary part with `kind: "custom"` and `definition: id`.
   Version 2 files are migrated by adding an empty list. IDs must not contain
   `/` (it separates instance paths after elaboration).
2. **Pins.** Inside a definition, each switch is an input pin and each LED an
   output pin, named by its label; names must be present and unique within the
   definition. An instance's ports are those names (since ADR 0013, the pin
   parts' IDs, with labels only shown). On the canvas an instance
   is a box with its inputs down the left and its outputs down the right, in
   the top-to-bottom order of the pins inside (then left to right).
3. **Elaboration in `sim-core`.** The circuit description carries the
   definitions with their pins listed explicitly. Before compiling, the engine
   flattens every instance, depth first: the definition's parts, junctions and
   wires are copied with IDs prefixed `instance/`, and each pin switch or LED
   becomes a junction that the instance's port is joined to. Net resolution
   (ADR 0010) then sees one flat circuit, so an input pin left unconnected
   outside reads 0 inside, and each instance has its own state. Before
   flattening, each level's wiring that touches pins is checked as drawn,
   with instances as black boxes (see `docs/simulation-model.md`), so two
   pins driving one wire and inputs joined with nothing driving them are
   reported where the user wired them.
4. **Errors.** An unknown definition, a definition that contains itself
   (directly or through others), an invalid pin (missing or repeated name, two
   pins on one part, or a pin that is not a switch or LED; since ADR 0013 the editor names pins by
   part ID, so only a hand-made file can have one) and a flattened circuit of more than
   200,000 items are validation errors. Parts, junctions, wires and instance
   expansions all count, so a small file of nested definitions cannot expand
   without bound. Pins are checked only for definitions actually used, so an
   unlabelled switch in one does not break circuits that do not use it. The
   engine also refuses IDs containing `/`, two instances sharing an ID, and a
   wire to a pin part through any port but its own.
   Diagnostics name the top-level part or wire involved: an ID inside an
   instance is reported as that instance.
5. **Editing.**
   - *Make component* (inspector, for a selection) turns the selection into a
     new definition and puts one instance in its place; wires that crossed the
     selection's edge are dropped (since ADR 0016, they become new pins). Refused when a pin is unnamed or a name
     repeats.
   - A *Chips* section in the parts panel lists definitions; picking one arms
     an instance. A definition cannot be placed inside itself or anything it
     contains.
   - *Edit component* on an instance opens its definition on its own sheet,
     with a breadcrumb back to the main circuit. The sheet simulates the
     definition on its own (its switches can be toggled). Each sheet keeps its
     own undo history. Changes apply to every instance.

## Consequences

- One elaboration path for the browser and native tests; the 4-bit adder
  example is checked natively and in the browser.
- Flat elaboration repeats the definition per instance; fine for Phase 2
  sizes, with a hard limit so a hostile file cannot exhaust memory.
- Signals inside an instance are not shown on the main sheet; open the
  definition to see its own simulation.
- Not yet: reconnecting wires that crossed a *Make component* selection (done
  by ADR 0016), and pins wider than one bit (multi-bit signals come next).

## Amendment (2026-11-07): renaming and deleting definitions

- *Rename*: an instance's inspector has a *Component name* field. Names are
  stored like labels: normalized, cut at 32 characters, and blank becomes
  "Component". Files are held to the same rule on load (a name over 32
  characters is refused, like a label).
- *Delete*: each chip has a delete button. It is refused, with the reason,
  while an instance of the definition is on the main circuit or in another
  definition; otherwise it asks for confirmation. The reason stays shown,
  kept current, until it no longer holds. (On a definition's own sheet its
  chip is hidden; the store refuses deleting the open definition as well.)
  Two definitions may share a name; nothing requires names to be unique.
- *Undo*. Undo history stays per sheet and holds circuits only, so a
  definition change is not an undo step: a rename is reversed by renaming
  again, and a delete cannot be undone (the confirmation says so). For a
  delete to be sound, no undo or redo step may bring back an instance of
  the definition. Deleting therefore drops every such step from every
  sheet's history (each step is a whole circuit, so dropping one only merges
  it into its neighbour), drops the definition's own history, and empties the
  clipboard if it holds an instance. Recording definitions in the history
  was rejected: steps would have to carry the definitions list, and sheets'
  separate histories would then disagree about which definitions exist.

