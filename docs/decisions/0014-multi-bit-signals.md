# 0014. Multi-bit signals, buses and splitters

- Status: Proposed
- Date: 2026-11-07

## Context

Every Phase 2 item except multi-bit signals has landed. Every net is one bit
(`u8` per net), so an 8-bit value needs eight wires, eight switches and eight
LEDs. The brief asks for multi-bit buses, splitters and combiners, port widths
held explicitly in the data model, readable conventions for bus widths and
values, and an understandable error when widths do not match (§4.1, §4.2,
§5.6, §6.3). It also says that a 16-bit register must not need sixteen drawn
wires. Phase 4's CPU needs 8-bit data and addresses of up to 16 bits. ADR 0010
left bus widths for this decision, and ADR 0012 left wide pins for it too.
`docs/simulation-model.md` sketched widths 1–64 stored in a `u64`.

Constraints from earlier records: the engine owns all signal semantics, with
no evaluator in TypeScript (CLAUDE.md). The catalog's kinds, ports and widths
live in `sim-core` (ADR 0004). Settling stays deterministic and bounded
(ADR 0006). Custom component pins are switch and LED parts, named by part ID
(ADRs 0012 and 0013).

## Decision

### Widths

1. **A width is 1 to 32 bits.** One net's value fits a `u32`, and a JS number
   holds it exactly with the usual bit operators (`>>> 0`). Widths up to 64
   would put `BigInt` or a pair of words in every place the frontend reads a
   value, and nothing planned before Phase 5 needs them. `sim-core` exports
   `MAX_WIDTH = 32` through the catalog, so the editor never hard-codes the
   limit. A later, wider limit changes only that constant and the value
   storage. The file format stays the same.
2. **Widths are declared on parts and never inferred.** A part prop `width`
   (absent means 1) sets the width of every port on a switch, an LED and each
   gate (`not`, `and`, `nand`, `or`, `nor`, `xor`, `xnor`). Splitters and
   mergers take their widths from `fields` (item 9). An instance's port has
   its pin part's width. Wires and junctions have no width in the file. A
   net's width is the width of the ports it joins, so the file never stores a
   wire width that could disagree with its ports. Inferring widths through
   gates ("this AND is as wide as its bus") would make one wrong wire
   silently re-type a whole region. The error would then show up far from
   its cause.

### Values and the engine

3. **A net stores a `u32` value, and the compiled netlist keeps each net's
   width.** Every evaluator masks its result to its output's width, so a
   4-bit NOT of `0000` is `1111`, never `0xFFFFFFFF`. Change detection still
   compares whole values. Net 0 (ground) reads 0 at every width. An
   unconnected input of any width reads 0 and warns, as it does today.
4. **The delta-cycle engine is unchanged.** A bus is one net, and evaluating
   a component writes it in one step. One delta therefore carries all the
   bits of a value, and an 8-bit gate costs what a 1-bit one does. Splitters
   and mergers are components (item 9), so each adds one delta of delay, like
   a gate. Acyclic circuits still settle within *depth + 1* deltas, where
   splitters and mergers count as levels, and the existing limit (component
   count plus a floor) still bounds every settle. Whatever optimization of
   `sim.rs` lands first, widths change only the value type, the mask and the
   new primitives, not the scheduling.
5. **Four-state logic stays possible later.** It will add a per-net `u32`
   unknown mask beside the value, one bit of `X`/`Z` per signal bit. With 32
   bits as the limit, the value and the mask together fit a `u64`.

### Width checks

6. **New validation error `widthMismatch`.** All ports on a net must have
   the same width. The message names one port for each width it found, and
   the IDs are the net's wires and those ports' parts, for example: "wires
   w1, w2 connect ports of different widths: `a.out` is 8 bits, `l.in` is 1
   bit". The check runs where the driver rules already run. Net resolution
   checks every flat net. Each level's wiring as drawn (ADR 0012) is checked
   too, because flattening turns a pin into a width-less junction: there an
   instance's port has its pin part's width. A mismatch is reported once, at
   the level where it was drawn, and inner IDs are lifted to their instance
   as today. Wires are never refused when dropped, since editing does not
   judge semantics. The engine reports a mismatch, and the canvas highlights
   the IDs the way it highlights every diagnostic.
7. **New validation error `invalidWidth`.** It covers a `width` outside 1–32
   or not a whole number, a `width` on a kind that does not take one
   (`custom`, `split`, `merge`), and `fields` that are empty, contain a field
   under 1 bit, add up to more than 32 bits, or sit on any kind other than a
   splitter or merger. The editor never produces these, and import refuses
   out-of-range values (item 12). The engine checks anyway, because native
   tests and hand-written descriptions reach it directly.

### Splitters and mergers

8. **Two directional kinds, `split` and `merge`.** A bidirectional splitter,
   where either side can drive, would need nets that mix several drivers bit
   by bit. Phase 2 has no multi-driver nets (simulation-model), so one part
   per direction keeps the single-driver rule and the existing direction
   checks.
9. **Ports and props.** `fields` is a list of field widths, least
   significant field first, for example `[4, 4]` or eight `1`s. The total is
   the bus width. `split` has the input `in` (the total width) and the
   outputs `f0` to `f{n-1}`. `merge` has the inputs `f0` to `f{n-1}` and the
   output `out`. Field `f0` holds the lowest bits. Port names depend on
   `fields`, so the catalog lists the fixed port (`in` or `out`) and says
   that field ports are `f0…` on the output or input side. The layout
   consistency test (ADR 0004) checks the generated names for sample field
   lists. Inside the engine, each field of a `split` compiles to its own
   primitive (one input, one output, shift and mask), and a `merge` is one
   primitive with one input per field. Every component keeps a single
   output.
10. **Layout.** A splitter or merger is a bar 2 cells wide and `n + 1` cells
    tall. Unrotated, a `split` has `in` at (0, 1) and field `fi` at
    (2, 1 + i). A `merge` mirrors that, with `fi` at (0, 1 + i) and `out` at
    (2, 1). Field ports sit one cell apart, so an 8-way split is 9 cells
    tall. Each field port is labelled with its bit range (`3`, `7:4`).
    Rotation works through `layoutOf` as it does for every kind.

### Gates and I/O

11. **Gates are bitwise.** At width N, a gate applies its truth table to
    each bit independently: `and` is `a & b`, and `not` is `!a` masked to N
    bits. Both inputs and the output share the gate's `width`. Reductions
    (AND of all the bits of one bus), shifts and arithmetic are not gates.
    They come from splitters plus gates, or from later parts such as the
    Phase 3 register primitives and Phase 4's ALU.
12. **A switch or LED with a width above 1 is a multi-bit input or display.**
    There are no new kinds, so custom component pins stay switches and LEDs
    (ADRs 0012 and 0013), and a wide pin is just a wide switch or LED. On
    the canvas, a wide switch or LED is a 4 × 2 body that shows its value in
    hex (up to 8 digits), with its port at the middle of the side where a
    1-bit one has it. A width-1 part looks as it does today. Clicking a wide
    switch selects it and focuses the inspector's Value field. That field
    accepts decimal, `0x…` and `0b…`, and ↑ and ↓ step the value by 1. Wide
    switch values are transient and never saved, like switch positions. The
    accessible readout lists each wide switch and LED in decimal and in hex.
    The protocol's `setInput` carries a number from 0 to 2^width − 1. The
    engine refuses anything outside that range, and the editor masks a
    switch's value when its width changes. Signed display is not part of
    this decision.

### Custom components

13. **A pin's width is its pin part's width.** An 8-bit switch inside a
    definition is an 8-bit input port on every instance, and an 8-bit LED
    is an 8-bit output port. `PinDesc` is unchanged: the engine reads the
    width from the pin's part. Instance layout keeps its pin order and
    spacing. A wide port is drawn as a bus stub with its width beside it.
    Changing a pin's width inside a definition can leave wires on the main
    sheet mismatched. They are reported as `widthMismatch`, just as a
    deleted pin's wires are reported as `unknownPort` (ADR 0013).

### File format and engine contract

14. **Format version 5.** `props.width` is a whole number from 1 to 32 on
    the kinds in item 2. `props.fields` is a list of whole numbers of at
    least 1, adding up to at most 32, on `split` and `merge`. Export omits
    `width` when it is 1, so 1-bit circuits read exactly as before apart
    from `version`. Migration from v4 to v5 changes nothing but the version
    number. The bump still matters: a v4 build drops unknown props on import
    and would silently turn an 8-bit circuit into a 1-bit one. With the bump
    it reports a newer format instead. Bundled examples move to v5. Import
    checks the types and ranges above and refuses a file that breaks them.
    `label` stays editor-only.
15. **Description and protocol.** A component in the description gains the
    optional `width` and `fields`, which the projection copies from `props`
    (as planned in `architecture.md`, "props join the description when a kind
    needs one"). `loaded` gains `netWidths` (one per net). `state.nets`
    becomes a `Uint32Array`. `setInput.value` becomes a number. Catalog
    entries gain `sized: true` for kinds that take `width`, and the field-port
    side for `split` and `merge`.

### Editor

16. **Drawing.** A net wider than 1 bit is a bus. It is drawn at a new
    `--wire-width-bus` (4px, beside `--wire-width` 2px and `--wire-width-high`
    3px), in a neutral bus tone rather than the high/low colours, with a
    short slash and its width ("8") near its driver. Junctions on a bus are
    drawn larger. Hovering a bus shows its value in the status bar ("8 bits:
    44, 0x2C"). The engine supplies widths (`netWidths`) and values, so the
    canvas computes neither. While the circuit has validation errors, no
    netlist is loaded, so wires draw as they do today and the diagnostic
    highlights the mismatch. New tokens follow ADR 0008.
17. **Setting a width.** For a single selected part, the inspector shows
    **Width** (1–32) on kinds the catalog marks `sized`, and **Fields** (a
    comma list, least significant field first, with the total shown) on
    `split` and `merge`. Both commit on blur or Enter, Escape cancels, and
    each change is one undo step, as labels are today. Changing `fields` also
    deletes wires to field ports that no longer exist, in the same undo
    step: unlike a pin on another sheet, those ports belong to the part
    being edited. A width change on a switch or LED changes its layout
    (2 × 2 body to 4 × 2), so the wires on it are routed again. The parts
    panel gains **Splitter** and **Merger**. Setting the width of several
    parts at once is left for later.

### Out of scope

Named connections (net labels or tunnels) get a decision of their own. Also
out of scope: bidirectional splitters, multi-driver or tri-state buses,
signed display, widths above 32, width inference, and multi-part width
editing.

## Acceptance

Native (`sim-core`):

- Bitwise gates at widths 1, 8 and 32 match `&`, `|`, `^` and `!` masked to
  the width (property tests). A 4-bit `not` of 0 is 15.
- `merge(split(x)) = x` for fields `[3, 5]`, eight `[1]`s and `[32]`.
- `widthMismatch` is reported for an 8-bit switch wired to a 1-bit LED,
  through a junction, at an instance port whose pin is wider than the outside
  wire, and inside a definition. Each is reported once, with the expected
  IDs.
- `invalidWidth` is reported for widths 0 and 33, a `width` on `split`,
  empty `fields`, `fields` totalling 33, and `fields` on a gate.
- An unconnected 8-bit input reads 0 and warns. An 8-bit `not` fed back to
  itself is reported `Unstable` within the bound. `set_input` refuses a value
  of 2^width or more.
- **8-bit adder example** (`examples/8-bit-adder.clockyard.json`): 8-bit
  switches A and B, each split into bits and fed to eight instances of the
  existing full-adder definition, merged into an 8-bit sum LED, with
  carry-in from a switch and carry-out to an LED. Checked natively for all
  65,536 (A, B) pairs with carry-in 0 and 1 against `(A + B + cin) mod 256`
  and the carry.

Web (Vitest):

- A v4 file migrates to v5 with nothing but the version changed. Width and
  fields round-trip through export and import. Import refuses width 0, 33 or
  2.5, and bad `fields`.
- Projection copies `width` and `fields` and drops `label`. Layout names
  match the engine for `split` and `merge`, with sample fields.

Browser (Playwright):

- The 8-bit adder example opens. Setting A = 200 and B = 100 in the
  inspector shows sum 44 (0x2C) with carry-out 1 in the readout.
- An 8-bit switch wired to a 1-bit LED shows `widthMismatch`. Setting the
  LED's width to 8 clears the error and shows the switch's value.

## Consequences

- One bus net carries a whole value, so circuits are smaller, settle in the
  same number of deltas as their 1-bit equivalents, and draw with far fewer
  wires.
- Engine changes stay contained. The value type widens from `u8` to `u32`,
  one mask is added per evaluation, and two primitives and two diagnostic
  codes are new. The scheduler and the net rules are untouched. This work
  starts after the `sim.rs` compile and settle optimization lands, and
  rebases on it.
- Splitters and mergers each add one delta. Combinational results are
  unchanged, but the order of glitches in feedback loops differs from
  wiring the bits by hand. That is still deterministic.
- Widths are explicit, so placing a gate on a bus needs one inspector edit.
  A "match connected width" helper can come later without a format change.
- While a width error stands, buses lose their bus styling, because no
  netlist is loaded. The highlighted diagnostic points at the cause.
- Port widths now depend on props, so the catalog is no longer a fixed
  list of port names for every kind. The layout test covers the generated
  names.
- A v5 file cannot be opened by a v4 build, as designed.
