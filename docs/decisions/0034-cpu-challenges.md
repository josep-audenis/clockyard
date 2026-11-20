# 0034. Challenges 10 to 12: a CPU, a program and a screen, checked on computer benches

- Status: Proposed
- Date: 2026-11-20
- Depends on: ADR 0028 (Phase 6 plan, increment 4; its target is amended
  here); ADR 0025 (challenges, whose item 7 left these three for this ADR,
  and whose item 1 is amended for challenge 12's starter); ADR 0019 (the
  reference CPU and its assembler); ADR 0022 (memory-mapped I/O); ADR 0018
  (ROM and RAM); ADR 0021 (devices)

## Context

Challenges 1 to 9 are built (ADR 0025). Each is a custom component to
build, checked by `sim_core::check(description, challenge)`. The check
builds the bench in code: one switch per input pin, one instance named
`dut`, and one LED per output pin. A step sets inputs together, settles,
and compares outputs. A clock is an input pin toggled by steps.

The brief's last three are "Build a basic programmable CPU", "Run a small
program" and "Connect a visual output device". ADR 0025 item 7 sketched
their bench: the same bench with a ROM and RAM of its own, wired to the
CPU's address and data pins, so a check runs test programs. ADR 0028 made
them Phase 6's fourth increment. Its target reads: "the reference CPU, as
a solution, passes all three".

What exists to build on:

- **The reference CPU** (`docs/reference-cpu.md`, ADR 0019) is Harvard: a
  16-bit program ROM addressed by `PC`, and a data RAM of 256 bytes whose
  top sixteen addresses, `0xF0` to `0xFF`, reach devices (ADR 0022). Each
  instruction takes two cycles, and every register changes on a rising
  edge.
- **Its example sheet** (`scripts/reference-cpu.mjs`) is flat: the CPU's
  registers, control ROM (`ctl`), multiplexers and adder share one sheet
  with the program ROM, the RAM, the I/O decoder ROM (`iodec`), the devices
  and the status LEDs.
- **Tests that read that sheet:**
  - the native test of the CPU (`crates/sim-core/tests/cpu.rs`) reads its
    LEDs and registers by ID;
  - the browser tests use its LEDs, such as "Run until LED Fetch lights";
  - the routing test pins its routes;
  - the benchmarks load it.
- **The assembler** (`crates/asm`) is a dependency of `sim-core`'s tests.
  `cpu.rs` already holds Catch's ROM words against `asm::assemble` of
  their source.
- **Documents.** `sim-core` reads circuit descriptions, not project
  documents. The editor projects a document into a description, and so do
  the native tests' helpers.

Four questions decide the design:
- where the CPU's edge is, so a bench can hold the memories and devices;
- what a bench is, and how it reaches the engine;
- what a step can do beyond setting pins;
- what each challenge asks the user to build.

## Decision

1. **The three challenges.**

   | # | Build | Checked by |
   |---|-------|------------|
   | 10 | A CPU, `cpu`, that runs the reference CPU's instruction set | Test programs on a bench, by what they leave in RAM, in `OUT`, and whether they halt |
   | 11 | A program, in the ROM of a component `program`, for the reference CPU | The bench runs the provided reference CPU on it, with different bytes at `KEY` |
   | 12 | A screen interface, `display`: a screen pointer register and the write strobe for a screen | A drawing program on the provided CPU, then the bench screen's bytes |

   - **Challenge 10 is the hardware.** The user builds the reference CPU
     from registers, multiplexers and an adder.
     - The starter provides the reference CPU's own building blocks: its
       8- and 1-bit registers, its 8-bit multiplexer and its 8-bit adder
       with the full adder inside.
     - Allowed parts: gates, `dff`, split, merge and `rom`.
     - A ROM is allowed for the instruction decoder, as the reference
       CPU's `ctl`. A ROM's address is at most 16 bits wide (ADR 0018), so
       no single ROM can stand in for the 17-bit add or an 8-bit
       multiplexer, as ADR 0025 item 5 feared for the adders.
     - A ROM keyed on a cycle counter, replaying the expected run, is
       made impractical by runs that read `KEY` and take different paths
       (item 4).
     - The challenge text carries the instruction table, since the app
       does not ship `docs/reference-cpu.md`.
   - **Challenge 11 is software.** The user writes a program for the
     reference CPU in the program editor. Its task: read the byte `n` at
     `KEY` (`0xFF`), from 1 to 22, show `1 + 2 + … + n` with `OUT`, then
     halt.
     - That needs a loop, a load, an addition and a conditional jump. `JZ`
       alone is enough without a compare.
     - The total is at most 253.
   - **Challenge 12 is a device.** Given the CPU, the user builds what
     connects a screen: the `SPTR` register that `STA 0xFE` writes, and the
     strobe that writes the screen at `STA 0xFD`, as `docs/reference-cpu.md`
     specifies them.
   - **This amends ADR 0028's target.** The reference CPU is the solution
     to 10, and its pieces are the solutions to 11 (a program for it) and
     12 (its screen interface). Asking all three for a CPU would repeat
     challenge 10, and miss the brief's program and output device.

2. **The interfaces.** Pins are pin-part IDs (ADR 0013). Inside a
   definition, parts that would share a pin's name are renamed in the
   generated solution (the reference CPU's `pc` register and `we` gate, for
   example).

   `cpu` (challenge 10; provided in 11 and 12):

   | Pin | Width | Direction | Meaning |
   |-----|-------|-----------|---------|
   | `clk` | 1 | in | The clock; every register changes on its rising edge |
   | `instr` | 16 | in | The ROM word at `pc` |
   | `din` | 8 | in | The byte at `addr`: RAM, or a device at `0xF0` to `0xFF` |
   | `pc` | 8 | out | The program address |
   | `addr` | 8 | out | The data address of this cycle |
   | `dout` | 8 | out | The byte a store writes |
   | `we` | 1 | out | 1 during the execute cycle of `STA` |
   | `out` | 8 | out | The `OUT` register |
   | `halt` | 1 | out | `H` |
   | `fetch` | 1 | out | `¬T ∧ ¬H`, the status output *Run until* steps by |

   A store is `we` with `addr` and `dout` steady while `clk` rises. RAM
   and devices sample them from the settle's starting snapshot (ADR 0018).

   `program` (challenge 11): input `addr` (8), output `word` (16). Inside,
   a ROM of 256 words wired from one to the other. The program editor
   writes that ROM, as it writes any ROM.

   `display` (challenge 12):

   | Pin | Width | Direction | Meaning |
   |-----|-------|-----------|---------|
   | `clk` | 1 | in | The CPU's clock |
   | `addr`, `dout` | 8 each | in | The CPU's data address and store byte |
   | `we` | 1 | in | The CPU's store strobe |
   | `sptr` | 8 | out | The screen pointer: `STA 0xFE` sets it |
   | `swe` | 1 | out | 1 when a store to `0xFD` is under way: the screen's write enable |

   The bench's screen takes its address from `sptr`, its data from
   `dout` and its write enable from `swe`. Reads of `0xFE` and `0xFD` see
   `sptr` and the screen's byte. Allowed parts: gates, `dff`, split and
   merge. The reference CPU's 8-bit register is provided as `reg8`, a copy
   without the `bench-` prefix (item 3).

3. **Benches are circuit files.** A bench of a ROM, a RAM, a key, address
   decoding and devices is a circuit, so it is written as one, one per
   challenge, in `challenges/benches/`:
   - `cpu.clockyard.json`: a program ROM (256 × 16) on `pc` and `instr`; a
     data RAM (256 × 8); an 8-bit switch `key` read at `0xFF`; the decoding
     that sends `0xF0` to `0xFF` to devices instead of RAM; a clock switch
     `clk`; LEDs on `out`, `halt` and `fetch`; and an instance `cpu` of the
     definition under test.
   - `program.clockyard.json`: the same, with the provided CPU, and an
     instance `program` in the program ROM's place.
   - `display.clockyard.json`: the same, with the provided CPU, a program
     ROM, a screen, and an instance `display` between them.

   How a bench is used:
   - **IDs.** The bench's own definitions (the provided CPU and its parts)
     carry IDs starting `bench-`.
   - **Definitions.**
     - The check takes the user's definition under test, and the
       definitions it uses, from the user's document.
     - A definition whose ID starts `bench-` always comes from the bench
       file, even when the definition under test uses it.
     - The starters copy the bench sheet, `bench-` definitions included,
       into the user's document. Editing one there changes nothing the
       check runs, so a provided CPU cannot be edited to pass challenge 11
       or 12.
     - Parts a challenge provides for the user to build with, such as
       `display`'s register, are copies with their own IDs.
   - **Reaching the engine.**
     - A challenge file names its bench.
     - The editor projects the bench file, as it projects any document, and
       passes it to `sim_core::check` and `sim-wasm`'s `check` as a third
       argument.
     - The native tests do the same through their helpers.
     - Challenges 1 to 9 pass none and keep the bench built in code.
   - **Program and fresh start.** The check writes each run's program
     words into the bench's program ROM. Every run is a fresh `Simulator`.
   - **Generation.**
     - `scripts/challenges.mjs` writes the benches, the `cpu` solution and
       the provided parts from pieces shared with `scripts/reference-cpu.mjs`.
     - Those pieces move to a module both scripts import, since
       `reference-cpu.mjs` writes files when it runs.
     - Both scripts' `--check` keep the files current.
   - **The examples stay flat.** The reference CPU and Catch sheets do not
     change, and nor do the tests that read them.
     - A native test runs `cpu.rs`'s model of the reference CPU against the
       generated `cpu` on its bench, for the same programs.
     - That holds the cut CPU to the same specification as the flat one.

4. **Runs.** A bench challenge lists runs, each on a fresh bench:
   `{ name, words?, steps }`, where `words` is the program ROM's contents.
   - Challenge 10 has several runs:
     - loads, `OUT` and `HLT`;
     - additions and subtractions with their flags;
     - stores and loads through RAM;
     - jumps in a loop;
     - each of these runs again with other bytes at `KEY`.
   - Challenge 11's runs have no words (the user's `program` is the ROM)
     and differ only in `key`.
   - Challenge 12's runs draw through `SPTR` and `SDATA`.
   - A run is bounded: no run may ask for more than 1,000 cycles.

   A step does, in order:
   - `set`: switches, here `key`, set with `clk` low and settled, as now.
   - `cycles: n`: n clock cycles, each the clock switch set to 1, then
     to 0.
   - or `until: "halt"` with `cycles: n`: cycles until `halt` reads 1, at
     most n. Not halting in time fails the step, and the report says so.
   - `expect`: output pins, by the bench's LEDs (`out`, `halt`), as now.
   - `memory`: bytes by part and address, such as `{ "ram": { "16": 42 } }`
     or `{ "screen": { "0": 255 } }`. `Simulator::memory` reads them by the
     bench's part ID.

   A loop that does not settle is still `Unstable`, so every check ends.

5. **Reports.** `Report` keeps its three kinds, and the new failures fit
   them:
   - `Failed` gains `run` (the run's name) and memory mismatches, as
     `{ name: "ram[16]", expected, got }`, the fields `Mismatch` already
     has. A run that does not halt in its budget is `Failed`, with the
     mismatch `halt` expected 1, got 0.
   - `Refused` covers a bench part the challenge names that is missing.
     That is a fault in a bench file, which the user cannot edit; the
     native tests catch it.
   - The panel says it in words: "Run *Jumps*, step 2: RAM byte 16 should
     be 42 but is 0".

6. **Programs are data.** A run's words are written out in the challenge
   file, next to their assembly source. The editor never computes them.
   - The script holds the words written out by hand, next to their source,
     as `scripts/reference-cpu.mjs` holds Catch's (`CATCH_WORDS`). Node
     scripts cannot assemble, since `sim-wasm` is built after they run in
     `verify`.
   - `crates/sim-core/tests/challenges.rs` assembles each source with
     `asm::assemble` and fails if the words differ, as `cpu.rs` does for
     Catch.
   - The expected values come from a model of the reference CPU in the
     script, as ADR 0025's come from its models of the register and
     counter.

7. **Solutions, starters and tests**, as ADR 0025 item 4:
   - **The solutions:**
     - 10: the generated `cpu`;
     - 11: a program, in `scripts/challenges.mjs` as source, assembled
       into `program`'s ROM;
     - 12: the reference CPU's screen interface, as `display`.
   - **The starters:**
     - 10: the pins and the provided building blocks.
     - 11: a main sheet that is a copy of its bench, with the provided
       CPU, an empty `program`, an 8-bit switch on `KEY` and the RAM, so
       the user can run their program before checking it.
     - 12: the same kind of main sheet, with the screen visible on it
       (ADR 0021 draws only the open sheet's screens), and `display` with
       its pins. That is more than ADR 0025 item 1's "only the pins",
       which this amends for starters with a bench sheet.
   - **Native tests:**
     - every solution passes;
     - every starter fails;
     - a CPU that never halts fails by its budget;
     - the model and the generated CPU agree.
   - **Playwright, the target:**
     - the reference CPU, opened as challenge 10's solution, passes all
       its runs through the Check button;
     - 11's and 12's solutions pass too.

8. **In the editor.** The panel shows the new failures (item 5). The
   challenge list, the starter, the Check button and progress (ADR 0029)
   work as for 1 to 9.

9. **Order of work.** Each step is one pull request:
   1. The shared pieces module, and the generated `cpu`, `display` and
      benches, with the model test against the generated CPU. The
      examples are unchanged.
   2. The engine: a bench argument to `check`, runs, the new step fields,
      memory expectations and their reports, with native tests.
   3. Challenge 10, with its runs, solution, starter and tests.
   4. Challenges 11 and 12.
   5. The editor's reports, the Playwright target, and the docs.

   When this ADR is accepted, ADRs 0028 and 0025 are marked amended by it
   in their status lines and in `docs/decisions/README.md`.

## Alternatives considered

- **Benches built in code.** That is how challenges 1 to 9 are built, and
  it needs no new file. But a ROM, a RAM, I/O decoding and devices are a
  circuit. In code they would be a hand-written second copy of the
  reference CPU's pieces, and nobody could open one to look at it.
- **Reshaping the example sheets around a `cpu` part.** The examples
  would show the cut. But it moves every LED and register the native,
  browser, routing and benchmark tests read, and LEDs inside a definition
  become pins and stop being "Run until" choices. The cut is generated
  for the challenges instead, and held to the flat CPU by the model test.
- **The CPU with its memories inside**, as the example sheet has them.
  The bench would then reach in to load a program and read RAM. A program
  could not be swapped without editing the user's circuit, and challenge
  11 could not supply the ROM.
- **All three asking for the reference CPU, as ADR 0028's target
  reads.** Each would be a CPU again. Nothing would ask for a program or a
  device, which are the brief's 11 and 12.
- **The screen inside `display`.** It would leave the bench simpler, but
  the editor draws only the open sheet's screens. On the main sheet the
  user would never see their device draw. The screen stays on the bench
  sheet, driven by `display`.
- **A clock part on the bench.** ADR 0025 rejected it: a switch toggled
  by steps does the same, and the result does not depend on speed.
- **Challenge 11 as text: assembly checked by a model CPU in the engine.**
  That would be a software CPU, which CLAUDE.md forbids. Here the program
  runs on the reference CPU's gates.
- **Computing expected values at check time.** It would save writing them
  out, but a mistake would then pass wrong circuits silently. They are
  generated into the files by the script's model, as ADR 0025's are, and
  the reference solutions' passing checks them.

## Consequences

- `check` gains a second kind of bench, and challenge files gain runs.
  Challenges 1 to 9 are unaffected.
- The reference CPU exists as two circuits: flat in the examples, and cut
  as `cpu` for the challenges. The model test keeps them in step. It is
  also modelled twice: in Rust, in `cpu.rs`, and in JavaScript, in the
  challenge script's model for expected values, which goes further than
  ADR 0025's models of a register and a counter. The reference solution
  passing every run is what holds that model to the circuit. A second
  reference CPU (increment 6) would add another of each.
- A challenge file can hold programs. The assembler must keep assembling
  them to the same words, which the native test enforces.
- Challenge 10 is long. A CPU from registers, multiplexers and an adder
  is hours of work. Its text carries the instruction table, and its
  starter provides the building blocks.
- Not decided here:
  - challenges beyond 12;
  - progress shown per run;
  - a key that changes part-way through a run.
