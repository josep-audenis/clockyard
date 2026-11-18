# Performance

Measured, not guessed (brief §9, §10; ADR 0030). Each table says where and when it was measured. Timings vary between
runs on a quiet development machine by 10–20 %, and by two times or more while other work runs on it; a range is given
where it matters, and a table says when its run was loaded.

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
  Rates vary more between runs than loads do: by up to a third within this table's run, and a later re-run on the same
  machine gave about twice these rates, so compare native runs only made close together.

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
as `clockyard:` User Timing measures, only when its address has `?bench`. Every row of a table comes from one run: the
run clears earlier rows and stamps its own. A step that fails or times out leaves a note in its row, never a silent
dash.

- **Open**: Import of the file until the engine has answered the load and sent its first settled state
  (`clockyard:engine-ready`), and two frames have been drawn since. *Routing* and *drawing* are the main thread's share
  of it; routing happens inside drawing, so drawing includes it.
- **Toggle**: a click on a switch until the readout says it is on, which follows the engine's settle. The readout
  is updated before the canvas is drawn again, so the canvas's redraw is not in it.
- **Drag**: a part moved two cells in ten pointer steps: the median redraw, and the median sync (projecting the document
  and comparing it, ADR 0005), per step.
- **Pan**: frames per second while the view is dragged with the middle button.
- **Cycles per second**: Run at the top speed (10,000) for two seconds. The elapsed time includes the clicks' round
  trips, so the rate reads a few per cent low.
- **Autosave**: the slowest save after the drag (ADR 0029), from its start until IndexedDB has written it. It is
  asynchronous, so it includes any wait behind the main thread's drawing.
- At 50,000 parts only the open is measured: every later step takes minutes there.

Measured 2026-11-16, after step 3's first three optimizations (below), on an Intel Core i7-13700H, 16 GB, Windows 11,
on mains power, with Playwright 1.64.1's Chromium drawing on the Intel Iris Xe graphics card (Direct3D 11). Earlier
tables, before those steps and first with SwiftShader, a software WebGL, are in this file's history.

Other work ran on the machine during this run (30–40 % of the processor), so this table is loaded and noisy: a
recheck straight after it, with the code unchanged, opened `chain-10k` in 15.3 s (routing 12.1 s) against 9.2 s here,
and ran `cpu-10k` at 2,036 cycles per second against 1,569 here.

Against the previous baseline (the run before steps 3.2 and 3.3), `bench:check` failed this run on ten measurements.
Four are about twice as slow and fit the load: `counters-50k`'s open, routing and drawing (routing, which no change
touched, took 2.1 times as long) and `cpu-50k`'s drawing. Six went further and were not explained by a measurement:
autosave at 1,000 parts (`chain-1k` 14 → 109 ms, `adder-1k` 10 → 47 ms) and `cpu-10k`'s (4 → 18 ms), `cpu-1k`'s drawing
on open (71 → 176 ms), `counters-10k`'s pan (20 → 8.6 fps) and `chain-1k`'s toggle (54 → 119 ms).

This run is the baseline for now, which makes `bench:check` loose: a real slowdown of two times or more measured on a
quiet machine could pass against it. A run on a quiet machine did not settle the six; interleaved comparisons did:
`chain-1k`'s toggle was a regression, fixed, and the other five are not regressions: this run's slowdowns there were
noise (section 4 below).

| Benchmark | Open, ms | Of it: routing, ms | Of it: drawing, ms | Toggle, ms | Drag: draw, ms | Drag: sync, ms | Pan, fps | Cycles per second | Autosave, ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| adder-1k | 1993 | 382 | 1672 | 150 | 23.3 | 0.9 | 59.9 | – | 47 |
| adder-10k | 23584 | 15084 | 22639 | 366 | 188.1 | 6.8 | 6.7 | – | 92 |
| adder-50k (refused: too large) | 350090 | 272858 | 340595 | – | – | – | – | – | – |
| chain-1k | 639 | 162 | 506 | 119 | 5.5 | 0.5 | 59.9 | – | 109 |
| chain-10k | 9153 | 7579 | 8945 | 591 | 51.2 | 6.1 | 30.0 | – | 57 |
| chain-50k | 287240 | 274060 | 286535 | – | – | – | – | – | – |
| counters-1k | 1048 | 248 | 922 | – | 9.2 | 0.8 | 59.9 | 9071 | 14 |
| counters-10k | 24105 | 17304 | 23806 | – | 146.9 | 8.3 | 8.6 | 2017 | 100 |
| counters-50k | 450445 | 402288 | 449223 | – | – | – | – | – | – |
| cpu-1k | 296 | 0 | 176 | – | 1.4 | 0.3 | 59.9 | 8263 | 14 |
| cpu-10k | 289 | 0 | 157 | – | 1.6 | 0.8 | 59.9 | 1569 | 18 |
| cpu-50k | 1266 | 0 | 604 | – | – | – | – | – | – |
| fanout-1k | 895 | 509 | 754 | 117 | 7.1 | 0.4 | 59.9 | – | 13 |
| fanout-10k | 23086 | 19873 | 22383 | 460 | 106.8 | 6.0 | 20.0 | – | 60 |
| fanout-50k | 300004 | 277701 | 294311 | – | – | – | – | – | – |

A dash is a step that does not apply (no switch to toggle, no clock to run) or was not measured at that size.

Read so:

- **The main thread is the bottleneck, not the engine.** The same circuits load natively in 7–1,300 ms (above), and
  the `cpu` family, whose sheet holds only a few instances and no wires, opens 47,000 nets in 1.3 s, engine included.
  Every family with thousands of parts and wires on its sheet spends almost all its open in drawing, and most of that
  in routing every wire (two thirds or more of drawing at 10,000 parts, a fifth to two thirds at 1,000): opening is now
  the cost furthest from its target.
- **Panning** keeps the display's 60 frames a second at 1,000 parts, and 6.7–30 at 10,000 for flat circuits (60 for
  `cpu`). Before step 3 it redrew the whole scene on every frame: 5–12 frames a second at 1,000 parts, about 1 at
  10,000, with SwiftShader.
- **A drag step** takes 5–23 ms at 1,000 parts and 50–190 ms at 10,000 for flat circuits (under 2 ms for `cpu`),
  rebuilding only the chunks of the wires the moved part touches (step 3.2). The sync is small: under 9 ms at 10,000
  parts.
- **A toggle takes 0.37–0.6 s at 10,000 parts** (0.66–1.6 s in the previous table), though the engine settles it in
  2 ms or less. Which change, if any, made the difference is not known: section 3 measured the same toggle code at
  1.0–1.5 s, and `chain`'s 0.66 → 0.59 s is within this run's noise. Most of what remains is the redraw when every wire
  and gate changes (profiled on `chain`).
- **Running a large circuit** no longer freezes the page: `counters-10k` runs at 2,017 cycles per second, and `cpu-10k`
  at 1,569. The native table above gives the engine about 2,900 and 2,600 cycles per second for them (a native re-run
  during this work gave about twice that, so native timings vary as much); `cpu-10k` read 2,982 in the previous table;
  an interleaved comparison found its drop is not a regression from step 3.3 (section 4). At 1,000 parts the run
  speed is 8,300–9,100 of the 10,000 asked.
- **Refusing a circuit takes as long as opening it.** `adder-50k` is routed and drawn for nearly six minutes before
  the engine's "too large" is shown.
- **Autosave** takes 57–100 ms at 10,000 parts for flat circuits (0.17–1.2 s in the previous table), presumably
  because it waits behind less drawing, and 13–109 ms at 1,000 parts (7–48 ms before), which interleaved
  comparisons found to be noise (section 4); serializing and waiting are not measured apart.

### Against the targets (ADR 0030 item 4)

| Target | Measured | Met |
|---|---|---|
| 10,000 parts open in under 2 s | 9–24 s for flat circuits; 0.29 s for `cpu`; after step 3's routing index and bitmap labels, `chain` 1.3 s, `adder` 2.8–3.2 s, `counters` 2.7–3.3 s, `fanout` 6–13 s (measured with the routing index only); with shared part shapes (section 7) `chain` 0.6–0.7 s, `counters` 2.1–2.2 s, `adder` 2.3–2.4 s, `fanout` 5.7–6.2 s; with fewer cells searched (section 8, on battery, where the same builds are slower) `fanout` 10.8 → 3.4–3.5 s, `adder` 4.2 → 3.3–3.4 s, `counters` 3.7–3.9 → 3.1–3.2 s; on mains after section 8, `adder` 2.1 s, `counters` 2.3 s, `fanout` about 2.7 s; section 9 then takes 1.3 s, 0.5 s and 0.2 s off them on battery with other work running, where everything is two to three times as slow | for `chain` and `cpu` only, after them; not measured on mains power since section 9 |
| A toggle or an edit shows within 100 ms at 10,000 parts | toggle 0.37–0.6 s; a drag step 50–190 ms | no |
| Panning at 30 fps or more at 10,000 parts | 30 fps for `chain`; 20 for `fanout`, 8.6 for `counters`, 6.7 for `adder`; with shared part shapes (section 7) 30–60 for `chain`, `counters` and `fanout`, 20 for `adder` | partly |
| 50,000 parts open in under 10 s, edits under 1 s | 4.8–7.5 minutes for flat circuits; 1.3 s for `cpu-50k`; after step 3's routing index, `chain-50k` 6.3 s, `counters-50k` 22 s; with shared part shapes `chain-50k` 2.4 s; deleting every part of `chain-50k` takes about 1.2 s, over the 1 s asked (other edits not measured) | opening, for `chain` and `cpu` only, after it |
| Run speed on `counters-10k` recorded | 2,017 cycles per second | yes |
| The reference CPU keeps 10,000 cycles per second | about 8,300 (`cpu-1k`, four CPUs; reads a few per cent low, and this run was loaded) | no, in this run |

Step 3 of ADR 0030 has optimized panning, the wires an edit or a state redraws, what the page does with each engine
state, routing a whole sheet, labels, part shapes, the searches themselves and the page's long part lists (below). What
these numbers point to next: the rest of an open, now mostly routing and drawing (section 9), and drawing wires, which a
toggle that changes every wire also pays.

`pnpm bench:check` compares the last run with `benchmarks/browser-baseline.json` and fails on any measurement more than
twice as bad (and worse by more than 5), or one the run lost; `node scripts/bench-check.mjs --update` makes the last run
the baseline. The baseline is this table's run.

## Optimizations (ADR 0030 step 3)

### 1. Panning without redrawing

A pan used to redraw the whole scene on every pointer move. Now a frame that only moves the view sets the world's
transform and renders: the world is a Pixi render group, so moving it is one transform, and nothing is drawn again
(`clockyard:view` measures such a frame, `clockyard:draw` a redraw).

From here on `pnpm bench` asks Chromium for the graphics card (`--enable-gpu`, `--ignore-gpu-blocklist`, and ANGLE on
Direct3D 11 on Windows) instead of SwiftShader, so its frame rates are what a user sees. Before and after, measured
back to back on the graphics card:

| Benchmark | Pan before, fps | Pan after, fps |
|---|---:|---:|
| chain-1k | 30 | 60 |
| chain-10k | 3.5 | 12 |
| fanout-10k | 2.5 | 12 |
| adder-10k | 2.0 | 5.0 |
| cpu-1k | 60 | 60 |

That pair ran on battery, with everything about twice as slow as on mains power (routing, which the change does not
touch, too), so its columns compare only with each other. On mains power, in the previous full run (in this file's
history), every 1,000-part benchmark panned at 60 frames a second and the 10,000-part ones at 8.6–30 (6.7–30 in the
loaded run above). A pan frame still takes main-thread time with nothing drawn: 35–45 ms for `chain-10k` and about
110 ms for `adder-10k` (`clockyard:view`, on battery). That is Pixi's render, most likely its walk over every object,
off screen too (not yet profiled). Culling what is off screen is the next
candidate for panning.

### 2. Rebuilding only the wires that changed

Every redraw used to rebuild one `Graphics` holding every wire, and Pixi turns its strokes into triangles again when it
renders. A profile of a drag step at 10,000 parts (temporary measures, on battery) showed where the time went: 40–65 ms
building the wires, 20–30 ms checking the parts (their shapes are already cached; this step leaves them), and 180–300 ms in
`app.render()`, most of it the wires' triangles.

Now the wires are drawn in chunks of about 64, by a hash of the wire's ID, so adding or removing a wire moves no other
(except when the number of chunks doubles or halves, and every chunk is rebuilt once). A chunk is rebuilt only when one
of its wires looks different (its route, width, colour, transparency or bus width). Selected wires are drawn again,
with their halo, in a layer of their own above every chunk, rebuilt the same way, so selecting rebuilds no chunk and no
unselected wire covers a halo; junction dots and tags, which are few, are drawn whole as before. Where two unselected
wires cross, which is on top now follows their chunks, not the order they were added in, and picking near a crossing
can take the wire drawn under (hit-testing still follows the order they were added in). Before and after, back to back on the
graphics card (on battery, so the columns compare only with each other):

| Benchmark | Drag draw before, ms | Drag draw after, ms | Toggle before, ms | Toggle after, ms |
|---|---:|---:|---:|---:|
| counters-1k | 65.6 | 24.7 | – | – |
| chain-10k | 307.8 | 102.6 | 1792 | 1518 |
| fanout-10k | 415.4 | 101.0 | 3244 | 3148 |
| adder-10k | 559.4 | 242.9 | 3289 | 2452 |
| counters-10k | 667.1 | 172.3 | – | – |

A drag step is 2.3–4.1 times faster: it rebuilds the chunks of the wires the moved part touches. A toggle is not much
faster: toggling the switch of `chain` or `fanout` changes every wire's value, so every chunk is rebuilt, and most of a
toggle's 1.5–3.1 s is presumably spent outside the draw, judging by the drag's draw times; it is not yet
measured. Running `counters-10k` at full speed froze the page: what the main thread does with each state the worker
sends is measured, and fixed, below.

The after columns were measured before selected wires got their own layer; the benchmark selects a part, not a wire,
so that layer stays empty in it. The browser table above was measured after this step.

### 3. What the page does with each engine state

A profile (Chrome's sampling profiler over CDP, on an unminified production build, the graphics card, mains power)
showed where a toggle and a run go:

- **The screen readers' list of inputs and outputs named every part by counting among all the parts**, once per part
  listed, on every state. A `fanout-10k` toggle spent 560 ms rendering it, 484 ms of that in `partName`. `counters-10k`
  lists 588 LEDs among 10,000 parts: about six million comparisons a state.
- **Every state was handled as it arrived**: two store updates, React's renders, a redraw scheduled. While running, the
  worker sends one about every 16 ms; when handling one takes longer, they queue. Running `counters-10k`, the page did
  not answer for the 80 seconds measured, its JavaScript heap swinging between 0.4 and 1.4 GB, and in one attempt the
  page crashed within 5 seconds.
- **A toggle that changes every wire** (`chain`) is mostly the redraw: 935 ms in one draw, of it about 620 ms Pixi
  rebuilding its batches for the rebuilt chunks and 185 ms rebuilding the gates' shapes, whose values changed too.

Now parts are named in one pass, once per edit and definition change (`partNames`, cached), and a state is applied on
the next task: states that arrived meanwhile are skipped and only the latest is shown, so they still queue but cost
nothing to drop. Any other message applies a waiting state first, so messages take effect in the order they came (an
error after a state stays the latest word). A state that arrived before a load was sent is not shown, and a reset or
a new load inside a skipped stretch still counts a new waveform epoch. That the waiting states collapse into one relies
on Chromium running tasks of one priority in the order they were queued, which is what was measured; a hidden tab's
timers run about once a second, so it shows about one state a second until it is visible again.

Before and after, back to back on mains power:

| Benchmark | Toggle before, ms | Toggle after, ms | Cycles per second before | Cycles per second after |
|---|---:|---:|---:|---:|
| counters-1k | – | – | 9034 | 8762 |
| cpu-1k | – | – | 8626 | 8353 |
| chain-10k | 878 | 1044 | – | – |
| fanout-10k | 1675 | 1464 | – | – |
| counters-10k | – | – | the page stopped answering | 2359 |

`counters-10k` now runs, at about 80 % of the slowest native measurement of the engine alone (2,900–4,700 cycles per
second), and Pause answers.
The toggle times here are within run-to-run noise: the after run was slower throughout, routing on open included,
which neither change touches. What remains of a toggle at 10,000 parts is the redraw when every wire and gate changes,
the next candidate: Pixi rebuilding its batches, and the gates' shapes.

### 4. Comparing on this machine, and the first state of a burst

A run on a quiet machine (under 12 % of the processor for two and a half minutes first, on mains power) did not settle
the six measurements above: its numbers moved up to two times in both directions against both earlier runs, and the
native harness ran two to five times faster than the native table, so the load that can be seen is not what moves them
(the processor's clock and which of its cores run Chromium are likely, not verified). A single run's numbers on this
laptop are only good for differences of more than two times.

What is reliable is an interleaved comparison: the two builds measured alternately, A, B, A, B, minutes apart. Done for
the code before steps 3.2 and 3.3 against after them:

| Measurement | Before, two runs | After, two runs |
|---|---:|---:|
| `chain-1k` toggle, ms | 36, 44 | 88, 89 |
| `chain-10k` toggle, ms | 831, 716 | 613, 572 |
| `chain-1k` autosave, ms | 12, 7 | 8, 9 |
| `chain-10k` autosave, ms | 169, 175 | 40, 57 |
| `chain-10k` drag draw, ms | 116, 129 | 57, 48 |
| `cpu-10k` cycles per second | 3,056, 2,923 | 3,000, 2,284 |

Of the six, this measured two: `chain-1k`'s autosave is noise, and its toggle was a regression: since step 3.3 every
state waited for a timer task, so the readout and the redraw could slip a frame or two. `cpu-10k`'s run speed, which
the loaded run's text had also questioned, is no regression. The other four, compared the same way in three rounds
each, before steps 3.2 and 3.3 against main after the fix below:

| Measurement | Before, three runs | After, three runs |
|---|---:|---:|
| `adder-1k` autosave, ms | 41, 12, 8 | 13, 19, 8 |
| `cpu-10k` autosave, ms | 6, 7, 5 | 10, 5, 11 |
| `cpu-1k` drawing on open, ms | 213, 114, 96 | 52, 34, 34 |
| `counters-10k` pan, fps | 20, 20, 20 | 12, 20, 20 |
| `counters-10k` drag draw, ms | 404, 439, 344 | 102, 62, 62 |
| `counters-10k` autosave, ms | 2,632, 2,494, 1,875 | 71, 56, 58 |
| `counters-10k` cycles per second | page stopped answering, three times | 2,057, 3,268, 3,667 |

None of the four is a regression: each side's runs overlap (for `cpu-10k`'s autosave and `counters-10k`'s pan, by one
run each), or the after side is faster. The last three rows confirm steps 3.2 and 3.3 at 10,000 parts.

Now the first state of a burst is applied at once; states that arrive before the next task are held, and only the
latest is shown then. A backlog still collapses, at the cost of one more state shown per burst: under a sustained
backlog every other state shown is already out of date, so showing a frame can cost up to twice what it did with only
the latest. The first state after a load is shown a task sooner too, so an open ends that much earlier than in older
tables. Interleaved, the code
before this change against after it:

| Measurement | Before, two runs | After, two runs |
|---|---:|---:|
| `chain-1k` toggle, ms | 82, 82 | 20, 24 |
| `chain-10k` toggle, ms | 457, 466 | 70, 68 |
| `counters-10k` cycles per second | 4,379, 3,694 | 4,510, 3,960 |

The toggle is measured to the readout, which now updates before the canvas is drawn again; the canvas still takes the
redraw after it, a few hundred milliseconds at 10,000 parts when every wire changes, which this benchmark does not see.
In this second comparison drags, autosaves and pans were the same on both sides. The table above predates this
change.

### 5. Routing with an index

Every wire's search marked its box by scanning every part and every route laid so far, so routing a whole sheet, which
an open does, grew with the square of its size. Now parts, junctions and laid routes are filed by tiles of 16 cells
(routes by their segments), and a search visits only the tiles its box touches. A route with a segment across more
than 64 tiles is kept in a plain list and checked by its bounding box, as before, so a wire between parts a million
cells apart costs what it did (ADR 0011). The routes are the same: every committed and generated 1,000- and
10,000-part benchmark and every example routed to byte-identical JSON before and after, and a test compares seeded
random circuits, with lines laid across them, against tiles wider than any sheet, which is the old scan.

Routing a whole sheet in Node (vitest), before and after:

| Benchmark | Before, s | After, s |
|---|---:|---:|
| chain-10k | 12.2 | 0.26 |
| adder-10k | 19.7 | 0.95 |
| counters-10k | 21.4 | 1.16 |
| fanout-10k | 25.9 | 8.9 |

Opening in the browser, interleaved (A, B, A, B; one round at 50,000 parts):

| Benchmark | Open before, s | Open after, s | Of it: routing after, s |
|---|---:|---:|---:|
| chain-10k | 9.5, 7.1 | 1.35, 1.29 | 0.18, 0.17 |
| adder-10k | 19.0, 12.3 | 5.4, 4.6 | 0.76, 0.71 |
| counters-10k | 13.2, 12.2 | 3.9, 3.7 | 0.86, 0.84 |
| fanout-10k | 19.0, 13.3 | 13.0, 6.2 | 10.6, 4.7 |
| chain-50k | 136 | 6.3 | 0.77 |
| counters-50k | 169 | 22 | 2.8 |

`chain` now opens within the targets at both sizes. What remains of the others' opens is mostly drawing outside
routing (drawing less routing: 3.4–4.1 s for `adder-10k`, 2.7–2.8 s for `counters-10k`, 18.5 s for `counters-50k`),
not yet profiled. For `fanout` it is still routing: its wires run from one switch across the sheet, so each searches a
large box, and in a profile in Node (6.6 s that run) about a third is still spent visiting the index (`avoid`, mostly the same net's
long routes, filed in many tiles), the rest in the searches. These tables were measured before long routes were kept
in a list: where a sheet has many (`fanout-50k`, `counters-50k`), checking that list makes routing about a tenth
slower in Node, still far faster than before the index. Toggles, drags,
pans and run speed were the same on both sides. The table above predates this step.

### 6. Labels from bitmap fonts

A profile of opening `adder-10k` (4.7 s) put 1.6 s in labels: each Pixi `Text` drew itself on a canvas of its own and
uploaded it as a texture, and the sheet has about 15,000 labels (each full adder's name and pin names, each switch's
and LED's). The rest was routing (0.7 s), building shapes (about 0.5 s) and the first frame's shaders (0.6 s).

Labels are now Pixi `BitmapText`, drawn from glyph atlases at the same twice-the-device-ratio resolution. A first
version gave each label a plain text style and let Pixi make fonts from them: its font cache did not match between
labels, so it built a font, and a 2,048-pixel atlas page, almost per label, and `adder-10k` opened in 289 and 405 s.
Now the canvas installs one font per look: plain labels share a white one, tinted to their colour; captions with a halo
get one per colour, with the halo drawn in. An atlas keeps the face it was drawn in, and Pixi keeps text measurements
by style, so once IBM Plex Mono arrives the canvas clears those measurements, uninstalls its fonts and draws its labels
again; a label drawn before the font arrived then ends up pixel-identical to one drawn after. A halo no longer pushes
a caption's glyphs down as a `Text`'s stroke did, so captions are placed 3 px lower to stay where they were.

Opening, interleaved (A, B, A, B), measured with a version that waited for the font before the canvas started (in
the benchmark the font has arrived before the file is opened, so the redraw then runs on an empty sheet):

| Benchmark | Open before, s | Open after, s |
|---|---:|---:|
| adder-1k | 0.52, 0.58 | 0.52, 0.54 |
| adder-10k | 5.0, 5.8 | 2.8, 3.2 |
| counters-10k | 3.6, 4.8 | 2.7, 3.3 |
| chain-10k (no labels) | 1.3, 1.4 | 1.3, 1.5 |

Toggles, drags, pans and run speed were within the runs' noise. Labels look the same, checked against the same text
in the page's own IBM Plex Mono in both themes, and measured in production builds: plain labels within a pixel of where
they were, captions where they were. One difference: an emoji in a plain label (a name, a pin name) is tinted to the
label's colour, where a `Text` kept its own colours; captions keep them.

### 7. One shape for parts that look alike

A profile of the opens that remained (on battery, so for proportions only) found no single large cost: routing took
22–26 % of `adder-10k` and `counters-10k`, drawing the wires 22–23 %, and building part shapes 12–15 %. Every part built
its own shape, though thousands are identical, and a part's look held the value of every port, so a toggle rebuilt gates
that show no signal.

A part's look now holds only what its drawing reads: its kind, its cached layout, the one signal it shows if any (an
LED's, a switch's, a clock's, a display's segments), and its error and keyboard state. Parts with the same look share
shapes. A screen keeps its own, since each shows its own picture.

One shape per look was not enough. A Pixi `Graphics` listens to its shape, and removing a listener scans them all, so
with every gate on one shape, deleting parts or changing theme became quadratic: 30–50 s at 50,000 parts. Each look is
therefore split into 256 shapes by a hash of the part's ID. 64 left deleting slower than before at 50,000 parts, and
1,024 gained nothing. Looks come and go, since every value a display shows is one, so once there are more than 1,024
shapes those no part shows are dropped. 32 displays passing through all 256 values hold 24 MB of JavaScript heap;
without the dropping they held 426 MB, and before this step 9 MB.

Production builds of the code before and after this step were compared in 30 canvas states: every example at rest and
stepped, toggles, both themes and a change between them, placement previews, and parts in error. They match, apart
from a pixel that can differ by one colour level, as it also does between two sessions of one build.

Opening and working on a sheet, interleaved (A, B, A, B), on mains power:

| Benchmark | Measurement | Before, two runs | After, two runs |
|---|---|---:|---:|
| chain-10k | open, s | 1.34, 1.43 | 0.61, 0.68 |
| counters-10k | open, s | 2.76, 3.18 | 2.06, 2.22 |
| adder-10k | open, s | 2.88, 3.00 | 2.31, 2.39 |
| fanout-10k | open, s | 7.1, 8.7 | 5.7, 6.2 |
| chain-10k | pan, fps | 30, 30 | 60, 30 |
| counters-10k | pan, fps | 30, 30 | 60, 30 |
| fanout-10k | pan, fps | 30, 15 | 60, 30 |
| adder-10k | pan, fps | 20, 20 | 20, 20 |

Drags and toggles to the readout varied too much between these runs to show a change either way. Run speed did not
fall (`counters-10k` 2,832 and 2,924 cycles per second before, 3,905 and 2,607 after).

Changing theme and deleting every part, the longest redraw of each, interleaved the same way. The first run before the
change was slow throughout, as a first run after a build can be:

| Benchmark | Measurement | Before, two runs | After, two runs |
|---|---|---:|---:|
| chain-10k | theme change, ms | 1,305, 387 | 144, 138 |
| chain-10k | delete all, ms | 306, 75 | 71, 71 |
| counters-10k | theme change, ms | 2,780, 778 | 494, 511 |
| counters-10k | delete all, ms | 552, 146 | 133, 137 |
| chain-50k | open, s | 23.0, 6.0 | 2.43, 2.40 |
| chain-50k | theme change, ms | 8,684, 2,170 | 781, 734 |
| chain-50k | delete all, ms | 1,179, 1,348 | 1,221, 1,241 |

Routing is the largest single part of an open that is measured: of the open times above, about 30 % of `chain-10k`, a
third of `adder-10k`, over two fifths of `counters-10k` and over four fifths of `fanout-10k`. Section 9 profiles what
was left after section 8.

### 8. Searching fewer cells

`fanout-10k` spent over four fifths of an open routing. Counting what its searches did showed three things. Half its
wires, each NOT gate's to its LED, start at a port whose first cell is taken: each built two search boxes only to find
that. The other wires that fit a box visited about 7,400 search states each, because the estimate of what was left
counted distance alone, while every bend costs 3 more. And each search walked every route of its own net in every tile
it touched, thousands of them where one net fans out across the sheet, only to skip them.

Now:

- On sheets of 2,000 wires or more, the estimate also counts the bends a route must still make, from its heading and
  the direction it has to arrive in. The search then leaves out cells that cannot lie on a cheapest route. A test checks
  the count against every position on an open grid: it is never more than a route needs, and no step lowers it by more
  than that step costs, which is what keeps each search's route cheapest.
- A port's first cell is checked on its own, before any box is built.
- Each tile holds its routes by net, so a search skips its own net at once.
- Routes beside a box are no longer walked along it, and the search's innermost loop is written out.

**Sheets under 2,000 wires route exactly as before**, and a test holds every example to its routes. Counting bends
everywhere was tried first. Each search still found a route of the same cost on the same obstacles (about 87,000
searches compared, on the examples, the 1,000- and 10,000-part benchmarks and 400 random sheets). But when several routes
tie it can take another of them, later wires then meet different obstacles, and a whole sheet can end up worse: on the
reference CPU, wires no search could place went from 34 to 37, one of them a straight line through five parts. Routing a
sheet that size takes about 0.2 s, so it has little to gain. A fan-out just under the limit gives up more: at 1,999
wires it still takes seconds to route, though no longer than before.

**Larger sheets can change.** Of the 10,000- and 50,000-part benchmarks only `fanout` does: 18 wires, with the same total
length and bends. On all of them, as many wires are left without a search's route as before. Another sheet of that size
could gain or lose such a wire.

Opening, interleaved (A, B, A, B), **on battery**, so everything is slower than the tables above. These runs came just
before the limit of 2,000 wires, which none of these sheets is under:

| Benchmark | Open before, s | Open after, s | Routing before, s | Routing after, s |
|---|---:|---:|---:|---:|
| chain-10k | 1.13, 1.19 | 1.07, 1.02 | 0.31, 0.34 | 0.29, 0.29 |
| adder-10k | 4.23, 4.24 | 3.30, 3.41 | 1.47, 1.43 | 0.43, 0.52 |
| counters-10k | 3.73, 3.85 | 3.11, 3.16 | 1.59, 1.62 | 0.88, 0.89 |
| fanout-10k | 10.8, 10.8 | 3.38, 3.53 | 9.08, 9.12 | 1.60, 1.66 |
| chain-50k | 4.60, 4.62 | 4.62, 4.79 | 1.37, 1.51 | 1.42, 1.31 |
| counters-50k | 13.7, 14.0 | 12.1, 11.4 | 4.80, 5.15 | 3.11, 3.13 |
| fanout-50k | 30.1, 25.9 | 15.0, 14.2 | 19.4, 16.3 | 4.06, 4.10 |

`chain` barely searches (22 states a wire), so it gains nothing. Routing is now under half of every open here, and the
rest, drawing above all, is what remains: about 2.9 s of `adder-10k` and 2.2 s of `counters-10k` on this power.

### 9. Label characters and long part lists

A profile of the opens left after section 8, on mains power, put them at about 2.1–2.7 s and found two costs that had
nothing to do with drawing or routing:

- **Pixi split every label with `Intl.Segmenter`**, 135–293 ms of `counters-10k` and `adder-10k`, to learn that each
  character of an ASCII label stands alone. Printable ASCII now skips it, through Pixi's `graphemeSegmenter` hook; any
  other text, `\r\n` included, still goes to the segmenter.
- **React placed each row of the two part lists on its own.** The hidden readout has one row per switch, keyboard, LED
  and display, and the "Run until" menu one option per 1-bit LED: 7,499 and 2,500 on `adder-10k`. Placing a row among
  new siblings looks through all those after it, which grows with the square of the list. The rows now sit in a
  fragment keyed by `opens`, a count of the sheets and documents swapped in, so a new sheet's rows go in as one. Edits
  keep their rows.

The readout's rows also lost their list markers, which took layout and style work for something nobody sees. The list
says `role="list"`, since Safari otherwise stops announcing it as one.

`content-visibility: auto` on the readout saved about 300 ms more layout, but **took every row out of Chromium's
accessibility tree**, which is the list's whole purpose, so it was dropped. `contain: strict` saved nothing.

Each open against main's build, alternating, nine rounds, median of the paired differences. These ran **on battery with
other work on the machine**, so the times are two to three times those on mains, and the differences are what to read. Main-thread
time comes from Chromium's own counters, which other programs disturb less than the clock:

| Benchmark | Open before, s | Open, change, ms | Main thread, change, ms | Layout and style, change, ms |
|---|---:|---:|---:|---:|
| adder-10k | 6.47 | −1,297 | −1,303 | −211 |
| counters-10k | 5.45 | −543 | −556 | −13 |
| fanout-10k | 6.28 | −184 | −385 | −166 |
| chain-10k | 1.96 | +35 | +63 | −1 |

`chain` has two list rows and no labels to speak of, so its change is noise. The largest costs left are routing on
`counters` and `fanout`, then drawing. Each open also draws the whole sheet a second time when the engine's first state
arrives, which is not yet looked into.

## Earlier measurements

- The reference CPU runs at the 10,000 cycles per second setting in the browser, about 9,950 measured (ADR 0019).
- Natively, Catch on the reference CPU runs at 115,000–133,000 cycles per second, with or without 16 recorded traces
  (ADR 0026).
