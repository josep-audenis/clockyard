# 0043. Phase 8: a computer with registers

- Status: Accepted
- Date: 2026-11-27
- Depends on: ADR 0037 (the Phase 7 plan, now built); ADRs 0019, 0025,
  0034, 0035, 0036, 0039; brief §2.2, §2.3, §16

## Context

Phase 7 is built: push buttons, wider gates and notes on the canvas
(ADR 0038), computers laid out in regions you can read (ADR 0039), rough
edges closed (ADR 0040), challenges 13 to 16 (ADR 0041), and a project
others can join (ADR 0042). Nothing is planned after it.

What is still open, from the brief and from the roadmap:

- **The brief's Computer Lab (§2.3) lists three computers.** Two kinds
  exist: the reference CPU, an accumulator machine, and Reference CPU 2,
  the same machine with bit operations, shifts, a jump and a call.
  - "A more advanced 8-bit processor with several registers" does not
    exist. Both CPUs have one accumulator; every value goes through it
    and through memory.
  - "A simple 16-bit processor" does not exist either.
  - ADR 0037 put both off until increment 2 had shown how a large
    circuit should be laid out. ADR 0039 has shown it: regions with
    titles, net labels in place of long wires, and a jump to each region
    at 100%.
- **A register file needs a shared bus.** Registers that share one bus
  drive it through tri-state buffers (ADR 0035). When two are enabled at
  once, the bus reads `X` where they differ, and nothing says which
  drivers are in conflict. ADR 0035 left that diagnostic out of scope. A
  user debugging their own control logic would meet it first.
- **The program editor knows two instruction sets,** and they are one
  family: Reference CPU 2's adds to the first's (`needs_cpu_2`, ADR 0036).
  The editor cannot know which CPU a ROM feeds, so it warns when a
  program needs the second. A machine with registers needs instructions
  that name a register, which the first two do not have. The program
  editor must then know which instruction set to assemble.
- **Challenges stop at 16.** None asks for more than one register.

## Decision

1. **Phase 8 is a project phase,** run as Phases 5 to 7 were (ADRs 0020,
   0028 and 0037). It has increments, and each has its own ADR, its own
   target that works in the browser and in tests, and steps of one pull
   request each.

2. **The order:**
   1. **Bus conflicts named.**
      - When two or more enabled drivers put different known values on
        one net, the engine reports a diagnostic that names the net and
        each driver. The problems dialog lists it, and its Select button
        selects the drivers (ADR 0032). *Amended by ADR 0044:* the net is
        named by its drivers, since the engine keeps no net names.
      - The rule is written in `docs/simulation-model.md` before any
        code: what counts as a conflict when a value is `X` or when the
        drivers agree; when it counts, since a bus is in conflict for a
        delta or two whenever its enables change (ADR 0035) and that must
        not be reported; and the problem's severity, whether it stops a
        run, and how it sits beside `unstable`.
      - The value stays `X`, as ADR 0035 says. Only the report is new.
      - No benchmark has a bus yet (ADR 0040 left it until needed), so
        this increment adds one and measures the check's cost on it. The
        two-state path has no `Z` and no shared buses, so it is
        unchanged.
      - Target: two tri-state buffers on one bus, both enabled with
        different values, are named in the problems dialog. With one
        disabled, nothing is reported, and switching which one is enabled
        reports nothing either.
   2. **Reference CPU 3: an 8-bit CPU with registers.**
      - Its instruction set is specified first, in
        `docs/reference-cpu-3.md`. It has an assembler in `crates/asm`,
        a generator in `scripts/` and a model in the native tests, as the
        first two have. The increment's ADR chooses the number of
        registers and the encoding. Its instructions stay 16 bits wide,
        the width the program editor assembles (ADR 0019).
      - The registers share a bus through tri-state buffers, so
        increment 1's diagnostic covers its control logic.
      - The sheet is generated and laid out in regions, as ADR 0039 does
        for the first two. Everything stays on the main sheet, so it all
        runs live.
      - The program editor knows which instruction set it assembles for
        a ROM. The increment's ADR chooses how: the ROM can say so, or
        the user can pick it in the editor. A program written for one
        machine is never silently assembled for another.
      - An example: a program that uses every register, such as a
        multiplication by shifts and adds, with notes that say what to
        watch.
      - The about page and the README name the third computer.
      - Target: the example runs in the browser and halts with the right
        product. Each region fits the canvas at 100% when jumped to, as
        in ADR 0039. The model and the circuit agree on every instruction
        of a generated test program.
   3. **Challenges 17 and 18,** on what Reference CPU 3 adds: a register
      file (several registers, a write select and a read select on one
      bus), and a program for Reference CPU 3 checked on a bench built
      around it, as challenge 16's is around Reference CPU 2. Each is
      checked by behavioural tests, as ADRs 0025 and 0034 do; the
      increment's ADR chooses them.
      - A challenge with a register file on one bus allows tri-state
        buffers, so a mismatch reports its width, which ADR 0040 left
        until a challenge allowed one.
      - The about page's list of challenges grows with them.
      - Target: each starter fails and each solution passes in the
        browser.

3. **Rules from ADRs 0020, 0028 and 0037 still hold for every
   increment:** behaviour stays in `sim-core`; nothing leaves the
   browser; an instruction set changes in its specification first; each
   increment updates the roadmap and closes with a Playwright test of
   its target.

4. **ADR 0009 stands,** and deploying the app or publishing a package
   stays the owner's decision. Nothing in Phase 8 does either.

5. **Not planned in Phase 8,** and kept in the roadmap's "out of scope
   (for now)": a 16-bit CPU; several clocks, and stepping one delta;
   project previews; Markdown in notes; global labels across sheets;
   installing the app for offline use (PWA); a guided tutorial for the
   first visit; a character display (ADR 0021: a pixel screen can
   draw characters from a ROM the user writes); and the roadmap's other
   out-of-scope items from ADRs 0014, 0015 and 0040, except the two this
   plan takes up (a benchmark with a bus, and a mismatch's width).

## Alternatives considered

- **A 16-bit CPU first.** The brief lists it too. But a wider machine
  makes every bus, register and ROM word wider, and it needs its own ROM
  width in the program editor (ADR 0019). Registers come before width in
  the brief's own list. Once Reference CPU 3 has shown a register file
  on the sheet, a 16-bit machine can reuse its layout.
- **The bus diagnostic inside the CPU's increment.** It is general: it
  helps any circuit with a shared bus, not only Reference CPU 3. Built
  first, it can be tested on two buffers, and then it helps while the
  CPU is built.
- **A guided tutorial, or deploying the app so people can use it.** A
  tutorial is better asked for once people use the app, as ADR 0037
  said, and no one outside the project uses it yet because it is not
  deployed. Deploying is the owner's call. If the owner decides to
  deploy, a phase on first use can come before this one, and this ADR's
  order changes by amendment.
- **More challenges on the CPUs that exist,** without a third machine.
  Challenges 13 to 16 already cover what Reference CPU 2 adds. A
  register file is the next idea the brief's progression points to.
- **One ADR for all of Phase 8.** As before, that would fix designs
  before the work that informs them. This ADR fixes only the order and
  the targets.

## Consequences

- The next increment is bus conflicts named, with its own ADR.
- The order can change between increments by amending item 2, as ADRs
  0020, 0028 and 0037 allowed.
- The engine reports a new kind of problem, so the worker's messages and
  the problems dialog change with it.
- A third instruction set means the program editor no longer assumes one
  family. The warning that a program needs Reference CPU 2 (ADR 0036)
  is replaced by the choice increment 2's ADR makes.
- If a ROM says which instruction set it holds, the file format changes
  with a new version.
- Once this ADR is accepted, the roadmap's out-of-scope list drops a
  benchmark with a bus and a mismatch's width.
- Each target is concrete enough to check, so "done" stays checkable.
