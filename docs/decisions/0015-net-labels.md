# 0015. Named connections: net labels on junctions

- Status: Proposed
- Date: 2026-11-07
- Depends on: ADR 0014 (format v5, `widthMismatch`)

## Context

Phase 2 lists named connections, and §6.3 of the brief asks for connection
labels. Today two distant points join only through a drawn wire, so a clock,
a reset or a data bus that many parts read crosses the whole sheet. ADR 0010
left net names out, and ADR 0014 left them for a decision of their own. This
decision is built after ADR 0014 and relies on its format v5 and its
`widthMismatch` error.

Constraints from earlier records:

- Connectivity comes from references, never from geometry (ADR 0004). A name
  is a reference, so it fits.
- The engine resolves nets (ADR 0010). The frontend copies IDs and computes
  no connectivity (CLAUDE.md).
- Wires and junctions carry no width; a net takes the width of its ports
  (ADR 0014).
- A custom component's interface is its pins (ADRs 0012 and 0013).
- Each level's wiring that touches pins (every net, once ADR 0014 lands) is
  checked as drawn before
  flattening (`check_wiring`), then the flat circuit is checked again in
  `compile` (ADRs 0012 and 0014). Elaboration only returns errors; warnings
  come from `compile`, lifted to top-level IDs (`lift`).

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
   ends trimmed, at most 32 characters) and also to Unicode NFC
   (`normalize("NFC")`), so a name typed with a combining accent matches the
   precomposed one. `clk` and `CLK` are different nets, as they look
   different. Look-alike characters from other scripts stay different; the
   `unmatchedLabel` warning (item 5) is what catches them.
4. **The engine resolves labels.** The description's junction gains
   `name?: string`. An empty name counts as no name. Pin junctions made by
   elaboration carry no name. Union-find (ADR 0010) also joins junctions
   that share a name and a sheet, in both places nets are built:
   - **The per-level check** (`check_wiring`) joins same-named junctions of
     that level before it counts drivers and readers. Without this, a label
     between two pin LEDs and a pin switch would be judged as two halves,
     and the LED half would be a false `inputToInput`.
   - **The flat circuit** (`compile`). A flattened junction's sheet is its
     instance path: its ID up to the last `/`, or empty on the main sheet.
     Junctions are joined by the pair (instance path, name), never by a
     joined string, so a main-sheet label named `i1/carry` stays apart from
     instance `i1`'s `carry`. `i1`'s `carry` and `i2`'s `carry` stay apart
     too. A circuit with no definitions skips elaboration and goes straight
     to `compile`, so the same rule covers it.

   All existing net rules then apply unchanged: one driver, `multipleDrivers`,
   `outputToOutput`, `inputToInput`, and ADR 0014's `widthMismatch`. A rule
   broken across a label names every wire of the net, on both sides. On the
   main sheet the canvas therefore highlights the far half too. Inside a
   definition, IDs are lifted to the instance as for every level error, and
   the message lists the inner wires; the far half shows when the definition
   is opened on its own sheet.
5. **New warning `unmatchedLabel`.** A name that only one junction on a
   sheet carries warns, naming that junction. It catches a typo that would
   otherwise leave a net silently cut. It is produced in `compile`, from the
   same (instance path, name) groups, so it needs no warning channel out of
   elaboration and covers the main sheet with or without definitions:
   - On the main sheet it names the junction.
   - Inside a definition, `lift` names the top-level instance, so each
     flattened copy of a definition with an unmatched label warns once,
     naming the top-level instance it sits in (as `unconnectedInput` does).
     Definitions that no instance uses are not checked, since they are not
     compiled.
   - Like every warning today, it is not reported while validation errors
     stop the load.
   - The message quotes the name: "label `stop` joins nothing else on this
     sheet".
6. **File format v6.** `circuit.junctions[]` gains an optional `name`, in
   the main circuit and in definitions. Import normalizes it as in item 3,
   drops a blank one and refuses one over 32 characters, as for labels.
   Export omits it when absent. The version bump is needed: an older build
   drops unknown fields on import and would silently cut every labelled
   net. v6 follows ADR 0014's v5, and the v5 → v6 migration changes only the
   version. The projection copies `name` into the description.
7. **Drawing.** A named junction is drawn as a tag holding its name in the
   canvas label style, instead of a dot. The tag sits on the side of the
   point that none of its wires leave from, trying right, left, below and
   above in that order, and on the right when wires leave all four sides, so
   it needs no rotation of its own. Signal colour comes from `wireNets` as
   for any junction's wires, so both halves of a label net light together.
   A label named by an `unmatchedLabel` warning draws its tag outline in
   `--caution` (added to the canvas `COLORS` list; the token exists). Today
   the canvas highlights only error IDs, so this is a new, narrow case for
   that one warning. A warning from inside a definition names the instance,
   so its tag shows the outline only when the definition is opened on its
   own sheet. Routing (ADR 0011) does not yet treat
   tags as obstacles; a wire may pass under one.
8. **Editing.**
   - The parts panel gains **Label**, which places a named junction. It
     gets the first unused name of the form `n1`, `n2`, … on that sheet,
     and the inspector's Name field takes focus.
   - Selecting a single junction shows **Name** in the inspector. It
     commits on blur or Enter, Escape cancels, and each change is one undo
     step, as labels on parts are. Naming a junction made by splitting a
     wire turns it into a label in place.
   - A named junction with no wires is kept: a label is placed before it is
     wired. This amends ADR 0010's "a junction left with no wires is
     removed", which now applies to plain junctions only. Clearing the name
     of a junction with no wires removes it.
   - Selecting a label highlights the other labels with the same name on
     the sheet. The editor does this lookup itself with the rule in item 3,
     because the engine's data cannot give it: unwired labels have no wires
     in `wireNets`, every undriven net shares net 0 (ADR 0014 item 15), and
     no netlist is loaded while errors stand. It is a display aid only;
     signals and diagnostics still come from the engine.
   - Copy, paste and duplicate keep names, so a pasted label joins the
     original's net, as a tunnel should.
   - *Make component* moves labels like other junctions. A name left on
     both sides of the selection's edge becomes two nets on two sheets,
     like a wire crossing the edge (ADR 0012), and each side reports
     `unmatchedLabel` if it is left alone.
   - The status bar's plain sentences (`PLAIN`) gain `unmatchedLabel`: "A
     label has no partner on this sheet."
9. **Docs when built.** `architecture.md` (the format example and version,
   the junction rule, the description's `junctions` shape, and the note
   that a junction's `name`, unlike props, reaches the engine) and
   `simulation-model.md` (Nets and Diagnostics) are updated to match. On
   acceptance, ADR 0010 is marked "amended by 0015" in the index and at its
   item 5.

### Out of scope

Global labels across sheets, picking bits of a bus by name (`D[3]`), labels
as routing obstacles, renaming every label of a net at once, case-insensitive
matching, and look-alike detection beyond NFC.

## Acceptance

Native (`sim-core`):

- Two junctions named `a` on the main sheet, with no definitions, one wired
  from a switch and one to an LED: the LED follows the switch. Named `a` and
  `A`: the LED stays 0 and warns `unconnectedInput`, and each label warns
  `unmatchedLabel`, naming its junction.
- An empty name behaves as no name. A main-sheet label `i1/x` does not join
  instance `i1`'s label `x`.
- A definition with a label between its pins, instanced twice: each
  instance passes its own signal, and labels never cross instances.
- Inside a definition, two pin switches driving one label name that an LED
  pin reads report `multipleDrivers` once, at the level check, with the IDs
  `[first instance]` and both inner wires named in the message. Without the
  reader the same circuit reports `outputToOutput`.
- An 8-bit switch and a 1-bit LED joined only by a label report
  `widthMismatch`.
- A definition with an unmatched label, instanced twice, warns
  `unmatchedLabel` once per instance, each naming its instance.

Web (Vitest):

- A v5 file migrates to v6 with only the version changed. Names round-trip
  through export and import. Import normalizes names (including NFC), drops
  a blank one and refuses one over 32 characters.
- Projection copies `name`.
- Deleting the last wire of a named junction keeps it; of a plain one
  removes it.

Browser (Playwright):

- A switch and an LED far apart, each wired to a Label named `go`: toggling
  the switch lights the LED. Renaming one label to `stop` turns the LED off,
  and the status bar message's `title` (which joins every diagnostic
  message) contains both "label `go` joins nothing" and "label `stop` joins
  nothing". The canvas is not readable from Playwright, so the caution
  outline stays a visual cue and is not asserted.

## Consequences

- Long and many-reader nets no longer need drawn wires, and labels cost the
  engine one extra union per named junction, with no change to the
  scheduler or the net rules.
- A label adds no width and no port, so it works on buses from day one.
- Connections can now be invisible on screen. The tag, the same-name
  highlight, the caution outline from `unmatchedLabel` and diagnostics
  naming both halves are what keep them readable.
- Duplicating a stage whose label is driven inside the copy gives two
  drivers on that label's net at once (`multipleDrivers` or
  `outputToOutput`). That is how tunnels behave; rename the copy's label.
- The editor holds a name lookup for highlighting, alongside the engine's
  rule. If the rule grows (global scope, case folding), both change.
- A v6 file cannot be opened by a v5 build, as designed.
