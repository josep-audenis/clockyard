# 0034. Challenges 10 to 12: a CPU, a program and a screen, checked on computer benches

- Status: Accepted
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
     - 11: a program, in `scripts/cpu-runs.mjs` as source beside its
       words, in `program`'s ROM;
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

   *As built (step 1):* `scripts/cpu-pieces.mjs` holds the shared pieces
   and `scripts/computer.mjs` the cut `cpu`, `display`, `program` and the
   bench sheet; `scripts/challenges.mjs` writes `challenges/benches/` and
   the solutions of 10 and 12 (the benches with the reference part in the
   slot). The examples regenerate unchanged.
   - All three benches are the same computer: each has the `HEX` register
     and a screen, and the `cpu` and `program` benches have a screen
     pointer register of their own, so `cpu.rs`'s whole model applies.
     The digits' decoders and seven-segment displays are left off.
   - A bench file holds its slot's definition empty (the pins; an empty
     ROM for `program`), so it is a circuit that loads.
   - Inside `cpu`, the `PC` register is `pcr`, and the `we` and `fetch`
     gates are `weg` and `fetchg`, since pins take those names.
   - `cpu.rs` runs its model against both solutions, cycle by cycle, with
     the clock as a switch: the instruction and device programs, and 60
     random programs with changing keys.

   *As built (step 2):* `sim_core::check::check_on(description, challenge,
   bench)` is the bench check. `check` runs challenges 1 to 9 as before,
   and now refuses a challenge that has runs (its bench was not given) or
   no steps, so nothing passes by default.
   `sim-wasm`'s `check` takes the bench as an optional third argument, and
   the worker's `check` command an optional `bench`.
   - **Definitions.** The check takes every definition whose ID does not
     start `bench-` from the user's document, not only the closure of the
     one under test, as `check` already does; unused ones are never
     elaborated. The bench's own non-`bench-` definitions, its empty
     slot, are dropped.
   - **The slot** is every instance on the bench of the definition under
     test; allowed parts are counted inside it.
   - **Steps.** `set` names bench switches and `expect` bench LEDs.
     `until` stops the cycles once its LED reads 1, checked before each
     cycle, so a CPU already halted runs none.
   - **Runs.** A run's `words` go into the bench part `rom`; the clock is
     the bench switch `clk`. No run may total more than 1,000 cycles
     (`MAX_RUN_CYCLES`).
   - **Reports.** `Failed` has `run` (absent for challenges 1 to 9) and
     memory mismatches named `ram[16]`. Its `inputs` are the switches the
     run has set so far. `Passed` counts the steps of every run. A fault
     in a bench or challenge file is `Refused`, starting "This challenge's
     bench cannot run".
   - The editor does not load a bench yet: that comes with challenge 10.

   *As built (step 3):* challenge 10, `challenges/10-cpu.json`, with its
   solution and starter.
   - **Runs.** Ten, from eight programs: a load and `OUT`; additions and
     subtractions whose jumps are taken only with the right flags; stores
     and loads; a loop as long as the key, with keys 3 and 9; a branch on
     the key, with keys 4 and 200; flags kept by the instructions that do
     not set them, and set by `ADD` and `SUB` of a RAM byte; the reserved
     opcodes D to F, which have no assembly; and the reserved addresses,
     `NOP` and the screen. Only the two programs that read the key run
     with more than one, not each program as item 4 said.
   - **Steps.** Each run has three: the key set (if the program reads it)
     and two cycles, after which `fetch` is 1; cycles until `halt`, the
     model's own count and 20 more, then `out` and every byte stored;
     then four more cycles, after which `out`, `halt`, `fetch` at 0 and
     the bytes must be as they were.
   - **The model** is `scripts/cpu-runs.mjs`, instruction by instruction.
     The words are written by hand there, and `challenges.rs` holds them
     to `asm::assemble` of their source and the reference CPU to every
     run. Ten CPUs with one thing miswired each fail: review found six
     of them passing the first eight runs (OUT loading on every
     instruction, a halt that stops nothing, C reloaded by loads, `fetch`
     stuck at 1 or at 0), which the flags run and the steps before and
     past the halt now catch.
   - **The starter** is the bench with the CPU's pins only and the
     building blocks, so its main sheet is a computer to run the CPU in.
     ADR 0025's "only the pins" holds for the definition; the main sheet
     is new.
   - **The pins a challenge lists** are those its bench wires to the slot,
     which a native test holds, so a missing pin is named as a pin.
   - **The editor** reads the bench a challenge names
     (`storage/challenges.ts`, `benchOf`), projects it and passes it to the
     check. A failure reads "Run Store and load, step 2 of 3 failed.
     RAM byte 16 should be 7 but is 0." A Playwright test opens the
     challenge, fails its starter, and passes the reference CPU through
     the Check button: 30 of 30 steps.
   - The bench's parts are spread out when written, after it was first
     seen in the editor.

   *As built (step 4):* challenges 11 and 12, each with its solution and
   starter, a copy of its bench.
   - **11, the program.** Five runs with no words: the keys 1, 2, 5, 10
     and 22, and the sum expected in `out`. No memory is compared, since
     where a program keeps its numbers is its own business, and each run
     has 900 cycles (the reference loop takes 366 for 22). Only a `rom`
     is allowed in `program`. The solution's words are held to its source
     by a native test, and another program for the same sums passes.
   - **12, the display.** Three runs: one byte; two bytes with the pointer
     moved and read back; and stores to every address one bit away from
     `0xFE` or `0xFD`, before and after the one real draw, then additions
     that read those two addresses and a last read of the pointer. The
     additions matter: `addr` stays through the next cycle while A
     changes, so a display that ignores `we` draws the sum or moves the
     pointer. A load there hid it, the byte written being the byte just
     read. Eight miswired displays fail.
   - **What no program on the bench can see.** `swe` a cycle late, or
     `sptr` loaded at the falling edge: `addr`, `dout` and `sptr` hold
     through the fetch that follows a store, so the same byte lands one
     edge later, and a `HLT` always has a fetch before it. The text asks
     for neither, and the check lets both pass.
   - **Playwright.** Challenge 11's starter fails (the CPU never halts on
     an empty ROM); a program that shows the key is written in the ROM's
     editor, assembled, and fails at the second key; the sum passes, 15 of
     15 steps. Challenge 12's starter fails at the first byte and its
     solution passes.
   - **A definition added under a `bench-` ID.** *Add components* numbers
     an ID already taken (`bench-reg8-2`), and the check leaves every
     `bench-` definition of the user's out. A part built from one is then
     refused for an unknown definition. Building from the provided `reg8`
     avoids it.

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
