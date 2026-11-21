# 0037. Phase 7: the playground's gaps, computers you can read, and a project others can join

- Status: Accepted
- Date: 2026-11-21
- Depends on: ADR 0028 (the Phase 6 plan, now built); ADRs 0029–0036;
  ADR 0009 (local checks instead of hosted CI); brief §2, §12, §13, §16

## Context

Phase 6 is built: local persistence (ADR 0029), benchmarks (ADR 0030),
editing a running circuit (ADR 0033), challenges 10 to 12 (ADR 0034),
four-state signals (ADR 0035) and a second reference CPU (ADR 0036).
Clockyard now does what the brief's definition of success asks, up to its
long-term goal: a user can build a CPU, write a program for it, and watch
it run through the circuit. Nothing is planned after it.

What is still open, from the brief and from the roadmap:

- **The playground lacks parts the brief lists** (§2.1, §2.2). None exists
  in any form today:
  - push buttons: a switch must be turned on and off again;
  - gates with more than two inputs: the engine's gates take two, and a
    wide function takes a tree of them;
  - text on the canvas: notes are a panel (`metadata.notes`), not labels
    beside the parts.

  Logic probes, which §2.1 also lists, exist in effect: a bus's value on
  hover, the readout, and waveforms. Latches, decoders and multiplexers
  are built from gates, as the challenges teach; they get no parts.
- **The bundled computers are hard to read.** The brief's promise is that
  computers are not black boxes (§16), and its Computer Lab (§2.3) asks
  that a user can see the current instruction, the registers, the ALU's
  operation and the active control signals as a program runs.
  - The reference CPU's sheet is 81 parts and 174 wires on one level;
    Reference CPU 2's is 117 parts and 271 wires. The first opens framed
    at about 30% in a laptop's window, too small to read its labels (a
    rough edge on the roadmap).
  - The registers can be read: the readout lists them, and the sheet's
    LEDs show them. Nothing shows where in the program the CPU is: the
    program editor's disassembly is a static listing of the ROM.
  - The editor simulates the sheet that is open (ADR 0017). A part of the
    CPU moved into a component and opened as its own sheet is simulated
    alone, not as the CPU runs it. So the insides must stay on the main
    sheet to be seen running, and *Run until*, the readout and the
    program editor all work on the main sheet's parts.
- **Rough edges:** 17 on the roadmap, one of them stale (bit operations
  and a call, which ADR 0036 built). Most are small; some make the tool
  harder to use than it should be, such as a component made by Make
  component covering the parts below it, or routing over label tags.
- **Challenges** stop at 12, the brief's list. Reference CPU 2 brought
  ideas the first twelve do not teach: decoding, shifting, a stack.
- **The repository is public, but not yet easy to join** (§13):
  - `CONTRIBUTING.md` says the project is at Phase 0 with the editor next,
    and names `pnpm test`, which `pnpm verify` does not run;
  - the README's table still says IndexedDB comes later;
  - there is no code of conduct, security policy, or issue and pull
    request templates;
  - no one has checked the dependencies' licenses, nor the fonts, shots
    and recording the build and the about page ship;
  - `sim-core`'s public items are not all documented (§13 asks that the
    core could become a library);
  - the scripts that check the generated examples decide whether they
    were run directly with `import.meta.main`, which Node has only from
    22.18 and 24.2, while `package.json` allows 22.13 or later: on an
    older Node their `--check` passes without checking anything.
  - Hosted CI was removed on purpose (ADR 0009): `pnpm verify` runs in
    each contributor's pre-push hook, to be revisited if outside
    contributions grow. They have not yet.

## Decision

1. **Phase 7 is a project phase,** run as Phases 5 and 6 were (ADRs 0020
   and 0028): increments, each with its own ADR, its own target that
   works in the browser and in tests, and steps of one pull request each.

2. **The order:**
   1. **The playground's gaps.**
      - A push button: an input that is 1 while pressed, by pointer, touch
        or a key. Press and release are input changes between ticks, as a
        switch's are; a clocked circuit can miss a press shorter than a
        clock cycle, which the increment's ADR says how to show.
      - Gates with 2 to 8 inputs, set in the inspector beside the width.
        Their rules (an N-input XOR is parity; how `X` and `Z` combine)
        are written in `docs/simulation-model.md` before any code, and
        the engine's cost on the benchmarks is measured. The file format
        changes.
      - Text on the canvas: notes placed on a sheet, kept in the document
        apart from its parts, so the engine never receives them.
      - Open for the increment's ADR: how a key reaches a push button
        without clashing with the editor's shortcuts and the keyboard
        part.
      - Target: a 4-input AND with a push button on each input, and a
        note beside it, saved and opened again.
   2. **Computers you can read.**
      - The reference CPUs' sheets laid out again in titled regions
        (fetch, control, the ALU, the registers, I/O, and on Reference
        CPU 2 the logic unit and the stack), using the notes of increment
        1 as titles and net labels in place of long wires. Everything
        stays on the main sheet, so it all runs live. The circuits'
        connectivity, their models and what their tests check do not
        change; their positions and wires do, and so do the end-to-end
        tests that click their parts.
      - Routing that keeps clear of label tags, from the rough edges,
        comes first, since the new layout leans on net labels.
      - A list of a sheet's notes that jumps the view to each, so a region
        can be shown at a readable zoom.
      - The program followed as it runs: the program editor's listing
        marks the word at the ROM's address now. On the reference CPUs
        that is the instruction to be fetched next; the listing says so.
        It knows nothing about CPUs: it reads the ROM's `addr` net, so it
        works for any circuit that fetches from a ROM.
      - The about page brought up to date with the bundled computers it
        shows: its shots, and its text (twelve challenges, the tri-state
        buffer, what is built), whatever work already under way on the
        page has not done by then.
      - Target: in a 1280×800 window, with the left panel and the
        inspector open at their default widths, each region of the
        reference CPU fits the canvas at 100% when jumped to; stepping one
        instruction moves the listing's mark to the next.
   3. **Rough edges.** The increment's ADR names the items to close:
      Make component covering parts, refusing a
      single item, and counting a bus that only passes through as a
      driver; the readout missing memories and screens; a bench
      challenge's text in one paragraph and its pass not naming runs; and
      the stale item, removed. Each other item is marked "by design" or
      moved to "out of scope" with its reason.
      - Target: the list holds only items marked so, and each one closed
        has a test.
   4. **Challenges 13 to 16,** on what Reference CPU 2 adds: a decoder, a
      shifter, a stack, and a program that draws with `CALL`. The last
      needs a bench built around Reference CPU 2, as challenge 11's is
      around the first. Each is checked by behavioural tests, as ADRs
      0025 and 0034 do; the increment's ADR chooses them.
      - The about page's list of challenges grows with them.
      - Target: each starter fails and each solution passes in the
        browser.
   5. **A project others can join.**
      - `CONTRIBUTING.md` and the README brought up to date: setup,
        build, test, how a change is made (an ADR for a design choice,
        `docs/` kept in step), and what is out of scope.
      - A code of conduct, a security policy, and issue and pull request
        templates.
      - A license check in `pnpm verify`, from the package managers' own
        data (`cargo metadata`, `pnpm licenses list`) with no new
        dependency: every license a shipped dependency or bundled asset
        uses must be on an allowlist of those compatible with MIT OR
        Apache-2.0 (MIT, Apache-2.0, BSD, ISC, Unicode-3.0, the
        Unlicense, OFL-1.1 for the fonts, …), and those that need it, such
        as the fonts' OFL, travel with the build. Dev-only dependencies
        are listed apart. Names are checked, not a snapshot, since the
        list differs by platform.
      - `sim-core` documented: `missing_docs` on, and `cargo doc` with
        warnings as errors in `pnpm verify`.
      - The generators that check the bundled examples fail at once when
        `import.meta.main` is not there, and `package.json` asks for a
        Node that has it, so a check can never pass unrun.
      - Target: a fresh clone set up from `CONTRIBUTING.md` alone runs
        `pnpm verify` to the end, on Windows and on one Linux machine, and
        the license check passes. This
        increment has no Playwright test of its own: its target is the
        check itself.

3. **Rules from ADRs 0020 and 0028 still hold for every increment:**
   behaviour stays in `sim-core`; nothing leaves the browser; an
   instruction set changes in its specification first; each increment
   updates the roadmap and closes with a Playwright test of its target,
   increment 5 apart.

4. **ADR 0009 stands.** Checks stay local, in the pre-push hook. Hosted CI
   comes back only when the owner decides that outside contributions call
   for it, as ADR 0009 says; this plan does not add it. Deploying the app
   or publishing a package stays the owner's decision too, and nothing in
   Phase 7 does either.

5. **Not planned in Phase 7,** and added to the roadmap's "out of scope
   (for now)": a 16-bit CPU, or one with a register file (brief §2.3);
   several clocks, and stepping one delta; project previews; Markdown in
   notes; global labels across sheets; installing the app for offline
   use (PWA); a diagnostic for two bus drivers in conflict (ADR 0035);
   and a guided tutorial for the first visit.

## Alternatives considered

- **Regroup the CPUs into components,** so the main sheet is a block
  diagram. It reads best when still, but a block opened as its sheet is
  simulated alone (ADR 0017): the control signals and buses inside would
  vanish from the running view, against brief §2.3. Showing an instance's
  insides live is a large change of its own. Regions on one sheet keep
  everything running and visible.
- **Mark the instruction running, not the next one.** The ROM holds no
  record of which word went into the instruction register, and finding
  the register would make the editor know about CPUs. The word at the
  ROM's address now is exact, general, and labelled for what it is.
- **An open project first,** with hosted CI back. It would protect every
  later increment. But ADR 0009 chose local checks, and the reason to
  revisit it, outside contributions, has not come. Done last, the
  contributor docs describe the project as it ends the phase.
- **A third CPU, 16-bit or with registers.** The brief lists it. But the
  two CPUs that exist cannot yet be read comfortably; a third, larger one
  would be worse. It can come once increment 2 has shown how a large
  circuit should be laid out.
- **Rough edges in each increment that touches them,** as ADR 0028 chose.
  Several here touch nothing the other increments change (routing,
  the readout, challenge reports), so they would never be picked up;
  one increment closes them with a clear list.
- **A guided tutorial** for the first visit. It would help newcomers, but
  it is a design of its own, and the examples already lead from an AND
  gate to a CPU. It is better asked for once people use the app.
- **One ADR for all of Phase 7.** As before, that would fix designs before
  the work that informs them. This ADR fixes only the order and the
  targets.

## Consequences

- The next increment is the playground's gaps, with its own ADR.
- The order can change between increments by amending item 2, as ADRs
  0020 and 0028 allowed.
- Laying the CPUs out again changes their generated files: the reference
  CPU, Catch, Reference CPU 2, Catch 2, and the cut CPU and benches of
  challenges 10 to 12, which are built from the same pieces. Native tests
  read parts by ID and are untouched; the end-to-end tests that click CPU
  parts by position, the benchmarks built from the reference CPU, the
  drawing tests that use its sheet as a large one, and the about page's
  shots all follow, in increment 2.
- Gates with more inputs and a push button change the file format and
  the engine's catalog; notes on the canvas change the file format.
- Each target is concrete enough to check, so "done" stays checkable.
