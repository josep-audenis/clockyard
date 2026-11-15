# 0026. Waveforms: watched wires recorded by the engine

- Status: Accepted
- Date: 2026-11-15
- Depends on: ADR 0020 (Phase 5 plan, increment 6); ADR 0005 (the worker);
  ADR 0017 (clocks, ticks and runs); ADR 0021 (memories read once a frame)

## Context

The brief lists waveform visualization next to signal probing and cycle
counters, and asks that results stay deterministic whatever the rendering
frame rate. ADR 0020 makes waveforms its sixth increment: "recorded signals
over ticks, for chosen nets".

What exists today:

- The engine advances in ticks, two per clock cycle, and settles after each
  (`Simulator::tick`). Virtual time is a tick count; the cycle counter is
  `(time + 1) / 2`.
- During a run, the worker ticks in chunks of 64 within an 8 ms budget per
  16 ms slice, then sends one `state` with every net's value. The editor
  sees one state per frame, not one per tick: at 100 cycles per second it
  already misses most ticks.
- Wires have stable IDs; net indices do not, since every edit reloads the
  circuit. The `loaded` reply maps each wire to its net (`wireNets`).
- Each sheet (the main circuit or a definition) is simulated on its own
  (ADR 0012). Only the sheet on screen is loaded.
- A load, a reset and a new sheet all set time back to 0 (ADR 0017).
- Memories shown by screens are read once per animation frame with
  `readMemory` (ADR 0021), not pushed with every state.

So a waveform cannot be drawn from the states the editor already receives.
The ticks between two frames are only ever seen inside the engine.

## Decision

1. **A trace is a watched wire on the sheet being simulated.**
   - The user picks a wire and chooses *Watch*. The trace follows that
     wire's net, so watching two wires of one net shows one trace.
   - A wire ID survives edits; after each load the editor sends the watched
     wires' net indices again, from `wireNets`.
   - A trace is named by its net label (ADR 0015) if the net has one, or
     otherwise by the part and port that drive it, such as `ff.q`. An
     undriven net is named by the wire's ID.
   - At most 16 traces per sheet.
   - Watches are kept per sheet in the editor, as view state. They are not
     saved in the file (see Alternatives).
2. **The engine records the traces.**
   - `Simulator::watch(nets)` sets the nets to record and clears the
     record.
   - After every settle (a load's first settle, `set_inputs`, each tick, a
     step, a reset), each watched net whose value differs from its last
     record gets a new record `(time, value)`. A settle at a time that
     already has a record replaces it, so each net has one value per tick.
     Deltas inside a settle are not recorded, as they are never shown.
   - A tick that does not settle is recorded with the values it stopped
     at, which are the values the canvas shows.
   - The record is bounded: it keeps the last 4,096 ticks and the value in
     force when that window starts. Older changes are dropped. A net's
     record is then at most 4,097 entries, whatever the run length.
   - A load or a reset clears the record, since time goes back to 0.
   - `Simulator::waves()` returns each watched net's changes in time order.
   - Recording happens per tick inside `tick`, so the record after `n`
     ticks is the same whether the worker ticked them in one call or many,
     at any speed or frame rate. A native test asserts exactly that.
3. **The worker and the wasm adapter.**
   - `sim-wasm` exposes `watch(nets)` and `waves()`. `waves()` returns one
     `Float64Array` per trace, with time and value interleaved
     (`[t0, v0, t1, v1, …]`). Times are exact up to 2^53 ticks and values
     fit in a double exactly, so nothing is lost and nothing goes through
     JSON.
   - *As built (step 1):* `sim-wasm` has `wave(i)`, one trace's array,
     rather than `waves()`, so no array of arrays crosses the boundary; the
     worker calls it once per watched net. `sim-core` has both
     `Simulator::wave(i)` and `waves()`. `watch` refuses a net index that
     does not exist, and records the current values at once, so every trace
     starts with a value.
   - A `watch` command sets the nets. A `readWaves` command is answered
     with `{ type: "waves", time, traces }`, with the arrays transferred.
   - The editor sends `readWaves` once per animation frame while a trace is
     shown, as it reads memories for screens. A paused simulation therefore
     costs nothing.
4. **The waveform panel.**
   - It sits below the canvas and appears once a wire is watched.
   - Each row has a name, a value and a lane. A 1-bit trace is a high and
     low line. A wider trace is a bus: a band whose segments show the value
     in hex, as wire labels do, where the segment is wide enough.
   - The time axis ends at the current tick and is labelled in cycles. A
     fixed scale of 8 pixels per tick shows the most recent ticks that fit
     the panel.
   - Hovering or clicking a lane places a cursor at a tick, and each row's
     value column then shows that tick's value. Left and Right move the
     cursor by one tick and Escape removes it. Without a cursor the column
     shows the current value.
   - Each row has a button to stop watching. The wire's inspector has a
     Watch and Stop watching toggle.
   - The panel is drawn as SVG in the DOM, not in the PixiJS canvas. It is
     small, it is testable by text, and its value column is readable by a
     screen reader.
   - The editor draws only what the engine recorded. It never computes a
     value.
5. **Target.** Open the 8-bit counter example, turn its Count switch on,
   watch the clock wire (`w-clk`) and the register's output bus (`w-q`),
   and press Step three times. The panel shows three clock pulses, and the
   bus reads `0x00`, `0x01`, `0x02`, `0x03`. A cursor placed in the second
   cycle reads `0x01`. A Playwright test does exactly this.
6. **Performance.** Recording costs one comparison per watched net per
   settle. Step 1 measures the reference CPU's run speed with no traces and
   with 16, and records both numbers here. It optimizes only if the
   measurement says so (ADR 0020 item 2).

   *As built (step 1):* running Catch natively in release, over three runs,
   gave 115,000 to 133,000 cycles per second with no traces and 115,000 to
   122,000 with 16. The difference is within the noise between runs, and
   both are far above the top speed of 10,000, so nothing was optimized. The
   ignored test `measure_the_reference_cpu_with_and_without_traces` in
   `crates/sim-core/tests/waves.rs` repeats it.
7. **Order of work.** Each step is one pull request:
   1. The engine:
      - `watch` and `waves` with the window;
      - `sim-wasm`'s `watch` and `waves`;
      - native tests:
        - chunking does not change the record;
        - an input change is recorded at its tick;
        - a later settle at the same tick replaces the earlier one;
        - the window drops old changes but keeps the value in force;
        - a load or a reset clears the record;
      - the speed measurement.
   2. The editor:
      - the `watch` and `readWaves` messages;
      - Watch in the wire inspector;
      - the panel and its cursor;
      - the Playwright target.

      This closes the increment.

## Alternatives considered

- **Recording in the worker, after each chunk.** It sees one value per 64
  ticks. A clock would look still, and the record would depend on where
  the chunks fall, which is not deterministic.
- **Recording in the editor, from states.** It sees one value per frame,
  worse still.
- **Recording every net.** No choice for the user, but a CPU has hundreds
  of nets, so memory grows by the window per net, and the work on every
  tick grows with it. Only watched nets are recorded.
- **A probe part placed in the circuit.** It would be saved with the
  document and visible on the canvas. However, it needs a new kind, a new
  file format, and a wire to it, while a wire already names its net.
  Watching a wire adds nothing to the circuit.
- **Saving the watches in the file (format 11).** Then an example could
  ship with its traces. However, watches are view state, like the speed or
  the zoom, which are not saved either. This can be added once an example
  or a challenge needs it.
- **Drawing in PixiJS.** Consistent with the canvas, but text in the panel
  would be harder to test and to read with assistive technology. The lanes
  are a few hundred SVG elements at most.
- **An unbounded record.** Simpler, but memory would grow with the run
  length, and a long run at 10,000 cycles per second fills it within
  minutes.

## Consequences

- A waveform is exact for every tick in its window, at any speed: the
  engine records it, and the editor only draws it.
- Every edit reloads the circuit, and a load clears the record, so editing
  during a run starts the waveform again at time 0. That follows ADR 0017,
  where a load sets time to 0.
- At high speeds, 4,096 ticks pass in well under a second. The panel is
  for looking at a paused or slow simulation, or the last moments before a
  pause. Scrolling back further would need a larger window.
- Wires inside an instance are not watchable from the main sheet. Opening
  the definition's sheet watches that sheet's own simulation (ADR 0012),
  not the instance placed in the main circuit.
- Not yet:
  - zoom and scrolling;
  - saving watches;
  - export to VCD;
  - triggers;
  - deltas inside a settle (glitches);
  - probing inside instances from the main sheet.
