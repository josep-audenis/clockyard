# 0033. Editing a running circuit: state kept across edits, matched by part ID

- Status: Accepted
- Date: 2026-11-20
- Depends on: ADR 0028 (Phase 6 plan, increment 3); ADR 0017 (clocks,
  flip-flops and load starting at time 0); ADR 0018 (ROM and RAM);
  ADR 0021 (devices); ADR 0012 (custom components, flattened with
  instance paths); ADR 0026 (waveforms, amended here)

## Context

Every connectivity edit sends the engine a new circuit. The engine
compiles it from scratch, so time goes back to 0 and every flip-flop, RAM
cell and screen pixel to 0 (ADR 0017 item 5, `docs/simulation-model.md`). A
run under way keeps running, from time 0. Moving a part changes only
geometry, so it keeps state. But adding an LED to a running counter,
rewiring one gate or undoing a wire starts the whole machine again. On the
reference CPU that throws away the program's progress, its RAM and its
screen.

ADR 0017 left "keeping state across edits, matched by part ID" for later,
and ADR 0028 made it Phase 6's third increment. Its target: the 8-bit
counter, run to some value, keeps counting from it after a wire is moved.
The rough edges that touch the same code come with it: opening a file to
fit its circuit, and the readout covering registers.

What the engine has to work with:

- **Part IDs.** Parts compile in ascending ID order (`Simulator::compile`).
  Custom components are flattened first, each inner ID prefixed with its
  instance's path (`counter/q3`, ADR 0012). The editor makes part IDs with
  `crypto.randomUUID()`, so an ID names the same part before and after an
  edit, inside components too. An ID comes back only for the same part,
  through undo.
- **Where state lives.** Most of it is in primitives:
  - a switch's or keyboard's value;
  - the clock's level, which follows time;
  - a flip-flop's stored value and the clock it last saw;
  - a RAM's or screen's cells and the clock it last saw (a screen compiles
    to a RAM, ADR 0021).

  Time is one counter. Nets are numbered by primitive, so an added part
  renumbers them, and nothing can be matched by net. A latch built from
  gates keeps its state in nets, not in a primitive.
- **Waveforms.** The engine records watched nets, one record per net (ADR
  0026: two watched wires of one net show one trace). The worker resolves
  watched wires to nets again after every load, and the editor drops the
  record when it sends a load. `watch` clears every record whenever the
  watched set changes.
- **Telling an edit from an open.** The editor's `opens` counter changes
  when a file, example, project or link is loaded (all through
  `openDocument`, then the store's `load`), and when a sheet is opened or
  closed. The engine is sent a load only when the projected description
  changed. So opening the same example again, or New on an empty sheet,
  sends nothing.
- **Clock edges today.** A load settles from all-zero nets, and nothing
  that feeds a flip-flop is pre-settled. So a load from zero never changes
  a flip-flop or writes RAM. After an edit, though, the editor re-sends
  every switch (`sent = {}`) to an engine that restarted them at 0. A
  switch that was on goes from 0 to 1 and can clock a flip-flop it drives.

## Decision

1. **What an edit keeps.** A load sent for an edit carries state from the
   circuit simulated before it. Each primitive is matched by its part's
   flattened ID:
   - **Time.** With it come the cycle counter and the clock's level: every
     clock, a new one too, takes the level the kept time gives.
   - **A flip-flop's** stored value, when a `dff` of the same width has
     that ID.
   - **A RAM's or a screen's** cells, when one of the same kind and the
     same address and data widths has that ID.
   - **A switch's or a keyboard's** value, when one of the same kind has
     that ID. A switch whose width changed keeps the bits that still fit,
     as the editor already does (ADR 0014). The editor's re-send after a
     load then changes nothing, so it cannot clock a flip-flop.

   Anything else starts as a load does: a new part, a part whose kind or
   width changed, and a RAM or screen whose size changed. A ROM's words are
   the document's, as now. Parts moved into a new component by Make
   component get new flattened IDs (`instance/part`), so their state starts
   at 0. A definition is edited on its own sheet, and opening that sheet is
   an open (item 3), so in the app an instance's inner state survives edits
   to the sheet it sits on, not edits to its definition. The engine's
   matching does not depend on that.
2. **A load is never a clock edge.** After the carried state is set, the
   load settles from all-zero nets, as now. Flip-flops, RAMs and screens do
   not sample or write during that settle. Afterwards, each takes its clock
   input's value as the clock it last saw. So moving the wire to a
   register's clock never clocks it by itself: the register is clocked on
   the next rising edge it sees.
   - This changes nothing for opens, whose loads already never change a
     flip-flop or RAM.
   - It removes the re-send edge described above.
   - If the load's settle hits its delta limit, the clocks last seen are
     taken from where it stopped, as after any unstable settle, and the
     circuit is reported unstable.
3. **Edits and opens.** Opening something starts at time 0 with
   everything at 0, as now: a file, an example, a project, a link, another
   sheet, or closing back to the main sheet.
   - The protocol's `load` gains `keep: boolean`.
   - The editor sets `keep` when its `opens` counter is unchanged since
     the previous sync, not since the previous load.
   - An open always sends a load with `keep` false, even when the
     description is the same as before, so it always starts clean and the
     next edit keeps from it.
   - `keep` with nothing to keep is a plain load: a new worker, React's
     double mount in development, or an engine that has not loaded yet.
   - Undo and redo are edits. Reset is unchanged and stays the way back
     to zero.
4. **An edit that does not compile.** A half-finished edit can leave
   validation errors, and then the engine has nothing to simulate.
   - `sim-wasm`'s engine keeps the last circuit that compiled. Today it
     drops it before compiling.
   - The next load with `keep` carries from it, so a fix restores the
     state the errors interrupted. A load without `keep` discards it.
   - Time stands still meanwhile, and `time()` reports the kept
     circuit's time, so the cycle counter does not show 0. Nets, memories
     and screens show nothing, as with errors now.
   - Step is ignored meanwhile, as now. Reset drops the kept circuit, so
     the load after the fix starts clean.
5. **A run continues.** A run under way keeps running across an edit,
   from the kept time, at the same speed. *Run until* still waits for its
   LED (ADR 0019). As now, a load clears why the last run stopped (ADR
   0021). Which tick an edit lands on depends on wall time, as a switch
   flipped while running does. Given that tick, the state after the edit is
   deterministic.
6. **The waveform record is kept (amending ADR 0026).** Time continues, so
   the record does too.
   - The engine watches wires by ID instead of nets: `watch(wires)`
     resolves them to nets as the worker does now, one record per net, as
     ADR 0026 says.
   - `watch` keeps the record of every net that stays watched, and starts
     only the newly watched ones. Today adding a watched wire clears every
     trace.
   - `load_keeping` (item 7) carries the records. Each newly watched net
     takes the record of the old net of its first watched wire, in watch
     order, that existed before.
   - So a net split in two gives both halves the old history. Wires
     joined into one net show the first one's history, and the same
     values after.
   - A wire the edit removed leaves the watch list and the record, as
     now. Undoing its deletion brings its trace back with no history.
   - The editor no longer drops the record when it sends an edit's load.
   - The cursor's epoch (ADR 0026) starts again only on an open's load or
     when time goes back (a Reset). Today every new load starts one.
7. **All of it is the engine's.** Matching and carrying live in
   `sim-core`, behind one entry point,
   `Simulator::load_keeping(description, previous)`. It compiles as `load`
   does, copies the matched state and records from `previous`, then
   settles under item 2's rule. `sim-wasm` keeps the previous (or last
   compiled) simulator and passes it when `keep` is set. The worker and
   editor only choose `keep`. Native tests cover:
   - a counter that keeps counting across a rewire;
   - a part removed and added again under a new ID, which starts at 0;
   - a width change: a flip-flop starts at 0, a switch keeps its bits;
   - a RAM and a screen kept, and a resized one cleared;
   - a keyboard's held key kept;
   - a clock wire moved without clocking anything, and a switch re-sent
     without clocking;
   - an instance kept with its inner registers, and the same parts moved
     into a new instance, starting at 0;
   - an edit with errors, then its fix;
   - records kept, split and joined.

   *As built (engine):* `Simulator::load_keeping` and `watch_wires` are in
   `sim-core`, with these tests in `crates/sim-core/tests/keeping.rs`.
   Every load, a plain one too, settles without sampling. `watch(nets)`
   keeps the record of a net still watched, which the browser sees at
   once: watching another wire no longer clears the others. `watch(nets)`
   forgets the watched wires, so the worker must watch by wire for records
   to be carried. A wire an edit removed stays in the engine's list until
   the next `watch_wires`; it records nothing meanwhile, and the editor
   sends only wires still on the sheet. `sim-wasm`, the worker and the
   editor still use `load` and `watch(nets)`.
8. **Opening fits the circuit.**
   - A file, example, project or link opens framed to fit when it does not
     fit the default view at 100%. One that fits keeps the default view,
     so a small circuit opens where it always has.
   - The fit is the existing Fit, capped at 100%: opening never zooms in.
     Opening a sheet, and every edit, keeps the current view, as now.
   - The canvas host reports its view as `data-view="x y zoom"`: the pan
     in pixels and the zoom.
   - The browser tests' grid helper reads it after the open, instead of
     assuming the default origin.
9. **The readout covers registers.** The readout for screen readers also
   lists:
   - the clock, in one row: "Clock: high" or "Clock: low";
   - every `dff` on the open sheet, by label, like an LED: on or off for
     one bit, the value in decimal and hex for more;
   - every custom component on the open sheet that holds state at any
     depth (a flip-flop, RAM or screen inside it), by label and output
     pin, as "PC q: 12". That covers the reference CPU's registers, which
     are all `Register 8` and `Register 1` instances. The engine reports
     an instance's output pins in `portNets`, as it does a primitive's
     ports; today a pin becomes a junction and is not reported.

   Memories and screens themselves are still not listed, since their
   contents are larger than a row should read out. The roadmap's rough
   edge is narrowed to them, not dropped.
10. **Target, as Playwright tests.**
    - The 8-bit counter example steps to a known value. Then one of its
      wires is moved to another port, and back, both connectivity edits.
      Neither the cycle counter nor the count goes back, and the next step
      adds one.
    - The reference CPU runs its program part way and is paused. An LED is
      added to an output, and the program's RAM and its registers in the
      readout are unchanged.
11. **Docs.**
    - `docs/simulation-model.md` replaces "a load also starts at time 0"
      and "a load clears the record" with these rules.
    - ADR 0017 item 5 and ADR 0026 items 1 to 3 (one trace per net,
      `watch` and what clears the record, the worker resolving wires) get
      as-built notes pointing here.
    - The roadmap drops the rough edges this closes: edits resetting
      registers and time, and files opening at the default view. It
      narrows the readout's to memories and screens.

## Alternatives considered

- **Matching by net.** Nets are renumbered by every compile, and an edit
  can split or join them, so a net has no identity across edits. Part IDs
  do.
- **Seeding nets from their old values.** A new net could start from the
  value of the old net driven by the same part's same port, instead of 0.
  That would keep a latch built from gates. But a net the edit split or
  joined has no single old value, its old driver may be gone, and the
  settle would start from a state no load from zero reaches. It is left
  for later, if gate latches turn out to matter.
- **Replaying from time 0.** Re-running the new circuit through the
  recorded inputs would give the state the new circuit "would have had".
  It costs time proportional to the run, needs every input change
  recorded, and gives a state the user never saw. Carrying what is there
  is cheaper, and is what a breadboard does.
- **Patching the compiled circuit in place.** This would avoid
  recompiling, but every compile step would then need an incremental
  form. A load grows about linearly, 70–450 ms natively at 10,000 parts
  (`docs/performance.md`). So at realistic sizes a full compile, plus
  copying the matched state, is simpler and fast enough.
- **Keeping state on every load, opens too.** Opening another file or
  sheet is a new circuit, and state matched across two unrelated files
  would be coincidence. Opens start clean.
- **A record per watched wire.** Two joined wires could then keep separate
  histories, but the reply would change shape, and ADR 0026 chose one
  trace per net. Showing the first wire's history keeps that choice.
- **Truncating or extending state when a width changes.** A changed
  register is a different register, and keeping some of its bits would
  surprise more than starting at 0. The same holds for a resized RAM. A
  switch is the exception, since the editor already keeps its bits and
  the user set them.
- **Letting the load's settle be an edge.** It would follow the old rule
  that every settle can clock. But then moving a clock wire, or the switch
  re-send after a load, would clock registers by itself. Nobody pressed
  anything, so nothing should be clocked.
- **Always fitting on open.** A small circuit would then open zoomed in,
  and every browser test that clicks by grid position would move. Fitting
  only what does not fit changes nothing for small circuits, and
  `data-view` keeps the tests exact for large ones.

## Consequences

- An edit no longer costs the user the machine's state. A clean start
  takes Reset, which already exists.
- A latch built from gates still resets on an edit, or oscillates if it
  settles that way from zero (the alternative above).
- Editing a ROM, or assembling a new program into it, keeps the program
  counter and RAM. Running the new program from the start takes Reset.
- Undo restores the circuit, not the state. Undoing an edit carries the
  current state into the older circuit, and a watched wire brought back
  by undo has no history.
- Behaviour changes, so some tests change. Native tests of load starting
  at time 0 after an edit, and browser tests that expect cycle 0 or an
  empty record after an edit, are rewritten to these rules. Tests of
  opening and of Reset keep their expectations.
- While an edit's load runs, the engine holds two simulators, and while an
  edit has errors it keeps the last compiled one. Each is the circuit's
  size.
- Not done here: per-part reset, a "restart on edit" preference, seeding
  nets for gate latches, and listing memories or screens in the readout.
