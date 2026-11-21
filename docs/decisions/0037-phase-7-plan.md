# 0037. Phase 7: an open project, computers you can read, and the playground's gaps

- Status: Proposed
- Date: 2026-11-21
- Depends on: ADR 0028 (the Phase 6 plan, now built); ADRs 0029–0036;
  brief §2, §12, §13 and §16

## Context

Phase 6 is built: local persistence (ADR 0029), benchmarks (ADR 0030),
editing a running circuit (ADR 0033), challenges 10 to 12 (ADR 0034),
four-state signals (ADR 0035) and a second reference CPU (ADR 0036).
Clockyard now does what the brief's definition of success asks, up to its
long-term goal: a user can build a CPU, write a program for it, and watch
it run through the circuit. Nothing is planned after it.

What is still open, from the brief and from the roadmap:

- **The project is not yet ready to be public.** Brief §13 asks for CI
  configuration, contribution guidelines, a clear README, license
  declarations and dependencies with compatible licenses.
  - There is no CI: `pnpm verify` runs only in each contributor's
    pre-push hook.
  - `CONTRIBUTING.md` still says the project is at Phase 0, with the
    editor next.
  - The README's status was two phases behind until #120.
  - No one has checked the dependencies' licenses.
- **The bundled computers are hard to read.** The brief's promise is that
  computers are not black boxes (§16), and its Computer Lab (§2.3) asks
  that a user can see, as a program runs, the current instruction, the
  registers, the ALU's operation and the active control signals.
  - The reference CPU's sheet is 81 parts and 174 wires on one level. It
    opens framed at about 30% in a laptop's window, too small to read its
    labels (a rough edge on the roadmap). Reference CPU 2 is 117 parts.
  - The registers can be read: the readout lists them and the sheet's
    LEDs show them. But nothing shows *which instruction* is running. The
    program editor's disassembly is a static listing of the ROM.
- **The playground lacks a few parts the brief lists** (§2.1, §2.2):
  - push buttons: today a switch must be turned on and off again;
  - gates with more than two inputs: wide functions take trees of gates;
  - text on the canvas: notes are a panel, not labels beside the parts.
  - Logic probes exist in effect (a bus's value on hover, the readout,
    waveforms). Latches, decoders and multiplexers are built from gates,
    and challenge-style; they do not need parts of their own.
- **Rough edges**, 22 on the roadmap. Some are cosmetic. Others make the
  tool harder to use than it should be, such as a component made by Make
  component covering the parts below it, or routing over label tags.
- **Challenges** stop at 12, the brief's list. Reference CPU 2 brought
  ideas the first twelve do not teach: decoding, shifting, a stack.

## Decision

1. **Phase 7 is a project phase,** run as Phases 5 and 6 were (ADRs 0020
   and 0028): increments, each with its own ADR, its own target that
   works in the browser and in tests, and steps of one pull request each.

2. **The order:**
   1. **An open project.**
      - CI: a GitHub Actions workflow that runs `pnpm verify` on every
        pull request and on `main`. It changes nothing outside the
        repository and publishes nothing.
      - `CONTRIBUTING.md` and the README brought up to date: setup,
        build, test, how a change is made (ADR first for a design choice,
        `docs/` kept in step), and what is out of scope.
      - A license report of every Rust and npm dependency, from the
        package managers' own data, checked against MIT OR Apache-2.0;
        the check runs in `pnpm verify`.
      - `sim-core`'s public items documented, so `cargo doc` gives no
        warnings (brief §13: the core could become a library).
      - Target: a pull request shows the workflow's run, and the license
        report lists every dependency with no incompatible license.
   2. **Computers you can read.**
      - The reference CPUs' sheets regrouped into named components:
        fetch, control, the ALU, the registers, I/O, and on Reference
        CPU 2 the stack. The main sheet reads as a block diagram; each
        block opens as its sheet. The models and the tests that hold the
        circuits to them do not change, and neither does what they show.
      - The program in a ROM followed as it runs: the program editor's
        listing marks the word at the ROM's address now, and keeps it in
        view. This knows nothing about CPUs: it reads the ROM's `addr`
        net, so it works for any circuit that fetches from a ROM.
      - Target: the reference CPU opens with its labels readable in a
        laptop's window; stepping one instruction moves the listing's
        mark to the next.
   3. **The playground's gaps.**
      - A push button: on while pressed, by pointer or key.
      - Gates with 2 to 8 inputs, chosen as a gate's width is.
      - Text on the canvas: a note part, saved in the document, that the
        engine never sees.
      - Target: a 4-input AND with a push button on each input, and a
        note beside it, saved and opened again.
   4. **Rough edges.** The roadmap's list, each one closed or moved to
      "out of scope" with its reason. Among them: routing over label
      tags, Make component covering parts and its one-item limit, the
      readout missing memories and screens, a bench challenge's text in
      one paragraph and its pass not naming runs, and the about page.
      Target: the list holds nothing that a user meets in normal use.
   5. **Challenges 13 to 16,** on what Reference CPU 2 adds: a decoder, a
      shifter, a stack, and a program that draws with `CALL`. Each is
      checked by behavioural tests, as ADRs 0025 and 0034 do; the
      increment's ADR chooses them.
      - Target: each starter fails and each solution passes in the
        browser.

3. **Rules from ADRs 0020 and 0028 still hold for every increment:**
   behaviour stays in `sim-core`; nothing leaves the browser; an
   instruction set changes in its specification first; each increment
   updates the roadmap and closes with a Playwright test of its target.

4. **Deploying stays the owner's decision.** Increment 1 makes the project
   ready to be public; it does not deploy the app or publish a package.
   Whether and where to deploy is asked when increment 1 is done.

5. **Not planned in Phase 7.** These stay on the roadmap until a need
   shows:
   - a 16-bit CPU, or one with a register file (brief §2.3);
   - several clocks, and stepping one delta;
   - project previews, Markdown in notes, global labels across sheets;
   - installing the app for offline use (PWA);
   - a diagnostic for two bus drivers in conflict (ADR 0035).

## Alternatives considered

- **Readable computers first.** It is the most visible, and closest to the
  brief's promise. But it moves many generated files and the tests that
  read them, and CI catches what a contributor's machine misses. An open
  project first also means every later increment runs under it.
- **A third CPU, 16-bit or with registers.** The brief lists it. But the
  two CPUs that exist cannot yet be read comfortably; a third, larger one
  would be worse. It can come when increment 2 has shown how a large
  circuit should be laid out.
- **A guided tutorial** for the first visit, beyond the hint on an empty
  sheet and the examples' notes. It would help newcomers, but it is a
  design of its own and the examples already lead from an AND gate to a
  CPU. It is better asked for once the project is public and people use
  it.
- **Rough edges first.** They are many and small; done first they would
  delay everything else without a target to show. Last but one, they also
  take in what increments 1 to 3 leave.
- **One ADR for all of Phase 7.** As before, that would fix designs before
  the work that informs them. This ADR fixes only the order and the
  targets.

## Consequences

- The next increment is an open project, with its own ADR.
- The order can change between increments by amending item 2, as ADRs
  0020 and 0028 allowed.
- CI runs `pnpm verify` on GitHub's machines: about four minutes a run
  today. Pull requests show its result.
- Regrouping the CPUs changes their generated files and the IDs inside
  them (a part `t` becomes `control/t`). Their tests and the challenges'
  benches follow, in increment 2.
- Each target is concrete enough for a Playwright test, so "done" stays
  checkable.
