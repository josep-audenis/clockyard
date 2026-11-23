# 0040. Rough edges: Make component, the readout, bench reports, and a list that holds only what stays

- Status: Proposed
- Date: 2026-11-23
- Depends on: ADR 0037 (Phase 7 plan, increment 3); ADR 0016 (Make
  component); ADR 0035 (buses and tri-state buffers); ADR 0021 (devices,
  memories read after each state); ADR 0034 (bench challenges); ADR 0011
  (kept routes); ADR 0019 (the program editor)

## Context

ADR 0037 makes increment 3 the rough edges, and names what it closes:
Make component covering parts, refusing a single item, and counting a bus
that only passes through as a driver; the readout missing memories and
screens; a bench challenge's text in one paragraph and its pass not naming
runs; and the stale item, removed. Every other item is marked "by design"
or moved to "out of scope", with its reason. The target: the list holds
only items marked so, and each one closed has a test.

The stale item (bit operations and a call) went in ADR 0039's step 5. The
roadmap lists 13 items now. What the code does today, for the five to
close:

- **Make component places its instance at the selection's top-left
  corner,** and steps it down 2 cells only while one of its ports would
  land on a junction left on the sheet (ADR 0010). The chip is drawn from
  its pins, so it can be taller or wider than the selection was, and
  covers parts left beside or below it.
- **Make component is offered only when two or more items are selected.**
  A single selected part shows its own properties, and the form is not
  there. Yet one part with wires crossing to it is a fair component: the
  crossings become its pins (ADR 0016), as they would for two.
- **A bus that passes through a component** (an input pin wired straight
  to an output pin) puts that output on the bus's net. `splitsBus` in the
  store counts every output of an instance on a bus as a driver, since the
  engine reports only which nets are buses, not who drives them. Such an
  instance and the bus's buffers must be selected together or not at all,
  and the message asks only for the buffers. The engine knows each bus's
  real drivers: it builds the bus from them (`sim.rs`, the resolver's
  inputs are tri-state buffers, flattened out of the instances).
- **The readout for screen readers** (`Readout` in `App.tsx`) lists the
  clock, switches, keyboards, buttons, LEDs and displays, flip-flops,
  registers inside components, and notes. It says nothing of ROMs, RAMs or
  screens, so a CPU's program counter shows only through its LEDs, and a
  screen not at all. The editor already reads each screen's words after
  every state (`watched` in `simulation/sync.ts`), to draw it.
- **A bench challenge's text is one paragraph:** challenge 10's is about
  1,300 characters, with the opcodes run into the prose. Its pass reads
  "Passed, 30 of 30 steps.", while a failure names its run ("Run Store and
  load, step 2 of 3 failed.").

## Decision

1. **Make component's instance lands clear of the parts it leaves.** Its
   box, from the new definition's layout, is stepped down 2 cells, as for a
   port on a junction today, until it overlaps no part, junction or note
   left on the sheet, with a gap of one cell so no port touches another
   part's and looks joined to it (as ADR 0010 keeps ports off junctions).
   Boxes are taken as drawn, turned parts with their turned bounds. Wires
   left on the sheet are not obstacles: the chip may lie over one, as a
   placed part may today. The wires back to it are routed as now. Stepping
   down keeps it in its column, near where the selection was, and ends,
   since the items are finite; a search in every direction would place it
   better on a crowded sheet, and is left out.

2. **Make component is offered for one part too.** The inspector shows the
   form below a single part's properties when the part is not a pin
   (switch or LED) and not a note. A lone component is allowed: it wraps a
   chip in a chip. The rules do not change: the component needs pins, from
   labelled switches and LEDs inside or from crossing wires, so a lone gate
   with wires to it becomes a chip with those wires as pins, and a lone
   gate with none is refused as today. The form says "1 part selected"
   (not "1 items"), and is keyed on the part, so a typed name or an error
   does not carry over to the next one selected.

3. **The engine names each bus's drivers.** `Simulator::bus_drivers()`
   returns, for each bus, the top-level parts that own its tri-state
   buffers: a buffer inside an instance is reported as the instance, as
   `net_drivers` does (ADR 0016). `sim-wasm` passes it through as
   `busDrivers: Record<net, partId[]>` in place of `buses`, and the store's
   check counts those parts only. An instance whose output only follows a
   bus through its pins owns no buffer on it, so it is neither required nor
   refused. The message stays "select every tri-state buffer on it, or none
   of them", which is now exactly the rule (a component holding a buffer
   counts as one).

4. **The readout lists memories and screens,** after the registers:
   - a ROM: `ROM Program: address 3, word 4611 (0x1203)`, from its `addr` and
     `out` nets, named as the readout names other parts (its kind and
     label, or "ROM 1");
   - a RAM: `RAM 1: address 12 (0x0c), data 7 (0x07)`, from its `addr`
     and `out` nets;
   - a screen: `Screen 1: 18 of 512 pixels on`, counted from the words the
     editor already reads to draw it; a pixel whose bit is unknown is not
     counted as on. A count does not show the picture, but it says whether
     anything is drawn and how much changed; a description of the picture
     is left out.
   Values are written with `showValue`, as the readout writes others (`X`,
   `Z`, "unknown" while stale): an address at the part's address width, a
   word or data at its width. The list is not live (`aria-live` stays
   off), as now: a reader asks for it.

5. **A bench challenge reads in parts and its pass names its runs.**
   - A challenge's `text` may hold blank lines; the panel shows each part
     as its own paragraph. Challenges 10 to 12 are split: what to build,
     the instructions or the interface as a list of lines, then what is
     provided. No other challenge changes.
   - A pass on a bench reads "Passed all 10 runs, 30 steps: Load and
     show; Add, subtract and flags; …", the runs named in order and
     joined by semicolons, since run names hold commas. A challenge
     without runs still reads "Passed, 4 of 4 steps."
   - The texts are written by `scripts/challenges.mjs`, whose `--check`
     keeps the files in step; the split goes there, and the files are
     made again.

6. **The rest of the list, each with its reason,** in the roadmap under
   "by design" and in "out of scope (for now)":
   - **By design:**
     - kept wires longer than needed until the file opens again (ADR 0011:
       an edit reroutes only what it touches, so other wires do not jump);
     - a circuit with a tri-state buffer runs on the two-word path
       throughout (ADR 0035: the two-state path has no `Z`);
     - a register that took `X` from a loop holds it, and a settle cut by
       the delta limit is reported as an oscillating loop (ADR 0035: state
       holds what it was given; the limit cannot tell a long transient
       from an oscillation);
     - a component under a `bench-` ID cannot be used in a bench challenge
       (ADR 0034: those IDs are the bench's own);
     - Catch reads `KEY` once per step (ADR 0023: holding a key to move
       is the game's choice; moving on a new press only would need
       tapping once per lane).
   - **Out of scope (for now):**
     - a benchmark with a bus, to measure that path's cost (ADR 0035 notes
       none has one);
     - a diagnostic naming two bus drivers in conflict (already listed by
       ADR 0037);
     - a challenge mismatch's width, needed only once a challenge allows
       a tri-state buffer, which none does;
     - the program editor for ROMs other than 16 bits wide (ADR 0019: each
       machine needs its own assembler).

7. **Steps,** one pull request each:
   1. **Bus drivers from the engine:** `bus_drivers` in `sim-core` with a
      native test (a buffer at top level, one inside an instance, and an
      instance that passes the bus through, which is not a driver),
      `sim-wasm`, the worker protocol (`simulation/protocol.ts`) and the
      store following, with their tests (`sim-wasm.test.ts`,
      `store.test.ts`). Vitest for Make component on the pass-through
      case, selected alone and with the buffers: the made circuit loads
      with no diagnostic and the bus's value still reaches its reader.
   2. **Make component for one part, clear of the rest:** the inspector,
      the placement, Vitest (a lone gate with crossings becomes a chip; an
      instance taller than its selection lands below the parts beside it,
      overlapping none).
   3. **The readout,** with Vitest for the three new rows (a ROM, a RAM, a
      screen with some pixels on, and each while stale).
   4. **Bench challenges in parts,** with Vitest for the pass text and the
      split texts; the roadmap's list reclassified, the increment marked
      done, and the Playwright target: Make component on one gate gives a
      chip overlapping nothing; the readout lists the reference CPU's ROM
      and RAM; challenge 10 shows its text in paragraphs.

## Alternatives considered

- **Place the instance anywhere free,** searching outward. It finds a
  better place on a crowded sheet, but the chip can land far from where
  its parts were, and its wires cross the sheet. Down the same column is
  predictable; a user can move it after.
- **Keep counting pass-through outputs, and fix the message.** Cheaper,
  but a user would still have to select a component that has nothing to
  do with the bus's drivers. The engine already has the right answer.
- **Describe a screen's picture in words** (rows of filled cells). Long
  and slow to listen to; a count says whether the program draws, which is
  what a reader checks first.
- **Close every item.** Several are choices ADRs made on purpose, and
  undoing them is a design of its own; the rest need a feature (an
  assembler per machine, a challenge with buses) that no one has asked
  for yet.

## Consequences

- The roadmap's rough edges hold only items marked "by design", each with
  its ADR; the others are in "out of scope (for now)".
- `sim-wasm`'s load result changes: `busDrivers` replaces `buses`.
- Make component's form shows for single parts, so the inspector is taller
  for them.
- **Left out:** a free-space search for the instance, a picture in words
  for screens, and the out-of-scope items above.
