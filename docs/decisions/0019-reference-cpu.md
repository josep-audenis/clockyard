# 0019. The reference CPU, its assembler and instruction stepping

- Status: Accepted
- Date: 2026-11-08
- Depends on: ADRs 0012 (custom components), 0014 (widths and splitters),
  0017 (clocks, run controls), 0018 (ROM and RAM)

## Context

Phase 4's goal is the project's central promise: a small assembly program runs
on a processor built from Clockyard parts and shows its result on an output
device. The brief asks for:

- a deliberately simple 8-bit architecture: accumulator, program counter,
  instruction register, ALU, control unit, ROM, RAM and an output register;
- an instruction set and encoding designed before implementation;
- an assembly editor and assembler, and program loading;
- register and memory inspection, single-cycle stepping, and breakpoints if
  feasible;
- a clear distinction between a clock cycle and an instruction step;
- instructions checked against an independent reference specification in
  native Rust tests.

The CPU must run through the real netlist. CLAUDE.md forbids a hidden
software CPU, and all simulation semantics live in `sim-core`.

## Decision

1. **The specification is a document:
   [`docs/reference-cpu.md`](../reference-cpu.md).**
   - An 8-bit accumulator machine with a Harvard layout: a program ROM of 256
     × 16-bit words and a data RAM of 256 bytes.
   - One-word instructions: a 4-bit opcode and an 8-bit operand.
   - Thirteen instructions: `NOP LDI LDA STA ADD SUB ADI SBI JMP JZ JC OUT
     HLT`, with zero and carry flags.
   - Two cycles per instruction: fetch, then execute.

   The page is the reference that tests check against. Changing the
   instruction set means changing it first.
2. **Why this shape.**
   - One word per instruction and a combinational ROM (ADR 0018) keep fetch
     to one cycle, so there is no multi-byte operand logic.
   - Two fixed phases make the cycle/instruction distinction visible
     without a micro-sequencer.
   - Separate ROM and RAM address spaces let a program never overwrite
     itself, and avoid a shared bus with tri-state drivers, which the
     engine does not have.
   - 8-bit addresses fit the 8-bit data path: a jump target or RAM address
     is one operand.
   - The flags are only those the jumps need.
3. **The CPU is a circuit, generated from a script.**
   `examples/reference-cpu.clockyard.json` is written by
   `scripts/reference-cpu.mjs` (Node, no dependencies), so it is
   reproducible and reviewable as code. `pnpm verify` runs the script
   with `--check`, which fails if the committed file is not what it
   writes now, for instance after a change to the 8-bit adder example it
   copies.
   - **Built from existing parts only:**
     - D flip-flops and registers;
     - gates;
     - splitters and mergers;
     - the ROM and RAM of ADR 0018;
     - custom components for the repeated pieces: an 8-bit 2-to-1
       multiplexer, a register with load enable, and the 8-bit adder.
   - **Register enable.** `dff` has no enable, so a register with load
     enable gates its `d` and its own `q` with AND and OR gates into the
     flip-flop: `d ∧ en ∨ q ∧ ¬en`. A 1-bit enable reaches every bit of an
     8-bit register through a merger whose fields all come from that one
     net, as the 8-bit multiplexer's select does. There are 8-bit and
     1-bit register components; `IR` is two 8-bit ones, merged into a
     16-bit value for its LED.
   - **The ALU** is an 8-bit adder built from full adders. For `SUB` and
     `SBI`, B passes through XOR with the subtract signal, and the carry in
     is that same signal.
   - **The control unit** is combinational logic. Its inputs are `IR`'s
     opcode, `T`, `H`, `Z` and `C`. It drives:
     - the load enables of `PC`, `IR`, `A`, the flags, `OUT` and `H`;
     - the `PC` source (increment or jump target);
     - the `A` source (operand, RAM or ALU);
     - the ALU's B source (RAM or operand) and its subtract signal;
     - the RAM's `we`.

     As built, the decoding is a **control ROM**: the 4-bit opcode
     addresses a 16 × 12-bit ROM whose word holds these signals, one bit
     each, then AND gates combine them with the phase (`T ∧ ¬H`) and, for the
     jumps, the flags. A ROM is combinational, so this is the decision
     above; the script writes its words from the instruction table.
   - **Constants.** There is no constant part, so the circuit makes 1 and
     0 as XNOR and XOR of the clock with itself, and an 8-bit 0 by merging
     eight copies of that 0. The incrementer adds 0 with a carry in of 1.
   - **On the sheet** the parts are laid out in labelled groups. The output
     register drives an 8-bit LED. The status LEDs "Fetch" (`¬T ∧ ¬H`)
     and "Halted" (`H`) are defined in the specification. Registers are
     instances of a register component, whose values a chip does not
     show, so `PC`, `IR`, `A`, `Z`, `C` and `OUT` each drive an LED on the
     sheet, and register inspection needs nothing new.
4. **The assembler is Rust, in a new crate `crates/asm`.**
   - It has no dependencies and is not part of `sim-core`: it turns text
     into ROM words and simulates nothing.
   - `sim-wasm` exposes `assemble(text)`. It returns `{ words, errors }`,
     each error with a line number and a message.
   - The native tests use the same crate to assemble their programs.
   - The syntax is in the specification page.
5. **Program editor.**
   - A 16-bit ROM's inspector gains an *Assembly* box and an *Assemble*
     button; 16 bits is the reference CPU's instruction width, and a
     narrower ROM could not hold its words. A
     program that assembles is written into the ROM's `data` as one
     undoable edit. That reloads and resets the circuit (ADRs 0017 and
     0018). Errors are listed by line, and the ROM is left unchanged. So is a
     program with more words than the ROM's address bits hold, which says
     so. The listing shows the first 256 words, the assembler's maximum.
   - The source is kept with the ROM as an editor-only prop `source`. It is
     saved in the file but never sent to the engine. It joins format v8
     (ADR 0018 item 8), so there is one bump for both.
   - Editing *Contents* directly still works. The two can then disagree,
     and the inspector says so when the words no longer match the source.
   - The assembler runs in the worker, in the same WebAssembly module as
     the engine: the editor sends `assemble` and `disassemble` requests
     and awaits the reply carrying the same request number.
6. **Instruction step and breakpoints: Run until an LED lights.** The
   engine knows nothing about instructions (ADR 0017 item 1), so stepping
   is defined by the circuit.
   - The toolbar gains *Run until*, a choice of any 1-bit LED on the sheet.
     A run then stops at the first tick after which that LED's net reads 1
     having read 0 just before it, after any switch change since the tick
     before: a rise caused by a tick. An LED lit by a switch during a run
     therefore has to go dark and light again too.
   - `sim-core` gains `tick_until(count, net)`. It stops at that tick, or
     at a tick that does not settle (`unstable`), and reports how many
     ticks ran, so the stop does not depend on how the worker slices the
     run.
   - On the reference CPU:
     - *Run until Fetch* is the instruction step: it stops at the start of
       the next fetch, two cycles on;
     - *Run until Halted* runs a program to its end;
     - a breakpoint is circuit the user adds: compare `PC` with a switch
       and light an LED on equality, then *Run until* it. No comparator
       part or example ships with Phase 4, and none is tested.
   - Being lit is not enough: an LED lit when the run starts must go dark
     and light again. One that never rises runs until paused, like Run. For
     example, *Run until Fetch* on a halted CPU never stops, because Fetch
     stays dark once halted.
   - Fetch rises on a rising clock edge, so *Run until Fetch* stops with
     the clock high. From there, a Step takes 3 ticks (ADR 0017).
   - Step (one cycle) and Run are unchanged.
7. **Memory inspection** is ADR 0018's RAM dump in the inspector. A
   *Disassembly* view of the ROM, listing each word with its address,
   sits under the program editor. It is computed by `crates/asm`, not by the
   engine. A word the assembler would not write (a reserved opcode,
   reserved bits, or an operand on an instruction without one) shows what
   it executes as, with the raw word in a comment (`NOP ; 0xD012`), so the
   listing always assembles to a program that behaves the same.
8. **Tests.**
   - **Reference model.** `crates/sim-core/tests/cpu.rs` holds a model of
     the specification, about 60 lines written from the page alone. It
     lives in test code only, never in the app.
   - **Differential runs.** The tests assemble programs and load the
     example circuit with each program in its ROM. After every cycle they
     compare `PC`, `IR`, `A`, `OUT`, `Z`, `C`, `T`, `H` and the RAM with
     the model. Registers are read from the LEDs on the sheet, so the
     display wiring is checked too, `T` from its flip-flop by elaborated
     ID (`t/r`), and the RAM through `memory()` (ADR 0018). The Fetch LED
     must equal `¬T ∧ ¬H`, and three cycles after `HLT` are checked. The
     programs are:
     - the two examples on the specification page;
     - programs covering every instruction and flag case (carry and
       none, borrow and none, `Z` both ways, jumps taken and not), plus
       reserved opcodes and bits, each required to halt;
     - a `PC` wrap from 255 to 0;
     - 200 random programs from a seeded generator, so the runs are
       repeatable. Each is 256 raw words, so reserved opcodes and bits
       are exercised too; in half of them operands stay within 0-15, so
       loads, stores and jumps meet. Each runs 64 instructions or until
       `H`, so a program that loops forever still ends.
   - **The shipped example.** Its ROM words are its source assembled,
     and it shows 8 after eight steps. `pnpm verify` checks the file is
     what the generator writes.
   - **Run until.** On the CPU, until Fetch and until Halted stop at the
     ticks the specification gives, whatever size of calls the run is
     split into.
   - **Assembler.** `crates/asm` is tested on every syntax rule and error.
   - **Playwright**, on the example:
     - *Run until Fetch* twice stops at cycles 2 and 4, and *Run until
       Halted* runs the shipped program to an output of 8;
     - the program editor: an error listed by line with the ROM
       unchanged, `LDI 7 / ADI 2 / OUT / HLT` assembled, undo, the note
       for words edited directly, and a run to an output of 9;
     - the Phase 4 demo: a program summing 1 to 5 through RAM, typed and
       assembled; one instruction step is two cycles (PC 1, IR `LDI 0`);
       run until Halted, the output shows 15.
9. **Order of work.**
   1. ROM and RAM (ADR 0018).
   2. `crates/asm` and its tests.
   3. The generated CPU circuit and the differential tests.
   4. `tick_until` and *Run until*.
   5. The program editor and disassembly.
   6. Playwright and docs.

   Each step is a pull request that leaves the editor working.

## Alternatives considered

- **A von Neumann machine with one memory.** It would need bus arbitration
  (tri-state or wide multiplexers) and multi-cycle operand fetch. It is
  closer to classic designs (SAP-1, 6502) but needs more parts, and the
  engine has no tri-state yet.
- **4-bit operands and 16 bytes of memory (SAP-1 style).** It is smaller
  still, but programs barely fit, and `LDI` could not load a full byte.
- **A software CPU model in the app for stepping or inspection.** The brief
  rules it out. The model exists only in tests, as the independent
  reference.
- **The assembler in TypeScript.** The native tests need it too.
  Duplicating it would let the two disagree. One Rust crate serves both
  through `sim-wasm`.
- **Engine-level instruction stepping** (a CPU-aware "step instruction").
  It would put CPU knowledge in the engine. *Run until an LED* stays
  generic and also gives breakpoints and run-to-halt.
- **Building the CPU by hand in the editor.** That is possible and a good
  demo of the editor, but a generated file can be regenerated, diffed and
  kept in step with the specification. A hand-built variant can come later
  as a tutorial.

## Consequences

- The Phase 4 demo is reachable with two new kinds (ROM, RAM), one crate,
  one engine call (`tick_until`) and UI.
- The CPU is large: hundreds of primitives across instances, well inside
  the engine's limits. Measured when step 3 landed: it keeps up with the
  top speed, about 9,950 cycles per second at the 10,000 setting.
- Every program change resets the CPU. That is fine for loading programs;
  editing a program while it runs is not offered.
- The specification is small by design. Larger instruction sets, a stack,
  interrupts and memory-mapped devices are Phase 5 material, and each needs
  its own change to the specification and an ADR.
