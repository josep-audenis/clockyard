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

- `benches/cpu`, `program`, `display` (`.clockyard.json`): the computers of
  ADR 0034, for challenges 10 to 12. Each is a sheet with a program ROM, a
  data RAM, a key read at `0xFF`, the I/O decoding, a `HEX` register, a
  screen, a clock switch and LEDs, round one slot: the `cpu`, the `program`
  ROM, or the `display` that drives the screen. The slot's definition is
  empty (its pins only; an empty ROM for `program`). Definitions the bench
  owns have IDs starting `bench-`.
- `solutions/10-cpu`, `11-program` and `12-display` are those benches with
  the reference part in the slot: the reference CPU cut along its memory
  boundary, a program that sums 1 to the key, and the screen interface. A
  bench challenge's starter is its bench with the slot empty and the parts
  it provides.
- A bench challenge (`"bench": "cpu"`) has `runs` in place of steps: each a
  program (`words`, beside the `source` they were assembled from by hand)
  run on a fresh bench, and steps that set bench switches, run `cycles`
  clock cycles `until` an LED lights, then `expect` LEDs and `memory`
  bytes. `scripts/cpu-runs.mjs` holds the programs and the model the
  expected values come from.

`crates/sim-core/tests/challenges.rs` checks that every solution passes and
every starter fails, through the engine. `crates/sim-core/tests/cpu.rs`
holds the cut CPU and the display, on their benches, to the same model of
`docs/reference-cpu.md` as the example sheet.

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
| `10-cpu` | `clk`, `instr[16]`, `din[8]` → `pc[8]`, `addr[8]`, `dout[8]`, `we`, `out[8]`, `halt`, `fetch` | gates, dff, split, merge, rom (registers, multiplexer and 8-bit adder provided) |
| `11-program` | `addr[8]` → `word[16]`: a program in its ROM | rom (the CPU provided on the bench) |
| `12-display` | `clk`, `addr[8]`, `dout[8]`, `we` → `sptr[8]`, `swe` | gates, dff, split, merge (8-bit register provided; the CPU on the bench) |

A clocked challenge changes its data inputs with `clk` low, and nothing
else in the step that raises `clk`, so every edge samples settled inputs.
One pulse also changes an input while `clk` is high, which must change
nothing.
