# 0039. Computers you can read: regions, routing clear of label tags, jumping to a note, the program followed

- Status: Accepted
- Date: 2026-11-22
- Depends on: ADR 0037 (Phase 7 plan, increment 2); ADR 0038 (notes on the
  canvas); ADR 0015 (net labels and their tags); ADR 0011 and ADR 0033
  (routing, kept routes, opening framed); ADR 0017 (the open sheet is what
  runs); ADR 0019 and ADR 0036 (the reference CPUs and the program
  editor); ADR 0024 (links); ADR 0030 (benchmarks); ADR 0034 (the cut CPU,
  left as it is)

## Context

ADR 0037 item 2 asks that the bundled computers can be read: their sheets
laid out in titled regions, routing that keeps clear of label tags first,
a list of a sheet's notes that jumps the view to each, the program
editor's listing marking the word at the ROM's address, and the about page
brought up to date. Its target: in a 1280×800 window with the left panel
and the inspector open, each region of the reference CPU fits the canvas
at 100% when jumped to, and stepping one instruction moves the listing's
mark to the next.

What there is:

- **The sheets.** `scripts/reference-cpu.mjs` places every part by hand:
  81 parts, 174 wires, 6 net labels over 152 × 82 cells, written as format
  version 11. `scripts/reference-cpu-2.mjs` imports those parts and wire
  pairs, rewrites some pairs by their `"from>to"` text (throwing if one is
  missing), checks that its own parts do not overlap them, and adds its
  own: 117 parts, 271 wires, 160 × 124 cells. The same scripts write Catch
  and Catch 2, and `--check` (in `pnpm verify`) fails if a committed file
  is not what they would write.
- **What else follows those files:**
  - `scripts/computer.mjs`, the cut CPU of challenge 11's bench (ADR
    0034), keeps its own copy of the positions;
  - `scripts/benchmarks.mjs` builds `benchmarks/cpu-1k.clockyard.json`
    from the example, and its `--check` is in `pnpm verify`;
  - `apps/web/src/canvas/routing.test.ts` pins route hashes for Catch, the
    reference CPU and the devices example;
  - `apps/web/src/storage/link.test.ts` requires Catch's link to stay
    under 8,000 characters; it is about 7,300 now (amended below: under
    10,000);
  - Playwright clicks the program ROM at (22, 14), and the test of opening
    framed (ADR 0033) names its position; `apps/web/scripts/landing-shots.mjs`
    clicks parts and crops Catch's devices by pixel for the about page.
- **The tests of behaviour** (`crates/sim-core/tests/cpu.rs`, `cpu2.rs`)
  run the circuits against independent models and do not care where parts
  are.
- **Names.** `docs/reference-cpu.md` names the architectural registers and
  ports (`PC`, `IR`, `A`, `Z`, `C`, `T`, `H`, `OUT`, `KEY`, `SPTR`,
  `SDATA`, `HEX`). The control lines are named only in
  `scripts/cpu-pieces.mjs` (`aLoad` and the rest); nothing names the ALU's
  output.
- **Everything runs on the open sheet** (ADR 0017), so the regions stay
  on the main sheet.
- **Label tags** (ADR 0015 item 7) are drawn beside a named junction, in
  11 px bitmap mono, on the first side, of right, left, below and above,
  that no *route* leaves by. Routing treats only part bodies and junction
  dots as obstacles (`obstaclesOf`): a wire may run under a tag. An edit
  reroutes only wires near parts or junctions that moved (`unaffected`).
- **Notes** (ADR 0038) are plain text at a grid point, one size, under
  wires and parts, which do not avoid them. ADR 0038 left to this ADR
  whether a note gets a size.
- **The canvas** in a 1280×800 viewport, with the left panel (232 px) and
  the inspector (280 px) open, is 768 × 728 px: 48 × 45 cells at 100% (a
  cell is 16 px); the zoom controls take the bottom right corner. A
  document opens framed, never below 25% (ADR 0033).
- **The program editor** renders for the selected 16-bit ROM, and shows
  its listing as one block of text, disassembled from the first 256 words.
- **The reference CPUs take two cycles an instruction**: fetch, then
  execute. `PC` drives the program ROM's `addr`; the fetch cycle ends with
  `PC` already moved on, so the word at `addr` after it is the next
  instruction's. The `Fetch` LED is lit during fetch cycles.
- **The about page** (`apps/web/about/index.html`) shows the reference CPU
  with 13 block outlines placed by hand in percentages over its shot
  (Fig. 5), refers to blocks by number ("the ALU is block 7"), plays a
  recording of the CPU stepping and a hero loop cropped from Catch, and
  embeds two Catch links. Its text predates the tri-state buffer and
  counts nine challenges.
- **Rough edges this increment closes:** routing over label tags; the
  reference CPU's dense sheet opening at about 30%; the about page out of
  date.

## Decision

1. **Label tags are obstacles, and their side is known before routing.**
   - **Side.** From each of the label's wires, the direction from the dot
     to the wire's far end (a port's or a junction's position): right if
     the far end is further right, left if further left, below and above
     the same way, so a diagonal far end takes two sides. For a wire the
     user shaped, its bend nearest the dot stands for the far end, since
     it is laid as shaped (amended in step 1). The tag takes
     the first side, of right, left, below and above, that no wire takes.
     If all four are taken, it is drawn on the right as today and is no
     obstacle.
   - **Box.** The grid points the tag covers, reckoned from its name by
     one function the router and the canvas share: half a cell a character
     (generous for 11 px mono, about 0.4 of a cell), one row, starting one
     point from the dot on its side, or centred on the dot's column above
     or below. The canvas draws the tag where it draws it now, and picks
     it (`tagAt`) by the drawn tag, as now; the reckoned box only keeps
     routes away.
   - **Routing.** Tag boxes go into `obstaclesOf` as bodies: every net's
     routes keep clear of them, the label's own included, so no wire hides
     its own name. The dot stays a reachable goal. Where nothing clear
     exists, the plain orthogonal fallback (ADR 0011) is laid, as it is
     when bodies leave no way.
   - **Kept routes.** A label whose box changed (renamed, or its side
     flipped because a far end moved) counts as moved for `unaffected`, so
     routes near it are laid again.
   - The route hashes in `routing.test.ts` are checked in the same pull
     request (as built, none changed: the examples' routes already kept
     clear of their tags); the benchmarks are measured before and after.
   - The box is generous, so it can cover a neighbouring dot or the first
     cell outside a port; a wire that then has no way out takes the plain
     fallback (ADR 0011). Step 4's layout test catches any in the CPUs.

2. **Notes stay one size.** A region is titled by one note: its first line
   is the title, and the lines after it say what the region does. Nothing
   is added to the format. Frames or larger type can come later if titles
   prove too quiet.

3. **Jumping to a note.** The inspector's Notes section, which holds the
   project's notes (ADR 0027), gains a list of the open sheet's notes by
   their first line, top to bottom, then left to right. Choosing one sets
   the zoom to 100% and puts the note one cell in from the canvas's top
   left corner. It does not change the selection, so the program editor
   stays open beside a region. The list is reachable by keyboard, and the
   jump is announced ("Showing Fetch.").

4. **The program followed.**
   - The listing becomes one row per word, and the row at the ROM's `addr`
     now is marked: highlighted, with `aria-current`. The address comes
     from a selector that reads only that net from the engine's state; while
     the state is stale, `addr` has unknown bits, or the address is past the
     words listed (those stored, up to 256), nothing is marked.
   - The marked row is scrolled into view when the clock is paused, after a
     Step or a Reset, never while running, so a run does not fight the
     reader's own scrolling.
   - A line under the listing says what the mark is: "Marked: the word at
     the ROM's address now: in a CPU fetching from this ROM, the next
     instruction to run, once its fetch has begun." It knows nothing of
     CPUs, so it works for any circuit that fetches from a ROM on the open
     sheet. A ROM inside an instance on this sheet cannot be selected, so
     it is not followed; opening its component's sheet follows it there,
     since the open sheet is what runs (ADR 0017).

5. **The reference CPUs laid out in regions.**
   - **Regions** are rectangles of at most 44 × 40 cells, each with its
     note at its top left corner, in a grid of at
     most three columns with 4 cells between them, so a sheet still opens
     framed at 25% or more. The first CPU: Clock and phase; Fetch (`PC`,
     the program ROM, `IR`); Control; Registers; ALU; Memory and I/O (RAM
     and the decoding of the devices' addresses); Devices (keyboard,
     screen, digits). Reference CPU 2 adds the Logic unit and the Stack,
     and may split a region its additions outgrow. CPU 1's regions leave
     room for what CPU 2 adds beside them.
   - **Titles and text.** Each region's note: a title, and a few lines in
     the words of `docs/reference-cpu.md` where it describes the region,
     and of the generator's own comments where it does not (control, the
     decoding).
   - **Net labels between regions,** in place of long wires, named as the
     specification names the signal where it does (`PC`, `IR`, `A`, `Z`,
     `C`, `KEY`, …), and otherwise as `cpu-pieces.mjs` does (`aLoad`, …);
     the ALU's output is named `ALU` here and in its region's note.
   - **The generators** write format 13 (the version with notes). They
     keep `--check`, and check what they can see: every wire's two ends lie
     in one region, or it goes through a label; no two regions overlap;
     every part lies inside one region. They export the region rectangles,
     so tests read the same ones.
   - **The layout check** is a Vitest test over each example file, routed
     by the editor's own router: every part, tag and route lies inside its
     region; no route crosses a note; no wire falls back to the plain
     path, which the router counts in a figure exported for tests
     (`fallbacks`).
   - **Connectivity does not change.** A committed fixture records, for
     each example, which ports share a net today, computed by union-find
     over its wires and label names. A test computes the same for the new
     files and compares partitions (junction and wire IDs may change;
     ports may not), and checks that the engine reports no diagnostic it
     did not report before (no `unmatchedLabel`, say).
   - **What follows,** in the same pull request: Catch, Catch 2, `cpu-1k`
     and its check, the route hashes, and the Playwright tests that click
     parts.
   - **The cut CPU** of challenge 11's bench (`scripts/computer.mjs`) is
     left as it is: it is a component inside the challenge files, spread
     from the old positions for its pins-only starter, not a computer
     shown to read; relaying it would change challenge 11's starter and
     the challenges' format for no reader's gain. ADR 0037 expected it to
     follow; this records why it does not.
     Catch's link stays under 8,000 characters; if region text pushes it
     over, Catch keeps only the titles.

6. **The about page:** Fig. 5 shows a region-laid CPU, its outlines
   placed by region instead of 13 hand-placed blocks, and the text refers
   to regions by name; the shots, the CPU recording and the hero loop's
   crops are made again by `landing-shots.mjs`; the two Catch links are
   made again; the text says twelve challenges, the tri-state buffer, two
   reference CPUs, the push button and notes. (Its list of challenges
   grows in increment 4.)

7. **Steps,** one pull request each:
   1. **Routing clear of label tags,** with the side from wire ends, the
      shared box, and kept routes near a changed tag laid again. Vitest: a
      route around a tag, a diagonal far end taking two sides, a full dot
      with no obstacle, a rename rerouting what its tag now covers. The
      route hashes updated; benchmarks before and after, and a sheet of
      many labels (the reference CPU) measured in step 4.
   2. **Jumping to a note,** with Vitest for the list's order and the view
      it sets, and that the selection stays.
   3. **The program followed,** with Vitest for the marked row (stale,
      unknown, past 256), and Playwright: on the reference CPU, Run until
      `Fetch` lights; at each cycle of an instruction that is not a jump,
      the mark is where the specification says `PC` is.
   4. **The reference CPUs in regions,** both at once, since the second
      is built from the first: the generators, the connectivity fixture
      and test, the router's fallback count and the layout test,
      everything that follows (item 5), and the
      target: in a 1280×800 viewport with both panels open, jumping to
      each region's note gives 100% with the region's rectangle inside the
      canvas, and the sheet opens framed at 25% or more.
   5. **The about page,** and the roadmap marks increment 2 done and the
      three rough edges closed.

## Consequences

- A visitor can open the reference CPU, jump region by region at a
  readable size, and watch the program's mark move as it steps.
- Routing does a little more work on sheets with labels, and wires around
  tags are longer; names are never hidden under wires.
- The CPUs' sheets look new: anyone who learned the old layout, or wrote
  coordinates against it, has to look again. Their behaviour does not
  change, and a test says so.
- Step 4 is a large pull request: the two CPUs cannot be laid out apart.
- Region titles are as quiet as any note; that may need revisiting.
- **Left out:** frames around regions, note sizes, collapsing regions, a
  minimap, a mark on the canvas, and following a ROM inside a component.

## Amendment (2026-11-22): laying the CPUs out (step 4)

- **Catch's link is about 9,300 characters,** over the 8,000 of item 5,
  even with its notes cut to titles. What grew is the wiring between
  regions: 75 net labels against 6 before. Getting under 8,000 would mean
  some 40 fewer labels, so long wires across the sheet again. 8,000 is
  only where Copy link starts to warn that some apps cut long links
  (ADR 0024); browsers open far longer ones. The test's bound is now
  10,000, and Catch keeps only its regions' titles.
- **The regions differ from item 5 in three places:**
  - Jumps (whether JMP, JZ or JC loads the PC with n) is a region of its
    own beside Control, which did not fit 44 × 40 with it;
  - in CPU 2, Shifts is split off the Logic unit;
  - the `SPTR` and `HEX` registers and `OUT` sit in Devices, beside what
    they drive, not in Memory and I/O.
- **Label names.** Where neither the specification nor `cpu-pieces.mjs`
  names a signal, the generators coin a short name: `clk`, `one`, `zero`,
  `zero8`, `opcode`, `jump`, `B`, `logic`, `dropped`, `return`,
  `sptrWe`, `hexWe`, `sdataWe`. The old `KEY`, `HEX high` and `HEX low`
  labels are gone; part IDs do not change.
- **Captions are not obstacles,** so a few labels sit over a part's
  caption. Left as it is.
