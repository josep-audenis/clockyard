# 0044. Bus conflicts named

- Status: Accepted
- Date: 2026-11-27
- Depends on: ADR 0043 (the Phase 8 plan, increment 1); ADRs 0030,
  0032, 0035; amends ADR 0043 item 2.1

## Context

ADR 0043 makes this the first increment of Phase 8. A bus that several
tri-state buffers share reads `X` where two enabled buffers disagree
(ADR 0035), and nothing says which buffers did it. Reference CPU 3 will
put its registers on such a bus, and a user who builds one will meet the
`X` first while debugging their own control logic.

What the engine and the editor have today:

- **Each bus is one resolver,** a hidden primitive whose inputs are its
  buffers' own nets (ADR 0035 item 7). It exists only for a net with two
  or more drivers, all tri-state buffers. A buffer that is not enabled
  gives `Z` on its own net, an enabled one its data, an unknown enable
  `X`. So the resolver's inputs say who drives what, bit by bit.
- **A settle returns one report** (`Option<Diagnostic>`): the `unstable`
  error when it hit its delta limit, else the `unsettled` warning while a
  loop's `X` remains (ADR 0035 item 8). A load settles twice and keeps
  the first's report, else the second's.
- **Calls that settle many times keep the last report.** `tick` returns
  the first error, else the last tick's warning; `tick` with no clock
  settles nothing and returns the `unsettled` warning only.
  `tick_until` calls `tick(1)` and keeps the last result. The worker
  ticks in chunks of 64 and replaces its list of runtime diagnostics
  with each chunk's (`sim.worker.ts`).
- **At a load,** `sim-wasm` puts only `unstable` in the runtime list;
  every other diagnostic stays in the load's list until the next load.
- **The canvas highlights** the parts that errors and `unsettled` name,
  and no other warning's (`scene.ts`).
- **A bus is `Z` or in conflict for a delta or two** whenever its
  enables change (ADR 0035), because the enable that turns one buffer
  off and the one that turns the other on arrive in different deltas.
  That must not be reported: every register transfer would set it off.
- **No benchmark has a bus** (ADR 0040).

## Decision

1. **A conflict is two known values that disagree, on a settled bus.**
   - When a settle ends, the engine looks at every resolver's inputs. A
     bit is in conflict when one input drives a known 0 there and
     another a known 1.
   - Drivers that agree are no conflict, however many are enabled.
   - An unknown bit (`X`) on an input is no conflict either: the bus
     reads `X` already, and a conflict that might be is not reported as
     one that is. Nothing is a guess, as everywhere `X` is used.
   - Only settled values are read, so the delta or two of conflict while
     enables change is never seen. No time window is needed. A conflict
     that comes and goes inside one settle is not reported either.
   - A settle that hit its delta limit reports `unstable` alone, as now.
     Its values are `X` where the loop was, so conflicts are not looked
     for.
   - The check runs only in a circuit with a tri-state buffer
     (`tristate`). Others have no resolver and pay nothing.
   - Flip-flops start at 0 (no `X` at power-up, ADR 0035), so control
     logic that enables two buffers in its reset state is in conflict
     from the first settle. That is the circuit's, and is reported.

2. **It is a warning, `busConflict`.**
   - It stops nothing: a tick, a run and a challenge check go on, as
     with `unsettled`. The bus still reads `X` (ADR 0035), so whatever
     reads it shows the fault, and a challenge whose outputs it reaches
     fails on its tests.
   - **One warning per bus.** Its IDs are the buffers in conflict: those
     with a known bit that another contradicts, not every buffer on the
     bus. As for every runtime diagnostic, a buffer inside an instance is
     named by the instance on the open sheet.
   - **The bus is named by its drivers,** not by a net or a label. This
     narrows ADR 0043 item 2.1, which said "the net and each driver"; it
     is amended to say so. The engine keeps no net names, net labels are
     joined before compiling (ADR 0015), and a diagnostic has one list of
     IDs, which Select selects: wires there would be selected too. The
     bus already shows `X` on the canvas where it is wrong.
   - **Its message** names buffers as the open sheet shows them, a
     top-level ID or the instance and the path inside it, since `lift`
     changes IDs and not text. It names each buffer in conflict with the value it
     drives, written as the readout writes a value (hex, with `X` for a
     digit that holds an unknown bit), and says the bus reads `X` where
     they differ: "tri-state buffers tb1 (0x12) and tb2 (0x34) drive one
     bus at once; it reads X where they differ". Three or more are
     listed the same way ("tb1 (0x12), tb2 (0x34) and tb3 (0x56)").
     Buffers inside an instance are named by their instance and their
     path inside it ("cpu1/rA (0x12)").

3. **A report is a list, and it keeps every conflict of the call.**
   - A settle returns its error alone when it has one, else its
     warnings: `unsettled` first, then each bus in conflict, in the
     order of its resolver. A load reports its first settle's error if
     it has one, else its last settle's warnings (it settles a second
     time only when a clock settles unknown).
   - The engine keeps the last settle's conflicts beside `looping`.
     `tick` with no clock, which settles nothing, returns them with the
     `unsettled` warning, so a run of the *Shared bus* example, which has
     no clock, keeps its warning.
   - **Many settles in one call.** `tick`, `tick_until` and the worker's
     chunks of a frame keep, for each bus, a conflict seen at any settle
     of the call. One that lasts to the call's last settle is reported
     as that settle found it. One that has ended stays in the report as
     it was first seen, with the tick it came at ("at tick 41"). This is the exception to "reported while it lasts": a
     run ticks many times a frame, and a conflict that lasts one clock
     phase of each instruction would otherwise be missed.
   - `tick_until` carries the list in the field that held one report.
   - **At the boundary,** `sim-wasm`'s load puts `busConflict` and
     `unsettled` in the runtime list beside `unstable`, so the next
     settle's report replaces them rather than doubling them.

4. **In the editor.**
   - The status bar reads "Settled, 1 warning" (or "Running") as for
     other warnings.
   - The problems dialog (ADR 0032) lists each conflict with its
     message, and its Select button selects the buffers it names.
   - The canvas highlights the buffers too: `busConflict` joins errors
     and `unsettled` in what `scene.ts` highlights.
   - The worker merges the conflicts of a frame's chunks, by the rule of
     item 3, before it sends them. It knows a bus by its message without
     the " at tick N" suffix: the message names every buffer by its path,
     so it is one per bus, where lifted IDs are not (two buses inside one
     instance both lift to it).
   - No new control. Pausing a run at a conflict is left out (see
     Alternatives).

5. **A benchmark with a bus.**
   - `scripts/benchmarks.mjs` gains a family, `bus`: groups of 8-bit
     registers, each behind a tri-state buffer on a shared bus, with a
     counter and a decoder enabling one buffer at a time, so each bus
     changes driver every cycle and never conflicts once settled. At
     `1k` it has about 1,000 parts, as the other families do.
   - Its ticks per second are measured before and after the check in
     interleaved pairs, as `docs/performance.md` asks of any comparison,
     and recorded there. The check reads every resolver's inputs once
     per settle. If after loses most pairs by more than their spread,
     the cost is recorded and a cheaper check is chosen by amendment,
     with its own measurement.
   - The other families have no tri-state buffer and are not measured
     again.

6. **The steps,** one pull request each:
   1. The rule in `docs/simulation-model.md`: items 1 to 3, with the
      conflict inside one settle that is not reported.
   2. The `bus` benchmark, with its ticks per second before the check.
   3. The engine and the boundary: `Code::BusConflict`, the check, the
      list a settle returns, the rules of item 3 for `tick`, `tick_until`
      and a load, `sim-wasm`'s runtime list, and the cost on `bus-1k`.
      Tests: two buffers that disagree are named with their values; two
      that agree, one disabled, and an unknown enable report nothing;
      one select driving both enables, one through a NOT, which overlap
      for a delta, reports nothing either way; a conflict in one tick of
      many is reported by `tick` and by `tick_until` with its tick;
      `tick` with no clock keeps a standing conflict; two buffers inside
      one instance are named by it with their paths; `unstable` comes
      alone; a load that starts in conflict reports it once.
   4. The editor, and the target in Playwright:
      - on the *Shared bus* example, its two 8-bit sources both enabled
        with different values are named in the problems dialog, Select
        selects both, and pressing Run keeps the warning; with one
        disabled, nothing is reported;
      - on a small fixture, one select switch drives both buffers'
        enables, one through a NOT; flipping it moves the bus from one
        source's value to the other's and reports nothing.

      The roadmap records the increment.

## Alternatives considered

- **An error that pauses a run.** It would stop at the first conflict
  and show the state that made it, which helps debugging. But it would
  change what a circuit does, not only what is reported: the *Shared
  bus* example shows a conflict on purpose, a challenge check would be
  refused rather than failed, and ADR 0043 keeps the value as the only
  effect. A warning can become a "pause on conflict" option later, if
  people ask for one.
- **Report possible conflicts too,** where one driver's bit is `X`. A
  buffer with an unknown enable would then be named on every settle of a
  circuit holding `X`, which is noise beside the `X` it shows already.
- **Watch every delta and ignore conflicts shorter than two.** It would
  catch a conflict that comes and goes inside one settle, such as a
  glitch a latch could take. That needs a count per bus in the hot loop,
  and a length chosen by hand; a settled conflict is the one a user's
  control logic causes.
- **Name the bus by its wires,** in the diagnostic's IDs. Select would
  then select the wires with the buffers, and the canvas shows the bus's
  `X` already. Naming it by a net label would mean keeping labels in the
  netlist for this alone.
- **Keep only the last tick's conflicts,** as `unsettled` does. A
  conflict in one phase of each instruction would come and go between
  frames, or never show.
- **One warning for all buses.** Several buses in conflict usually mean
  several faults, and Select should pick one fault's buffers.

## Consequences

- The engine reports a new kind of problem, and a settle's report
  becomes a list in `sim-core`. Every test that reads the one report
  changes with it.
- The worker merges chunk reports, and `sim-wasm`'s load sorts two more
  codes into the runtime list.
- A circuit with a tri-state buffer does a little more work per settle,
  measured on a new benchmark.
- A conflict that comes and goes within one settle is not reported; the
  model document says so.
- ADR 0043 item 2.1 is amended: the bus is named by its drivers.
- Reference CPU 3 (increment 2) is built with this check in place.
