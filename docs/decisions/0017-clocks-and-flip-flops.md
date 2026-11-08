# 0017. Clocks, flip-flops and virtual time

- Status: Proposed; confirms the sequential part of ADR 0006
- Date: 2026-11-08
- Depends on: ADRs 0006 (synchronous deltas), 0012 (custom components),
  0014 (widths), 0016 (`netDrivers`)

## Context

Phase 3 of the brief asks for hardware with memory and time: deterministic
virtual time, a clock component, rising-edge D flip-flops, a register
primitive, reset, run/pause/step controls, bounded event processing, clock
visualization and a cycle counter. The target demo is an 8-bit counter that
can be paused, reset and advanced one cycle at a time, with the same result
whatever the frame rate.

`docs/simulation-model.md` already sketches the design target, and ADR 0006
left its sequential part to be confirmed in Phase 3:

- an edge-triggered element samples its data from the state settled
  *before* the edge;
- every element triggered by one edge updates together;
- virtual time is a tick counter, independent of wall-clock time.

What the engine has today:

- Every settle is a run of synchronous deltas. Each part compiles to
  primitives with one output each, and primitive `p` drives net `p + 1`
  (ADR 0014).
- Settles are bounded. A loop that does not settle reports `unstable` and
  is resumed by the next settle.
- On load, logic that cannot reach a loop is pre-settled in topological
  order. That needs every primitive to be pure while settling, so a
  stateful one must count as part of a loop (`presettle` says so).
- The protocol already reserves `stepClock`, `run`, `pause` and `reset`
  commands, marked "Phase 3" in `architecture.md`.

## Decision

1. **One global clock, counted in ticks.** Virtual time is a `u64` count of
   *ticks*, one tick per half period.
   - The clock is low at even ticks and high at odd ones. Time 0 is low.
   - A *cycle* is one rising edge. The cycle counter is the number of
     rising edges so far, `(time + 1) / 2`.
   - Phase 3 has a single global clock with no period of its own: speed is a
     run-time setting (item 6), not a property of the circuit. Several
     independent clocks with their own periods and phases, scheduled on a
     time-ordered event queue keyed by `(tick, sequence)` as
     `simulation-model.md` plans, come later.
2. **A Clock part.** New kind `clock`: no inputs, one 1-bit output `out`.
   - Its value is the global clock's level. Every clock part, on the sheet
     or inside a definition, shows the same level at the same time.
   - It compiles to one primitive whose value the engine sets on each tick,
     as a switch's is set by `setInput`.
   - It is not a pin. A definition that needs a clock takes it through an
     input pin (a switch) wired to a clock outside. On the definition's own
     sheet, toggling that switch makes edges by hand.
3. **A D flip-flop, which is also the register.** New kind `dff`.
   - Ports: input `d` (width *w*), input `clk` (1 bit), output `q` (width
     *w*).
   - It is sized (ADR 0014): width 1 to 32, default 1. A wide one is a
     register. One primitive serves both, so the parts panel offers two
     tiles of the same kind: *D flip-flop* (width 1) and *Register* (width
     8).
   - `q` starts at 0. An unconnected `clk` reads 0 and never rises, with the
     usual unconnected-input warning.
   - Clock enable, falling-edge triggers and per-part reset pins come later
     (items 9 and 11).
4. **Edge sampling, for every settle.** Each settle snapshots the net values
   it starts from. That is the settled state before whatever change started
   it: a tick, `setInput`, load or reset.
   - Each `dff` remembers the last value it saw on `clk`, starting at 0.
   - When a delta evaluates a `dff` and finds `clk` at 1 after a remembered
     0, the flip-flop takes `d` from the snapshot, not from the current
     nets. Its new `q` appears like any other primitive's output, in the
     following delta.
   - The same rule therefore covers:
     - the global clock;
     - a gated or derived clock that arrives some deltas later;
     - a ripple chain, where one flip-flop's `q` clocks the next;
     - a switch wired to `clk` and toggled by hand.

     None of them can see new data from the same edge. A shift register
     moves by exactly one place per edge.
   - A glitch that raises `clk` twice in one settle samples the same
     snapshot twice, so it changes nothing extra.
   - The snapshot is a copy of the net values, taken once per settle. An
     undo log of changed nets is a later optimization, allowed only if
     results stay identical.
   - A `dff` is stateful, so `presettle` treats it as part of a loop. Logic
     it drives settles delta by delta, as logic feeding a loop already does.
5. **Engine commands** (`sim-core`, exposed through `sim-wasm`).
   - `tick(count)` advances the clock `count` ticks. Each tick sets every
     clock primitive and settles.
   - `step_cycle()` ticks until the clock has risen once and fallen again,
     leaving it low with the cycle counter one higher: 2 ticks from low,
     3 from high.
   - `reset()` puts every flip-flop, the clock and time back to 0, keeps
     switch values, sets every net to 0, then pre-settles and settles as a
     load does.
   - `time()` returns the current tick.
   - Each command returns its runtime diagnostics. A tick that ends
     `unstable` stops the command at that tick and reports it.
   - Load also starts at time 0 with every flip-flop at 0. A connectivity
     edit therefore resets sequential state. Keeping state across edits,
     matched by part ID, is left for later.
6. **The worker runs the clock; the engine never reads wall time.**
   - Protocol commands: `run { cyclesPerSecond }`, `pause`, `step` (one
     `step_cycle`) and `reset`. These replace the reserved `stepClock`.
   - While running, the worker works in slices of wall time, about 16 ms
     each. In each slice it ticks the number of ticks the speed calls for
     since the last slice, at most what fits in a slice's budget (about
     8 ms of work), then replies `state`.
   - At low speeds a slice holds one tick, so the clock is seen to blink.
   - Pacing uses `performance.now()` in the worker only. It decides how many
     ticks run, never what a tick does. The state after *n* ticks is the
     same at any speed, frame rate or slice size, which is the brief's
     determinism requirement.
   - `pause` takes effect between ticks, so the clock may be left high.
     `step` from there finishes that cycle and runs one more (item 5).
   - `step` and `reset` pause first.
   - An `unstable` result pauses the run and is reported as it is today.
   - Commands keep their order. A `setInput` sent while running is applied
     between two ticks.
   - A `load` while running keeps running, from time 0.
   - `state` gains `time` (ticks, as a JS number) and `running`, so the
     editor learns of a pause the worker made itself.
7. **Editor.**
   - The toolbar gains Run/Pause, Step and Reset, plus a speed choice: 1, 2,
     5, 10, 100, 1,000 and 10,000 cycles per second, default 2.
   - The status bar shows `Cycle n`, with the clock's level beside it.
   - A Clock part is drawn with a square-wave mark, and its output wire is
     coloured by level like any wire.
   - A D flip-flop or register is a box with `D` and a clock triangle on the
     left and `Q` on the right. A wide one shows `q` in hex, as a wide
     switch does.
   - New parts-panel tiles: Clock (Inputs), and D flip-flop and Register (a
     new Memory section).
   - Run, Step and Reset act on the open sheet, which is what the engine
     simulates.
8. **File format v7.** The kinds `clock` and `dff` join the document, and
   `dff` takes `width`. A v6 file opens unchanged. A v6 build refuses a v7
   file as too new, rather than failing on an unknown kind.
9. **Bounded.** Every settle keeps its delta limit (ADR 0006). A run
   advances a bounded number of ticks per slice, and `tick(count)` stops at
   the first `unstable`. Nothing can keep the worker busy without
   returning.
10. **Custom components.** A clock or flip-flop inside a definition works
    as anywhere else. Every instance has its own flip-flops, as ADR 0012
    requires of stateful parts. All clocks share the global clock. `lift`
    reports a flip-flop inside an instance as that instance, and
    `netDrivers` names the instance as its `q` net's driver.
11. **Out of scope for Phase 3:**
    - a single-delta *step event*;
    - falling-edge triggers;
    - clock enable;
    - per-part reset pins;
    - several clocks with their own periods;
    - keeping state across edits;
    - RAM and ROM;
    - waveforms;
    - four-state values.

    Each needs its own decision when it comes.

## Alternatives considered

- **Sample at the edge's delta, with no snapshot.** A flip-flop would read
  `d` in the delta where it sees `clk` rise. A clock gated through a few
  gates arrives deltas late, by which time `d` may already hold that edge's
  new data, so results would depend on gate depth. The brief rules this
  out ("capture all register inputs using the pre-edge state").
- **A separate register primitive.** It would need the same ports, sampling
  and state as a wide `dff`. One sized kind covers both, as sized gates do.
- **A clock with a period property, now.** One global clock needs none, and
  independent clocks need the event queue. Both are deferred together.
- **Pause only at whole cycles.** The paused state would be tidier, but at 1
  cycle per second a pause could wait half a second. Pausing between ticks,
  with `step` defined to end on a whole cycle, avoids that.
- **Pacing in the main thread.** It would tie the clock to the frame rate
  and cost a message per tick. The worker owns the loop, and the UI only
  draws what arrives.

## Consequences

- The counter demo becomes buildable from existing parts. Turn the 8-bit
  adder example into a component with Make component (its 8-bit A and B
  switches become pins). Then wire an 8-bit register's `q` into A, a wide
  switch set to 1 into B, the sum back into `d`, a clock onto `clk`, and an
  LED onto `q`. An example
  file and a Playwright test check that Step adds one, that Reset returns to
  0, and that running for a while then pausing gives the same state as the
  same number of Steps.
- Every connectivity edit resets registers. This is simple and predictable,
  but someone building a CPU will feel it.
- One snapshot copy per settle costs memory traffic proportional to the
  number of nets. That is fine at Phase 3 sizes; measure before replacing
  it with an undo log.
- Docs to update when this is built:
  - `simulation-model.md`: the sequential section stops being a design
    target, and ticks, `step_cycle` and reset are described as built;
  - ADR 0006: its sequential part is confirmed;
  - `architecture.md`: commands and `state`;
  - the roadmap.
- Tests:
  - `sim-core`:
    - a shift register shifts by exactly one place per edge;
    - a gated clock and a ripple counter sample pre-edge values;
    - a hand-toggled `clk` works;
    - `step_cycle` from low and from high;
    - reset keeps switch values;
    - `tick` stops at `unstable`;
    - two instances of a definition holding a flip-flop keep separate
      state;
    - the same command sequence gives identical nets, whatever the
      component order.
  - Editor and format: v7 round-trip, and v6 migration.
  - Playwright: the counter demo.
