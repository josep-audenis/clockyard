# Simulation model

Status: **built** for combinational logic (Phase 1, ADR 0006) and sequential
logic (Phase 3, ADR 0017), and for four-state signals (ADR 0035): unknown
values, the tri-state buffer and nets with several drivers. See Four-state
signals. Gates with 2 to 8 inputs and the push button (ADR 0038) are
**specified, not built yet**: the passages marked *ADR 0038* say what the
engine will do once they are.

## Terms

| Term | Meaning |
|------|---------|
| Component | A primitive in the compiled netlist (gate, switch, LED, flip-flop, …) |
| Port | A named input or output of a component, with a width |
| Net | Ports joined by wires, directly or through junctions: one driver output, or several tri-state buffers (see Several drivers), and any number of reader inputs |
| Value | The signal on a net |
| Delta | One evaluation round inside a settle, at a single instant of virtual time |
| Settle | Repeating deltas until no net changes |
| Tick | One unit of virtual simulation time |

## Signal values

A net carries `width` bits (1–32, ADR 0014), each `0` low or `1` high,
stored as one `u32` cut to that width. A second word, `unknown`, marks the
bits that are not known (ADR 0035): see Four-state signals. No bit is
unknown until a loop fails to settle.
Widths are declared on parts (`width` on switches, LEDs and gates, `fields`
on splits and merges) and never inferred. They are checked when a circuit
loads: a bad `width` or `fields` is `invalidWidth`, and ports of different
widths on one net are `widthMismatch`, never a silent truncation. The engine,
protocol, file format (v5) and editor all carry them (ADR 0014).
*ADR 0038:* AND, OR, NAND, NOR, XOR and XNOR also declare how many
inputs they have, `inputCount`, absent meaning 2. One that is not a whole
number from 2 to 8, or one on any other part (custom parts included), is
`invalidWidth`, as a bad address width is.

A bit can also be `X` (unknown) or `Z` (high impedance), which only a
tri-state buffer gives.

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
reader) unless each driver may share a wire (see Several drivers), and inputs joined to a pin with nothing driving them `inputToInput`,
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
| 2 or more, all tri-state buffers | any | Valid: a bus, resolved by a table (see Several drivers) |
| 2 or more, otherwise | 0 | `outputToOutput` error |
| 2 or more, otherwise | 1 or more | `multipleDrivers` error |

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

- `nets: Vec<u32>` — current value per net, and `unknown: Vec<u32>` beside it.
- `components: Vec<Component>` — kind, input net indices, output net indices.
- `fanout: Vec<Vec<u32>>` (or CSR arrays) — components reading each net.

Component order is fixed at compile time (sorted by stable document ID) so the
same circuit compiles to the same indices on every machine.

Parts compile to primitives, each with one output net: a switch or gate to
one, a split to one per field, a merge to one, an LED to none. Gates are
bitwise at their width (a 4-bit NOT of `0000` is `1111`).

*ADR 0038:* each of those six gates has *n* inputs, `a`, `b`, … up to `h`, 2 to 8 of them,
each of the gate's width, and one output `out`. Bit by bit, AND is `1`
when all its inputs are `1`, OR when any is, and XOR when an odd number
are (parity). NAND, NOR and XNOR are the NOT of AND, OR and XOR: the
engine combines the inputs with AND, OR or XOR and inverts once at the
end, since NAND, NOR and XNOR do not chain. With two inputs each is the
gate there is now. NOT has one input, `in`.

*ADR 0038:* a **push button** (`button`) is an input part like a 1-bit
switch: no inputs, an output `out` of 1 bit, set through `setInputs`,
`1` while held. It takes no `width`; one is `invalidWidth`. It is its own
kind only so that the editor can tell it from a switch; inside a custom
component it is not a pin, and it stays at `0` wherever the component is
used.

Split field *i* is
`in` shifted right past the fields below it and masked to its width; a merge
places each field at its offset, `f0` lowest. Every primitive adds one delta
of delay. Below, "component" means a primitive.

## Combinational evaluation

Change-driven, with **synchronous deltas**:

```
dirty := components affected by the change
while dirty not empty:
    if delta_count > limit: report Unstable, settle the loop to X (see below), stop
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
  whose outputs were still changing. The engine then settles the loop to `X`
  (see A loop that does not settle) and waits for the next command. It never
  freezes.

Known consequence: with uniform one-delta gate delay, a cross-coupled NOR latch
released from `S=R=1` to `S=R=0` simultaneously oscillates. Real hardware
resolves this through metastability; Clockyard reports it as unstable and
shows `X` on both outputs. Edge-triggered flip-flop primitives (Phase 3) avoid
the issue for normal designs.

### Initial state

On load and on reset, all nets start at `0` (a tri-state buffer's and a bus's
at `Z`, see Four-state signals), every component is marked dirty, and the
circuit settles. A lone NOT gate therefore outputs `1` immediately.
A load's settle and a reset's settle are never a clock edge (ADRs 0033,
0035): flip-flops and RAMs do not sample or write during it, and each takes
its clock input's settled value as the one it last saw. From all-zero nets
this changes nothing, since an edge there could only sample zeros; it matters
for state carried across an edit (below). A clock that settles unknown counts
once afterwards (see Parts with state).

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
port (a split's `in` warns once, not once per field). This stays so with
four-state signals (ADR 0035).

### Multiple drivers

Two outputs on one net is a validation error, unless every one is a
tri-state buffer's: those share the net, resolved by a table that never
depends on evaluation order. See Several drivers.

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
  a delta evaluates it and finds `clk` at a known 1 after a known 0, it takes
  `d` from the snapshot, never from the current nets. Its new `q` appears in
  the following delta, like any primitive's output. An unknown clock is a
  possible edge: see Parts with state.
- So results do not depend on iteration order or on how many deltas a gated
  clock takes to arrive. A derived clock, a ripple chain (one flip-flop's `q`
  clocking the next) and a switch on `clk` all sample pre-edge data. A shift
  register moves by exactly one place per edge, and a glitch that raises
  `clk` twice in one settle samples the same snapshot twice.
- Switches that change together are set in one settle (`set_inputs`), so a
  flip-flop clocked by one of them samples the others' old values in any
  order. The editor restores every switch in one command after a load.
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
| Run / Pause | The worker ticks in slices, each 16 ms after the last finished: as many ticks as the speed calls for since then, in chunks of 64, starting no new chunk after 8 ms. Ticks that do not fit are dropped, so a circuit too heavy for the speed runs slower rather than catching up. A tick that is unstable pauses the run; the warning that a loop's `X` remains does not |
| Run until | Run, stopping at the tick where a chosen LED's net rises: a known 0 just before the tick (after any switch change), and a bit at a known 1 after it, so an LED lit at the start must go dark first, and one that leaves `X` for 1 has not risen (`tick_until`, ADR 0019). Where it stops does not depend on how the run is split into slices |
| Step | `step_cycle`: ticks until the clock has risen once and is low again (2 ticks from low, 3 from high) |
| Reset | Flip-flops, RAM, the clock and time to 0, switch values (and push buttons, ADR 0038) and ROM kept; nets to 0, then pre-settle and settle as a load does |
| Speed | Target cycles per wall-clock second (1 to 10,000). Pacing decides only how many ticks run, so the state after *n* ticks is the same at any speed |

A load starts at time 0 with every flip-flop at 0. `load_keeping(description,
previous)` instead carries state from `previous`, the circuit simulated before
an edit (ADR 0033): time (the clock takes the level it gives), and each switch,
push button (ADR 0038), keyboard, flip-flop, RAM and screen whose elaborated ID names a part of the same
kind and size in both. A switch whose width changed keeps the bits that still
fit; anything else new or changed starts at 0, and nets still settle from 0, so
a latch built from gates is not kept. The editor sends a connectivity edit
(undo and redo too) as such a load, so the circuit keeps running from where it
was; opening a file, example, project, link or sheet is a plain load from time
0, and Reset is the way back to 0. A run under way keeps running. Stepping a
single delta is planned.

*ADR 0038:* **a press between two ticks.** An input change is applied
between ticks and settled at once, so combinational logic always sees it.
A flip-flop or RAM whose `clk` the button drives, directly or through
gates, sees the press itself as a rising edge, between ticks, as it would
a switch's. One clocked by the clock, or by anything else, sees a press
only if a rising edge of its clock falls while the button is held: a press
and release with no tick between them never reaches it. Such a press
leaves no trace in a waveform either, which keeps one value per tick.
Nothing stretches a press. The worker, which applies input changes between
its slices of ticks, notes the tick at which a button went to `1`, and
reports the button if it goes back to `0` at that same tick while a run is
going (Run or Run until). A reload that sends a
held button's `1` again keeps the noted tick; Reset sets it to 0, as time
goes back to 0.

### Waveforms

`watch(nets)` records chosen nets (ADR 0026); a net already watched keeps its
record, the others start from their current values. `watch_wires(wires)` does
the same for the nets of chosen wires, each net once, in the order of its first
wire, and remembers the wires: `load_keeping` watches them again and carries
each net's record from the first watched wire on it that was recorded before
(ADR 0033). `watch(nets)` forgets them, so after it a kept load carries no
record. After every settle (a switch
change, each tick, a reset), a watched net whose value or unknown bits
differ from its last record gets `(time, value, unknown)`; a later settle at the same tick replaces that
tick's value, so a net has one value per tick and deltas inside a settle are
never recorded. Recording happens inside `tick`, so the record after *n* ticks
does not depend on how the ticks were split into calls. The record keeps the
last 4,096 ticks (`WAVE_WINDOW`) and the value in force when that window
starts. A reset clears it, as does a plain load, which starts with nothing
watched. `waves()` and `wave(i)` read it.

## Four-state signals

[ADR 0035](decisions/0035-four-state-signals.md). Everything in this
section is built in the engine.

The editor's part (how `X` and `Z` are drawn and written, the buffer in the
parts panel, and Make component refusing to split a bus) is in the ADR and
in `docs/architecture.md`, Rendering.

### Values

Each bit is `0`, `1`, `X` (unknown) or `Z` (high impedance: nothing drives
it). A net keeps
a second word, `unknown`, beside its value:

| `unknown` | `value` | The bit is |
|-----------|---------|------------|
| 0 | 0 | `0` |
| 0 | 1 | `1` |
| 1 | 0 | `Z` |
| 1 | 1 | `X` |

A circuit with no unknown bit has the values it has today. Everything
starts known: nets, flip-flops and RAM at 0. A value word alone does not
say what a bit is (an `X` has its value bit set), so every test of a value
is "a known 1" or "a known 0".

`Z` comes only from a tri-state buffer that is not enabled, and lives on
wires: an LED, the inspector and a waveform show it. Every part that
computes reads a `Z` bit as `X`.

An unconnected input still reads `0` and warns, and so does an instance's
pin left unconnected. So a bus whose buffers are all disabled reads `Z`,
and the same wires with the last buffer deleted read `0`.

### Parts

Bit by bit, never more unknown than the inputs force:

| Part | Output |
|------|--------|
| AND | `0` if any input is `0`; `1` if all are `1`; else `X` |
| OR | `1` if any input is `1`; `0` if all are `0`; else `X` |
| NOT | `X` for `X` or `Z`; NAND and NOR are NOT of the above |
| XOR, XNOR | `X` if any input is unknown |
| Split, merge | each bit passes through; a `Z` becomes `X` |
| ROM | all `X` if any address bit is unknown |
| Switch, push button (ADR 0038), keyboard, clock | always known |
| Tri-state buffer (`tri`: `in` of width *w*, `en` of 1 bit → `out` of width *w*, sized 1 to 32 like a gate) | `en` a known `1`: `in`, a `Z` bit as `X`; `en` a known `0`: all `Z`; `en` unknown: all `X` |

### Parts with state

A flip-flop remembers the clock as `0`, `1` or unknown. Its value and each
RAM cell can hold `X` bits. Data comes from the snapshot, which carries the
`unknown` word.

- **A certain edge:** the clock at a known `1` after a known `0`. The
  flip-flop takes `d`, unknown bits as `X`.
- **A possible edge:** any evaluation that finds the clock unknown,
  whatever it was before, and a known `1` after unknown. An unknown clock
  may be toggling, so it may rise at any time. Each stored bit becomes `X`,
  except a known bit that equals `d`'s known bit both in the snapshot and
  on the net now. A flip-flop is evaluated again whenever `d` changes, so
  data that moves under an unknown clock is caught.
- A known `0` after unknown, and a known `0` after `1`, are no edge.
- **A RAM reads** all `X` if any address bit is unknown, else the cell.
- **A RAM writes** at a certain edge with `we` a known `1` and a known
  address: the cell takes `din`, unknown bits as `X`. If `we` is a known
  `0`, or there is no edge, nothing is written. At a certain edge with
  `we` or the address unknown, the snapshot's cell (every cell, if the
  address is unknown) keeps only the bits that equal `din`. At a possible
  edge it looks at `we`, the address and `din` in the snapshot and now:
  nothing happens if `we` is a known `0` in both; for each address that is
  known, that cell becomes `X` as a flip-flop's value does; if either
  address is unknown, every cell does. A screen is a RAM, so the same holds for its pixels.
- **A load's settle and a Reset's settle are never an edge,** certain or
  possible. Both settle from all-zero nets, where every buffer is disabled
  for a moment. Each part takes the clock's settled value as the one it
  last saw. If that value is unknown, the part takes one possible edge at
  the end of the settle against the settled data, and what follows settles
  as an ordinary settle does.
- So after Reset all state is known, unless a clock settles unknown. An
  edit that keeps state (`load_keeping`) keeps each flip-flop's and RAM
  cell's unknown bits with its value.

### Several drivers

A net may have two or more drivers only if every one is a tri-state
buffer's output. It is resolved bit by bit:

| | `Z` | `0` | `1` | `X` |
|---|---|---|---|---|
| **`Z`** | `Z` | `0` | `1` | `X` |
| **`0`** | `0` | `0` | `X` | `X` |
| **`1`** | `1` | `X` | `1` | `X` |
| **`X`** | `X` | `X` | `X` | `X` |

The table is symmetric and gives the same result in any grouping, so the
order of the drivers never matters. Any other net with two or more outputs
stays a load error; when one of them is a tri-state buffer's, the message
says that only tri-state outputs may share a wire.

- **Bus pins.** A definition's output pin is a bus pin when, inside, the
  net that reaches it has at least one driver, every driver is a tri-state
  buffer's output or a bus pin of an instance, and no input pin is on that
  net. This is worked out once per definition, inner definitions first.
- **On a sheet as drawn** (wires that touch a pin), several drivers are
  accepted when each is a tri-state buffer's output or an instance's bus
  pin. An ordinary output pin cannot share a wire, nor can a pin wired
  straight through from an input pin. Two bus pins that share a net inside
  their instance join the buses wired to them outside.
- **On the flattened circuit**, every driver of a net with several must be
  a tri-state buffer.
- Net labels join nets before either check counts drivers.

In the netlist such a net compiles to one hidden primitive, a
**resolver**: its inputs are the drivers' own nets and its output is the
bus. Every wire of the group, every reader and each buffer's reported
`out` take the resolver's net. Resolvers are numbered after every part's
primitives. A resolver belongs to no part of its own: where the engine
names a net's driver, a bus gives its buffer with the lowest ID, and an
`unstable` report that would name a resolver names every buffer on its
bus. A resolver adds one delta; a buffer alone on its net needs none.

A circuit with a tri-state buffer never takes the two-state path that
other circuits take while nothing is unknown: that path has no `Z` to give
a buffer that is not enabled.

Because every primitive takes one delta, **a bus is `Z` or in conflict for
a delta or two whenever its enables change.** A flip-flop is safe, since it
samples the snapshot. A latch built from gates, or a derived clock, that
reads the bus can take that `X` and keep it.

### A loop that does not settle

When a settle reaches its delta limit, it goes on in two stages:

1. **Marking.** A primitive whose output would change gets `X` in the
   bits that would change and keeps the rest. Stored state follows the
   same rule. Bits only become unknown here, each at most once, so the
   stage ends within 32 deltas per net. A certain edge that falls in this
   stage therefore leaves `X` where the new data differs, until the next
   certain edge.
2. **Clearing.** Every primitive evaluated while marking is evaluated
   again in the normal way and the settle runs on. From here nets only
   become more known; a flip-flop or RAM can still lose bits to a possible
   edge, each bit once. So this ends too. Logic that does not depend on
   the loop keeps its values. It matters when the limit cuts a transient
   that would have ended by itself: marking turns its last changes to
   `X`, nothing keeps that `X`, and clearing finds every net known. The
   settle is still reported, since it reached the limit.

Every delta still reads one snapshot and applies its writes after. The
settle reports the `unstable` error, naming the parts whose outputs were
changing at the limit; that stops a tick, pauses a run and refuses a
challenge check. The parts named are those changing at the limit: the
loop, and whatever was still following it. Afterwards the circuit is
settled, with `X` where the loop was, and nothing is kept to resume. The
engine remembers the parts named, adding those of any later loop. While
any of them still has an `X` output bit, each later settle reports a warning,
`unsettled`, naming those that do; it stops nothing. The list is dropped
when none has an `X` bit left, and at Reset or a load.

A loop that reads a floating bus never oscillates at all: it reads `X`
from the start, `X` is stable, and nothing is reported, since nothing
failed to settle. That holds at a load and a Reset too, because their
settle starts with every buffer's net and every bus at `Z` (all nets are 0
there, enables included, so no buffer drives). A buffer whose own `en`
reads its bus is such a loop: it stays `X`, Reset included.

A NOT fed back to itself reads `X`. So does a cross-coupled latch released
from `S = R = 1`. A register clocked by such a loop holds `X` until a
certain edge loads known data, or Reset.

### At the engine's edge

- `unknown()` beside `nets()`; `sim-wasm`'s `unknown()` and the worker's
  `state` message give it empty while no bit is unknown.
- A settle returns at most one diagnostic: the `unstable` error, or the
  `unsettled` warning. `tick` stops at an error and otherwise returns the
  last tick's warning; the worker's run and a challenge check stop on errors
  only.
- A waveform record is `(time, value, unknown)`, made when either word
  changes.
- `memory_unknown()` beside `memory()`, empty while every cell is known.
- Run until stops when the LED's net was a known `0` and now has a bit
  that is a known `1`. A net that goes `0`, then `X`, then `1` does not
  stop the run, and neither does a bus that goes from `Z` to `1`.
- A challenge check counts any unknown bit in a compared output or memory
  byte as a mismatch, reported with its unknown bits, and a bench step's
  `until` waits for a known `1`.
- Switch values sent in (`set_inputs`) stay plain numbers.

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
| Runtime | During simulation | Unstable/oscillating loop, delta limit exceeded (`unstable`, an error); a warning while that loop's `X` remains (`unsettled`) |

Document-level problems (corrupt JSON, unsupported file version) are caught by
`storage/` before the engine sees anything.

Every diagnostic carries a severity, a message, and the document IDs involved,
so the editor can highlight the culprit. Neither category crashes the app.

## Test obligations

- Every gate's full truth table.
- *ADR 0038:* every gate with 2 to 4 inputs over every combination of `0`,
  `1`, `X` and `Z`, against a model written from the rules above; 8 inputs
  at width 32 on chosen values; an `inputCount` out of range or on another
  part refused.
- *ADR 0038:* a push button set through `setInputs`, and a value above 1
  refused; kept by `load_keeping` and by Reset; a switch replaced by a
  button under the same ID starting at 0; a definition pin naming a button
  refused; a button driving a flip-flop's `clk` clocking it between ticks.
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
