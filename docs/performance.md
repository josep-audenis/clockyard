# Performance

Measured, not guessed (brief §9, §10; ADR 0030). Each table says where and when it was measured. Timings vary between
runs on a development machine by 10–20 %; a range is given where it matters.

## Benchmark circuits

`scripts/benchmarks.mjs` generates them as project files. The 1,000-part sizes are committed in `benchmarks/` and
checked in `pnpm verify` (`crates/sim-core/tests/benchmarks.rs` runs each once and checks what it computes); every size
is written to `benchmarks/generated/` (not committed) by `node scripts/benchmarks.mjs --all`.

| Family | Circuit | Sizes |
|---|---|---|
| `chain` | a switch, a line of NOT gates, an LED | 1,000 / 10,000 / 50,000 parts |
| `fanout` | one switch driving NOT gates, each with an LED | 1,000 / 10,000 / 50,000 parts |
| `adder` | a ripple adder: per bit two switches, a full-adder instance and an LED | 1,000 / 10,000 / 50,000 parts |
| `counters` | 8-bit ripple counters of D flip-flops on one clock | 1,000 / 10,000 / 44,000 parts |
| `cpu` | copies of the reference CPU, made a component | 4 / 34 / 170 copies |

"Parts" are the parts on the sheet; "nets" in the tables below are the engine's nets, about one per primitive once
instances are expanded. A reference CPU is about 300 nets.

## Native engine

`pnpm bench:native` (the generator with `--all`, then `cargo run --release -p sim-core --example bench`). Median of 5
runs, with the range.

- **Load**: validate, elaborate instances, compile, first settle.
- **Switch change**: one switch flipped and settled. For the adder, every A bit is on first, so the carry ripples
  through every bit.
- **Ticks per second**: ticks in chunks of 64, as the worker runs them, for one second. A clock cycle is two ticks.

Measured 2026-11-16 on an Intel Core i7-13700H, 16 GB, Windows 11, Rust 1.99.1:

| Benchmark | Nets | Load, ms (range) | Switch change, ms (range) | Ticks per second |
|---|---:|---:|---:|---:|
| chain-1k | 1000 | 8.8 (8.1–11.2) | 0.2 (0.2–0.2) | – |
| chain-10k | 10000 | 108.8 (96.9–130.2) | 1.6 (1.0–1.9) | – |
| chain-50k | 50000 | 598.6 (551.0–619.4) | 9.7 (8.6–12.7) | – |
| fanout-1k | 501 | 7.5 (7.1–8.6) | 0.0 (0.0–0.0) | – |
| fanout-10k | 5001 | 89.7 (85.2–98.6) | 0.2 (0.2–0.2) | – |
| fanout-50k | 25001 | 532.3 (486.5–560.5) | 0.7 (0.6–0.9) | – |
| adder-1k | 1745 | 42.1 (34.8–43.1) | 0.1 (0.1–0.1) | – |
| adder-10k | 17495 | 456.0 (430.1–556.2) | 0.8 (0.6–1.0) | – |
| adder-50k | – | refused: TooLarge | – | – |
| counters-1k | 930 | 13.0 (12.7–28.0) | – | 124250 |
| counters-10k | 9410 | 139.4 (128.4–140.4) | – | 11581 |
| counters-50k | 41410 | 820.4 (751.7–841.1) | – | 1012 |
| cpu-1k | 1181 | 39.5 (32.5–46.1) | – | 52178 |
| cpu-10k | 10031 | 332.8 (295.0–376.6) | – | 4953 |
| cpu-50k | – | refused: TooLarge | – | – |

Read so:

- **Load grows about linearly** with size: about 10 ms per 1,000 parts for gates, and three to four times that per
  1,000 nets inside instances, which elaboration expands. Every connectivity edit reloads (ADR 0017), so on a
  10,000-part circuit an edit costs the engine 100–450 ms before the browser does anything.
- **Settling is fast.** A change that ripples through 50,000 gates settles in about 10 ms.
- **Ticking scales with what changes on a tick.** 10,000 flip-flops toggling run at about 5,800 cycles per second,
  and 41,000 at about 500.
- **Limits found.** Elaboration refuses more than 200,000 items (`MAX_PARTS`), which counts instances, their pins and
  wires, not just primitives. So about 12,500 full-adder instances (`adder-50k`) or 170 reference CPUs (`cpu-50k`) are
  refused, although their primitive counts are far lower. Import refuses files over 10 MB, which is about 45,000
  parts with their wires: `counters` at 50,000 would be 11 MB, so it is generated at 44,000.

## Browser

To be measured in ADR 0030 step 2 (`pnpm bench`): opening, toggling, moving a wire until drawn, panning frame times,
run speed and autosave, against the targets of ADR 0030 item 4.

## Earlier measurements

- The reference CPU runs at the 10,000 cycles per second setting in the browser, about 9,950 measured (ADR 0019).
- Natively, Catch on the reference CPU runs at 115,000–133,000 cycles per second, with or without 16 recorded traces
  (ADR 0026).
