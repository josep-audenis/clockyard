# 0016. Make component keeps wires that cross the selection's edge

- Status: Accepted; amends ADR 0012 (item 5)
- Date: 2026-11-08
- Depends on: ADRs 0010 (nets resolved in the engine), 0013 (ports by pin
  ID), 0014 (widths)

## Context

*Make component* (ADR 0012) turns a selection into a definition and puts one
instance in its place. Every wire with one end inside the selection and one
outside is dropped, so the instance comes out unconnected and the user has to
rewire it by hand. ADR 0012 listed this as "not yet".

Such a wire cannot simply be moved onto an existing pin. Pins are switches
(inputs) and LEDs (outputs). A switch has no input and an LED has no output,
so a wire into the selection never ends at a pin. Each crossing has to become
a new pin.

Constraints from earlier records:

- The engine resolves nets, and the frontend computes no connectivity of its
  own (ADR 0010, CLAUDE.md). Which wires share a net, and how wide it is,
  must come from the engine.
- A net takes its width from its ports (ADR 0014), so a new pin needs the
  net's width.
- An instance's ports are its pins' part IDs, in the top-to-bottom order of
  the pins inside (ADRs 0012 and 0013). Pins need labels that are present and
  distinct.

## Decision

1. **One new pin per crossing net.** A *crossing wire* has exactly one end
   (a port or a junction) owned by a selected part or junction. Crossing
   wires are grouped by the net the engine reports for them. Each group
   becomes one pin, so a net that leaves the selection through several
   wires gives the chip one port, not several.

   The grouping cannot use `wireNets`. Every undriven net shares ground,
   net 0 (ADR 0014 item 15), so the net index cannot tell undriven nets
   apart. `loaded` therefore gains `wireGroups`: for each wire, the index
   of the net it is on as joined by wires and labels, before any net is
   given a driver. Undriven nets get different indices. One pin per wire
   on net 0 was considered and rejected: two such wires joined inside the
   selection would give one net two switches.
2. **Direction comes from the net's driver, which the engine reports.**
   - Every net but ground is driven by exactly one primitive: primitive `p`
     drives net `p + 1` (ADR 0014). Two drivers on one net are an error, and
     no netlist is loaded while errors stand.
   - `loaded` gains `netDrivers`: for each net index, the ID of the top-level
     part whose primitive drives it, lifted the way diagnostics are (`lift`),
     or `null` for net 0. A gate inside an instance is reported as the
     instance.
   - The editor cannot work this out itself. `portNets` is keyed by
     flattened part IDs, so an instance's ports are not in it, and finding
     the driver is connectivity, which the engine owns.
   - Driver inside the selection: an output pin, an LED.
   - Driver outside, or no driver (net 0): an input pin, a switch. An
     undriven input reads 0, as an unconnected pin already does.
3. **Width comes from the engine.** The pin's width is the net's width
   (`wireWidths`). A 1-bit pin keeps the default.
4. **Wiring.**
   - Inside the definition, the new pin's port (switch `out` or LED `in`) is
     wired to the inside end of every crossing wire in its group.
   - On the sheet, the instance's port for that pin is wired to the outside
     end of every crossing wire in the group.
   - The original crossing wires are removed. Their bends are not kept: the
     new wires are routed afresh (ADR 0011).
   - Ends already joined inside the definition stay joined as drawn. Ends
     that were joined only through the outside are now joined inside,
     through the pin's port.
5. **Names.** Each new pin is labelled from the outside end of its group's
   first crossing wire:
   - the label of a switch or LED there;
   - otherwise the name of a net label (a named junction) there;
   - otherwise `in1`, `in2`, … for inputs and `out1`, `out2`, … for outputs.

   If a name is already used by another pin of the definition, `-2`, `-3`, …
   is appended until it is free. Names follow the label rules (normalized,
   at most 32 characters), and the user can rename pins later (ADR 0013).
6. **Placement.** New input pins go in a column 4 cells left of the
   selection's leftmost item, and output pins 4 cells right of its rightmost
   edge. Each pin sits on the row of its group's first inside end, moved
   down 2 cells at a time while it would overlap another new pin or stack a
   junction (ADR 0010). Pin order, and so the instance's port order, then
   follows the rows the wires came in on. The definition's origin is the
   top-left of its parts, new pins included. The instance takes the
   selection's top-left corner, as before, so it lands where the selection
   was and not on top of parts to its left.
7. **The engine's view must be current.** Grouping, direction and width read
   the engine's result for the circuit as it is now. If there are crossing
   wires and that result is not available, Make component is refused:
   - while the result is stale: "Wait for the simulation to catch up, then
     try again";
   - when the circuit has errors: "Fix the circuit's errors first: wires
     crossing the selection need a working circuit."

   A selection with no crossing wires works as before, whatever the
   engine's state. The inspector passes the engine's result in with the
   request, so the store does not read simulation state.
8. **Existing rules stay.** Existing switches and LEDs in the selection are
   still pins and must still be labelled and distinct. The refusal "A
   component needs pins" now applies only when the selection has no pins
   *and* no crossing wires. Make component is still one undo step on the
   sheet. The new definition is not undone with it (ADR 0012 amendment).
9. **No format change; two protocol fields.** The new pins are ordinary
   switches and LEDs, and the new wires are ordinary wires. The only engine
   changes are `wireGroups` (item 1) and `netDrivers` (item 2) in
   `loaded`, documented in `architecture.md`.

## Alternatives considered

- **Warn and drop**, as today but with a confirmation. Cheap, but the user
  still loses the wiring.
- **Refuse while wires cross.** Simple and safe, but it pushes the rewiring
  onto the user every time.
- **Group wires into nets in the editor.** Would work while the circuit has
  errors, but it is connectivity computed outside the engine, which ADR
  0010 rules out. It would also miss nets joined by labels, which only the
  engine joins.
- **One pin per crossing wire.** Simpler grouping, but a net that leaves
  through two wires would give the chip two ports for one signal, and an
  output net would need two LEDs on one driver.

## Consequences

- A selection taken out of a working circuit becomes a working chip, wired
  where it was.
- Make component now depends on the engine's latest result when wires cross.
  A circuit with errors has to be fixed, or the selection made so that no
  wire crosses, before it can be turned into a component.
- Auto-named pins (`in1`, `out1`) are readable but generic, so users will
  often rename them.
- Not covered: a net label whose name appears on both sides of the edge with
  no drawn wire crossing. It still becomes two nets, each reported as
  unmatched (ADR 0015, item 9).
- Tests:
  - `sim-core` tests: `netDrivers` names each net's driver, an instance
    for a gate inside it, and nothing for ground; `wireGroups` tells two
    undriven nets apart and follows a label.
  - Store tests with a stubbed engine result: grouping by net, each
    direction, widths, naming
    and collisions, placement order, and the stale and errored refusals.
  - A Playwright test: switch → NOT → NOT → LED. Make a component of the
    two NOTs (the inspector offers Make component for two or more
    items), and the switch still drives the LED through the new chip.
