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
