# Reference CPU 2: specification

Status: **designed, not built** (ADR 0036, accepted). Nothing on this page
runs yet: the assembler and the model follow, then the circuit.
Change this page first to change the instruction set.

Reference CPU 2 is the [reference CPU](reference-cpu.md) with eleven more
instructions and a return stack. **Everything on that page holds here**:
the machine, the instruction word, its thirteen instructions and their
flags, the I/O, the timing, the status outputs and the assembly language
(its Catch section is about the first CPU's own example).
This page gives only what is added, and the one thing that differs.

**What differs.** On the reference CPU, opcodes `0xD` and `0xF` do nothing.
Here they are the new instructions. So a program for the reference CPU
runs the same here unless it holds a word with one of those opcodes, which
the assembler never wrote for it. It also means Reference CPU 2 is not a
solution to challenge 10, which checks that those opcodes do nothing.

## Machine

Added to the reference CPU's:

| Register | Bits | Holds |
|----------|------|-------|
| `SP` | 4 | The stack pointer: where the next return address goes |

- **Return stack:** 16 bytes, `STACK[0]` to `STACK[15]`, apart from the
  data RAM. No instruction reads or writes it but `CALL` and `RET`.
- **Reset:** `SP` and every stack byte are 0, with everything else.

## Instruction word

`JNZ` has opcode `0xD` and the reference CPU's layout: bits 11–8 are
reserved, written as 0 and ignored.

The other ten share opcode `0xF`. Bits 11–8, reserved on the reference
CPU, say which:

```
 15     12 11      8 7               0
+---------+---------+-----------------+
|  1111   |  which  |     operand     |
+---------+---------+-----------------+
```

## Instructions

`n` is the operand, and `RAM[n]` a RAM byte or a device, as on the
reference CPU. "Set", "–" and the flags mean what they mean there.

| Word | Mnemonic | Effect | Z | C |
|------|----------|--------|---|---|
| `0xD0nn` | `JNZ n` | if not `Z`: `PC ← n` | – | – |
| `0xF0nn` | `AND n` | `A ← A and RAM[n]` | set | – |
| `0xF1nn` | `OR n` | `A ← A or RAM[n]` | set | – |
| `0xF2nn` | `XOR n` | `A ← A xor RAM[n]` | set | – |
| `0xF3nn` | `ANI n` | `A ← A and n` | set | – |
| `0xF4nn` | `ORI n` | `A ← A or n` | set | – |
| `0xF5nn` | `XRI n` | `A ← A xor n` | set | – |
| `0xF600` | `SHL` | `A ← A` shifted left one bit; bit 0 becomes 0 | set | the old bit 7 |
| `0xF700` | `SHR` | `A ← A` shifted right one bit; bit 7 becomes 0 | set | the old bit 0 |
| `0xF8nn` | `CALL n` | `STACK[SP] ← PC`, `SP ← SP + 1`, `PC ← n` | – | – |
| `0xF900` | `RET` | `SP ← SP − 1`, `PC ← STACK[SP]` | – | – |
| `0xEnnn`, `0xFAnn`–`0xFFnn` | (reserved) | nothing, as `NOP`, whatever the other bits | – | – |

Where a row gives several steps, they happen in that order: `RET` reads
`STACK` at the new `SP`, and `CALL` writes it at the old one.

- **`and`, `or`, `xor`** work on each of the eight bits. `AND`, `OR` and
  `XOR` read a device at `0xF0`–`0xFF` as `ADD` does: `XOR 0xFD` combines
  `A` with the screen byte at `SPTR`. `ANI`, `ORI` and `XRI` use `n`
  itself and read nothing.
- **Shifts** move one bit. To shift further, shift again: `SHL` three
  times multiplies by 8.
- **`SHL`, `SHR` and `RET` take no operand.** The assembler writes 0 in
  bits 7–0, and the CPU ignores them: `0xF6nn`, `0xF7nn` and `0xF9nn` do
  what `0xF600`, `0xF700` and `0xF900` do, for any `nn`.
- **`Z` after reset** is 0, though `A` is 0: no instruction has set it. A
  `JNZ` that comes first is taken.

### Call and return

- **`CALL n`** stores the `PC` in `STACK[SP]`, with `SP` as it was before
  the instruction, then adds 1 to `SP` and jumps to `n`. The `PC` stored
  is the address after the `CALL`: the fetch has already left it there. A
  `CALL` at address 255 stores 0.
- **`RET`** takes 1 from `SP`, then jumps to the address `STACK` holds at
  the new `SP`.
- **`A`, `Z` and `C` pass through both.** A routine can take a value in
  `A`, and give an answer back in `A` or in a flag.
- **Routines may call routines,** sixteen deep. `SP` wraps from 15 to 0
  and from 0 to 15, and nothing checks it:
  - a seventeenth call inside sixteen writes over the oldest return
    address, so the outermost `RET` goes to the wrong place;
  - a `RET` with nothing stored leaves `SP` at 15 and jumps to what
    `STACK[15]` holds, which is 0 after reset;
  - `here: CALL here` runs for ever, filling the stack with the address
    after it.

## Timing

Unchanged: every instruction takes two clock cycles, fetch then execute.
`CALL` and `RET` do all of their work in the execute cycle, on its rising
edge. Once halted, `SP` and the stack keep what they hold, with everything
else.

## Assembly language

The reference CPU's, with the eleven mnemonics. `JNZ`, `AND`, `OR`, `XOR`,
`ANI`, `ORI`, `XRI` and `CALL` take one operand; `SHL`, `SHR` and `RET`
take none, so `SHL 3` is an error: write `SHL` three times.

There is one assembler for both CPUs. On the reference CPU these eleven
assemble and do nothing.

Example: a routine that doubles `A`, called twice.

```
        LDI 5
        CALL twice
        CALL twice
        OUT             ; 20
        HLT
twice:  SHL
        RET
```

Example: light the pixel at column 10, row 3. Screen byte `3 × 8 + 1` holds
columns 8 to 15, the most significant bit leftmost, so column 10 is bit 5.

```
        LDI 25
        STA 0xFE        ; SPTR
        LDA 0xFD        ; SDATA: what the byte shows now
        ORI 0b00100000
        STA 0xFD
        HLT
```

Example: count the 1 bits of the key held, with a loop that ends in `JNZ`.

```
        LDA 0xFF        ; KEY
        STA 0           ; what is left of it
        LDI 0
        STA 1           ; the count
loop:   LDA 0
        SHR             ; the low bit goes to C
        STA 0
        JC one
        JMP next
one:    LDA 1
        ADI 1
        STA 1
next:   LDA 0           ; Z: is anything left?
        JNZ loop
        LDA 1
        OUT
        HLT
```
