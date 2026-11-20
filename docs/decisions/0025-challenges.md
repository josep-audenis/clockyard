# 0025. Challenges checked by behavioural tests

- Status: Accepted; item 1 (starters) amended by ADR 0034 for challenges
  with a bench
- Date: 2026-11-15
- Depends on: ADR 0020 (Phase 5 plan, increment 5); ADR 0012 (custom
  components) and ADR 0013 (instance ports by pin); ADR 0017 (flip-flops);
  the project file format (`apps/web/src/storage/file.ts`, format 9)

## Context

The brief describes a Challenge Mode with this progression: an inverter,
XOR from NAND gates, a half adder, a full adder, an 8-bit adder, storing
one bit, a register, a counter, an ALU, a programmable CPU, running a
program, and connecting a visual output device. It adds that completion
"should eventually rely on automated behavioral tests, not simply
detecting particular components". ADR 0020 makes challenges its fifth
increment, checked by tests "the engine runs against the user's circuit".

A behavioural test needs to know where to drive the circuit and where to
read it. The editor already has a part with a named interface: a custom
component (ADR 0012). Its pins are the switches and LEDs inside it, named
by their labels, and the engine elaborates an instance of it wherever it
is placed. The engine can also set several switches at once and settle
(`set_inputs`), and it reports a loop that does not settle as `Unstable`
instead of hanging.

Two facts limit what can be asked:

- With one delta per gate, a cross-coupled latch made of gates oscillates
  from the all-zero start (`docs/simulation-model.md`, "Known
  consequence"). A challenge that asks for a latch built from gates would
  fail every correct answer.
- Challenges 10 to 12 need a CPU's interface: where its program comes
  from, what counts as its output, how long it may run. Nothing in the
  first nine informs that yet.

## Decision

1. **A challenge is a custom component to build.**
   - Each challenge names a definition, its input pins and its output
     pins, with a width for each. For example, XOR has inputs `A` and `B`
     and output `Y`, all 1 bit wide.
   - Starting a challenge opens a starter document. It holds that
     definition with only its pin switches and LEDs, labelled, and nothing
     between them. The user builds inside it, using any parts the
     challenge allows, including their own components.
   - The definition is identified by its ID, which the starter fixes and
     the editor never changes. Its pins are found by name, as instances
     find them.
   - *As built (step 1):* an instance names a port by its pin part's ID
     (ADR 0013), so a challenge's pin names are the IDs of the starter's
     pin parts (`A`, `B`, `Y`), labelled the same. A pin deleted and drawn
     again gets a new ID, and the check says that pin is missing.
   - *As built:* the starter keeps the solution's other definitions, as
     parts the challenge provides. The 8-bit adder's starter has a full
     adder, since documents do not yet share components (blueprints,
     ADR 0020 increment 7).
2. **The check runs in `sim-core`.**
   - `sim_core::check(description, challenge)` builds a test bench around
     the definition: one switch per input pin, one instance of the
     definition, and one LED per output pin. It loads the bench in a fresh
     `Simulator`, so the user's running simulation is untouched and every
     check starts from Reset.
   - It then runs the challenge's steps in order. Each step sets some
     inputs together with `set_inputs`, settles, and compares the outputs
     it names.
   - A clock is an input pin like any other (`clk`), so a sequential test
     makes its edges by setting it to 1 and then 0. No clock part is
     involved, and the outcome does not depend on run speed.
   - The result is one of these:
     - every step passed;
     - the first step whose outputs differ, with every input's value at
       that step, what it expected and what it read;
     - a reason the bench could not run:
       - a pin is missing, or has the wrong width;
       - a part is not allowed;
       - the circuit did not settle (`Unstable`);
       - the description has errors.
   - `sim-wasm` exposes it as `check(description, challenge)`. The worker
     answers a "check" message with the report, as it does for a load
     (step 2).
3. **Allowed parts.** A challenge may list the primitive kinds it allows,
   such as only `nand` for the inverter and for XOR.
   - The check flattens the definition, so components the user made
     themselves count by what they are built of. An XOR made from NAND
     gates can then be used in the half adder.
   - Pins are not parts: their switches and LEDs vanish when elaborated.
   - This restricts the parts used; it never decides completion. Whether a
     challenge is passed is decided by its steps alone.
4. **Challenge files** live in `challenges/` at the repository root, next
   to `examples/`:
   - `NN-name.json` holds the challenge: its title, the text the editor
     shows, the definition ID, the pins, the allowed parts, and the steps.
     Steps are data, as an example file is: expected outputs are written
     out, never computed by the editor.
   - `solutions/NN-name.clockyard.json` holds a reference solution.
   - The starter document is written from the solution by a script that
     keeps only the pins, as `scripts/reference-cpu.mjs` writes the
     examples. Its `--check` runs in `pnpm verify`.
   - Native tests:
     - every solution passes its challenge;
     - every starter fails it, so no step list is vacuous;
     - a missing pin, a wrong width, a part that is not allowed, and a
       loop that does not settle are each reported with their reason.
   - The larger step lists, such as the 8-bit adder's and the ALU's, are
     generated by the same script. The native test then holds them
     against a solution that runs in the engine.
5. **The first nine challenges**:

   | # | Build | Pins | Parts |
   |---|-------|------|-------|
   | 1 | Inverter | `A` → `Y` | `nand` |
   | 2 | XOR | `A`, `B` → `Y` | `nand` |
   | 3 | Half adder | `A`, `B` → `S`, `C` | gates |
   | 4 | Full adder | `A`, `B`, `Cin` → `S`, `Cout` | gates |
   | 5 | 8-bit adder | `A[8]`, `B[8]`, `Cin` → `S[8]`, `Cout` | gates, split, merge |
   | 6 | One-bit register | `D`, `load`, `clk` → `Q` | gates, `dff` |
   | 7 | 8-bit register | `D[8]`, `load`, `clk` → `Q[8]` | gates, `dff`, split, merge |
   | 8 | 8-bit counter | `en`, `clr`, `clk` → `Q[8]` | gates, `dff`, split, merge |
   | 9 | ALU | `A[8]`, `B[8]`, `sub` → `Y[8]`, `C`, `Z` | gates, split, merge |

   - "Gates" means `not`, `and`, `nand`, `or`, `nor`, `xor` and `xnor`.
     No challenge allows a ROM, since a lookup table would pass the
     adders without building them.
   - Challenge 6 is "store one bit" in the form the engine can check: the
     bit keeps its value at a clock edge unless `load` is 1, in which case
     it takes `D`. A latch made of gates is left out (see Context).
   - The counter's `clr` is synchronous: it takes effect at the edge.
   - The ALU is the one the reference CPU needs (`docs/reference-cpu.md`):
     - `Y` is `A + B`, or `A − B` when `sub` is 1;
     - `C` is the carry, or "no borrow" when subtracting;
     - `Z` is 1 when `Y` is 0.
6. **In the editor:**
   - A Challenges list opens a challenge's starter. It asks before it
     replaces a circuit, as Import does, then opens the definition's
     sheet.
   - A panel shows the challenge's text and a Check button. A check
     reports either "Passed, N of N steps" or the first failing step in
     words, such as "With A = 1, B = 1: Y should be 0 but is 1." A reason
     the bench could not run is shown the same way.
   - The document records the challenge it was started from:
     `metadata.challenge`, in format 10. An exported file or a shared
     link then reopens with its panel and can still be checked.
   - Progress is not kept between visits. That waits for local storage,
     which arrives with autosave.
7. **Challenges 10 to 12 come later, in their own ADR.** Once challenges
   1 to 9 are built, they will show how a bench should drive a CPU. The
   likely shape is the same bench with a ROM and RAM of its own, wired to
   the CPU's address and data pins, so a check can run test programs on
   it.
8. **Order of work.** Each step is one pull request:
   1. The engine: `check`, the challenge format, `sim-wasm`'s `check`,
      and challenges 1 to 5 with their solutions, starters and native
      tests.

      *As built:* `scripts/challenges.mjs` writes the three files of each
      challenge; `crates/sim-core/tests/challenges.rs` holds them against
      the engine. Errors in the circuit are reported before parts that are
      not allowed, so a part of an unknown kind reads as an error. The
      report is JSON, `{ result: "passed", steps }`, `{ result: "failed",
      step, inputs, mismatches }` or `{ result: "refused", reason }`.
   2. The editor:
      - the Challenges list, the panel, Check and its messages;
      - `metadata.challenge` (format 10), with a migration test;
      - Playwright tests:
        - start the inverter, build it from NAND gates, Check: passed;
        - a wrong circuit names its first failing step;
        - an attempt shared by link reopens with its panel.

      *As built:* the list sits under the chips; the panel under the
      inspector's properties, with an Open button for the component when
      another sheet is open. `metadata.challenge` is the challenge's file
      name (`01-inverter`). A name this version has no challenge for is kept
      and shows no panel. The report is hidden by any edit to a component,
      since it describes the components it checked; switching sheets or
      editing the main circuit, which the bench ignores, keeps it. The editor adds the name to a
      starter it opens; since step 3 the files carry it too (format 10), so
      an imported solution opens with its panel.
   3. Challenges 6 to 9 with their solutions, starters and native tests,
      and a Playwright test of the one-bit register.

      This closes the increment.

      *As built:* a clocked challenge's steps come from a model in the
      script. Data inputs change with `clk` low, and nothing else changes in
      the step that raises `clk`, so every edge samples inputs that have
      settled; the output is expected after every step. One pulse in each
      sets an input while `clk` is high and expects nothing to change, so a
      clock gated by `load` or `en` fails. The 8-bit register loads values
      that differ when their bits are reordered; the counter runs through
      255, holds there, wraps to 0, and is cleared from 254 (1,054 steps);
      the ALU sets each bit of `Y` alone, for `Z`, and subtracts 0. A native
      test holds wrong circuits that once passed (a gated clock, a reversed
      register, a clear of two bits, a `Z` missing a bit) to failing. The ALU's starter provides the 8-bit adder
      and its full adder. Steps are written one to a line.

## Alternatives considered

- **Checking the main circuit through labelled switches and LEDs.** No
  custom component is needed. However, labels on the top level can repeat
  or be missing, and the check would need the editor to map labels to
  parts. Pins already have unique names and reach the engine as part of
  the description.
- **Detecting the parts used** ("has an XOR gate"). The brief rules this
  out as a completion test. Allowed parts are kept only as a restriction.
- **Exhaustive truth tables computed from a formula.** The formula would
  have to live in the editor or in Rust next to the checker, a second
  evaluator of the challenge. Steps written out as data, and proved
  against a solution that runs in the engine, keep one source of
  behaviour.
- **Checking in the user's running simulator.** The check would depend on
  the state the user left it in and would disturb their run. A fresh bench
  costs one elaboration and gives the same answer every time.
- **A clock part on the bench.** Ticks would add nothing an input pin does
  not already give, and tests would depend on the clock's phase.
- **Showing only the allowed parts in the palette.** It is friendlier, but
  it is a second place to keep the rule. The check enforces the rule and
  the challenge text states it; the palette can follow later.
- **All twelve challenges now.** Deciding a CPU's interface before the
  simpler benches exist would fix guesses in place, which ADR 0020 warns
  against.

## Consequences

- Passing a challenge means the circuit behaves correctly on every
  listed step, whatever it is built from within the allowed parts.
- Steps are a finite list, so a circuit that is wrong only on inputs no
  step sets still passes. The larger lists are chosen to cover carries,
  borrows, wraparound and every operation.
- A challenge is a definition, so what the user builds can be reused in
  the next challenge or in a sandbox circuit.
- Format 10 adds an optional field. Files and links without it open as
  before.
- Latches built from gates stay out of the challenges until the engine
  resolves symmetric loops (for example with an `X` value). The one-bit
  register uses a flip-flop instead.
- Challenges 10 to 12 remain open. The roadmap lists them as a later item
  under this increment.
