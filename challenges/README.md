# Challenges

The challenges of ADR 0025, each a custom component to build. Do not edit
these files by hand: `node scripts/challenges.mjs` writes them, and
`pnpm verify` fails if they are out of date.

- `NN-name.json`: the challenge. Its title and text, the definition to
  build, its pins (by part ID) and widths, the parts it allows, and its
  steps: inputs to set, then outputs to expect.
- `solutions/NN-name.clockyard.json`: a reference solution.
- `starters/NN-name.clockyard.json`: what the editor opens. The definition
  holds only its pins; parts the challenge provides are kept.

`crates/sim-core/tests/challenges.rs` checks that every solution passes and
every starter fails, through the engine.

| File | Build | Parts |
|------|-------|-------|
| `01-inverter` | `A` → `Y` | NAND |
| `02-xor` | `A`, `B` → `Y` | NAND |
| `03-half-adder` | `A`, `B` → `S`, `C` | gates |
| `04-full-adder` | `A`, `B`, `Cin` → `S`, `Cout` | gates |
| `05-adder8` | `A[8]`, `B[8]`, `Cin` → `S[8]`, `Cout` | gates, split, merge (full adder provided) |
| `06-register` | `D`, `load`, `clk` → `Q` | gates, dff |
| `07-register8` | `D[8]`, `load`, `clk` → `Q[8]` | gates, dff, split, merge |
| `08-counter8` | `en`, `clr`, `clk` → `Q[8]` | gates, dff, split, merge |
| `09-alu` | `A[8]`, `B[8]`, `sub` → `Y[8]`, `C`, `Z` | gates, split, merge (8-bit adder provided) |

A clocked challenge changes its data inputs with `clk` low, and nothing
else in the step that raises `clk`, so every edge samples settled inputs.
One pulse also changes an input while `clk` is high, which must change
nothing.
