# Reference CPU: specification

Status: **built** (ADR 0019, accepted; I/O from ADR 0022). This is the reference specification
that the CPU built from Clockyard parts is tested against: native Rust tests
run the same programs on the netlist and on a model written from this page,
and the results must match after every clock cycle. Change this page first
to change the instruction set.

## Machine

- 8-bit data. Harvard: the program is in a ROM and data in a RAM, each with
  its own address.
- **Program ROM:** 256 words of 16 bits, addressed by the PC.
- **Data RAM:** 256 bytes, of which addresses `0x00`–`0xEF` are reached;
  `0xF0`–`0xFF` are I/O (see I/O below).
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

- **Reset:** every register, every RAM byte, `SPTR`, `HEX` and every
  screen byte are 0. The ROM keeps its program.

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

`n` is the operand. `RAM[n]` is the byte at data address `n`: a RAM byte
for `n` up to `0xEF`, a device for `0xF0`–`0xFF` (see I/O below). Additions
and subtractions are modulo 256.

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

## I/O

Data addresses `0xF0`–`0xFF` reach devices instead of the RAM (ADR 0022).
`LDA`, `ADD` and `SUB` read them; `STA` writes them. A store there never
writes the RAM, and a load there never reads it.

| Address | Name | Read | Write (`STA`) |
|---------|------|------|---------------|
| `0xFF` | `KEY` | the keyboard: the code of the key held, or 0 | ignored |
| `0xFE` | `SPTR` | the screen pointer | `SPTR ← A` |
| `0xFD` | `SDATA` | `SCREEN[SPTR]` | `SCREEN[SPTR] ← A` |
| `0xFC` | `HEX` | the hex register | `HEX ← A` |
| `0xF0`–`0xFB` | (reserved) | 0 | ignored |

- **Screen:** 256 bytes, shown 64 pixels wide and 32 rows high. Byte `i`
  is row `i / 8`, pixels `8 × (i mod 8)` onwards, most significant bit
  leftmost. A program reaches any byte by storing its address to `SPTR`
  first; `SPTR` does not move by itself.
- **`HEX`** is shown on two seven-segment digits, high nibble left, as hex
  (`0`–`9`, `A`, `b`, `C`, `d`, `E`, `F`).
- **`KEY`** is the key held while the instruction executes, not a queue:
  a program sees a new press by comparing with the code it read before.
  Key codes are those of ADR 0021: printable ASCII as itself, Enter 13,
  Backspace 8, Escape 27, arrows `0x80` up to `0x83` right.
- Writes take effect on the execute cycle's rising edge, as RAM stores do;
  `SDATA` uses `SPTR` as it was before that edge.

## Timing

Each instruction takes **two clock cycles**. A cycle is one rising edge of
the clock (ADR 0017), and every register changes only on a rising edge.

- **Fetch** (`T = 0`): `IR ← ROM[PC]`, `PC ← PC + 1` (wrapping from 255 to
  0), `T ← 1`.
- **Execute** (`T = 1`): the effect of `IR` from the table above, then
  `T ← 0`. A jump that is taken overrides the `PC` the fetch left.
- **Halted** (`H = 1`): `HLT`'s own execute cycle completes as any other
  (`H ← 1`, `T ← 0`). From the next edge on, no register, RAM byte, device
  register or screen byte changes, `T` included. Only reset leaves the
  halted state.

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
  instruction. A label may stand on its own line, and may touch its
  instruction (`loop:OUT`). A label after the last instruction of a full
  ROM would be address 256, so using it is an error. Names are letters,
  digits and `_`, not starting with a digit, and are case-sensitive.
- Operands are numbers from 0 to 255, in decimal, `0x` hex or `0b` binary,
  or a label.
- `;` starts a comment that runs to the end of the line.
- Errors give their line number:
  - an unknown mnemonic;
  - a missing, extra or out-of-range operand;
  - an unknown or repeated label;
  - more than 256 instructions.
- Every error is reported, not only the first. Several labels may stand
  before one instruction, each naming its address.

Example: add 5 and 3, show the result and stop.

```
        LDI 5
        ADI 3
        OUT
        HLT
```

Example: draw the key held. Show its code on the hex digits and light
eight pixels at the screen byte the code addresses.

```
loop:   LDA 0xFF     ; KEY
        JZ loop      ; no key held
        STA 0xFC     ; HEX
        STA 0xFE     ; SPTR
        LDI 0xFF
        STA 0xFD     ; SDATA
        JMP loop
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
