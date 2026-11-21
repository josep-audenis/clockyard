# 0035. Four-state signals: `X`, `Z`, a tri-state buffer and shared buses

- Status: Proposed
- Date: 2026-11-21
- Depends on: ADR 0028 (Phase 6 plan, increment 5); ADR 0006 (the
  combinational engine); ADR 0014 (buses); ADR 0017 (flip-flops); ADR 0018
  (ROM and RAM); ADR 0012 (custom components); ADR 0026 (waveforms); ADR
  0025 and ADR 0034 (challenge checks); ADR 0030 (benchmarks)

## Context

Signals are two-state. A net is one `u32` cut to its width, and every bit
is `0` or `1` (`docs/simulation-model.md`). Two things follow that the
brief (§5.1) and ADR 0028 want changed:

- **No shared buses.** A net has exactly one driver. Two outputs on one
  net is a load error (`outputToOutput`, `multipleDrivers`). A CPU built by
  hand selects between sources with multiplexers, where real ones put
  several sources on one bus and enable one of them.
- **A loop that does not settle leaves made-up values.** The engine stops
  at its delta limit, reports `unstable`, and keeps whatever the nets held
  at that moment. Those values look as real as any other.

ADR 0028 item 2.5 asks for `X` and `Z` in the engine, a written rule for
several drivers, a tri-state buffer, loops that show `X`, and the cost
measured against the benchmarks. Its target: two tri-state buffers share
one bus, and two drivers on at once show `X`.

What the engine has to work with:

- **One net per primitive.** Primitive `p` drives net `p + 1`; net 0 is
  ground, read by unconnected inputs. A net's value is `nets[n]`.
- **Values cross the engine's edge as `u32`:** `nets()` to the editor,
  waveform records `(time, value)`, `memory()`, a challenge's expected
  values, and `tick_until`'s test that a net rose.
- **State lives in primitives:** a flip-flop's value and the clock level
  it last saw, a RAM's cells.
- **Nets are checked twice:** on each sheet as drawn, where an instance is
  a black box whose outputs drive, and again on the flattened circuit.
- **Speed.** Natively the reference CPU benchmark (`cpu-1k`) runs about
  60,000 ticks per second and `counters-1k` about 83,000
  (`docs/performance.md`).

## Decision

1. **Four values per bit.** `0`, `1`, `X` (unknown) and `Z` (nothing
   drives it). A net keeps a second word beside its value, `unknown`, one
   bit per bit:

   | `unknown` | `value` | The bit is |
   |-----------|---------|------------|
   | 0 | 0 | `0` |
   | 0 | 1 | `1` |
   | 1 | 0 | `Z` |
   | 1 | 1 | `X` |

   A circuit with no unknown bit has the values it has today, word for
   word. Everything starts known: nets at 0, flip-flops and RAM at 0 (ADR
   0017, ADR 0018). There is no unknown power-up state.

2. **Where `Z` comes from, and who sees it.** Only a tri-state buffer that
   is not enabled puts `Z` on a net (item 5). `Z` lives on wires: an LED,
   the inspector and a waveform show it. Every part that computes reads a
   `Z` bit as `X`, since an input left floating is unknown.

   An unconnected input still reads `0` and warns, as now.
   `docs/simulation-model.md` said it would read `Z` with four-state
   logic; this ADR does not do that (see Alternatives).

3. **What parts do with unknown bits.** Bit by bit, and never more unknown
   than the inputs force:
   - **AND:** `0` if either input is `0`; `1` if both are `1`; else `X`.
   - **OR:** `1` if either input is `1`; `0` if both are `0`; else `X`.
   - **NOT:** `X` for `X`. NAND and NOR are NOT of the above.
   - **XOR, XNOR:** `X` if either input is unknown.
   - **Split, merge:** each bit passes through; a `Z` becomes `X`.
   - **ROM:** all `X` if any address bit is unknown.
   - **Switch, keyboard, clock:** always known.

4. **Parts with state.** A flip-flop remembers the clock as `0`, `1` or
   unknown. Its stored value and each RAM cell can hold `X` bits.
   - **A certain edge** is the clock at `1` after `0`, both known. The
     flip-flop takes `d` as now, unknown bits as `X`.
   - **A possible edge** is the clock unknown after `0`, or `1` after
     unknown. The flip-flop cannot know whether it sampled, so its value
     becomes all `X`.
   - **A RAM reads** all `X` if any address bit is unknown, else the
     cell.
   - **A RAM writes** at a certain edge with `we` at `1` and a known
     address, as now. If `we` is `0`, or there is no edge, nothing is
     written. In every other case it cannot know what was written: with a
     known address that cell becomes all `X`; with an unknown address
     every cell does.
   - A screen is a RAM (ADR 0021), so the same holds for its pixels.
   - Reset makes everything known again. An edit that keeps state (ADR
     0033) keeps unknown bits with it.

5. **The tri-state buffer.** A new part, `tri`: inputs `in` (width *w*)
   and `en` (1 bit), output `out` (width *w*), sized 1 to 32 like a gate.
   - `en` at `1`: `out` is `in`, a `Z` bit read as `X`.
   - `en` at `0`: `out` is all `Z`.
   - `en` unknown: `out` is all `X`.

   The file format becomes version 12, since older editors do not know
   the kind. Older files load unchanged.

6. **Several drivers on one net.** A net may have two or more drivers only
   if every one of them is a tri-state buffer's output. Its value is
   resolved bit by bit:

   | | `Z` | `0` | `1` | `X` |
   |---|---|---|---|---|
   | **`Z`** | `Z` | `0` | `1` | `X` |
   | **`0`** | `0` | `0` | `X` | `X` |
   | **`1`** | `1` | `X` | `1` | `X` |
   | **`X`** | `X` | `X` | `X` | `X` |

   The table is symmetric and gives the same result in any grouping, so
   the result never depends on the order of the drivers (brief §5.1). Two
   enabled drivers that agree give their value; two that disagree give
   `X`.

   Any other net with two or more outputs stays the load error it is
   today. Two gate outputs wired together are a mistake, and a beginner
   is better served by "these wires connect two outputs" than by an `X`.
   - **On a sheet as drawn**, a group of wires with several drivers is
     accepted when each driver is a tri-state buffer's output or an
     instance's output pin. What is inside an instance is not looked at
     there.
   - **On the flattened circuit**, where pins are gone, every driver of
     such a net must be a tri-state buffer. If one is not, the error names
     the top-level parts, as flattened diagnostics do now.
   - Pins keep their direction. A pin that is both input and output is
     not offered.

7. **In the netlist.** "One net per primitive" stays. A net with several
   drivers compiles to one hidden primitive, a resolver. Its inputs are
   the drivers' own nets and its output is the bus: every wire of the
   group and every reader takes the resolver's net. Like any primitive it
   adds one delta. A tri-state buffer alone on its net needs no resolver;
   its readers and wires take its net, which can be `Z`.

8. **A loop that does not settle becomes `X`.** When a settle reaches its
   delta limit, it does not stop there. It goes on in a second mode: a
   primitive whose output would change gets `X` in the bits that would
   change, and keeps the rest. Bits only ever become unknown in this mode,
   so it ends, and rule 3 never makes more `X` than its inputs force, so
   logic outside the loop that does not depend on it keeps its values.
   - The settle still reports `unstable`, naming the parts whose outputs
     were changing, and a run still pauses on it.
   - The circuit is then settled, with `X` where the loop was. The engine
     no longer keeps primitives to resume.
   - The diagnostic is reported again after every later settle while any
     of those parts still has an unknown output bit. So the error stays
     beside the `X` it explains, and both go when an input breaks the
     loop, or at Reset.
   - A NOT fed back to itself reads `X`. So does a cross-coupled latch
     released from `S = R = 1`, which today oscillates.

9. **At the engine's edge.**
   - `Simulator::unknown()` beside `nets()`, and `Engine::unknown()` in
     `sim-wasm`. The worker's `state` message carries both arrays.
   - A waveform record is `(time, value, unknown)`. A net is recorded
     when either word changes.
   - `memory()` keeps returning values; `memory_unknown()` returns the
     cells' unknown bits, empty while every cell is known.
   - `tick_until` stops when the LED's net was a known `0` and now has a
     bit that is a known `1`.
   - **A challenge check** treats any unknown bit in a compared output or
     memory byte as a mismatch. `Mismatch` gains `unknown` (left out when
     0), and the editor writes such a value with `X` and `Z` digits: "out
     should be 3 but is X". Challenges list their allowed parts, and none
     lists `tri`, so no challenge changes.

10. **In the editor.**
    - **Wires.** `X` and `Z` each get a colour and a line style of their
      own (colour is never the only sign): a wire with any `X` bit is
      drawn as `X`; one that is all `Z` as `Z`.
    - **Numbers.** Wherever a value is written (inspector, readout, LED
      labels, waveform bands), one bit is `0`, `1`, `X` or `Z`. A hex
      digit is `Z` if its four bits are all `Z`, `X` if any is unknown,
      else the digit.
    - **Parts that show.** An LED is lit only for a known non-zero value,
      and shows `X` or `Z` otherwise. A seven-segment display and a screen
      draw an unknown segment or pixel in the `X` colour.
    - **The part.** *Tri-state buffer* in the parts panel, drawn as a
      buffer triangle with `en` entering from the side.
    - Nothing in the editor computes a value. It draws the two words the
      engine sends.

11. **Cost.** Every evaluation now computes two words. The native
    benchmarks are run before and after step 2, close together, as
    `docs/performance.md` asks. Ticks per second on `cpu-1k` and
    `counters-1k` may fall by at most 10%. If they fall further, the step
    is not merged until an optimization brings them back (the obvious
    one: a primitive whose inputs are all known takes today's path). The
    numbers go in `docs/performance.md` either way.

12. **Order of work.** Each step is one pull request:
    1. `docs/simulation-model.md`: the rules of items 1 to 8, marked as
       designed and not yet built. ADR 0028 asks for them in writing
       before any code.
    2. The engine's values: the `unknown` word, items 3, 4, 8 and 9, with
       native tests and the benchmark comparison. No part produces `Z`
       yet, so only an unstable loop shows anything new.
    3. The tri-state buffer and nets with several drivers: items 5, 6 and
       7, format 12, with native tests.
    4. The editor: item 10.
    5. An example, *Shared bus*: two 8-bit sources behind tri-state
       buffers on one bus, with a switch to enable each. The Playwright
       target enables one and reads its value on the bus, enables both
       with different values and reads `X`, and enables neither and reads
       `Z`. Then the docs and the roadmap.

## Alternatives considered

- **An unconnected input reads `Z`,** as `docs/simulation-model.md` once
  planned. Every half-built circuit would then fill with `X`: a gate with
  one input still unwired gives `X` for half its truth table. The warning
  already says the input is unconnected and reads 0, and every example,
  challenge and test relies on that 0. A bus whose buffers are all
  disabled is different: someone built it to float, and `Z` shows that it
  does.
- **Any outputs may share a net,** resolved by the same table, with no
  load error. Simpler to state, and it needs no rule about which drivers
  qualify. But it turns the commonest wiring mistake from an error that
  names the wires into an `X` that appears only when the outputs
  disagree.
- **`Z` passes through split and merge.** A bus could then be split while
  floating and still show `Z` on each part. It would make split and merge
  the only computing parts that can output `Z`, and their outputs could
  then share nets, which item 6 would have to allow or forbid case by
  case. Read as `X`, the rule is one line.
- **Stop at the delta limit and mark the changing nets `X`,** without the
  second mode. Cheaper, but logic downstream of the loop would keep values
  computed from whatever the loop held when it stopped, and a known value
  beside an `X` would be a guess.
- **Skip a RAM write that cannot be known,** and warn. Simulators often
  do. The memory would then hold values that may be wrong and look right,
  which is what `X` exists to prevent. Marking 65,536 cells is cheap.
- **Bus conflicts as a diagnostic too.** Two enabled drivers that
  disagree could report an error naming them. ADR 0028 asks only for `X`.
  A diagnostic can be added when the `X` proves hard to trace.
- **Pull-ups, wired-AND, drive strengths.** Real buses use them. Nothing
  here needs them, and the resolution table has room for them later.
- **One enum per bit, or two bits packed in a `u64`.** The first is far
  slower for buses. The second moves every reader of `nets()` to a new
  layout; a second word leaves today's values where they are.

## Consequences

- A hand-built CPU can use a shared bus. The second reference CPU
  (increment 6) may, if it helps.
- An unstable loop is visible on the canvas, on the wires it reaches, not
  only in the diagnostics list.
- Every evaluation does more work. Item 11 bounds it and records it.
- The engine's edge grows: a second array in every state message and a
  third number in each waveform record.
- The resolver adds one delta of delay to a shared bus. Deltas are not
  shown to the user, and the delta limit counts primitives, resolvers
  included.
- A possible clock edge makes a whole register `X`, and an unknown
  address a whole RAM. That is pessimistic: some bits would in truth keep
  their values. It is never wrong, and Reset clears it.
- `docs/simulation-model.md` changes its plan for unconnected inputs
  (item 2).
- Not done here: pins that are both input and output, pull-ups, a
  conflict diagnostic, and `X` at power-up.
