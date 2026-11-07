# Simulation model

Status: **proposed**. Phase 1 implements combinational evaluation; sequential
sections are the design target for Phase 3 and are confirmed by ADR before
implementation.

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

Phase 1: binary, 1 bit. `0` low, `1` high. One `u8` per net.

Designed to extend to:

- **Multi-bit** (Phase 2, planned in ADR 0014): a net carries `width` bits
  (1–32), stored as a `u32` word plus width. Width is checked at compile
  time; a mismatch is a validation error (`widthMismatch`), never a silent
  truncation.
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

## Compiled netlist

Dense, index-based, built once per load:

- `nets: Vec<NetValue>` — current value per net.
- `components: Vec<Component>` — kind, input net indices, output net indices.
- `fanout: Vec<Vec<u32>>` (or CSR arrays) — components reading each net.

Component order is fixed at compile time (sorted by stable document ID) so the
same circuit compiles to the same indices on every machine.

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
- **Bounded.** The delta limit (default proportional to component count, with a
  floor) guarantees termination. An oscillating loop, such as a NOT gate fed
  back to itself, yields an `Unstable` diagnostic naming the components whose
  outputs were still changing. The engine stops settling, keeps the last
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

Phase 1: an unconnected input reads `0` and produces a warning diagnostic.
With four-state logic it reads `Z`/`X` instead.

### Multiple drivers

Phase 1–2: two outputs on one net is a validation error. Multi-driver nets
arrive with tri-state support, with an explicit resolution table (e.g. `0`+`Z`
→ `0`, `0`+`1` → `X`). Resolution never depends on evaluation order.

## Sequential logic (Phase 3 design target)

### Edge sampling rule

An edge-triggered element samples its data inputs from the circuit state as it
was **settled before the edge**, and all elements triggered by that edge update
together.

Steps for a clock edge:

1. The circuit is settled.
2. The engine opens a timestep and remembers pre-edge net values
   (an undo log of nets changed during the timestep is enough).
3. The clock net toggles; deltas run.
4. Any flip-flop that sees a rising edge on its clock input samples `D` from the
   **pre-edge** values and schedules its `Q` change for the next delta.
5. Deltas continue until settled.

Because sampling uses pre-edge values, results do not depend on iteration order
or on how many deltas a gated clock takes to arrive. Gated or derived clocks
still work; they never see "new" data from the same edge.

Planned variants: falling-edge triggers, clock enable, synchronous and
asynchronous reset (asynchronous reset acts like a combinational input).

### Clocks and virtual time

- Virtual time is a `u64` tick counter, independent of wall-clock time.
- A clock source has a period and phase in ticks. Phase 3 starts with one
  global clock; multiple independent clocks use a time-ordered event queue keyed
  by `(tick, sequence)` for determinism.
- A **clock cycle** is one full period (rising + falling edge). An **instruction
  step** (Phase 4) may span several cycles and is defined by the CPU, not the engine.
- A simulated 1 MHz clock does not need a million timers. The worker runs
  batches of cycles per slice of wall time and reports state periodically.

### Execution controls

| Control | Engine meaning |
|---------|----------------|
| Run / Pause | Worker advances cycles in batches / stops |
| Reset | All nets and sequential state to initial values, then settle |
| Step event | Run a single delta |
| Step cycle | Advance to the end of the next full clock period |
| Speed | Target cycles per wall-clock second (the worker paces; results identical at any speed) |

## Determinism

Given the same circuit description and command sequence, the engine produces
bit-identical state. Sources of nondeterminism are excluded by design: no hash
map iteration in evaluation paths, no wall-clock reads, no randomness without a
seeded generator, fixed component ordering.

## Diagnostics

Two distinct categories:

| Category | When | Examples |
|----------|------|----------|
| Validation (compile time) | Loading a circuit | Unknown kind, missing port, output-to-output connection, width mismatch, multiple drivers, missing or recursive definition, circuit too large |
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
  edge), reset, cycle counting.
- Phase 2: multiple instances of a stateful custom component keep separate state.
