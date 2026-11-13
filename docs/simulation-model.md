# Simulation model

Status: **built** for combinational logic (Phase 1, ADR 0006) and sequential
logic (Phase 3, ADR 0017). Four-state values and multi-driver nets are still
a design target.

## Terms

| Term | Meaning |
|------|---------|
| Component | A primitive in the compiled netlist (gate, switch, LED, flip-flop, …) |
| Port | A named input or output of a component, with a width |
| Net | Ports joined by wires, directly or through junctions: exactly one driver output, any number of reader inputs |
| Value | The signal on a net |
| Delta | One evaluation round inside a settle, at a single instant of virtual time |
| Settle | Repeating deltas until no net changes |
| Tick | One unit of virtual simulation time |

## Signal values

Binary. A net carries `width` bits (1–32, ADR 0014), each `0` low or `1`
high, stored as one `u32` cut to that width. A 1-bit net holds `0` or `1`.
Widths are declared on parts (`width` on switches, LEDs and gates, `fields`
on splits and merges) and never inferred. They are checked when a circuit
loads: a bad `width` or `fields` is `invalidWidth`, and ports of different
widths on one net are `widthMismatch`, never a silent truncation. The engine,
protocol, file format (v5) and editor all carry them (ADR 0014).

Designed to extend to:

- **Four-state** (later): `0`, `1`, `X` (unknown/conflict), `Z` (high
  impedance), stored as value + unknown masks. Introduced together with
  tri-state outputs and multi-driver nets.

Code that reads values goes through the `logic` module's value type so the
representation can change without touching every evaluator.

## Custom components

Before nets are resolved, `sim-core` flattens every instance of a custom
component (ADR 0012), depth first: the definition's parts, junctions and wires
are copied with IDs prefixed `instance/`, and each of its pin switches and LEDs
becomes a junction that the instance's port is joined to. Each instance thus
has its own state.

Flattening joins levels through pins, so wiring that touches a pin is checked
first, level by level, as the user drew it: on the main circuit and in each
definition used, an instance is a black box whose input ports read and output
ports drive, and inside a definition its pin switches drive and its pin LEDs
read. The table below then applies to each such group of wires on its own:
two pins driving one wire is `outputToOutput` (or `multipleDrivers` with a
reader), and inputs joined to a pin with nothing driving them `inputToInput`,
whatever the flattened net would show. After flattening, a net with no output
that reaches a pin is a pin left unconnected: its readers read 0 and warn. So
a pin passed straight through an instance and left unconnected reads 0 on the
far side. Diagnostics
name the top-level part an inner ID belongs to. Unknown or recursive
definitions, bad pins (checked where a definition is used) and more than
200,000 expanded items (parts, junctions, wires and instances) are errors, as
are IDs containing `/` (`invalidId`) and instances sharing an ID.

## Nets

Wires join two ends: ports or junctions. On load the engine joins every port
and junction that wires connect (union-find over the connection graph,
ADR 0010) and checks each resulting net as a whole:

| Outputs | Inputs | Result |
|---------|--------|--------|
| 1 | any | Valid: the output drives every input; every wire in the net reports it |
| 0 | 0 or 1 | Valid dangling branch: its input reads 0 and warns as unconnected; its wires read 0 |
| 0 | 2 or more | `inputToInput` error: nothing drives the net |
| 2 or more | 0 | `outputToOutput` error |
| 2 or more | 1 or more | `multipleDrivers` error |

Duplicate wires between the same ends are harmless: they join nothing new.

**Net labels** (ADR 0015): junctions with the same non-empty `name` on one
sheet are one net, as if a wire joined them, and every rule above applies to
the whole. A sheet is the main circuit or one definition; inside an instance
a junction's sheet is its instance path, so labels never join across
instances or across a component's boundary (pins are the only way in). Names
match exactly, case included. Labels are joined in both places nets are
built: each level's check before flattening, and the flat circuit. A name no
other junction on its sheet carries warns `unmatchedLabel`, naming that
junction (or, inside a definition, the top-level instance).

## Compiled netlist

Dense, index-based, built once per load:

- `nets: Vec<NetValue>` — current value per net.
- `components: Vec<Component>` — kind, input net indices, output net indices.
- `fanout: Vec<Vec<u32>>` (or CSR arrays) — components reading each net.

Component order is fixed at compile time (sorted by stable document ID) so the
same circuit compiles to the same indices on every machine.

Parts compile to primitives, each with one output net: a switch or gate to
one, a split to one per field, a merge to one, an LED to none. Gates are
bitwise at their width (a 4-bit NOT of `0000` is `1111`). Split field *i* is
`in` shifted right past the fields below it and masked to its width; a merge
places each field at its offset, `f0` lowest. Every primitive adds one delta
of delay. Below, "component" means a primitive.

## Combinational evaluation

Change-driven, with **synchronous deltas**:

```
dirty := components affected by the change
while dirty not empty:
    if delta_count > limit: report Unstable, stop
    writes := []
    for c in dirty (ascending index):
        writes += evaluate(c) reading current net values
    dirty := {}
    for (net, value) in writes:
        if value != nets[net]:
            nets[net] := value
            dirty += fanout[net]
    delta_count += 1
```

Properties:

- **Order independence.** Every component in a delta reads the same snapshot;
  writes apply after the whole delta. Results cannot depend on which component
  runs first.
- **Only affected logic is evaluated.** Untouched parts of the circuit cost nothing.
- **Acyclic circuits** settle in at most *depth + 1* deltas. On load, logic
  that cannot reach a loop is first evaluated in topological order (see
  Initial state); results are identical.
- **Feedback is allowed.** Stable feedback settles normally.
- **Bounded.** The delta limit (default proportional to primitive count, with a
  floor) guarantees termination. An oscillating loop, such as a NOT gate fed
  back to itself, yields an `Unstable` diagnostic naming, once each, the parts
  whose outputs were still changing. The engine stops settling, keeps the last
  values, and waits for the next command. It never freezes. The components
  still pending are kept and resumed by the next settle, so a live loop is
  reported again after every input change until an input breaks it.

Known consequence: with uniform one-delta gate delay, a cross-coupled NOR latch
released from `S=R=1` to `S=R=0` simultaneously oscillates. Real hardware
resolves this through metastability; Clockyard reports it as unstable (later as
`X`). Edge-triggered flip-flop primitives (Phase 3) avoid the issue for normal
designs.

### Initial state

On load and on reset, all nets start at `0`, every component is marked dirty,
and the circuit settles. A lone NOT gate therefore outputs `1` immediately.

Before that settle, every component that cannot reach a feedback loop is
evaluated once in topological order; otherwise a chain of *n* gates
would take *n* deltas of shrinking waves (*n²/2* evaluations). Results are
identical: no loop, nor anything feeding one, reads those components, so loops
see the same deltas, glitches included (a pulse from the all-zero start can
still set a latch); and loop-free logic forgets its starting values within one
delta per component, inside the delta limit. Logic feeding a loop still
settles delta by delta from zero, since its glitches are real behaviour; a
component whose state changes while settling (a Phase 3 flip-flop) will count
as a loop for this. Reset (Phase 3) settles from all-zero nets too, so it must
take the same step, or resetting long chains turns quadratic again.

### Unconnected inputs

An unconnected input of any width reads `0` and produces one warning per part
port (a split's `in` warns once, not once per field).
With four-state logic it reads `Z`/`X` instead.

### Multiple drivers

Phase 1–2: two outputs on one net is a validation error. Multi-driver nets
arrive with tri-state support, with an explicit resolution table (e.g. `0`+`Z`
→ `0`, `0`+`1` → `X`). Resolution never depends on evaluation order.

## Sequential logic

As decided in [ADR 0017](decisions/0017-clocks-and-flip-flops.md).

### Parts

- **Clock** (`clock`): no inputs, one 1-bit output. Every clock shows the one
  global clock's level.
- **D flip-flop** (`dff`): inputs `d` (width *w*) and `clk` (1 bit), output
  `q` (width *w*), sized 1 to 32 bits. A wide one is a **register**. `q`
  starts at 0. An unconnected `clk` reads 0 and never rises.

- **ROM** (`rom`) and **RAM** (`ram`), [ADR 0018](decisions/0018-rom-and-ram.md):
  `2^addressWidth` words of `width` bits. Both read combinationally: `out` is
  the word at `addr`. A ROM's words are its `data`. A RAM writes `din` at
  `addr` on a rising `clk` while `we` is 1, taking all three from the
  snapshot as a flip-flop takes `d`; it starts at 0 and reset clears it.
  A RAM is stateful for the pre-settle, a ROM is not. Flattened circuits
  hold at most 2^20 memory words.
- **Devices** ([ADR 0021](decisions/0021-devices.md)) reuse the parts
  above. A **seven-segment display** (`seg7`) is an LED with one 8-bit input
  `seg` (bit 0 segment a … bit 6 g, bit 7 the point). A **screen** (`screen`)
  is a RAM whose words are its pixels. A **keyboard** (`keyboard`) is a
  switch with an 8-bit `out`, set through `setInputs`. Neither `seg7` nor
  `keyboard` takes a width.

### Edge sampling rule

An edge-triggered element samples its data inputs from the circuit state as it
was **settled before the edge**, and all elements triggered by that edge update
together.

- Every settle, whatever started it (a tick, a switch change, a load, a
  reset), first copies the net values it starts from: the **snapshot**.
- Each flip-flop remembers the last value it saw on `clk`, starting at 0. When
  a delta evaluates it and finds `clk` at 1 after a 0, it takes `d` from the
  snapshot, never from the current nets. Its new `q` appears in the following
  delta, like any primitive's output.
- So results do not depend on iteration order or on how many deltas a gated
  clock takes to arrive. A derived clock, a ripple chain (one flip-flop's `q`
  clocking the next) and a switch on `clk` all sample pre-edge data. A shift
  register moves by exactly one place per edge, and a glitch that raises
  `clk` twice in one settle samples the same snapshot twice.
- Switches that change together are set in one settle (`set_inputs`), so a
  flip-flop clocked by one of them samples the others' old values in any
  order. The editor restores every switch in one command after a load.
- After a settle that hit its delta limit, the next settle starts where it
  stopped, so its snapshot is not a settled state; the circuit has already
  been reported as unstable.
- A flip-flop is stateful, so the topological pre-settle (Initial state)
  treats it, and everything feeding it, as part of a loop.

Planned variants: falling-edge triggers, clock enable, per-part synchronous
and asynchronous reset (asynchronous reset acts like a combinational input).

### Clocks and virtual time

- Virtual time is a `u64` count of **ticks**, one per half period, independent
  of wall-clock time. The clock is low at even ticks and high at odd ones.
- A **cycle** is one rising edge; the cycle counter is `(time + 1) / 2`. An
  **instruction step** (Phase 4) may span several cycles and is defined by the
  CPU, not the engine.
- Phase 3 has one global clock with no period of its own: speed is a run-time
  setting. Several clocks with their own periods and phases, on a
  time-ordered event queue keyed by `(tick, sequence)`, come later.
- A simulated 1 MHz clock does not need a million timers. The worker ticks in
  slices of wall time and reports state after each.

### Execution controls

| Control | Engine meaning |
|---------|----------------|
| Run / Pause | The worker ticks in slices, each 16 ms after the last finished: as many ticks as the speed calls for since then, in chunks of 64, starting no new chunk after 8 ms. Ticks that do not fit are dropped, so a circuit too heavy for the speed runs slower rather than catching up. A tick that is unstable pauses the run |
| Run until | Run, stopping at the tick where a chosen LED's net rises: 0 just before the tick (after any switch change), not 0 after it, so an LED lit at the start must go dark first (`tick_until`, ADR 0019). Where it stops does not depend on how the run is split into slices |
| Step | `step_cycle`: ticks until the clock has risen once and is low again (2 ticks from low, 3 from high) |
| Reset | Flip-flops, RAM, the clock and time to 0, switch values and ROM kept; nets to 0, then pre-settle and settle as a load does |
| Speed | Target cycles per wall-clock second (1 to 10,000). Pacing decides only how many ticks run, so the state after *n* ticks is the same at any speed |

A load (any connectivity edit) also starts at time 0 with every flip-flop at
0. A run under way keeps running. Stepping a single delta is planned.

## Determinism

Given the same circuit description and command sequence, the engine produces
bit-identical state. Sources of nondeterminism are excluded by design: no hash
map iteration in evaluation paths, no wall-clock reads, no randomness without a
seeded generator, fixed component ordering.

## Diagnostics

Two distinct categories:

| Category | When | Examples |
|----------|------|----------|
| Validation (compile time) | Loading a circuit | Unknown kind, missing port, output-to-output connection, width mismatch, invalid width or fields, multiple drivers, missing or recursive definition, circuit too large; warnings: unconnected input, unmatched label |
| Runtime | During simulation | Unstable/oscillating loop, delta limit exceeded |

Document-level problems (corrupt JSON, unsupported file version) are caught by
`storage/` before the engine sees anything.

Every diagnostic carries a severity, a message, and the document IDs involved,
so the editor can highlight the culprit. Neither category crashes the app.

## Test obligations

- Every gate's full truth table.
- Cascades, fan-out, re-evaluation after toggles.
- Order independence: shuffling component order at compile time gives
  identical results.
- Feedback that settles; oscillators that are detected within the bound.
- Invalid circuits produce the expected validation diagnostics.
- Property tests: `NOT(NOT x) = x`, `XOR(x, x) = 0`, `AND(x, 1) = x`,
  N-bit adder equals modular addition.
- Phase 3: simultaneous sampling (shift register shifts by exactly one per
  edge), delayed clocks and ripple chains, reset, cycle counting, switches set
  together in any order (`crates/sim-core/tests/sequential.rs`), and the 8-bit
  counter example.
- Phase 2: multiple instances of a stateful custom component keep separate state.
