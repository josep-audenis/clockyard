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
| `cpu` | copies of the reference CPU, made a component | 4 / 34 / 160 copies |

"Parts" are the parts on the sheet. "Nets" in the tables below are the engine's nets: one per primitive that drives
a value, once instances are expanded, plus ground. LEDs drive nothing, so `fanout` has about half as many nets as
parts. A reference CPU is about 300 nets.

## Native engine

`pnpm bench:native` (the generator with `--all`, then `cargo run --release -p sim-core --example bench`). Median of 5
runs, with the range.

- **Load**: validate, elaborate instances, compile, first settle. Not reading the file or its JSON, which a reload in
  the browser also pays (about 300 ms at 50,000 parts natively), nor dropping the simulator.
- **Switch change**: one switch flipped and settled. For the adder, every A bit is on first, so the carry ripples
  through every bit.
- **Ticks per second**: ticks in chunks of 64, as the worker runs them, for 200 ms a run. A clock cycle is two ticks.
  Rates vary more between runs than loads do, by up to a third.

Measured 2026-11-16 on an Intel Core i7-13700H, 16 GB, Windows 11, Rust 1.99.1:

| Benchmark | Nets | Load, ms (range) | Switch change, ms (range) | Ticks per second (range) |
|---|---:|---:|---:|---:|
| adder-1k | 1745 | 42.48 (39.74–44.02) | 0.05 (0.05–0.07) | – |
| adder-10k | 17495 | 447.00 (405.71–480.52) | 0.72 (0.59–1.01) | – |
| adder-50k | – | refused: TooLarge | – | – |
| chain-1k | 1000 | 10.65 (10.27–18.55) | 0.18 (0.18–0.23) | – |
| chain-10k | 10000 | 133.58 (111.84–149.13) | 1.78 (1.68–1.84) | – |
| chain-50k | 50000 | 688.45 (638.70–705.64) | 9.46 (8.70–10.73) | – |
| counters-1k | 930 | 12.80 (12.36–12.99) | – | 82775 (81474–85028) |
| counters-10k | 9410 | 140.66 (139.96–153.89) | – | 5733 (5386–6390) |
| counters-50k | 41410 | 721.85 (645.96–757.00) | – | 1102 (1070–1162) |
| cpu-1k | 1181 | 33.23 (31.42–34.66) | – | 60405 (51468–65234) |
| cpu-10k | 10031 | 265.76 (240.19–292.83) | – | 5280 (4550–6963) |
| cpu-50k | 47201 | 1281.75 (1180.50–1349.17) | – | 778 (716–859) |
| fanout-1k | 501 | 6.80 (5.25–6.90) | 0.02 (0.02–0.02) | – |
| fanout-10k | 5001 | 68.23 (67.75–112.64) | 0.08 (0.08–0.14) | – |
| fanout-50k | 25001 | 419.55 (362.30–465.64) | 0.68 (0.65–0.79) | – |

Read so:

- **Load grows about linearly** with size: about 10–14 ms per 1,000 parts for gates, and two and a half to three
  times that per 1,000 nets inside instances, which elaboration expands. Every connectivity edit reloads (ADR 0017),
  so on a 10,000-part circuit an edit costs the engine 70–450 ms, plus reading its description, before the browser
  does anything.
- **Settling is fast.** A change that ripples through 50,000 gates settles in about 10 ms.
- **Ticking slows with size, and faster than size grows.** The counters have 464, 4,704 and 20,704 flip-flops, of
  which only about two per counter change on a tick (a ripple counter). They run at about 41,000, 2,900 and 550
  cycles per second: ten times the size costs about fourteen times the time per tick. Every settle of a circuit with
  flip-flops also copies its whole net array (`snapshot`, ADR 0017), which grows with size whatever changes. This
  benchmark cannot tell the two causes apart.
- **Limits found.** Elaboration refuses more than 200,000 items (`MAX_PARTS`), which counts every part, pin part,
  junction and wire at every level, and the instances, not just primitives. So about 12,500 full-adder instances
  (`adder-50k`, 375,000 items) are refused, and the reference CPU fits about 160 copies (`cpu-50k`, 47,000 nets)
  where 170 would be refused. Import refuses files over 10 MB. Flat circuits of 50,000 parts with a wire a part fit
  (8.4–9.0 MB); `counters`, with about one and a half wires a part, would be 11 MB at 50,000, so it is generated at
  44,000, already at 96 % of the limit.

## Browser

`pnpm bench` (the WASM module, every size generated, a production build, then `bench/browser.bench.ts` in Playwright's
Chromium at 1280 × 800, one page at a time). `BENCH_SIZES=1k,10k` limits the sizes. The app records where the time goes
as `clockyard:` User Timing measures, only when its address has `?bench`.

- **Open**: Import of the file until the status says Settled and two frames have been drawn. *Routing* and *drawing* are
  the main thread's share of it; routing happens inside drawing, so drawing includes it.
- **Toggle**: a click on a switch until the readout says it is on, which follows the engine's settle and a redraw.
- **Drag**: a part moved two cells in ten pointer steps: the median redraw, and the median sync (projecting the document
  and comparing it, ADR 0005), per step.
- **Pan**: frames per second while the view is dragged with the middle button.
- **Cycles per second**: Run at the top speed (10,000) for two seconds.
- **Autosave**: one save of the project after the drag (ADR 0029).

Measured 2026-11-16 on an Intel Core i7-13700H, 16 GB, Windows 11, Playwright 1.64.1's Chromium:

| Benchmark | Open, ms | Of it: routing, ms | Of it: drawing, ms | Toggle, ms | Drag: draw, ms | Drag: sync, ms | Pan, fps | Cycles per second | Autosave, ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chain-1k | 396 | 98 | 285 | 255 | 10.7 | 0.4 | 12 | – | 10 |
| chain-10k | 8678 | 6234 | 7436 | 1787 | 119.8 | 5.5 | 1 | – | – |
| chain-50k | 277829 | – | – | – | – | – | – | – | – |
| fanout-1k | 1250 | 388 | 591 | 675 | 20.7 | 0.6 | 4 | – | – |
| fanout-10k | 32299 | 17969 | 20510 | 8111 | 341.8 | 9.6 | 0 | – | – |
| fanout-50k | 365554 | – | – | – | – | – | – | – | – |
| adder-1k | 814 | 153 | 408 | 295 | 17.8 | 0.5 | 8 | – | 7 |
| adder-10k | 17282 | 8419 | 10575 | – | – | – | – | – | – |
| adder-50k (refused: too large) | 356622 | – | – | – | – | – | – | – | – |
| counters-1k | 800 | 198 | 482 | – | 29.5 | 0.4 | 8 | 8994 | 8 |
| counters-10k | 16981 | 11874 | 14264 | – | 335.6 | 6.3 | 1 | – | – |
| counters-50k | 344925 | – | – | – | 2151.7 | 47.1 | – | – | – |
| cpu-1k | 187 | 0 | 47 | – | 0.6 | 0.3 | 60 | 9654 | 8 |
| cpu-10k | 286 | 0 | 98 | – | 1.3 | 0.5 | 60 | 1922 | 7 |
| cpu-50k | 333 | – | – | – | 3.2 | 0.3 | 30 | 549 | 7 |

The 50,000-part rows come from an earlier run of the same script, which measured little more than the open: every later
step takes minutes at that size. A dash elsewhere is a step that timed out (10,000-part pans run at about one frame a
second, and the steps after them often ran out of time) or does not apply.

Read so:

- **The main thread is the bottleneck, not the engine.** The same circuits load natively in 10–450 ms (above), and the
  `cpu` family, whose sheet holds only a few instances and no wires, opens 47,000 nets in a third of a second. Every
  family with thousands of parts and wires on its sheet spends almost all its open in drawing, and most of that in
  routing every wire.
- **Panning redraws the whole scene** on every frame: 12 frames a second at 1,000 parts, 1 at 10,000. Panning changes
  nothing but the view, so it need not redraw anything.
- **A drag step redraws everything too**, 10–30 ms at 1,000 parts and 120–340 ms at 10,000. The sync that the
  `shortcut:` comment suspected is small: under 10 ms at 10,000 parts.
- **Refusing a circuit takes as long as opening it.** `adder-50k` is routed and drawn for six minutes before the
  engine's "too large" is shown.
- **Autosave is cheap**: under 10 ms.
- **Run speed** in the browser matches the engine's at 1,000 parts (about 9,000 cycles per second against the 10,000
  asked); larger circuits run at what the engine allows.

### Against the targets (ADR 0030 item 4)

| Target | Measured | Met |
|---|---|---|
| 10,000 parts open in under 2 s | 8.7–32 s for flat circuits; 0.3 s for `cpu` | no |
| A toggle or an edit shows within 100 ms at 10,000 parts | toggle 1.8–8 s; a drag step 120–340 ms | no |
| Panning at 30 fps or more at 10,000 parts | 0–1 fps | no |
| 50,000 parts open in under 10 s, edits under 1 s | 4.5–6 minutes; a drag step 2 s | no |
| The reference CPU keeps 10,000 cycles per second | about 9,650 (`cpu-1k`, four CPUs) | yes |

Step 3 of ADR 0030 optimizes, in the order these numbers point: panning without redrawing, then drawing only what an
edit changed, then routing only the wires it touched.

`pnpm bench:check` compares the last run with `benchmarks/browser-baseline.json` and fails on any measurement more than
twice as bad; `node scripts/bench-check.mjs --update` makes the last run the baseline.

## Earlier measurements

- The reference CPU runs at the 10,000 cycles per second setting in the browser, about 9,950 measured (ADR 0019).
- Natively, Catch on the reference CPU runs at 115,000–133,000 cycles per second, with or without 16 recorded traces
  (ADR 0026).
