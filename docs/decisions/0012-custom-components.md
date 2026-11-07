# 0012. Custom components: definitions, pins and flat elaboration

- Status: Accepted
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
   definition. An instance's ports are those names. On the canvas an instance
   is a box with its inputs down the left and its outputs down the right, in
   the top-to-bottom order of the pins inside (then left to right).
3. **Elaboration in `sim-core`.** The circuit description carries the
   definitions with their pins listed explicitly. Before compiling, the engine
   flattens every instance, depth first: the definition's parts, junctions and
   wires are copied with IDs prefixed `instance/`, and each pin switch or LED
   becomes a junction that the instance's port is joined to. Net resolution
   (ADR 0010) then sees one flat circuit, so an input pin left unconnected
   outside reads 0 inside, and each instance has its own state.
4. **Errors.** An unknown definition, a definition that contains itself
   (directly or through others), an invalid pin (missing or repeated name, or
   a pin that is not a switch or LED) and a flattened circuit larger than
   200,000 parts are validation errors. Diagnostics name the top-level part or
   wire involved: an ID inside an instance is reported as that instance.
5. **Editing.**
   - *Make component* (inspector, for a selection) turns the selection into a
     new definition and puts one instance in its place; wires that crossed the
     selection's edge are dropped. Refused when a pin is unnamed or a name
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
- Not yet: renaming or deleting definitions, reconnecting wires that crossed
  a *Make component* selection, and pins wider than one bit (multi-bit
  signals come next).
