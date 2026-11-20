# 0034. Challenges 10 to 12: a CPU, a program and a screen, checked on a computer bench

- Status: Proposed
- Date: 2026-11-20
- Depends on: ADR 0028 (Phase 6 plan, increment 4; its target is amended
  here); ADR 0025 (challenges, whose item 7 left these three for this ADR);
  ADR 0019 (the reference CPU and its assembler); ADR 0022 (memory-mapped
  I/O); ADR 0018 (ROM and RAM)

## Context

Challenges 1 to 9 are built (ADR 0025). Each is a custom component to
build, checked by `sim_core::check` on a bench of one switch per input
pin, one instance, and one LED per output pin. A step sets inputs together,
settles, and compares outputs. A clock is an input pin toggled by steps.

The brief's last three are "Build a basic programmable CPU", "Run a small
program" and "Connect a visual output device". ADR 0025 sketched their
bench: the same bench with a ROM and RAM of its own, wired to the CPU's
address and data pins, so a check runs test programs. ADR 0028 made them
Phase 6's fourth increment, with the target "the reference CPU, as a
solution, passes all three".

What exists to build on:

- **The reference CPU** (`docs/reference-cpu.md`, ADR 0019) is Harvard: a
  16-bit program ROM addressed by `PC`, and a data RAM of 256 bytes whose
  top sixteen addresses, `0xF0` to `0xFF`, reach devices (ADR 0022). Each
  instruction takes two cycles, and every register changes on a rising
  edge. Its example sheet (`scripts/reference-cpu.mjs`) holds the ROM, the
  RAM, the I/O decoding and the devices on the same sheet as the CPU.
- **The assembler** (`crates/asm`, ADR 0019) turns the reference CPU's
  assembly into ROM words. The editor's program editor uses it.
- **The check** needs a fresh bench per run, data-only steps, and a
  bounded run.

Three questions decide the design: where the CPU's edge is, so a bench can
hold the memories and devices; what a step can do beyond setting pins; and
what each challenge asks the user to build.

## Decision

1. **The three challenges.**

   | # | Build | Checked by |
   |---|-------|------------|
   | 10 | A CPU (`cpu`) that runs the reference CPU's instruction set | Test programs on the bench: values left in RAM, in `OUT`, and `halt` |
   | 11 | A program, in the ROM of a component (`program`), for the reference CPU | The bench runs the provided CPU on it, with different keys held |
   | 12 | A screen interface (`display`): an `SPTR` register and a screen, written by `STA` | A drawing program on the provided CPU; the screen's bytes afterwards |

   - Challenge 10 is the hardware: the user builds the reference CPU from
     the parts of challenges 1 to 9 (registers, an ALU, multiplexers). Its
     text points to `docs/reference-cpu.md`. Allowed parts: gates, `dff`,
     split, merge, and a `rom` (the instruction decoder, as the reference
     CPU's control ROM). The ALU and registers of challenges 7 and 9 are
     provided.
   - Challenge 11 is software: write a program for the reference CPU, in
     the program editor. Its task: hold a number `n` on the keyboard (1 to
     22), and the program shows `1 + 2 + … + n` with `OUT`, then halts.
     That needs a loop, a load, an addition and a conditional jump.
   - Challenge 12 is a device: given the CPU, connect a screen. The
     component sees the CPU's data bus and stores what `STA 0xFE` and
     `STA 0xFD` write, as `docs/reference-cpu.md` specifies `SPTR` and
     `SDATA`.
   - This amends ADR 0028's target. The reference CPU is the solution to
     10, and its pieces are the solutions to 11 (a program for it) and 12
     (its screen interface). Asking all three for the same CPU would
     repeat challenge 10, and miss the brief's program and output device.

2. **The CPU's interface.** Challenge 10's `cpu` has these pins, and the
   reference CPU is cut along them:

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

   - The memories and devices are the bench's, so the CPU has none. A
     store is `we` with `addr` and `dout` steady while `clk` rises.
   - Reset is a fresh bench: everything starts at 0, as the reference
     CPU's reset specifies.
   - `scripts/reference-cpu.mjs` builds the CPU as a `cpu` definition with
     these pins, and the example sheet places it with its ROM, RAM and
     devices around it. The example then shows the same cut the challenges
     use. Behaviour is unchanged, and the example's native tests still
     pass.

3. **Benches are circuit files.** The challenges of ADR 0025 are checked
   on a bench `check` builds in code. These three need a ROM, a RAM, a
   keyboard switch, address decoding and devices round the part under test.
   That is a circuit, so it is written as one.
   - `challenges/benches/computer.clockyard.json` holds the bench:
     - a program ROM (256 × 16) addressed by `pc`;
     - a data RAM (256 × 8);
     - a `key` switch read at `0xFF`, as `KEY` is;
     - the decoding that sends `0xF0` to `0xFF` to devices, not RAM;
     - a clock switch `clk`;
     - an LED on each of `out` and `halt`;
     - a `cpu` instance in the middle.
   - Challenge 12's bench also places a `display` instance on the data
     bus.
   - `scripts/challenges.mjs` writes the benches from the same pieces as
     `scripts/reference-cpu.mjs`, and `--check` keeps them current.
   - `check` loads the bench, gives it the user's definitions (the one
     under test and those it uses, as now), and puts the challenge's
     program into the bench ROM. For challenge 11 the user's `program`
     component takes the bench ROM's place instead.
   - The bench is a fresh `Simulator`, as every check is.

4. **Steps that run a program.** A challenge with a bench uses these step
   fields, all data:
   - `set`: switches, as now. Here that is `key`.
   - `cycles: n`: n clock cycles, each the clock switch set to 1, then
     to 0.
   - `until: "halt"` with `cycles: n`: run until `halt` reads 1, at most n
     cycles. Not halting in time fails the step, which says so.
   - `expect`: output pins, as now (`out`, `halt`).
   - `memory`: bytes to compare, by part and address, such as
     `{ "ram": { "16": 42 } }` or `{ "display/screen": { "0": 255 } }`.
     `Simulator::memory` reads them, by the elaborated ID the challenge
     names.

   A failed step reports what it read, as now. For memory that is "RAM
   byte 16 should be 42 but is 0". A run is bounded by its `cycles`, and a
   loop that does not settle is still `Unstable`, so a check always ends.

5. **Programs are data.** A challenge's test programs are ROM words, as
   steps are expected values, never computed by the editor.
   - Each sits next to its assembly source, in the challenge file.
   - `scripts/challenges.mjs --check` assembles the source with the same
     assembler (`crates/asm` through `sim-wasm`) and fails if the words
     differ.
   - Challenge 10 has several programs, each on a fresh bench:
     - loads, `OUT` and `HLT`;
     - additions and subtractions with their flags;
     - stores and loads through RAM;
     - jumps (`JMP`, `JZ`, `JC`) in a loop.

     A failure names the program as well as the step.

6. **Solutions, starters and tests**, as ADR 0025 item 4:
   - The solutions are:
     - 10: the reference CPU's `cpu`;
     - 11: a program in a `program` component's ROM;
     - 12: the reference CPU's screen interface as `display`.
   - The starters keep the pins and the provided parts:
     - 10: the ALU and the register;
     - 11: nothing to build but the ROM's contents;
     - 12: the screen part itself, so its ID is fixed.
   - Native tests: every solution passes, every starter fails, and a CPU
     that never halts fails by its cycle budget.
   - Playwright, the target: the reference CPU, opened as challenge 10's
     solution, passes all its programs through the Check button.
   - Each of 11's and 12's solutions passes too.

7. **In the editor.** The challenge panel shows the new failures in words
   ("Program 3, step 2: RAM byte 16 should be 42 but is 0"). Nothing else
   changes: the challenge list, the starter, the Check button and progress
   (ADR 0029) work as for 1 to 9.

8. **Order of work.** Each step is one pull request:
   1. The CPU cut along its interface, in `scripts/reference-cpu.mjs`,
      with the examples regenerated and their tests unchanged.
   2. The engine: benches as files, the new step fields, memory
      expectations and their reports, with native tests.
   3. Challenge 10, with its programs, solution, starter and tests.
   4. Challenges 11 and 12.
   5. The editor's reports, the Playwright target, and the docs.

## Alternatives considered

- **Benches built in code.** That is how challenges 1 to 9 are built, and
  it needs no new file. But a ROM, a RAM, I/O decoding and devices are a
  circuit. In code they would be a second, hand-written copy of what
  `scripts/reference-cpu.mjs` builds, and nobody could open one to look at
  it.
- **The CPU with its memories inside**, as the example sheet has it. The
  bench would then reach in to load a program and read RAM. A program
  could not be swapped without editing the user's circuit, and challenge
  11 could not supply the ROM.
- **All three for the same CPU, in stages** (ADR 0028's wording: ALU
  instructions, then jumps, then I/O). Each stage would be a CPU again.
  Nothing would ask for a program or a device, which are the brief's 11
  and 12.
- **A clock part on the bench.** ADR 0025 rejected it: a switch toggled
  by steps does the same, and the result does not depend on speed.
- **Challenge 11 as text: assembly checked by the engine running a model
  CPU.** That would be a software CPU, which CLAUDE.md forbids. Here the
  program runs on the reference CPU's gates.
- **Computing expected values from the programs.** It would save writing
  them out, but a mistake in the model would pass every wrong CPU. They
  are written out, and the reference CPU's passing is the check on them.

## Consequences

- The example sheets change shape: the CPU becomes one part, `cpu`, with
  its ROM, RAM and devices around it. That is the cut the challenges use.
  It also makes the second reference CPU (increment 6) a new `cpu`
  definition rather than a new sheet.
- `check` grows a second kind of bench. Challenges 1 to 9 are unaffected.
- A challenge file can hold programs. The assembler must keep assembling
  them to the same words, which `--check` enforces.
- Challenge 10 is long: a CPU from the earlier parts is hours of work.
  Its text points to the specification, and its starter provides the ALU
  and register, so it is building, not rediscovering.
- Not decided here: challenges beyond 12, progress shown per program, and
  a keyboard that can hold a key part-way through a run.
