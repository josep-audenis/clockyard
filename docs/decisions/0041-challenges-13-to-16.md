# 0041. Challenges 13 to 16: a decoder, a shifter, a stack, and a program that draws with `CALL`

- Status: Accepted
- Date: 2026-11-23
- Depends on: ADR 0037 (the Phase 7 plan, increment 4); ADR 0025
  (challenges 1 to 9, built in code); ADR 0034 (bench challenges, runs and
  their reports); ADR 0036 (Reference CPU 2); ADR 0040 (challenge text in
  paragraphs)
- Amends: ADR 0034 item 4, the 1,000-cycle limit on a run (item 7 here)

## Context

ADR 0037 item 2.4 asks for four challenges on what Reference CPU 2 adds
(`docs/reference-cpu-2.md`): a decoder, a shifter, a stack, and a program
that draws with `CALL`. The last needs a bench built around Reference
CPU 2, as challenge 11's is built around the first CPU. Each challenge is
checked by its behaviour, as in ADRs 0025 and 0034. This ADR chooses them.

What exists to build on:

- **Challenges 1 to 9** are components whose bench is built in code: one
  switch per input pin, the definition under test, and one LED per output.
  Their steps set inputs and expect outputs. A clocked challenge toggles
  `clk` in its steps (the README's rule: data changes with `clk` low).
  `scripts/challenges.mjs` writes each file, its solution and its starter.
- **Challenges 10 to 12** run on benches: circuit files in
  `challenges/benches/` with a slot for the part under test. A run is a
  program run on a fresh bench, and its steps can expect bytes in the
  bench's RAM or screen. No run may take more than 1,000 cycles
  (`MAX_RUN_CYCLES`).
- **Reference CPU 2** exists only as a flat example sheet,
  `scripts/reference-cpu-2.mjs`, built from the first CPU's sheet plus its
  additions. Its decoding is a control ROM addressed by the instruction's
  whole high byte. The logic and shift unit is built from gates,
  multiplexers, split and merge. The stack is a 16-byte RAM with a 4-bit
  `SP` register and an adder that gives `SP + 1` or `SP − 1`.
  `crates/sim-core/tests/cpu2.rs` holds that sheet to a model of the
  specification, cycle by cycle.
- **The screen** is 64 × 32 pixels in 256 bytes: eight bytes a row, the
  most significant bit leftmost.

## Decision

1. **The four challenges.**

   | # | Build | Checked by |
   |---|-------|------------|
   | 13 | `decoder`: the high byte of an instruction to one line for each of the sixteen words `0xF0` to `0xFF` | Every one of the 256 bytes |
   | 14 | `shifter`: `SHL` and `SHR` of one byte, with the bit that drops out | Every byte, shifted each way |
   | 15 | `stack`: 16 bytes and a 4-bit pointer, pushed and popped on the clock | Clocked steps: pushes, pops, a wrap past 15, and steps that change nothing |
   | 16 | A program, in the ROM of a component `program`, for Reference CPU 2, that draws with a routine it calls | Runs on a new bench, `cpu2`, by every byte of its screen |

   13 to 15 are components with the bench built in code, as 1 to 9 are.
   Only 16 needs a bench file.

2. **13, the decoder.** Input `hi` (8 bits); output `y` (16 bits). Bit k
   of `y` is 1 when `hi` is `0xF0 + k`, and every bit is 0 otherwise. That
   is the line that picks one of the ten instructions under opcode `0xF`,
   and one line for each of the six reserved words.
   - Allowed parts: gates, split and merge. No ROM: a ROM would be the
     table itself, which is what the CPU's control does and not what the
     challenge teaches.
   - The text says how Reference CPU 2 uses those lines, and that its own
     decoding is a ROM.

3. **14, the shifter.** Inputs `A` (8) and `right` (1); outputs `Y` (8) and
   `C` (1).
   - With `right` 0: `Y` is `A` shifted left one bit, bit 0 becomes 0, and
     `C` is the old bit 7 (`SHL`).
   - With `right` 1: `Y` is `A` shifted right one bit, bit 7 becomes 0, and
     `C` is the old bit 0 (`SHR`).
   - Allowed parts: gates, split and merge. A multiplexer is not provided:
     choosing between two wirings with gates is part of the exercise.

4. **15, the stack.** Inputs `clk`, `push`, `pop` (1 each) and `din` (8);
   outputs `top` (8) and `sp` (4).
   - On a rising edge of `clk`:
     - with `push` 1, `din` is written at `sp`, and `sp` goes up by 1;
     - with `pop` 1, `sp` goes down by 1.
   - `sp` wraps from 15 to 0 and from 0 to 15, as Reference CPU 2's `SP`
     does.
   - There is no reset input. At the start of the check `sp` is 0 and
     every byte is 0, so `top` reads 0.
   - While `push` is 0, `top` is the byte at `sp − 1`: the last byte
     pushed, as `RET` reads it. While `push` is 1, `top` is not checked. A
     stack with one RAM has one address, which a push needs for `sp`.
   - `push` and `pop` are never 1 together; the text says so, and no step
     asks for it.
   - Allowed parts: gates, `dff`, split, merge and `ram`. A 4-bit register
     and a full adder are provided, as challenge 5 provides its full
     adder: `reg4`, built by the same `register()` as the CPUs' registers,
     and `full-adder`.
   - The steps push more than sixteen bytes, so the seventeenth writes
     over the first; pop past empty; hold with neither line; and change
     `din` while `clk` is high during a push, which must change nothing:
     the next step, with `push` at 0, reads `top` to show it.

5. **16, the drawing.** The key holds n, from 1 to 16. The program lights
   the pixels at column 3i, row 2i, for i from 0 to n − 1, then halts.
   The screen starts dark, and every other pixel stays dark.
   - Each pixel lies in a byte of its own, and column 3i passes through
     all eight bit positions (0, 3, 6, 1, 4, 7, 2, 5, then again), so no
     short pattern of masks draws it. A routine that lights one pixel
     from a column and a row, called n times, is the natural program, and
     the text asks for one.
   - **The text** carries what the program needs from its own page:
     Reference CPU 2's eleven added instructions beside the first CPU's
     table, as challenge 11's text carries that table; the screen I/O
     (`SPTR` at `0xFE`, `SDATA` at `0xFD`, `KEY` at `0xFF`); the screen's
     layout (eight bytes a row, the most significant bit leftmost); and
     the run's cycle limit (item 7).
   - **The check cannot see a `CALL`.** It reads the screen and `halt`. A
     program without a routine that draws the same picture passes. That
     is said in the text, as ADR 0034 says what challenge 12's check
     cannot see. Reading the stack would need the check to reach inside
     the provided CPU, a part the user does not build.
   - Runs: the keys 1, 2, 7, 8 and 16. Each expects all 256 screen bytes
     and `halt`, since a picture with one pixel too many must fail.
     Nothing in RAM is compared, as in challenge 11.
   - The expected bytes come from the picture, computed in the script,
     not from a model of the CPU running a program. The reference
     solution passing every run holds the program to the picture.
   - Only a `rom` is allowed in `program`, as in challenge 11.

6. **The `cpu2` bench.** It is challenge 11's bench with Reference CPU 2
   in place of the first CPU: a definition `bench-cpu2`, the second CPU
   cut along its memory boundary with the same pins as `cpu` (ADR 0034
   item 2), its stack inside it. The bench also holds the screen pointer,
   the screen, the key and the `HEX` register, as the other benches do.
   - `scripts/computer.mjs` cuts it from the pieces `reference-cpu-2.mjs`
     uses, which move to a module both import, as ADR 0034 did for the
     first CPU. The example sheet does not change.
   - `cpu2.rs` runs its model against the cut CPU on the bench, as `cpu.rs`
     does for the first.

7. **The run budget.** A routine that lights one pixel, built as the
   example's `plot` in `reference-cpu-2.mjs`, takes about 22 instructions
   and 8 more for each bit it shifts, with about 7 more for the loop that
   calls it. Over column 3i a pixel shifts 3.5 bits on average, so it takes
   about 57 instructions, and n = 16 about 1,800 cycles, past
   `MAX_RUN_CYCLES`.
   - `MAX_RUN_CYCLES` goes from 1,000 to 4,000 for every bench, which
     amends ADR 0034 item 4; step 4 updates `check.rs` and its doc comment.
     A run's limit (below) comes to about 3,700 cycles, under the new cap.
   - **The count.** No JavaScript model of Reference CPU 2 exists, and
     none is added. The reference solution's cycles to halt for each key
     are written by hand in `scripts/challenges.mjs`, and `challenges.rs`
     runs the solution on `cpu2.rs`'s model, moved for that into
     `tests/common/`, and fails if they differ, as
     it holds the words to their source.
   - **The limit a run gives** is twice the reference's count for n = 16,
     rounded up to a hundred, the same for every run. The text states it,
     as challenge 11's says it halts within 900 cycles.
   - Step 4 measures the check's time in the browser and records it. If
     all five runs together take more than a second, the keys are cut
     rather than the budget raised further.

8. **Solutions, starters, tests,** as ADRs 0025 and 0034:
   - **Solutions:** 13 to 15 from gates and the provided parts, written in
     `scripts/challenges.mjs`; 16 a program in assembly beside its words,
     in `scripts/cpu-runs.mjs`, held to `asm::assemble` of its source by
     `challenges.rs`.
   - **Starters:** 13 to 15 the pins and the provided parts; 16 a copy of
     its bench with an empty `program`, an 8-bit switch on `KEY` and the
     screen on the main sheet, so the user can run their program before
     checking it.
   - **Native tests:** every solution passes and every starter fails. For
     each of 13 to 15, circuits with one thing miswired fail: a decoder
     that ignores the high nibble, a shifter whose `C` is the wrong bit, a
     stack whose pointer stops at 15 or that writes at `sp − 1`. For 16, a
     program that lights one pixel too many fails, and one without `CALL`
     that draws the picture passes.
   - **Playwright, the target:** each starter fails and each solution
     passes through the Check button.
   - **The about page's** list of challenges grows from twelve to sixteen.

9. **Order of work.** Each step is one pull request:
   1. Challenges 13 and 14, with their solutions, starters and tests.
   2. Challenge 15.
   3. The `cpu2` bench: the shared module, the cut CPU, and the model test
      against it. No challenge yet.
   4. Challenge 16 and the run budget.
   5. The Playwright target, the about page, the README's table and the
      roadmap.

   *As built (step 1):* the README's table gains each challenge with its
   step, and the Playwright test of each starter and solution grows with
   them. The native tests' projection carries a gate's `inputCount`.

   *As built (step 2):* the stack's solution keeps `sp + 1` and `sp − 1`
   from two chains of full adders at all times, and chooses between them
   with gates. A pointer that stops at 15 is not among its miswired
   stacks, since no one wire makes it; those that fail write at `sp − 1`,
   ignore a pop, count up on a pop, or read `top` at `sp`.

   *As built (step 3):* `scripts/cpu2-pieces.mjs` holds Reference CPU 2's
   control ROM and the parts and wires it adds to the first CPU, which the
   example places in its regions and `computer.mjs` adds to the first CPU's
   cut, below its parts. In the cut the `pc` register is `pcr`, as in `cpu`,
   and the SP LED is left out, since an LED inside a definition is a pin.
   The bench owns `bench-cpu2` and `bench-reg4`; its sheet is the `program`
   bench's with that CPU. `cpu2.rs` holds it to the model over the
   specification's examples and 40 random programs, 128 cycles each.

   *As built (step 4):* challenge 16, `16-drawing`, with five runs, keys 1,
   2, 7, 8 and 16. The reference program's routine, `plot`, shifts the mask
   in a loop of seven instructions a bit, ending in `JNZ`; it takes 1,852
   cycles for 16 pixels, so each run allows 3,800 (`DRAW_CYCLES` in
   `scripts/cpu-runs.mjs`). Its words come from `reference-cpu-2.mjs`'s
   assembler, which `challenges.rs` holds to `crates/asm`. The model moved to
   `tests/common/cpu2.rs`. Each run's second step names no LED to expect:
   `until` already fails it on `halt`, and naming `halt` again repeated the
   mismatch. The check of all five runs took 0.2 s in Playwright's Chromium,
   well under item 7's second, so the keys stay.

## Alternatives considered

- **The decoder as a 4-to-16 line decoder of `which` alone,** or a 3-to-8
  one. It is the textbook part, but it teaches nothing about the second
  CPU, and the enable from the opcode is half the work of decoding an
  instruction.
- **The whole control decoder** of Reference CPU 2, the high byte to its
  control word. That is a 256-entry table: as gates it is long and dull,
  and as a ROM it is data entry.
- **A barrel shifter,** by 0 to 7 bits. A good exercise, but Reference
  CPU 2 shifts one bit, and the challenge would no longer be a piece of
  it.
- **The whole logic unit** (`AND`, `OR`, `XOR`, the shifts and the
  choice among them) in place of the shifter. It is more of the CPU, but
  most of it is three 8-bit gates and multiplexers; the shift and its
  carry are what is new.
- **A stack whose `top` is also checked during a push.** That needs a
  second read address, which the RAM part does not have, or registers in
  place of the RAM. Reference CPU 2 never reads during a `CALL`.
- **Challenge 16 checking the stack,** so a program must call. The
  stack is inside `bench-cpu2`, which the check would have to read by a
  path into an instance. The check stays on what the user built: the
  picture.
- **A full CPU 2 challenge,** building Reference CPU 2 as challenge 10
  builds the first. It would repeat 10 with eleven more rows. The three
  pieces that are new are 13 to 15.
- **Keeping the budget at 1,000** with fewer pixels: n up to 8 fits. But
  then the picture covers a quarter of the screen and the routine is
  barely worth writing; sixteen across it is the picture the routine
  earns.

## Consequences

- The challenge list grows to sixteen. 13 to 15 need no engine change;
  16 needs a bench and a larger run budget.
- Reference CPU 2 exists as two circuits, flat in its example and cut in
  the `cpu2` bench, held to one model, as the first CPU is.
- A bench run can take four times longer than before. Item 7's measure
  says whether that is felt.
- Not decided here: a challenge for the whole of Reference CPU 2;
  challenges beyond 16.
