# 0036. A second reference CPU: bit operations, shifts, and call and return

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
- **No call.** The code that draws the paddle is written out three times.
  Snake was turned down for that reason: its drawing code, repeated, did
  not fit the 256-word ROM.

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
- **Speed.** The first CPU's sheet is 81 parts and five components, and
  runs at the editor's 10,000 cycles per second setting. A circuit with a
  tri-state buffer runs on the engine's slower path (ADR 0035).
- **No reset values.** Every register starts at 0; nothing gives one
  another start value.

## Decision

1. **A second CPU beside the first, not in place of it.** The first keeps
   its specification, its examples and its challenges, unchanged. The
   second has its own specification, `docs/reference-cpu-2.md`, its own
   generated example, and its own tests. It is called **Reference CPU 2**.

2. **A superset.** Reference CPU 2 runs every instruction of the first as
   the first does, with the same encoding, timing, flags, I/O and status
   outputs. `docs/reference-cpu-2.md` says so in one line and gives only
   what is added. One difference: on the first CPU opcode `0xF` does
   nothing; on the second it is the new instructions.

3. **Ten new instructions, under opcode `0xF`.** Bits 11–8, reserved until
   now, choose among them. `0xD` and `0xE` stay reserved.

   | Word | Mnemonic | Effect | Z | C |
   |------|----------|--------|---|---|
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
   - Nothing else is added: no compare, no `JNZ`, no rotate, no index
     register, no indirect addressing. Catch 2 (item 7) is written without
     them; the screen is already reached through `SPTR`.

4. **A return stack of its own.** Sixteen bytes, apart from the data RAM,
   with a 4-bit pointer `SP`. It holds return addresses only.
   - `CALL n`: `STACK[SP] ← PC`, `SP ← SP + 1`, `PC ← n`. The `PC` pushed
     is the address after the `CALL`, which the fetch has already left
     there.
   - `RET`: `SP ← SP − 1`, `PC ←` the byte `STACK` held at the new `SP`.
   - `SP` wraps. A seventeenth nested call writes over the oldest return
     address; a `RET` with nothing pushed takes whatever the stack holds
     there, 0 after reset. Neither is detected.
   - Reset: `SP` and every stack byte are 0.
   - Both instructions take the one execute cycle every instruction takes,
     so "after `2k` cycles, `k` instructions have executed" still holds.

5. **One assembly language.** `crates/asm` learns the ten mnemonics, and
   the disassembler their words. The editor keeps offering the one
   assembler for any 16-bit ROM. A program that uses them on the first
   CPU assembles, and those instructions do nothing there, as
   `docs/reference-cpu.md` already says of opcode `0xF`. Both
   specification pages say so, and so does the editor's hint under the
   program. A word the first CPU ignores is still disassembled as what
   the second CPU executes.

6. **The circuit,** `examples/reference-cpu-2.clockyard.json`, generated
   by a script from the shared pieces, as the first is.
   - **Multiplexers, not buses.** ADR 0028 allowed four-state buses here
     if they helped. They would put the whole CPU on the engine's
     two-word path, about a third slower (ADR 0035), and the game has to
     play at the 10,000 setting. So it has no tri-state buffer.
   - **The ALU** gains a bitwise unit and the two shifts, which are wiring
     through a splitter and a merger, and a wider result multiplexer.
   - **The stack** is a 16-byte RAM part, a 4-bit pointer register and an
     adder that gives `SP + 1` and `SP − 1`.
   - **Decoding** the ten instructions is a second control ROM addressed
     by bits 11–8, chosen when the opcode is `0xF`.
   - **Speed.** It must run at the editor's 10,000 setting: at least
     9,000 cycles per second measured there, as the first CPU's 9,950 was
     (ADR 0019). If it does not, the step is not merged until it does.

7. **Catch 2,** the target. A version of Catch on Reference CPU 2, in its
   own example, with its rules written in `docs/reference-cpu-2.md`
   before its program, as Catch's were.
   - **Single pixels.** The paddle is 8 pixels wide and moves one pixel at
     a time across the 64 columns. A block is 2 pixels by 2 and falls in
     any column.
   - **Shared drawing code.** One routine toggles the pixel at a column
     and row held in two RAM bytes: it works out the screen byte and the
     bit, and writes `SDATA xor` the bit. Every pixel the game draws or
     erases goes through it, by `CALL`, from at least three places.
   - **Play** stays Catch's: a block caught scores on `HEX` and the next
     falls faster; a miss halts; Reset plays again. The program fits the
     256-word ROM and plays at the 10,000 setting.
   - The first Catch stays as it is.

8. **Tests,** as for the first CPU (ADR 0019):
   - A model of Reference CPU 2 written from its specification, in the
     native tests. The first CPU's model is not changed.
   - Programs run on the circuit and the model together and are compared
     after every cycle: every register, `SP`, the stack, RAM and devices.
     Among them, each new instruction with both flag outcomes, nested
     calls sixteen and seventeen deep, a `RET` with nothing pushed, and
     the first CPU's own test programs, unchanged.
   - Catch 2 on both, with keys scripted cycle by cycle.
   - Playwright: the example runs a program that uses a call and a bit
     operation; Catch 2 scores with the paddle moved by one pixel.

9. **Order of work.** Each step is one pull request:
   1. `docs/reference-cpu-2.md`: the instruction set, the stack and the
      timing, marked as designed and not yet built.
   2. The assembler and the model: `crates/asm`, `sim-wasm`, the editor's
      hint, and the model with tests of its own against programs worked
      out by hand. No circuit yet.
   3. The circuit and its example, held to the model, with its speed
      measured.
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
  Ten do not fit in three. One opcode with a second field does, and
  leaves two opcodes free.
- **The stack in the data RAM,** with a full stack pointer. It is what
  most real CPUs do, and it would allow `PSH` and `POP`. But every
  register starts at 0, so the pointer would start at address 0 and grow
  into the program's variables or wrap into the devices, unless the
  program set it first; and the data RAM's address and data would each
  need another source. A stack of its own touches nothing the first CPU
  has.
- **A link register,** one return address and no stack. Less to build,
  and enough for Catch 2. A routine could then not call another, which is
  the first thing a learner tries.
- **`PSH` and `POP`.** Useful for saving `A`. The target does not need
  them; they can be added under `0xFA` and `0xFB` when something does.
- **Indirect or indexed addressing,** which ADR 0023 also listed. A read
  through a pointer held in RAM is two RAM reads, so a third clock cycle
  or a second address register: a larger change than the two ADR 0028
  asked for. A table lookup can be a chain of compares meanwhile.
- **A shift by several bits.** A barrel shifter is eight multiplexers
  deep in parts, and the pixel routine shifts at most seven times.
- **Tri-state buses inside the CPU.** See item 6.

## Consequences

- There are two CPU specifications to keep. The second is short, since
  it only adds.
- One assembler serves both, so a program can use an instruction its CPU
  ignores. The hint says so; the first CPU's challenges list the
  instructions they allow in their text.
- The stack is small and unchecked. A program that nests seventeen calls
  or returns too often goes wrong silently, as it would on real hardware.
- Reference CPU 2 is larger than the first: more parts on a sheet that is
  already dense (a rough edge on the roadmap). Item 6 holds its speed.
- Snake, Breakout and other games that ADR 0023 turned down become
  possible. None is planned here.
- Not done here: indirect addressing, `PSH` and `POP`, a compare, several
  clocks, interrupts.
