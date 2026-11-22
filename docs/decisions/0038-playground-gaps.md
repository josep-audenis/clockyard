# 0038. The playground's gaps: push buttons, gates with 2 to 8 inputs, notes on the canvas

- Status: Accepted
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

- **Inputs.** A switch is a part whose value the editor sets between
  ticks; the engine settles at once, and the worker applies input changes
  between its slices of ticks. A switch's position lives in the store's
  `inputs` and is never saved. Opening a file, example, project, link or
  sheet starts every switch at 0; an edit's reload sends the positions
  again, and Reset keeps them (`docs/simulation-model.md`, "Execution
  controls"). Inside a custom component a switch is an input pin (ADR
  0012). Devices are ordinary parts that can sit inside a component, and
  only the open sheet is simulated with its own inputs (ADR 0017, ADR
  0021).
- **Who has the keys (ADR 0021).** A click on a keyboard part gives the
  circuit the keys (on pointer-up). While it has them, a capture listener
  sends each plain key to the keyboard part and stops it, so no
  single-key shortcut fires. Ctrl or Cmd with a key still reaches the
  editor and lets go of every held key, and so does a Meta key-up, since
  macOS sends no key-up for a key released while Cmd is down. Esc, Tab,
  any press on the canvas or outside it, or leaving the window gives the
  keys back, and the status line says so while it lasts. The editor's
  shortcuts otherwise: Ctrl+Z/Y/C/X/V/D/A, Space (pan), Delete, R, F,
  Escape, `?` for the keyboard reference, and single letters that arm a
  part for placing (`SHORTCUTS` in `App.tsx`). Every bare letter is taken.
- **Gates.** AND, OR, NAND, NOR, XOR and XNOR have two inputs, `a` and `b`,
  and a width from 1 to 32 set in the inspector. The engine evaluates
  `gate(kind, input(0), input(1))`, with a two-state path and a two-word
  path for four-state circuits (ADR 0035). The canvas draws a gate 4 cells
  square, its inputs at rows 1 and 3, AND's front a semicircle.
- **Changing a part's size.** Fewer fields on a split or merge drops the
  wires on the ports that go, and a junction left with no wires, in one
  undoable edit (`setFields`). A new size that would put a port on a
  junction is refused (`withProps`).
- **Waveforms (ADR 0026)** record one value per tick: a later settle at
  the same tick replaces that tick's value. A press and release with no
  tick between them leaves no trace.
- **Text.** A project has notes in a panel (`metadata.notes`, ADR 0027),
  one text for the whole project, normalized on read (control and bidi
  characters removed, length checked). Nothing can be written on a sheet.
- **The file format** is at version 12. Older versions read unchanged
  where nothing moved; a newer one is refused with a message naming both
  versions.

## Decision

1. **Push button, a new part `button`.** One output `out`, 1 bit, `1`
   while held and `0` otherwise. Always known, like a switch. 4×4 cells,
   as a gate is, its output at (4, 2), a round cap of 1.25 cells' radius
   in the middle.
   - **In the engine** it is an input part like a switch, with its own
     kind so that the catalog, the readout and a definition can tell them
     apart. Its value is set between ticks by the same input call; the
     engine knows nothing of pointers or keys.
   - **By pointer or touch:** pointer-down on the cap holds the button;
     pointer-up, pointer-cancel or a lost capture of that pointer lets it
     go. Holds live in their own map keyed by pointer ID, outside the
     scene's single gesture: a cap press never starts or ends the
     gesture, and a holding pointer's events let go only of its own
     button. So several fingers hold several buttons while another drags.
     Near the output, a press picks the port, as on any part. The rest of
     the body selects and drags; a tap on the cap selects the button too.
   - **By key (the open question).** A button may have a *binding*: one
     of the keys A–Z or 0–9, stored as its physical code (`KeyA`,
     `Digit1`), set in the inspector by pressing the key, shown by its
     place on a US layout, saved in the file. The keys reach buttons only
     while *the circuit has the keys*, the state ADR 0021 already has,
     extended:
     - A press on a bound button's cap gives the circuit the keys, as a
       click on a keyboard part does. A press on a cap never gives them
       back: it keeps a keyboard part's claim and every button held by
       key. A press on an unbound cap leaves the keys where they are.
     - The Step, Run and Pause, and Reset buttons keep the keys a button
       gave, so a button can be held by key across a Step. (Amended in step
       4: a keyboard part's keys still go back on them, as ADR 0021 has it.) Any other press, on the
       canvas or outside it, gives them back, as today. That includes the
       speed and run-until selects: a native select's popup can swallow a
       key-up and leave a button held.
     - While the circuit has the keys, a plain key bound to buttons holds
       every button bound to it (down holds, up lets go, repeats are
       ignored) and goes nowhere else. Other plain keys go to the keyboard
       part if one was clicked, and are dropped otherwise.
     - Ctrl or Cmd with any key, bound or not, still reaches the editor
       and lets go of every button held by key, and so does a Meta
       key-up, as `keyStep` does for the keyboard part. Undo or redo that
       removes a held button forgets its hold; one that brings a button
       back brings it back let go.
     - Esc, Tab, a press that gives the keys back, or leaving the window
       lets go of every button held by key.
     - The status line names the bound keys: "The circuit has the keys:
       1, 2, 3, 4 hold buttons. Esc, Tab or a click elsewhere gives them
       back."

     So a key never holds a button while editing, the shortcuts keep their
     keys, and the keyboard part keeps every key no button claims. A key
     bound to a button cannot be typed into a keyboard part on the same
     sheet; the inspector says so beside the binding.
   - **From the keyboard alone:** the inspector of a selected button has a
     Press button, `aria-pressed`, held from pointer-down or Space/Enter
     key-down to their up (repeats ignored), let go on blur.
   - **A short press.** The worker, which applies input changes between
     its slices of ticks, notes the tick at which a button went to 1. If
     it goes back to 0 at the same tick while a run is going (Run or Run
     until), the worker reports the button's ID, and the editor's status
     line says: "Button 1 was let go before a tick: parts clocked by the
     clock did not see it." (Amended in step 1: a part whose `clk` the
     button itself drives does see the press, as a rising edge between
     ticks.) An edit's reload that sends a held button's 1 again keeps
     its noted tick; Reset sets it to 0, as time goes back to 0.
     Combinational parts did see it, and the canvas lit it. Nothing stretches a press: what the circuit sees is what was
     held. `docs/simulation-model.md` says that a clocked part sees a
     press only if its clock's rising edge falls inside it.
   - **Not saved, and kept as a switch is:** every button is let go when
     a file, example, project, link or sheet is opened. An edit's reload
     and Reset keep what is held, since the finger or key is still down.
     Its binding is saved.
   - **Inside a component** a button is an ordinary part, not a pin: it is
     let go wherever the component is used, and can be held on the
     component's own sheet (ADR 0017). The inspector of a definition with
     one says so. Challenge checks drive switches and pins only, not
     buttons.
   - Shown in the hidden readout list as "Button 1: held" or "let go",
     and in waveforms like any net.

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
   - **In the engine:** a shape value `inputCount`, 2 to 8, absent
     meaning 2, for the six gates only. Ports `a` to `h`, so a 2-input
     gate's ports keep their names. A description with `inputCount` out
     of range or on another kind is refused with `invalidWidth`, as an
     address width is, its message naming the input count. Evaluation
     folds AND, OR or XOR over the inputs and inverts once at the end for
     NAND, NOR and XNOR, on both paths.
   - **The cost** is measured on the ADR 0030 benchmarks before and after,
     native and in the browser, and written in the pull request. The
     native median of five runs of each 2-input benchmark must stay within
     5% of before; if a fold does not, the 2-input case keeps its own
     branch.
   - **In the editor:** an Inputs field beside Width in the inspector for
     the six gates. A gate with *n* inputs is 4 cells wide and 2*n* high,
     its inputs at rows 1, 3, …, 2*n* − 1 and its output at row *n*; at 2
     that is today's gate. It is drawn as today's 4×4 symbol centred on
     the output, with its flat back drawn over every input row.
     - The unrotated top edge stays where it is, in every rotation, so
       every input keeps its place and the part grows away from them;
       only `out` moves. Bends on wires to a port that
       moved are dropped, as `rotate` does.
     - Fewer inputs drops the wires on the ports that go, and a junction
       left with no wires, in one undoable edit, as `setFields` does.
     - A change refused because a port would land on a junction is said in
       the status line, for gates and for the parts `withProps` already
       refuses.

3. **Notes on the canvas.**
   - **In the document,** each sheet (the main circuit and each
     definition) gets `notes`, a required field beside `components`,
     `junctions` and `wires`, read as empty when a file has none (every
     file of version 12 or older, and version 13 files written before
     step 5): `{ id, position, text }`, at a grid point (as built: a
     `position`, as parts and junctions have). Required, so that the
     type checker finds every edit that rebuilds a circuit (move, remove,
     rotate, `setFields` and the rest) and none drops them.
   - **On read,** as for `metadata.notes`: each text goes through
     `normalizeNotes`; a text over 500 characters, more than 200 notes on
     a sheet, or an ID already used on the sheet (by a part, junction,
     wire or note) refuses the file; an empty note is dropped. Line breaks
     are kept.
   - **Never in the engine:** the projection to the engine leaves them
     out, and a test checks that a circuit's description is the same with
     and without its notes.
   - **On the canvas** a note is drawn in one size, its lines as written,
     with no frame, under the wires and parts so it never hides a
     connection. Wires do not route around notes. The hidden readout
     lists each note's text, for screen readers.
   - **Editing:** Add components has a Text entry. A new note is selected
     and the inspector's text field focused, as a wide switch's Value
     field is; the inspector edits it. A note left empty is deleted when
     the field is left, and a new one abandoned empty leaves no undo
     entry. Notes select (by click and marquee), move, delete, copy,
     paste with new IDs, duplicate and undo with parts. Rotating a
     selection turns a note's place, not its text. Make component takes
     parts only: notes stay on the sheet they were on.
   - Increment 2 needs titles for regions; whether a note gets a size is
     its ADR's to decide.

4. **The file format becomes version 13:** a gate's `inputCount`, the
   `button` part and its `binding`, and each sheet's `notes`. Files 1 to
   12 read unchanged, since nothing they hold moves. Version 12 and older
   Clockyards refuse a version 13 file with the message they have.
   Version 13 lands in step 3 and grows in steps 4 and 5 by additions
   only; nothing is deployed in between (ADR 0037). The bundled examples
   are written again only if a check needs it.

5. **Steps,** one pull request each:
   1. **The rules:** N-input gates and the push button in
      `docs/simulation-model.md`, nothing else.
   2. **The engine:** `inputCount`, ports `a` to `h`, the fold on both
      paths, the `button` kind, the catalog through `sim-wasm`. Tests:
      every input combination of `0`, `1`, `X` and `Z` for 2 to 4 inputs
      of each gate against a model written from the rules, and 8 inputs at
      width 32 on chosen values. The benchmarks, before and after.
   3. **Gates in the editor:** the Inputs field, layout and drawing,
      growing from the top edge in each rotation, wires dropped, refusals
      said. Format 13 and a test that a version 12 file reads the same;
      `docs/architecture.md`'s format line.
   4. **The push button:** pointer holds by pointer ID, touch, the
      binding, keys and the circuit having them, the run controls keeping
      them, the Press button, the short-press report from the worker, the
      readout, the button keys in the `?` reference. Vitest: key routing,
      Ctrl/Cmd and Meta letting go, two pointers holding two buttons while
      a third drags, a short press reported by the worker. Playwright
      holds a button with the pointer and with its key, and across a
      Step.
   5. **Notes on the canvas:** with Vitest for reading them (limits,
      normalizing, IDs) and for each edit keeping them. Then the target in
      Playwright: a 4-input AND, a button on each input bound to 1, 2, 3
      and 4, an LED, a note beside them. Holding 1, 2 and 3 leaves the LED
      off; 4 as well lights it; letting one go puts it out. Saved to a
      file and opened again: four inputs, the bindings, the note's text,
      every button let go. The roadmap updated.

## Consequences

- A circuit can be driven by holding things down, by pointer, touch or
  key, with no key ever reaching a button while editing, and a button can
  be held through a Step.
- A wide AND or OR no longer needs a tree of 2-input gates, and parity is
  one part.
- A sheet can carry its own explanations, which increment 2 builds on
  for the reference CPUs.
- A key bound to a button is lost to a keyboard part on the same sheet.
  Bindings name physical keys, so on another layout the key shown may
  type a different character.
- A short press is reported, not prevented: a clocked circuit can still
  miss it, as real hardware does without a debouncer and a latch.
- A tap on a cap to select a button also holds it for that moment, a
  real press the circuit sees.
- A gate that gains or loses inputs moves its output.
- Version 13 files do not open in older Clockyards.
- **Left out:** buttons in challenge checks; notes that route wires around
  them, have frames, sizes or links; a button wider than 1 bit; keys
  other than letters and digits; gates with more than 8 inputs.
