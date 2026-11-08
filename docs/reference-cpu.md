# Reference CPU: specification

Status: **proposed** (ADR 0019). This is the reference specification that the
CPU built from Clockyard parts is tested against: native Rust tests run the
same programs on the netlist and on a model written from this page, and the
results must match after every instruction.

## Machine

- 8-bit data. Harvard: the program is in a ROM and data in a RAM, each with
  its own address.
- **Program ROM:** 256 words of 16 bits, addressed by the PC.
- **Data RAM:** 256 bytes.
- **Registers:**

  | Register | Bits | Holds |
  |----------|------|-------|
  | `PC` | 8 | Address of the next instruction to fetch |
  | `IR` | 16 | The instruction being executed |
  | `A` | 8 | The accumulator |
  | `OUT` | 8 | The output register, shown on an output device |
  | `Z`, `C` | 1 each | Zero and carry flags |
  | `T` | 1 | Phase: 0 fetch, 1 execute |
  | `H` | 1 | Halted |

- **Reset:** every register and every RAM byte is 0. The ROM keeps its
  program.

## Instruction word

```
 15     12 11      8 7               0
+---------+---------+-----------------+
| opcode  |  0000   |     operand     |
+---------+---------+-----------------+
```

Bits 11–8 are reserved: the assembler writes 0 and the CPU ignores them.
The operand is an immediate value, a RAM address or a ROM address, as the
table says. Instructions without an operand have operand 0.

## Instructions

`n` is the operand. `RAM[n]` is the byte at RAM address `n`. Additions and
subtractions are modulo 256.

| Opcode | Mnemonic | Effect | Z | C |
|--------|----------|--------|---|---|
| `0x0` | `NOP` | nothing | – | – |
| `0x1` | `LDI n` | `A ← n` | set | – |
| `0x2` | `LDA n` | `A ← RAM[n]` | set | – |
| `0x3` | `STA n` | `RAM[n] ← A` | – | – |
| `0x4` | `ADD n` | `A ← A + RAM[n]` | set | carry |
| `0x5` | `SUB n` | `A ← A − RAM[n]` | set | no borrow |
| `0x6` | `ADI n` | `A ← A + n` | set | carry |
| `0x7` | `SBI n` | `A ← A − n` | set | no borrow |
| `0x8` | `JMP n` | `PC ← n` | – | – |
| `0x9` | `JZ n` | if `Z`: `PC ← n` | – | – |
| `0xA` | `JC n` | if `C`: `PC ← n` | – | – |
| `0xB` | `OUT` | `OUT ← A` | – | – |
| `0xC` | `HLT` | `H ← 1` | – | – |
| `0xD`–`0xF` | (reserved) | nothing, as `NOP` | – | – |

- **Z, "set":** `Z ← 1` if the new `A` is 0, else `Z ← 0`.
- **C, "carry":** `C ← 1` if the 9-bit sum is 256 or more.
- **C, "no borrow":** `C ← 1` if `A ≥` the subtrahend (before the
  subtraction), else `C ← 0`. This is the carry out of `A + ¬B + 1`.
- **"–":** the flag keeps its value.

## Timing

Each instruction takes **two clock cycles**. A cycle is one rising edge of
the clock (ADR 0017), and every register changes only on a rising edge.

- **Fetch** (`T = 0`): `IR ← ROM[PC]`, `PC ← PC + 1` (wrapping from 255 to
  0), `T ← 1`.
- **Execute** (`T = 1`): the effect of `IR` from the table above, then
  `T ← 0`. A jump that is taken overrides the `PC` the fetch left.
- **Halted** (`H = 1`): `HLT`'s own execute cycle completes as any other
  (`H ← 1`, `T ← 0`). From the next edge on, no register or RAM byte
  changes, `T` included. Only reset leaves the halted state.

So after reset and `2k` cycles, exactly `k` instructions have executed
(fewer if one was `HLT`). This is the *instruction step* the editor
offers: two cycles, ending as the next fetch begins, with the clock high
(ADR 0019 item 6).

## Status outputs

The circuit shows two 1-bit LEDs, which *Run until* uses (ADR 0019):

- **Fetch** = `¬T ∧ ¬H`: lit during a fetch cycle. It rises at the end of
  every executed instruction, and never once the CPU has halted.
- **Halted** = `H`: rises when `HLT` executes.

## Assembly language

- One instruction per line: a mnemonic, then its operand if it takes one.
  Mnemonics are case-insensitive.
- `name:` at the start of a line defines a label, the address of the next
  instruction. A label may stand on its own line. Names are letters,
  digits and `_`, not starting with a digit, and are case-sensitive.
- Operands are numbers from 0 to 255, in decimal, `0x` hex or `0b` binary,
  or a label.
- `;` starts a comment that runs to the end of the line.
- Errors give their line number:
  - an unknown mnemonic;
  - a missing, extra or out-of-range operand;
  - an unknown or repeated label;
  - more than 256 instructions.

Example: add 5 and 3, show the result and stop.

```
        LDI 5
        ADI 3
        OUT
        HLT
```

Example: count down from 10, showing each value.

```
        LDI 10
loop:   OUT
        SBI 1
        JZ done
        JMP loop
done:   OUT
        HLT
```
