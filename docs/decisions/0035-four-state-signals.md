# 0035. Four-state signals: `X`, `Z`, a tri-state buffer and shared buses

- Status: Accepted
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
  values and its `until`, and `tick_until`'s test that a net rose.
- **State lives in primitives:** a flip-flop's value, a RAM's cells, and
  for both the clock level last seen.
- **A settle that hits its limit keeps the primitives still pending,**
  and the next settle resumes them, so a live loop is reported again
  after every input change.
- **Nets are checked in two places.** Before flattening, each sheet's
  wires that touch a pin are checked as drawn, an instance being a black
  box whose output pins drive. After flattening, every net is checked.
- **Speed.** Natively the reference CPU benchmark (`cpu-1k`) runs about
  60,000 ticks per second and `counters-1k` about 83,000, and one run's
  numbers vary by 10 to 20% (`docs/performance.md`).

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

   A value word alone no longer says what a bit is: an `X` has its value
   bit set. Step 2 goes through every reader of a net's value, in the
   engine and the editor, and makes each test "a known 1" or "a known 0".

2. **Where `Z` comes from, and who sees it.** Only a tri-state buffer that
   is not enabled puts `Z` on a net (item 5). `Z` lives on wires: an LED,
   the inspector and a waveform show it. Every part that computes reads a
   `Z` bit as `X`, since an input left floating is unknown.

   An unconnected input still reads `0` and warns, as now, and so does an
   instance's pin left unconnected. `docs/simulation-model.md` said such
   an input would read `Z` with four-state logic; this ADR does not do
   that (see Alternatives). One seam follows: a bus whose buffers are all
   disabled reads `Z`, and the same wires with the last buffer deleted
   read `0`, with the warning.

3. **What parts do with unknown bits.** Bit by bit, and never more unknown
   than the inputs force:
   - **AND:** `0` if either input is `0`; `1` if both are `1`; else `X`.
   - **OR:** `1` if either input is `1`; `0` if both are `0`; else `X`.
   - **NOT:** `X` for `X` or `Z`. NAND and NOR are NOT of the above.
   - **XOR, XNOR:** `X` if either input is unknown.
   - **Split, merge:** each bit passes through; a `Z` becomes `X`.
   - **ROM:** all `X` if any address bit is unknown.
   - **Switch, keyboard, clock:** always known.

4. **Parts with state.** A flip-flop remembers the clock as `0`, `1` or
   unknown. Its stored value and each RAM cell can hold `X` bits. Data is
   taken from the snapshot, as now (ADR 0017), and the snapshot carries
   the `unknown` word.
   - **A certain edge** is the clock at a known `1` after a known `0`.
     The flip-flop takes `d`, unknown bits as `X`.
   - **A possible edge** is any evaluation that finds the clock unknown,
     whatever it was before, and also a known `1` after unknown. An
     unknown clock may be toggling (item 8), so it may rise at any time.
     The flip-flop cannot know whether it sampled, or when: each stored
     bit becomes `X`, except a known bit that equals `d`'s known bit both
     in the snapshot and on the net now, which sampling would not change.
     A flip-flop is evaluated again whenever `d` changes, so data that
     moves under an unknown clock is caught.
   - A known `0` after unknown, and a known `0` after `1`, are no edge.
   - **A RAM reads** all `X` if any address bit is unknown, else the
     cell.
   - **A RAM writes** at a certain edge with `we` a known `1` and a known
     address: the cell takes `din`, unknown bits as `X`. If `we` is a
     known `0`, or there is no edge, nothing is written. In every other
     case (a possible edge, or `we` or the address unknown) it cannot know
     what was written. It looks at `we`, the address and `din` both in
     the snapshot and now: nothing happens if `we` is a known `0` in
     both; for each address that is known, that cell becomes `X` as a
     flip-flop's value does; if either address is unknown, every cell
     does.
   - A screen is a RAM (ADR 0021), so the same holds for its pixels.
   - **A load's settle and a Reset's settle are never an edge,** certain
     or possible. A load already works so (ADR 0033); Reset now does too.
     Both settle from all-zero nets, where every buffer is disabled for a
     moment and a clock that comes through one reads unknown. Without
     this rule that moment would leave registers at `X` after Reset.
     Each part takes the clock's settled value as the one it last saw.
     If that value is unknown, the part takes one possible edge at the
     end of the settle, against the settled data: the clock may be
     toggling, and nothing would evaluate the part again. What follows
     from that edge settles as an ordinary settle does, so a part whose
     clock is still unknown is evaluated again when its data changes.
   - So after Reset all state is known, unless a clock settles unknown.
     An edit that keeps state (ADR 0033) keeps unknown bits with it.

5. **The tri-state buffer.** A new part, `tri`: inputs `in` (width *w*)
   and `en` (1 bit), output `out` (width *w*), sized 1 to 32 like a gate.
   - `en` a known `1`: `out` is `in`, a `Z` bit read as `X`.
   - `en` a known `0`: `out` is all `Z`.
   - `en` unknown (`X` or `Z`): `out` is all `X`.

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

   Any other net with two or more outputs stays a load error. Two gate
   outputs wired together are a mistake, and a beginner is better served
   by an error that names the wires than by an `X`. When one of the
   outputs is a tri-state buffer's, the message says that only tri-state
   outputs may share a wire.
   - **Bus pins.** A definition's output pin is a *bus pin* when, inside
     the definition, the net that reaches it has at least one driver,
     every driver is a tri-state buffer's output or a bus pin of an
     instance, and no input pin is on that net. This is worked out once
     per definition, inner definitions first.
   - **On a sheet as drawn** (wires that touch a pin), several drivers
     are accepted when each is a tri-state buffer's output or an
     instance's bus pin. Two bus pins that share a net inside their
     instance join the buses they are wired to outside into one, as the
     wiring says. So an instance's ordinary output pin, driven
     inside by a gate, cannot share a wire, and neither can a pin wired
     straight through from an input pin: joined to a bus outside, that
     one would let the bus drive backwards into the instance's input.
     Pins keep their direction, and a pin that is both input and output
     is not offered.
   - **On the flattened circuit**, every driver of a net with several
     must be a tri-state buffer. The sheet rule already guarantees it for
     nets that cross pins; this check covers the rest.
   - Net labels join nets before either check counts drivers, as now.

7. **In the netlist.** "One net per primitive" stays. A net with several
   drivers compiles to one hidden primitive, a resolver. Its inputs are
   the drivers' own nets and its output is the bus.
   - Every wire of the group, every reader, and each buffer's `out` in
     the reported port nets take the resolver's net. A port and its wire
     still always agree. A buffer's own net is internal.
   - Resolvers are numbered after every part's primitives, so parts keep
     the nets they would have without them.
   - A resolver belongs to no part of its own. Where the engine names a
     net's driver (`net_drivers`, used for a waveform's name and by Make
     component), a bus gives its buffer with the lowest ID. An `unstable`
     report that would name a resolver names every buffer on its bus.
   - Like any primitive, a resolver adds one delta. A tri-state buffer
     alone on its net needs none; its readers and wires take its net,
     which can be `Z`.
   - **Make component** finds a bus's drivers from the port nets. A
     selection that holds some of a bus's buffers and leaves others
     outside is refused, with a message: the bus would have to cross the
     component's edge in both directions.

8. **A loop that does not settle becomes `X`.** When a settle reaches its
   delta limit, it does not stop there. It goes on in two further stages:
   - **Marking.** A primitive whose output would change gets `X` in the
     bits that would change and keeps the rest. Stored state follows the
     same rule: a flip-flop's or RAM cell's bits that an edge would
     change become `X`. Bits only become unknown in this stage, each at
     most once, so it ends within 32 deltas per net. A certain edge that
     falls in this stage therefore leaves `X` where the new data differs,
     which is pessimistic and stays until the next certain edge.
   - **Clearing.** Marking can leave an `X` on a primitive whose inputs
     turned out known. So every primitive marked is evaluated again in
     the normal way, and the settle runs on. From here values only become
     more known (rule 3 gives a more known output for more known inputs),
     so this ends too. The result is what the gate rules give for the
     `X` the loop holds, and no more: logic that does not depend on the
     loop keeps its values.
   - Every delta still reads one snapshot and applies its writes after,
     so the result does not depend on the order of evaluation.
   - **The report.** The settle reports the `unstable` error, naming the
     parts whose outputs were changing when the limit was reached. That
     stops a tick, pauses a run and refuses a challenge check, as now.
   - **Afterwards** the circuit is settled, with `X` where the loop was.
     Nothing is kept to resume, and a tick of a circuit with no clock
     changes nothing. The engine remembers the parts it named. After
     each later settle, while any of them still has an `X` output bit,
     it reports a warning, `unsettled`, naming those that do. A warning
     stops nothing: it comes back from a settle as a diagnostic does
     now, and `tick`, the worker's run and a challenge check stop on
     errors only. The list is dropped when none has an `X` bit left, and
     at Reset or a load. If one of those parts later reads
     an `X` from somewhere else, the warning stays with it; that is
     accepted.
   - A NOT fed back to itself reads `X`. So does a cross-coupled latch
     released from `S = R = 1`, which today oscillates. A register
     clocked by such a loop holds `X` until a certain edge loads known
     data, or Reset.

9. **At the engine's edge.**
   - **Net values.** `Simulator::unknown()` beside `nets()`, and
     `Engine::unknown()` in `sim-wasm`. The worker's `state` message
     carries `unknown` beside `nets`, empty while no bit is unknown.
   - **Waveforms.** A record is `(time, value, unknown)`, made when
     either word changes. `Engine::wave` and the worker's `waves` message
     give each trace as `[t0, v0, u0, t1, v1, u1, …]`.
   - **Memory.** `memory()` keeps returning values. `memory_unknown()`
     returns the cells' unknown bits, empty while every cell is known,
     through `Simulator`, `Engine` and the worker's `memory` message, so
     a screen's unknown pixels can be drawn.
   - **Run until** (`tick_until`) stops when the LED's net was a known
     `0` and now has a bit that is a known `1`. A net that goes `0`,
     then `X`, then `1` does not stop the run.
   - **A challenge check.** Any unknown bit in a compared output or
     memory byte is a mismatch. `Mismatch` gains `unknown` (left out when
     0, in the engine and in the worker's protocol), and the editor
     writes such a value with `X` and `Z` digits: "out should be 3 but
     is X". A bench step's `until` waits for a known `1`. Challenges list
     their allowed parts and none lists `tri`, so no challenge changes.
   - Switch values sent in (`set_inputs`) stay plain numbers.

10. **In the editor.**
    - **Wires.** A wire with any `X` bit is drawn as `X`. Otherwise one
      with any `Z` bit is drawn as `Z`. Each has a colour and a line
      style of its own, since colour is never the only sign.
    - **Numbers.** Wherever a value is written (inspector, readout, LED
      labels, waveform bands), one bit is `0`, `1`, `X` or `Z`. A hex
      digit is `Z` if all its bits are `Z`, `X` if any other bit of it is
      unknown, else the digit.
    - **Parts that show.** An LED is lit only for a known non-zero value,
      and shows `X` or `Z` otherwise. A seven-segment display and a screen
      draw an unknown segment or pixel in the `X` colour.
    - **The part.** *Tri-state buffer* in the parts panel, drawn as a
      buffer triangle with `en` entering from the side. The file format
      becomes version 12 with it, since older editors do not know the
      kind. Older files load unchanged.
    - Nothing in the editor computes a value. It draws the two words the
      engine sends.

11. **Cost.** Every evaluation now computes two words. Native numbers
    vary too much to compare two separate runs. So step 2 builds the
    benchmark program before and after the change and runs the two
    alternately, ten times each, on `cpu-1k` and `counters-1k`. The
    median ticks per second after may be at most 10% below the median
    before. If the result is within the runs' spread of that limit, the
    comparison is repeated. If it falls further, the step is not merged until an
    optimization brings it back (the obvious one: a primitive whose
    inputs are all known takes today's path). The numbers and the method
    go in `docs/performance.md` either way.

12. **Order of work.** Each step is one pull request and leaves `main`
    working:
    1. `docs/simulation-model.md`: the rules of items 1 to 8, marked as
       designed and not yet built, since ADR 0028 asks for them in
       writing before any code. Its outdated lines go: the `logic` module
       that was never written, and the plan for unconnected inputs.
    2. The engine's values: the `unknown` word, items 3, 4, 8 and 9, with
       native tests and the benchmark comparison. No part produces `Z`
       yet, so only an unstable loop shows anything new. Its tests include
       data that changes under an unknown clock, a clock that settles
       unknown at load and at Reset (a register with feedback among
       them), and the same for a RAM's `we`. The
       editor keeps
       drawing value words until step 4, so such a loop's `X` looks like
       a 1 there, which is no worse than the made-up values of today.
    3. The tri-state buffer and nets with several drivers, in the engine:
       items 5, 6 and 7, with native tests. Among them: a gate-driven pin
       joined to a buffer, a pin wired straight through, a buffer on a
       definition's input pin, labels joining two buses, and a definition
       opened as a sheet, and two bus pins on one inner net.
    4. The editor: item 10, the part and format 12, and Make component's
       refusal (item 7).
    5. An example, *Shared bus*: two 8-bit sources behind tri-state
       buffers on one bus, with a switch to enable each. The Playwright
       target enables one and reads its value on the bus, enables both
       with different values and reads `X`, and enables neither and reads
       `Z`. Then the docs and the roadmap.

    *As built (step 2):* the engine's values, in `sim-core`, `sim-wasm`
    and the worker.
    - **Two paths.** One flag says whether any bit may be unknown. While
      it is false, evaluation, clock edges and deltas are the two-state
      code of before, on one word. The first version, two words
      everywhere, was 30% and 37% slower; with this, a RAM's unknown bits
      behind a pointer and the hot loop inlined again, the medians of
      fifteen alternating pairs are +1.0% on `cpu-1k` and −1.8% on
      `counters-1k` (`docs/performance.md`). The two-word path was about a
      third slower when everything took it, and a circuit takes it only
      while it holds an unknown bit.
    - **The parts `unstable` names** are those changing at the limit: the
      loop, and whatever was still following it, as before. The
      `unsettled` warning looks at those same parts only. A register that
      took an `X` from the loop, but was not changing at the limit, holds
      its `X` without a warning once the loop itself is known again.
    - **Two settles at a load.** The possible edge for a clock that
      settles unknown is a second, ordinary settle of the parts concerned.
      A load or Reset reports the first settle's error if there is one,
      else the second's.
    - **A warning from `tick`.** `tick` returns the last tick's warning
      when no tick failed, and `tick_until` carries it in the field that
      held only the error.
    - **A second loop** adds its parts to those the warning watches; it
      does not replace them.
    - **In the editor** the status bar reads Unstable for the warning as
      for the error (Running, while a run goes on past the warning), with its own sentence, and the canvas highlights the
      parts either names. Without this, the switch positions restored
      after a load would turn a loop's error into "Settled, 1 warning".
    - **Clearing changes nothing yet.** Without `Z`, marking already ends
      at a state that clearing leaves alone. It is kept for step 3,
      which must test it. Everything evaluated while marking is evaluated again, not
      only what changed. If clearing ever outlasted its guard, marking
      would finish the settle, which is certain to end.
    - **Two rules that looked redundant are not,** and each has a test
      from review: a known 1 after an unknown clock matters when the data
      moves in the delta the clock becomes known, and a certain edge
      while marking matters when a clock first rises on the last delta
      before the limit.
    - **Marking by bit and clearing cover for each other today:** marking
      a whole net would be put right by clearing, and clearing changes
      nothing while marking is by bit. Step 3 must test each alone.
    - **A RAM at a certain edge** with `we` or the address unknown uses
      the snapshot only, since the time of the write is known.
    - **A seeded test** runs 400 random circuits through both paths,
      command by command, and compares results and state.
    - **Not testable yet:** a challenge mismatch with unknown bits. A
      check refuses at the settle that finds the loop, so no compared
      output is ever `X`. The field, the report text ("out should be 3 but
      is X") and its test are there for step 3, when `Z` exists.
    - **The editor** reads three numbers a waveform change and ignores the
      third, and ignores `unknown` in a state, until step 4.

    *As built (step 3):* the tri-state buffer and nets with several
    drivers, in `sim-core`.
    - **`tri` is hidden from the editor.** The editor's kinds, layouts and
      file check follow the catalog `sim-wasm` gives it, so that catalog
      leaves `tri` out until step 4. The engine loads it; the editor
      refuses a file that holds one.
    - **A circuit with a buffer never takes the two-state path** (item 11's
      fast path), which has no `Z` to give a buffer that is not enabled.
      It takes the two-word path, measured about a third slower in step 2.
      No benchmark has a bus yet, so a bus design itself is not measured.
    - **A loop over a floating bus is `X` without a report.** It reads `X`
      from the first delta and `X` is stable, so no settle fails. Handed a
      known bus it oscillates, and is reported.
    - **Buffers and buses start at `Z` when a load or a Reset settles**
      (an addition to item 4, from review). The other nets start at 0,
      enables among them, so no buffer drives at that moment. Starting a
      bus at 0 gave the loop above a known value to oscillate on: the same
      circuit was silent after a switch change and reported after Reset or
      any edit.
    - **`unstable` on a ring** names the one primitive changing when the
      limit comes, as it always did. When that one is a resolver, the
      report names every buffer on its bus.
    - **Bus pins** are worked out by the per-sheet check itself, which is
      run once for each definition, after the definitions it uses. An
      output pin that nothing drives inside is not a bus pin.
    - **Reset's settle not being an edge** (item 4) now has a test: a
      clock that comes through a buffer floats for one delta of that
      settle.
    - **A challenge mismatch with unknown bits** has its test: a buffer's
      output, disabled, where 0 is expected.
    - **Clearing, marking by bit, and leaving an unchanged net alone
      while marking** each have a test of their own, from circuits found
      in review: a transient that the limit cuts on its last delta, a
      loop on one bit beside a bit that holds, and a disabled buffer fed
      by a loop. The step 2 note that clearing changes nothing was wrong.
    - **A settle can report `unstable` and leave no `X`,** when the limit
      cuts a transient that then ends. The message still says a loop
      oscillates. This was so before four-state signals; it is left.

    *As built (step 4):* the editor.
    - **Wires.** X: the X colour, long dashes. Z: the Z colour, dots. Both
      colours were already in the design tokens. A wire the engine names
      in an error keeps the error's colour, and its dashes.
    - **The LED** is a ring in its state's colour with the letter `X` or
      `Z` in it. A wide LED, switch or register writes its digits.
    - **Digits.** `hex` and `showValue` take the unknown word: one bit is
      `X` or `Z`; a wider value is its hex digits alone ("0x5X"), with no
      decimal beside them. In the readout "unknown" still means the engine
      has not reported yet.
    - **Waveforms.** A one-bit X or Z runs along the middle of the lane,
      dashed as on a wire. A bus band with unknown digits is outlined in
      the X style and shows them.
    - **The part** sits with the gates: a buffer's triangle, `en` below
      `in` on the left, as every part has its inputs. It has no shortcut
      key.
    - **Make component** counts a bus's drivers from the port nets: each
      tri-state buffer's `out`, and each instance's output pins. A
      selection that takes some and leaves others is refused: "A shared
      bus would be split: select every tri-state buffer on it, or none of
      them."
    - **Not done:** the about page's list of parts (another session's
      work in progress), and unknown words in the inspector's memory
      dump, which shows values only.

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
- **Any instance output pin may share a wire on its sheet,** leaving the
  flattened check to catch gate-driven ones. A pin wired straight through
  a component would then pass both checks and join two buses backwards
  through an output pin. The bus-pin rule costs one pass per definition.
- **Only `0` to `X` and `X` to `1` as possible edges,** as hardware
  description languages have it. There an `X` is one unknown level. Here
  it also stands for a net that keeps toggling, and a register under a
  toggling clock would keep a known value that is wrong, or not, by the
  parity of the delta limit.
- **`Z` passes through split and merge.** A bus could then be split while
  floating and still show `Z` on each part. It would make split and merge
  the only computing parts that can output `Z`, and their outputs could
  then share nets, which item 6 would have to allow or forbid case by
  case. Read as `X`, the rule is one line.
- **Stop at the delta limit and mark the changing nets `X`,** without the
  further stages. Cheaper, but logic downstream of the loop would keep
  values computed from whatever the loop held when it stopped, and a
  known value beside an `X` would be a guess.
- **Report `unstable` as an error for as long as the `X` lasts.** A run
  could then never continue past a loop that has settled to `X`, and a
  register left at `X` would block it until Reset. The error marks the
  settle that failed; the warning explains the `X` that remains.
- **Skip a RAM write that cannot be known,** and warn. Simulators often
  do. The memory would then hold values that may be wrong and look right,
  which is what `X` exists to prevent. Marking 65,536 cells is cheap, and
  the engine may keep one flag for "every cell" instead.
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
  only in the diagnostics list. The three engine tests of unstable loops
  change meaning: a loop is reported once as an error, then as a warning.
- Every evaluation does more work. Item 11 bounds it and records it.
- The engine's edge grows: a second array in a state message when
  something is unknown, and a third number in each waveform record.
- **A bus is `Z` or in conflict for a delta or two** whenever its enables
  change, since every primitive takes one delta and the resolver one
  more. A flip-flop is safe: it samples the snapshot. A latch built from
  gates, or a derived clock, that reads the bus can take that `X` and
  keep it. Step 3 tests this and the model document says it.
- A possible clock edge makes a register's differing bits `X`, and an
  unknown address a whole RAM. That is pessimistic: some bits would in
  truth keep their values. No known value is ever a guess, and Reset
  clears it.
- `docs/simulation-model.md` changes its plan for unconnected inputs
  (item 2).
- Not done here: pins that are both input and output, pull-ups, a
  conflict diagnostic, and `X` at power-up.
