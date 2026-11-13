# 0020. Phase 5: what comes first, and how it is split

- Status: Accepted
- Date: 2026-11-13
- Depends on: ADRs 0017 (clocks), 0018 (ROM and RAM), 0019 (the reference CPU)

## Context

Phase 5 of the brief (§8, "Computer-Building Sandbox") turns the simulator
into a complete product. It lists, as *potential* features:

- guided challenges with automated circuit evaluation;
- component blueprints;
- bundled computer designs and example CPUs;
- memory-mapped peripherals: seven-segment displays, LED matrices, keyboard
  input, character or pixel displays;
- richer instruction sets;
- better waveform tools;
- performance work;
- sharing through portable files or encoded URLs;
- more educational material.

The aspirational demo is a small game running on a processor designed in
Clockyard. The brief warns against committing to a particular game or
instruction set before the earlier phases are sound.

That is far more than one increment. Phases 1–4 each had a single target
demo and were built in steps of one pull request each. Phase 5 needs the
same discipline, or it never ends.

## Decision

1. **Phase 5 is split into increments, each with its own ADR, its own
   target, and steps of one pull request each.** An increment is done when
   its target works in the browser and in tests, as for earlier phases.
   The roadmap lists the increments in order and marks each one done.
2. **The order follows the aspirational demo first,** because the game
   needs devices and I/O, and those are useful on their own:
   1. **Devices** (ADR 0021): a seven-segment display, a pixel screen and a
      keyboard as parts. Target: a hand-wired circuit shows a digit and
      draws pixels, and a key press reaches the circuit.
   2. **Memory-mapped I/O on the reference CPU**: devices decoded into its
      data address space, with no new instructions. Target: a program
      reads the keyboard and writes the screen.
   3. **The game demo**: a small game on that CPU, chosen only once 1 and 2
      work, as the brief asks. Its program ships as an example.
   4. **Sharing**: a document encoded in a URL fragment, with no server
      involved, next to the existing file export.
   5. **Challenges**: a bundled set following the brief's progression
      (inverter … programmable CPU), each checked by behavioural tests the
      engine runs against the user's circuit, not by inspecting which parts
      it uses.
   6. **Waveforms**: recorded signals over ticks, for chosen nets.
   7. **Library and teaching**: blueprints (components reused across
      documents), bundled designs, and explanatory material.

   Performance work is not an increment of its own. Each increment measures
   what it needs, as Phase 4 did for the CPU's run speed, and optimizes
   when a measurement says so.
3. **Rules that hold for every increment:**
   - Behaviour stays in `sim-core`. Devices are parts with engine semantics,
     drawn by the editor, as LEDs are.
   - Nothing leaves the browser (CLAUDE.md). Sharing encodes the document
     in the URL; there is no backend.
   - Any change to the reference CPU's instruction set changes
     `docs/reference-cpu.md` first, then its tests, then the circuit.
   - Each increment updates the roadmap and closes with a Playwright test
     of its target.
4. **Rough edges left from Phase 4** are fixed where an increment touches
   them. For example, the devices increment adds a reason for a run that
   stopped (useful once games run until an LED). The rest stay listed on
   the roadmap.

## Alternatives considered

- **Challenges first.** They are the most "product" feature, and the brief
  gives their progression. But the later challenges ("connect a visual
  output device") need devices, and the checker needs the same engine
  features as everything else. They fit better once devices exist.
- **Sharing first.** It is small and independent, so it could come at any
  point. It is placed after the game, so that there is something worth
  sharing, but it can move earlier if wanted.
- **A new, richer CPU right away.** The brief says not to commit to an
  instruction set before the earlier phases are sound. Memory-mapped I/O
  needs no new instructions, so the current specification can drive the
  devices, and a richer CPU waits until a game shows what is missing.
- **One ADR for all of Phase 5.** It would freeze decisions about
  challenges and waveforms long before anything informs them.

## Consequences

- Phase 5 has a visible end for each increment, and the order can change
  between increments without rewriting this plan. Changing it means
  amending item 2.
- The devices ADR (0021) is drafted together with this one. Later
  increments get their ADRs when they start.
- The game is deliberately not chosen here.
