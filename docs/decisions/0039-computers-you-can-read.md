# 0039. Computers you can read: regions, routing clear of label tags, jumping to a note, the program followed

- Status: Proposed
- Date: 2026-11-22
- Depends on: ADR 0037 (Phase 7 plan, increment 2); ADR 0038 (notes on the
  canvas); ADR 0015 (net labels and their tags); ADR 0011 (routing); ADR
  0017 (the open sheet is what runs); ADR 0019 and ADR 0036 (the reference
  CPUs and the program editor); ADR 0020 to 0023 (the examples built on
  them)

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

- **The sheets.** `scripts/reference-cpu.mjs` places every part by hand
  on one sheet: 81 parts, 174 wires, 6 net labels, spread over 152 × 82
  cells. `scripts/reference-cpu-2.mjs` starts from those parts and adds
  its own: 117 parts, 271 wires, 160 × 124 cells. The same scripts write
  Catch and Catch 2 (the same circuits with a game in the ROM) and check
  the committed files (`--check`, run by `pnpm verify`). The Rust tests
  (`crates/sim-core/tests/cpu.rs`, `cpu2.rs`) run the circuits against
  independent models; they do not care where parts are. Some Playwright
  tests click parts at grid points (the keyboard, the screen).
- **Everything runs on the open sheet** (ADR 0017), so the regions stay
  on the main sheet: no part moves into a component.
- **Label tags** (ADR 0015 item 7) are drawn beside a named junction on a
  side its wires do not take, sized by the name's text. The side is found
  from the *routes*, after routing, and routing treats only part bodies
  and junction dots as obstacles: a wire may run under a tag. On a sheet
  that leans on labels, wires through tags hide names.
- **Notes** (ADR 0038) are plain text at a grid point, one size, under
  wires and parts. ADR 0038 left to this ADR whether a note gets a size.
- **The canvas** at 1280×800 with the left panel (232 px) and the
  inspector (280 px) open is 768 × 728 px: 48 × 45 cells at 100% (a cell
  is 16 px), less the zoom controls in the bottom corner.
- **The program editor** shows a ROM's listing, disassembled from its
  words, and knows nothing of the running circuit.
- **The reference CPUs take two cycles an instruction**: fetch, then
  execute. `PC` is the address of the next instruction to fetch, and it is
  what drives the program ROM's `addr`.
- **The about page** (`apps/web/about/`) shows shots of the reference CPU
  and its program, made by `apps/web/scripts/landing-shots.mjs`, and text
  written before the tri-state buffer, Reference CPU 2 and challenges past
  the first few.

## Decision

1. **Label tags are obstacles, and their side is known before routing.**
   - A tag's side is chosen from where its wires *go*, not from their
     routes: each wire's far end (a port or junction position) gives a
     direction from the dot, and the tag takes the first side, in the
     order right, left, below, above, that no wire's far end lies towards.
     So routing and drawing agree, and the side does not change when a
     route does.
   - A tag's box in grid cells is reckoned from its name as a note's is
     (half a cell a character, one cell high, plus the gap to the dot), in
     one function the canvas and the router share.
   - The router blocks the cells under every tag for wires of *other*
     nets; a wire of the label's own net may still cross it, since it joins
     there anyway. Where no route clear of tags exists, the router's
     fallback (ADR 0011), a plain orthogonal path, still lays one, as it
     does when bodies leave no way.
   - The cost is measured on the ADR 0030 benchmarks, which have few
     labels; a sheet with many is measured too (the new reference CPU).
   - This closes the rough edge "Routing does not yet avoid label tags".

2. **Notes stay one size.** A region's title is a note, its first line the
   title; nothing is added to the format. A frame or larger type can come
   later if titles prove too quiet.

3. **Jumping to a note.** The inspector's Notes section, which holds the
   project's notes (ADR 0027), gains a list of the open sheet's notes, by
   their first line, top to bottom then left to right. Choosing one sets
   the zoom to 100% and puts the note one cell in from the canvas's top
   left corner, and selects it. The list is keyboard reachable, and the
   view change is announced ("Showing Fetch.").

4. **The program followed.** The program editor's listing marks the word
   at the ROM's `addr` now, read from the engine's nets as the readout
   reads them: the row is highlighted, scrolled into view, and given
   `aria-current`. When `addr` is unknown, or the ROM is not on the open
   sheet's circuit as loaded, nothing is marked. A line under the listing
   says what the mark is: "Marked: the word at the ROM's address now. In a
   CPU that fetches from this ROM, the next instruction to run." It knows
   nothing of CPUs.

5. **The reference CPUs laid out in regions.**
   - **Regions** are rectangles of at most 44 × 40 cells, each with a
     title note at its top left, laid on the sheet in a grid with a gap
     between them. The first CPU: Clock and phase; Fetch (PC, the program
     ROM, IR); Control; Registers; ALU; Memory and I/O (RAM and the
     devices' decoding); Devices (keyboard, screen, digits). Reference CPU
     2 adds the Logic unit and the Stack, and may split a region that
     outgrows its rectangle. Each region holds a few lines of note text
     beside its title saying what it does, in the words of
     `docs/reference-cpu.md`.
   - **Between regions, net labels** in place of long wires: a signal that
     crosses regions leaves its region through a label named as the
     specification names it (`PC`, `IR`, `ALUOUT`, the control lines).
   - **The generator checks the layout:** every part, junction and wire
     bend lies wholly inside one region's rectangle, and no two regions
     overlap; otherwise the script fails, so `--check` keeps it so.
   - **Connectivity does not change.** A test (Node, beside the
     generators' check) loads the circuit before and after the relayout
     into the engine and compares, port by port, which ports share a net.
     The models, the Rust tests and what they check do not change; the
     Playwright tests that click parts at grid points do.
   - Catch and Catch 2 follow, since the same scripts write them.

6. **The about page** gets new shots of the reference CPU (a region at
   100%, and the program editor with its mark) from
   `landing-shots.mjs`, and its text brought up to date: twelve
   challenges, the tri-state buffer, two reference CPUs, the push button
   and notes. (Its list of challenges grows in increment 4.)

7. **Steps,** one pull request each:
   1. **Routing clear of label tags,** with the tag's side from wire ends.
      Vitest: a route around a tag of another net, one through its own
      net's tag allowed, the side unchanged when a route changes.
      Benchmarks before and after.
   2. **Jumping to a note,** with Vitest for the list's order and the view
      it sets.
   3. **The program followed,** with Vitest for the marked row, and
      Playwright stepping the reference CPU: two Steps move the mark to
      the next instruction.
   4. **Reference CPU in regions** (and Catch): the generator, its layout
      check, the connectivity test, the Playwright tests that click its
      parts, and the target: at 1280×800 with both panels open, jumping to
      each region's title gives 100%, and the region's rectangle lies
      inside the canvas.
   5. **Reference CPU 2 in regions** (and Catch 2), the same way.
   6. **The about page:** shots and text. The roadmap marks increment 2
      done.

## Consequences

- A visitor can open the reference CPU, jump region by region at a
  readable size, and watch the program's mark move as it steps.
- Routing does a little more work on sheets with labels, and wires around
  tags are longer; names are never hidden under wires of other nets.
- The CPUs' sheets look new: anyone who learned the old layout, or wrote
  coordinates against it, has to look again. Their behaviour does not
  change, and a test says so.
- Region titles are as quiet as any note; that may need revisiting.
- **Left out:** frames around regions, note sizes, collapsing regions, a
  minimap, and following the program anywhere but the listing (no mark on
  the canvas).
