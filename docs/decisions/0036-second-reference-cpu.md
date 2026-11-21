# 0036. A second reference CPU: bit operations, shifts, a jump, and call and return

- Status: Proposed
- Date: 2026-11-21
- Depends on: ADR 0028 (Phase 6 plan, increment 6); ADR 0019 (the
  reference CPU and its assembler); ADR 0022 (memory-mapped I/O); ADR 0023
  (Catch, and what it showed to be missing); ADR 0020 item 3 (an
  instruction set changes in its specification first); ADR 0034
  (challenges 10 to 12, which use the first CPU); ADR 0035 (four-state
  signals)

## Context

The reference CPU (`docs/reference-cpu.md`) has thirteen instructions: load
and store, add and subtract, three jumps, `OUT`, `HLT` and `NOP`. Catch
(ADR 0023) was written for it and showed two things missing:

- **No bit operations.** A program can only write whole bytes. A screen
  byte is 8 pixels wide, so Catch's blocks and paddle are byte-wide bars
  that move a whole byte sideways. No `AND`, `OR` or shift.
- **No call.** The code that writes the paddle's byte is written out
  three times, and a fourth at the start. Snake was turned down partly
  for that: its drawing code, repeated, came near the 256-word ROM.

ADR 0023 left both for "a later richer-CPU ADR", and ADR 0028 made that
Phase 6's last increment: the specification changes first, then its
tests, then the circuit. Its target: a version of Catch that draws single
pixels and shares its drawing code.

What there is to build on:

- **The instruction word** is 16 bits: opcode in bits 15–12, bits 11–8
  reserved (the assembler writes 0, the CPU ignores them), operand in bits
  7–0. Opcodes `0xD`–`0xF` are reserved and do nothing.
- **The first CPU is used.** Challenges 10 to 12 check a CPU, a program
  and a screen interface against its specification, and one of challenge
  10's runs checks that the reserved opcodes do nothing. Its examples,
  the benches and the benchmarks are generated from shared pieces
  (`scripts/cpu-pieces.mjs`).
- **How it is held to its specification.** Native tests run the same
  programs on the circuit and on a model written from the specification,
  and compare them after every clock cycle.
- **The assembler** (`crates/asm`) knows one instruction set. The editor
  offers it for any 16-bit ROM.
- **Speed.** The first CPU's sheet is 81 parts and five components. It
  runs at the editor's 10,000 cycles per second setting with room to
  spare: natively Catch runs at 115,000 to 133,000 cycles per second
  (`docs/performance.md`). A circuit with a tri-state buffer runs on the
  engine's slower path, about a third slower (ADR 0035).
- **No reset values.** Every register starts at 0; nothing gives one
  another start value.

## Decision

1. **A second CPU beside the first, not in place of it.** The first keeps
   its behaviour, its examples and its challenges, unchanged. The second
   has its own specification, `docs/reference-cpu-2.md`, its own generated
   example, and its own tests. It is called **Reference CPU 2**.

   ADR 0028 item 2.6 said the specification would change in
   `docs/reference-cpu.md`. This ADR amends that: the new instructions get
   a page of their own, and the first page gains only a pointer to it and
   one sentence (item 5).

2. **A superset.** Reference CPU 2 runs every instruction of the first as
   the first does, with the same encoding, timing, flags, I/O and status
   outputs. `docs/reference-cpu-2.md` says so in one line and gives only
   what is added. One difference: on the first CPU opcodes `0xD` and `0xF`
   do nothing; on the second they are the new instructions. So Reference
   CPU 2 is not a solution to challenge 10, whose runs check that those
   opcodes do nothing.

3. **Eleven new instructions.** One takes opcode `0xD`. Ten are under
   opcode `0xF`, where bits 11–8, reserved until now, choose among them.
   `0xE` stays reserved.

   | Word | Mnemonic | Effect | Z | C |
   |------|----------|--------|---|---|
   | `0xD0nn` | `JNZ n` | if not `Z`: `PC ← n` | – | – |
   | `0xF0nn` | `AND n` | `A ← A and RAM[n]` | set | – |
   | `0xF1nn` | `OR n` | `A ← A or RAM[n]` | set | – |
   | `0xF2nn` | `XOR n` | `A ← A xor RAM[n]` | set | – |
   | `0xF3nn` | `ANI n` | `A ← A and n` | set | – |
   | `0xF4nn` | `ORI n` | `A ← A or n` | set | – |
   | `0xF5nn` | `XRI n` | `A ← A xor n` | set | – |
   | `0xF600` | `SHL` | `A ← A` shifted left one bit, a 0 in at bit 0 | set | old bit 7 |
   | `0xF700` | `SHR` | `A ← A` shifted right one bit, a 0 in at bit 7 | set | old bit 0 |
   | `0xF8nn` | `CALL n` | push `PC`, then `PC ← n` | – | – |
   | `0xF900` | `RET` | pop into `PC` | – | – |
   | `0xFA`–`0xFF` | (reserved) | nothing | – | – |

   - `AND`, `OR` and `XOR` read `RAM[n]` as `ADD` does, devices included,
     so a program can combine a mask with the screen byte at `SDATA`.
   - A shift moves one bit. A program shifts further by repeating it.
     "Set" is from the new `A`, as everywhere.
   - `SHL`, `SHR` and `RET` take no operand. The assembler writes 0, and
     the CPU ignores bits 7–0 of their words, as it does for `OUT`. For
     `JNZ`, bits 11–8 are ignored, as for every instruction of the first
     CPU.
   - `JNZ` is there because every loop on the first CPU ends in `JZ out`
     and `JMP loop`: one word and two cycles a round, which the game's
     wait loop and its drawing loops would each pay. It costs one control
     bit. `Z` is 0 after reset, though `A` is 0, so a `JNZ` that comes
     first is taken.
   - Nothing else is added: no compare, no rotate, no index register, no
     indirect addressing. Catch 2 (item 7) is written without them; the
     screen is already reached through `SPTR`.

4. **A return stack of its own.** Sixteen bytes, apart from the data RAM,
   with a 4-bit pointer `SP`. It holds return addresses only.
   - `CALL n`: `STACK[SP] ← PC`, with `SP` as it was before the
     instruction; then `SP ← SP + 1` and `PC ← n`. The `PC` pushed is the
     address after the `CALL`, which the fetch has already left there. A
     `CALL` at address 255 pushes 0.
   - `RET`: `SP ← SP − 1`, `PC ←` the byte `STACK` held at the new `SP`.
   - `A`, `Z` and `C` pass through both untouched, so a routine can take
     a value in `A` and give an answer back in `A` or in a flag.
   - `SP` wraps. A seventeenth nested call writes over the oldest return
     address. A `RET` with nothing pushed leaves `SP` at 15 and jumps to
     what `STACK[15]` holds, 0 after reset. Neither is detected.
   - Reset: `SP` and every stack byte are 0. A halted CPU keeps both.
   - Both instructions take the one execute cycle every instruction takes,
     so "after `2k` cycles, `k` instructions have executed" still holds.

5. **One assembly language.** `crates/asm` learns the eleven mnemonics,
   and the disassembler their words. The editor keeps offering the one
   assembler for any 16-bit ROM: it cannot know which CPU a ROM feeds.
   - A program that uses the new instructions on the first CPU assembles,
     and they do nothing there, as `docs/reference-cpu.md` already says of
     opcodes `0xD` and `0xF`. Both specification pages say so.
   - **The editor says so when it happens.** After Assemble, the status
     under the program counts them: "Assembled 40 words; 3 are
     instructions only Reference CPU 2 runs." A note, not an error. The
     hint that stands there before is replaced by that status, so the hint
     alone would not be seen.
   - **Disassembly.** A word of the eleven is shown as its instruction,
     whichever CPU the ROM feeds. It is shown alone when the assembler
     would write that word; otherwise with the raw word in a comment, as
     now: `SHL ; 0xF612`, and `NOP` with the raw word for `0xE` and
     `0xFA`–`0xFF`.
     Disassembled text still assembles to a program that behaves the same,
     on either CPU.

6. **The circuit,** `examples/reference-cpu-2.clockyard.json`, generated
   by a script from the shared pieces, as the first is.
   - **Multiplexers, not buses.** ADR 0028 allowed four-state buses here
     if they helped. They do not: the shared pieces are built on
     multiplexers, one accumulator gives a bus little to share, and a
     sheet with no buffer has no `X` or `Z` to explain. Speed is not the
     reason; even a third slower would leave several times the 10,000
     setting.
   - **The ALU** gains a bitwise unit and the two shifts, which are wiring
     through a splitter and a merger, a wider result multiplexer, and a
     second source for `C` (the bit a shift moves out).
   - **The stack** is a 16-byte RAM part (`ram`, 4 address bits) and a
     4-bit pointer register. One adder gives `SP + 1` or `SP − 1`, by
     adding 1 or 15. The stack's address is `SP` for a `CALL` and the
     adder's output for a `RET`, which it must be before the clock edge,
     since a RAM reads at once and writes at the edge. The `PC` gains the
     stack's output as a third source.
   - **Decoding.** `JNZ` is one more bit in the first control ROM's words.
     The ten are a second control ROM addressed by bits 11–8, whose
     outputs count only when the opcode is `0xF`; what detects that, and
     how the two ROMs' outputs are joined, is the step's to choose.
   - **Speed** is recorded, not gated on a number the benchmarks' noise
     would decide. In one browser session, the first CPU's example and
     the second's are run in turn at the 10,000 setting, several times
     each, and the second must reach at least 95% of the first's median.
     Its native cycles per second go in `docs/performance.md` beside the
     first's, which is the figure that shows what the additions cost.

7. **Catch 2,** the target. A version of Catch on Reference CPU 2, in its
   own example, with its rules written in `docs/reference-cpu-2.md`
   before its program, as Catch's were.
   - **Single pixels.** The paddle is 8 pixels wide and moves one pixel at
     a time across the 64 columns. A block is 2 pixels by 2 and falls in
     any column from 0 to 62.
   - **Shared drawing code.** One routine toggles the pixel at a column
     and row held in two RAM bytes: it works out the screen byte and the
     bit, and writes `SDATA xor` the bit. Every pixel the game draws or
     erases goes through it, by `CALL`, from at least three places. A
     routine that calls another is expected (finding the byte is shared by
     toggling a pixel and by testing one).
   - **Even pace.** The routine takes the same time, within a few
     cycles, whatever the column: it builds the bit from the column's low
     three bits one at a time (shift by 4, by 2, by 1), not in a loop
     whose length is the column. Otherwise blocks would fall up to twice
     as fast on one side of a byte as on the other.
   - **Within reach.** The keys are read, and the paddle moved, twice for
     each row a block falls. A block falls about 30 rows, so the paddle
     can cross the whole screen while it does.
   - **Budget.** One row of fall, with its two paddle moves, is at most
     1,000 cycles before any waiting, about what a step of Catch takes at
     its start. The rules in the specification give the starting pace and
     how far a catch speeds it up, from the cycles the written program
     takes. The paper sketch puts a row near 900 cycles, so the game
     starts slower than Catch, for a catch to have something to take
     off.
   - **Play** stays Catch's: a block caught scores on `HEX` and the next
     falls faster; a miss halts; Reset plays again. The program fits the
     256-word ROM. A sketch of it on paper came to about 155 words, with
     a toggle routine of some 45 instructions.
   - The first Catch stays as it is.

8. **Tests,** as for the first CPU (ADR 0019):
   - A model of Reference CPU 2 written from its specification, in the
     native tests. The first CPU's model is not changed.
   - Programs run on the circuit and the model together and are compared
     after every cycle: every register, `SP`, the stack, RAM and devices.
     Among them:
     - each of the eight ALU instructions with both outcomes of each flag
       it sets, and `JNZ` taken and not;
     - `CALL` and `RET` keeping `A`, `Z` and `C`; calls nested sixteen and
       seventeen deep; a `RET` with nothing pushed; a `CALL` at address
       255; a `CALL` to itself; `HLT` inside a routine;
     - words the assembler would not write: `0xF6nn`, `0xF7nn` and
       `0xF9nn` with an operand, `0xE` and `0xFA`–`0xFF`;
     - the first CPU's test programs, the random ones too, against the
       second model. Their `0xD` and `0xF` words now do something, so a
       program whose asserted result relied on those doing nothing is
       replaced for this CPU.
   - Catch 2 on both, with keys scripted cycle by cycle.
   - Playwright: the example runs a program that uses a call and a bit
     operation (step 3); Catch 2 scores with the paddle moved by one
     pixel (step 4).

9. **Order of work.** Each step is one pull request:
   1. `docs/reference-cpu-2.md`: the instruction set, the stack and the
      timing, marked as designed and not yet built.
   2. The assembler and the model: `crates/asm`, `sim-wasm`, the editor's
      status after Assemble, and the model with tests of its own against
      programs worked out by hand. No circuit yet, so until step 3 the
      status says the instructions are for a CPU that is designed and not
      yet built. Comments that say the reserved opcodes have no name
      (`scripts/cpu-runs.mjs`, the disassembler's own) are corrected.
   3. The circuit and its example, held to the model, with its speed
      recorded and the example's Playwright test.
   4. Catch 2: its rules in the specification, its program, its example,
      its tests and the Playwright target. Then the docs and the roadmap.

## Alternatives considered

- **Change the first CPU.** One CPU is simpler to explain. But challenge
  10 teaches building that CPU from its specification, with a run that
  checks opcode `0xF` does nothing, and a learner's solution must keep
  passing. The first CPU is also the smaller thing to read first.
- **A new instruction set, not a superset.** A cleaner encoding is
  possible, for instance a register file. It would need a second
  assembler, a second language in the editor, and Catch rewritten before
  it could be extended. ADR 0028 asked for two additions, and the
  reserved bits were left for exactly this.
- **Opcodes `0xD`, `0xE` and `0xF` for three of the new instructions.**
  Eleven do not fit in three. One opcode with a second field holds ten,
  `JNZ` sits with the other jumps, and one opcode is left free.
- **No `JNZ`.** ADR 0028 asked for bit operations and a call. But it is
  the cheapest thing the first CPU lacks, and the target's inner loops
  would each pay for its absence.
- **The stack in the data RAM,** at `0xE0`–`0xEF` with the same 4-bit
  pointer. It is what most real CPUs do. But the data RAM's address and
  its data in each have one source today, and each would need a second,
  on the path every instruction's read takes; and a program could write
  over its own return addresses. A stack of its own touches nothing the
  first CPU has.
- **A link register,** one return address and no stack. Less to build,
  and enough for Catch 2. A routine could then not call another, which is
  the first thing a learner tries.
- **`PSH` and `POP`.** Useful for saving `A`. The target does not need
  them. They can be added under `0xFA` and `0xFB` when something does,
  with a second source for the stack's data and for `A`.
- **Indirect or indexed addressing,** which ADR 0023 also listed. A read
  through a pointer held in RAM is two RAM reads, so a third clock cycle
  or a second address register: a larger change than the two ADR 0028
  asked for. A table lookup can be a chain of compares meanwhile.
- **A shift by several bits.** A shifter by 0 to 7 is three stages of
  multiplexers each way. In software, shifting by a column's low three
  bits one at a time is about 21 instructions, which the budget of item 7
  affords.
- **Tri-state buses inside the CPU.** See item 6.

## Consequences

- There are two CPU specifications to keep. The second is short, since
  it only adds.
- One assembler serves both, so a program can use an instruction its CPU
  ignores. The status after Assemble says so, and the first CPU's
  challenges list the instructions they allow in their text.
- Reference CPU 2 does not pass challenge 10, by design (item 2).
- The stack is small and unchecked. A program that nests seventeen calls
  or returns too often goes wrong silently, as it would on real hardware.
- Reference CPU 2 is larger than the first: more parts on a sheet that is
  already dense (a rough edge on the roadmap). Item 6 holds its speed.
- Snake, Breakout and the other games ADR 0023 turned down are no longer
  blocked by missing bit operations and calls. Whether they fit is not
  shown here, and none is planned.
- Not done here: indirect addressing, `PSH` and `POP`, a compare, several
  clocks, interrupts.
