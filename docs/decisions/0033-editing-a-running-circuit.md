# 0033. Editing a running circuit: state kept across edits, matched by part ID

- Status: Proposed
- Date: 2026-11-19
- Depends on: ADR 0028 (Phase 6 plan, increment 3); ADR 0017 (clocks,
  flip-flops and load starting at time 0); ADR 0018 (ROM and RAM);
  ADR 0012 (custom components, flattened with instance paths); ADR 0026
  (waveforms)

## Context

Every connectivity edit sends the engine a new circuit. The engine
compiles it from scratch, so time goes back to 0 and every flip-flop and
RAM cell to 0 (ADR 0017 item 5, `docs/simulation-model.md`). A run under
way keeps running, from time 0. Moving a part changes only geometry, so it
keeps state, but adding an LED to a running counter, rewiring one gate or
undoing a wire starts the whole machine again. On the reference CPU that
throws away the program's progress and RAM.

ADR 0017 left "keeping state across edits, matched by part ID" for later,
and ADR 0028 made it Phase 6's third increment. Its target: the 8-bit
counter, run to some value, keeps counting from it after a wire is moved.
The rough edges that touch the same code come with it: opening a file to
fit its circuit, and the readout covering registers.

What the engine has to work with:

- Parts compile in ascending ID order (`Simulator::compile`). Custom
  components are flattened first, each inner ID prefixed with its
  instance's path (`counter/q3`, ADR 0012). Document IDs are stable across
  edits, so a flattened ID names the same part before and after an edit,
  inside components too.
- State lives in primitives: a switch's value, the clock's level, a
  flip-flop's stored value and the clock it last saw, a RAM's cells and
  the clock it last saw. Time is one counter. Nets are renumbered by every
  compile, so nothing can be matched by net.
- The waveform record is kept by net in the engine. The worker maps
  watched wires to nets again after every load (ADR 0026), and the editor
  drops the record when it sends a load.
- The editor already knows an edit from an open. Its `opens` counter
  changes when a file, example, project or link is loaded, and when a
  sheet is opened or closed.

## Decision

1. **What an edit keeps.** A load sent for an edit to the sheet being
   simulated carries state from the circuit simulated before it. Each
   part is matched by its flattened ID:
   - **Time**, and with it the clock's level and the cycle counter.
   - **A flip-flop's** stored value and the clock it last saw, when a
     `dff` of the same width has that ID.
   - **A RAM's** cells and the clock it last saw, when a RAM with the same
     address and data widths has that ID.
   - **A switch's** value, when a switch of the same width has that ID.
     The editor re-sends every switch after a load, as it does now (ADR
     0017 item 4). Once the value is carried, that re-send changes nothing,
     so it cannot clock a flip-flop on its own.
   - Anything else starts as a load does: a new part, a part whose kind
     or width changed, a RAM whose size changed, and every part on a sheet
     that was opened rather than edited. A ROM's words are the document's,
     as now.

   Editing a definition is an edit too. Each instance's parts keep their
   paths, so a register inside a `Register 8` keeps its bits while the
   instance and the flip-flop inside it stay.
2. **A load is never a clock edge.** After the carried state is set, the
   load settles from all-zero nets as it does now. Flip-flops and RAMs do
   not sample during that settle. Afterwards, each takes its clock input's
   settled value as the clock it last saw. Moving the wire to a register's
   clock therefore never clocks it by itself: it is clocked on the next
   rising edge it sees.
3. **What starts from zero.** Opening something starts at time 0 with
   everything at 0, as now. That covers a file, an example, a project, a
   link, another sheet, and closing back to the main sheet. The protocol's
   `load` gains `keep: boolean`. The editor sets it from its `opens`
   counter: unchanged since the last load means an edit. Undo and redo are
   edits. Reset is unchanged and stays the way back to zero.
4. **An edit that does not compile.** A half-finished edit can leave
   validation errors. Then the engine has nothing to simulate, and time
   stands still. The worker keeps the last circuit that compiled. The next
   load that compiles carries from it, so a fix restores the state the
   errors interrupted. An open discards it.
5. **A run continues.** A run under way keeps running across an edit,
   from the kept time, at the same speed. *Run until* still waits for its
   LED (ADR 0019). As now, a load clears why the last run stopped
   (ADR 0021).
6. **The waveform record is kept per watched wire.** Time continues, so
   the record does too. The engine's record is by net, so the worker maps
   each watched wire's history from the net it had to the net it has now.
   - A wire still there keeps its history and goes on with its new net's
     values.
   - A wire the edit removed leaves the record, as it leaves the watch
     list.
   - Two watched wires an edit joins into one net each keep their own
     history up to the edit, and show the same values after it.

   The editor no longer drops the record when it sends an edit's load.
   Since time did not go back, the cursor's epoch (ADR 0026) stays.
7. **All of it is the engine's.** Matching and carrying live in
   `sim-core`, behind one entry point. For example,
   `Simulator::load_keeping(description, previous)` compiles as `load`
   does, then copies the matched state from `previous` before the first
   settle. `sim-wasm` keeps the previous simulator and passes it when
   `keep` is set. The worker and editor only choose `keep` and remap the
   record. Native tests cover:
   - a counter that keeps counting across a rewire;
   - a part removed and added again under a new ID, which starts at 0;
   - a width change, which starts at 0;
   - RAM kept, and RAM resized;
   - a clock wire moved without clocking anything;
   - a definition edited while its instances keep their registers;
   - an edit with errors, then its fix.
8. **Opening fits the circuit.** A file, example, project or link opens
   framed to fit when it does not fit the default view at 100%. One that
   fits keeps the default view, so a small circuit opens where it always
   has. The fit is the existing Fit, capped at 100%: opening never zooms
   in. The canvas host reports its view in a `data-view` attribute (pan
   and zoom). The browser tests' grid helper reads it instead of assuming
   the default origin. Opening a sheet, and every edit, keeps the current
   view, as now.
9. **The readout covers registers.** The readout for screen readers also
   lists:
   - the clock, as "Clock: high" or "Clock: low";
   - every flip-flop on the open sheet, by label, like an LED: on or off
     for one bit, the value in decimal and hex for more.

   Parts inside components, memories and screens are still not listed.
   Their contents are larger than a list row should read out.
10. **Target, as a Playwright test.** The 8-bit counter example runs (or
    steps) to a known value. An LED is then added to one of its outputs,
    a connectivity edit. The counter keeps counting from that value: the
    cycle counter does not go back and the next step adds one. A second
    test opens the reference CPU, runs its program part way, rewires an
    LED and checks the program's RAM is unchanged.
11. **Docs.**
    - `docs/simulation-model.md` replaces "a load also starts at time 0"
      with these rules.
    - ADR 0017 item 5 and ADR 0026's "a load clears the record" get
      as-built notes pointing here.
    - The roadmap drops the rough edges this closes: edits resetting
      registers and time, files opening at the default view, and the
      readout lacking registers.

## Alternatives considered

- **Matching by net.** Nets are renumbered by every compile, and an edit
  can split or join them, so a net has no identity across edits. Part IDs
  do.
- **Replaying from time 0.** Re-running the new circuit through the
  recorded inputs would give the state the new circuit "would have had".
  But it costs time proportional to the run, needs every input change
  recorded, and gives a state the user never saw. Carrying what is there
  is cheaper and is what a breadboard does.
- **Patching the compiled circuit in place.** This would avoid
  recompiling, but every compile step would then need an incremental
  form. A load grows about linearly, about 130 ms natively at 10,000
  gates (ADR 0030), so at realistic sizes a full compile plus copying
  matched state is simpler and fast enough.
- **Keeping state on every load, opens too.** Opening another file or
  sheet is a new circuit, and state matched by ID across two unrelated
  files would be coincidence. Opens start clean.
- **Truncating or extending state when a width changes.** A changed
  register is a different register, and keeping some of its bits would
  surprise more than starting at 0. The same holds for a resized RAM.
- **Letting the load's settle be an edge.** It would follow the old rule
  that every settle can clock. But then moving a clock wire, or the
  switch re-send after a load, would clock registers by itself. Nobody
  pressed anything, so nothing should be clocked.
- **Always fitting on open.** A small circuit would then open zoomed in.
  Every browser test that clicks by grid position would also move. Fitting
  only what does not fit changes nothing for small circuits, and the
  `data-view` attribute keeps the tests exact for large ones.

## Consequences

- An edit no longer costs the user the machine's state. Getting a clean
  start takes Reset, which already exists.
- Behaviour changes, so some tests change. The editor's tests that expect
  a counter at cycle 0 after an edit, and the native tests of load
  starting at time 0 after an edit, are rewritten to these rules. Tests of
  opening and of Reset keep their expectations.
- The engine holds two simulators for a moment during an edit's load, and
  the worker keeps the last compiled one while an edit has errors. That
  memory is the circuit's size, already small at realistic sizes.
- Undo restores the circuit, not the state. Undoing an edit carries the
  current state into the older circuit; it does not bring back the state
  from before the edit.
- What follows from this, and is not done here: per-part reset, a
  "restart on edit" preference, and listing memories or screens in the
  readout.
