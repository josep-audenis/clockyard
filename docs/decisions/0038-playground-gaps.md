# 0038. The playground's gaps: push buttons, gates with 2 to 8 inputs, notes on the canvas

- Status: Proposed
- Date: 2026-11-22
- Depends on: ADR 0037 (Phase 7 plan, increment 1); ADR 0006 (the
  combinational engine); ADR 0014 (buses and widths); ADR 0012 and ADR 0017
  (custom components, the open sheet); ADR 0021 (the keyboard part and who
  has the keys); ADR 0026 (waveforms); ADR 0027 (project notes); ADR 0030
  (benchmarks); ADR 0035 (four-state signals)

## Context

ADR 0037 opens Phase 7 with three things the playground lacks, and leaves
one question to this ADR: how a key reaches a push button without clashing
with the editor's shortcuts and the keyboard part. Its target: a 4-input
AND with a push button on each input, and a note beside it, saved and
opened again.

What there is to build on:

- **Inputs.** A switch is a part whose value the editor sets with
  `setInput` between ticks; the engine settles at once. Its position lives
  in the store's `inputs`, is never saved, and every load starts at 0.
  Inside a custom component a switch is an input pin (ADR 0012).
  Devices are ordinary parts that can sit inside a component, and only the
  open sheet is simulated with its own inputs (ADR 0017, ADR 0021).
- **Who has the keys (ADR 0021).** A click on a keyboard part gives it the
  keys: a capture listener sends each key to the circuit and stops it, so
  no shortcut fires. Esc, Tab, a click elsewhere or leaving the window
  gives them back, and the status line says so while it lasts. Shortcuts
  otherwise: Ctrl+Z/Y/C/X/V/D/A, Space (pan), Delete, R, F, Escape.
- **Gates.** AND, OR, NAND, NOR, XOR and XNOR have two inputs, `a` and `b`,
  and a width from 1 to 32 set in the inspector. The engine evaluates
  `gate(kind, input(0), input(1))`, with a two-state path and a two-word
  path for four-state circuits (ADR 0035). The canvas draws a gate 4 cells
  high, its inputs at rows 1 and 3.
- **Waveforms (ADR 0026)** record one value per tick: a later settle at
  the same tick replaces that tick's value. A press and release with no
  tick between them leaves no trace.
- **Text.** A project has notes in a panel (`metadata.notes`, ADR 0027),
  one text for the whole project. Nothing can be written on a sheet.
- **Changing a part's ports.** Fewer fields on a split or merge drops the
  wires on the ports that go, and a junction left with no wires, in one
  undoable edit (`setFields`).
- **The file format** is at version 12. Older versions read unchanged
  where nothing moved; a newer one is refused with a message naming both
  versions.

## Decision

1. **Push button, a new part `button`.** One output `out`, 1 bit, `1`
   while pressed and `0` otherwise. Always known, like a switch.
   - **In the engine** it is an input part like a switch, with its own
     kind so that the catalog, the readout and a definition can tell them
     apart. Its value is set between ticks by the same input call; the
     engine knows nothing of pointers or keys.
   - **By pointer or touch:** pointer-down on the button's cap (the round
     middle of its 2×2 body) presses it, pointer-up, pointer-cancel or a
     lost capture releases it. Each pointer is tracked on its own, so
     several fingers hold several buttons. The cap never starts a move;
     the rest of the body selects and drags, as on any part.
   - **By key (the open question).** A button may have a key: one of A–Z
     or 0–9, matched by the key's physical code (`KeyA`, `Digit1`), set in
     the inspector, saved in the file. The keys reach buttons only while
     *the circuit has the keys*, the state ADR 0021 already has, extended:
     - A press by pointer on a button that has a key gives the circuit the
       keys, as a click on a keyboard part does. A button with no key does
       not.
     - While the circuit has the keys, a key bound to buttons holds every
       button bound to it (down presses, up releases, repeats are
       ignored) and goes nowhere else. Other keys go to the keyboard part
       if one was clicked, and are dropped otherwise. No shortcut fires,
       as today.
     - Esc, Tab, a click elsewhere or leaving the window give the keys
       back and release every button held by a key.
     - The status line names the bound keys: "The circuit has the keys: 1,
       2, 3, 4 press buttons. Esc, Tab or a click elsewhere gives them
       back."

     So a key never presses a button by accident while editing, the
     shortcuts keep their keys, and the keyboard part keeps every key no
     button claims. A letter bound to a button cannot be typed into a
     keyboard part on the same sheet; the inspector says so beside the
     key field.
   - **From the keyboard alone:** the inspector of a selected button has a
     Press button, held while the pointer, Space or Enter holds it.
   - **A short press.** While the simulation runs, a press that ends at
     the same tick it started (no tick passed while it was held) sets the
     status line: "Button 1 was released before a tick: parts that change
     on a clock edge did not see it." Combinational parts did see it, and
     the canvas lit it. Nothing stretches a press: what the circuit sees
     is what was pressed. `docs/simulation-model.md` says that a clocked
     part sees a press only if its clock's rising edge falls inside it.
   - **Not saved:** a button is released on every load and reset,
     as a switch is at 0. Its key is saved.
   - **Inside a component** a button is an ordinary part, not a pin: it is
     released wherever the component is used, and can be pressed on the
     component's own sheet (ADR 0017). The inspector of a definition with
     one says so. Challenge checks drive switches and pins only, not
     buttons.
   - Shown in the readout list as "Button 1: pressed" or "released", and
     in waveforms like any net.

2. **Gates with 2 to 8 inputs.**
   - **The rules first,** in `docs/simulation-model.md`, before any code,
     bit by bit and for any width:
     - AND: `0` if any input is `0`; `1` if all are `1`; else `X`. OR:
       `1` if any is `1`; `0` if all are `0`; else `X`. NAND and NOR: NOT
       of those.
     - XOR is parity: `1` when an odd number of inputs are `1`. XNOR is
       NOT of it. Either is `X` if any input is unknown.
     - `Z` at any input counts as `X`, as today. For two inputs every rule
       is the one there is now.
   - **In the engine:** a shape value `inputs`, 2 to 8, absent meaning 2,
     for the six gates only. Ports `a` to `h`, so a 2-input gate's ports
     do not change and no wire moves. A description with `inputs` out of
     range or on another kind is refused with a new code,
     `invalidInputs`. Evaluation folds over the inputs on both paths.
   - **The cost** is measured on the ADR 0030 benchmarks before and after,
     native and in the browser, and written in the pull request. A
     2-input gate must cost what it does now, within the benchmarks'
     noise; if a fold does not, the 2-input case keeps its own branch.
   - **In the editor:** an Inputs field beside Width in the inspector for
     the six gates. A gate with *n* inputs is 2*n* cells high, its inputs
     at rows 1, 3, …, 2*n* − 1 and its output at row *n*; at 2 that is
     today's gate. Fewer inputs drops the wires on the ports that go, and
     a junction left with no wires, in one undoable edit, as `setFields`
     does; the status line says how many wires went.

3. **Notes on the canvas.**
   - **In the document,** each sheet (the main circuit and each
     definition) gets `notes`, beside `components`, `junctions` and
     `wires`: `{ id, x, y, text }`, at a grid point, with plain text of 1
     to 500 characters, line breaks kept. A sheet holds at most 200.
     They are not parts: the projection to the engine leaves them out, so
     the engine never receives them, and a test checks that a circuit's
     description is the same with and without its notes.
   - **On the canvas** a note is drawn in one size, its lines as written,
     with no frame, under the wires and parts so it never hides a
     connection. Wires do not route around notes.
   - **Editing:** Add components has a Note entry. A new note is selected
     and the inspector's text field focused, as a wide switch's Value
     field is; the inspector edits it, and a note left empty is deleted
     when the field is left. Notes select, move, delete, copy, paste,
     duplicate and undo with parts. Rotating a selection turns a note's
     place, not its text. Make component takes parts only: notes stay on
     the sheet they were on.
   - Increment 2 needs titles for regions; whether a note gets a size is
     its ADR's to decide.

4. **The file format becomes version 13:** a gate's `inputs`, the
   `button` part and its `key`, and each sheet's `notes`. Files 1 to 12
   read unchanged, since nothing they hold moves. Version 12 and older
   Clockyards refuse a version 13 file with the message they have. The
   bundled examples are written again only if a check needs it.

5. **Steps,** one pull request each:
   1. **The rules:** N-input gates and the push button in
      `docs/simulation-model.md`, nothing else.
   2. **The engine:** `inputs`, ports `a` to `h`, the fold on both paths,
      `invalidInputs`, the `button` kind, the catalog through `sim-wasm`.
      Tests: every input combination of `0`, `1`, `X` and `Z` for 2 to 4
      inputs of each gate against a model written from the rules, and 8
      inputs at width 32 on chosen values. The benchmarks, before and
      after.
   3. **Gates in the editor:** the Inputs field, layout and drawing,
      wires dropped, format 13 and a test that a version 12 file reads
      the same.
   4. **The push button:** pointer, touch, keys and the circuit having
      them, the Press button, the short-press status, the readout.
      Vitest for the key routing; Playwright presses a button with the
      pointer and with its key.
   5. **Notes on the canvas,** then the target in Playwright: a 4-input
      AND, a button on each input bound to 1, 2, 3 and 4, an LED, a note
      beside them. Holding 1, 2 and 3 leaves the LED off; 4 as well lights
      it; letting one go puts it out. Saved to a file and opened again:
      four inputs, the keys, the note's text, every button released.

## Consequences

- A circuit can be driven by holding things down, by pointer, touch or
  key, with no key ever reaching a button while editing.
- A wide AND or OR no longer needs a tree of 2-input gates, and parity is
  one part.
- A sheet can carry its own explanations, which increment 2 builds on
  for the reference CPUs.
- A key bound to a button is lost to a keyboard part on the same sheet.
- A short press is reported, not prevented: a clocked circuit can still
  miss it, as real hardware does without a debouncer and a latch.
- Version 13 files do not open in older Clockyards.
- **Left out:** buttons in challenge checks; notes that route wires around
  them, have frames, sizes or links; a button wider than 1 bit; keys
  other than letters and digits; gates with more than 8 inputs.
