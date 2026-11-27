# Architecture decision records

Short records of significant choices: context, decision, consequences.
Numbered, never renumbered. A superseded record stays and links to its
replacement.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-monorepo-layout.md) | Monorepo layout | Accepted |
| [0003](0003-wasm-toolchain.md) | WASM toolchain | Accepted |
| [0004](0004-document-vs-netlist.md) | Separate circuit document and compiled netlist | Accepted |
| [0005](0005-simulation-in-worker.md) | Host the engine in a Web Worker from the start | Accepted |
| [0006](0006-delta-cycle-evaluation.md) | Change-driven evaluation with synchronous deltas | Accepted; sequential part by 0017 |
| [0007](0007-frontend-stack.md) | Frontend stack | Accepted |
| [0008](0008-visual-identity.md) | Visual identity and design tokens | Accepted |
| [0009](0009-local-checks-instead-of-ci.md) | Local pre-push checks instead of hosted CI | Accepted |
| [0010](0010-junctions-and-nets.md) | Junctions, nets resolved in the engine, file format v2 | Accepted; amended by 0015 |
| [0011](0011-wire-routing.md) | Grid routing and user-shaped wires | Accepted |
| [0012](0012-custom-components.md) | Custom components: definitions, pins and flat elaboration | Accepted; amended by 0013, 0016 and by its own amendment (renaming and deleting definitions) |
| [0013](0013-instance-ports-by-pin-id.md) | Instance ports are named by their pin part's ID | Accepted; amended by its own amendment (wires to a deleted pin) |
| [0014](0014-multi-bit-signals.md) | Multi-bit signals, buses and splitters | Accepted; amended by its own amendment (building it) |
| [0015](0015-net-labels.md) | Named connections: net labels on junctions | Accepted; amended by its own amendment (building the editor) |
| [0016](0016-make-component-crossing-wires.md) | Make component keeps wires that cross the selection's edge | Accepted; amended by its own amendment (what stays on the sheet) |
| [0017](0017-clocks-and-flip-flops.md) | Clocks, flip-flops and virtual time | Accepted |
| [0018](0018-rom-and-ram.md) | ROM and RAM parts | Accepted |
| [0019](0019-reference-cpu.md) | The reference CPU, its assembler and instruction stepping | Accepted |
| [0020](0020-phase-5-plan.md) | Phase 5: what comes first, and how it is split | Accepted |
| [0021](0021-devices.md) | Devices: seven-segment display, pixel screen, keyboard | Accepted |
| [0022](0022-memory-mapped-io.md) | Memory-mapped I/O on the reference CPU | Accepted |
| [0023](0023-game-demo.md) | The game demo: Catch on the reference CPU | Accepted |
| [0024](0024-url-sharing.md) | Sharing a circuit through a URL fragment | Accepted |
| [0025](0025-challenges.md) | Challenges checked by behavioural tests | Accepted; amended by 0034 |
| [0026](0026-waveforms.md) | Waveforms: watched wires recorded by the engine | Accepted |
| [0027](0027-library-and-teaching.md) | Library and teaching: examples in the editor, notes, and components from other files | Accepted |
| [0028](0028-phase-6-plan.md) | Phase 6: what comes after the Phase 5 plan | Accepted; amended by 0034 and 0036 |
| [0029](0029-local-persistence.md) | Local persistence: projects, autosave and a component library in the browser | Accepted |
| [0030](0030-benchmarks.md) | Benchmarks: generated circuits, measured in the engine and in the browser | Accepted |
| [0031](0031-about-page.md) | An about page built from the running app | Accepted |
| [0032](0032-editor-chrome.md) | Editor chrome: one primary action, a palette of symbols | Accepted |
| [0033](0033-editing-a-running-circuit.md) | Editing a running circuit: state kept across edits, matched by part ID | Accepted |
| [0034](0034-cpu-challenges.md) | Challenges 10 to 12: a CPU, a program and a screen, checked on a computer bench | Accepted; amended by 0041 |
| [0035](0035-four-state-signals.md) | Four-state signals: `X`, `Z`, a tri-state buffer and shared buses | Accepted |
| [0036](0036-second-reference-cpu.md) | A second reference CPU: bit operations, shifts, a jump, and call and return | Accepted |
| [0037](0037-phase-7-plan.md) | Phase 7: the playground's gaps, computers you can read, and a project others can join | Accepted |
| [0038](0038-playground-gaps.md) | The playground's gaps: push buttons, gates with 2 to 8 inputs, notes on the canvas | Accepted |
| [0039](0039-computers-you-can-read.md) | Computers you can read: regions, routing clear of label tags, jumping to a note, the program followed | Accepted |
| [0040](0040-rough-edges.md) | Rough edges: Make component, the readout, bench reports, and a list that holds only what stays | Accepted |
| [0041](0041-challenges-13-to-16.md) | Challenges 13 to 16: a decoder, a shifter, a stack, and a program that draws with `CALL` | Accepted |
| [0042](0042-a-project-others-can-join.md) | A project others can join: contributor docs, community files, a license check, and a documented core | Accepted |
| [0043](0043-phase-8-plan.md) | Phase 8: a computer with registers | Accepted |
| [0044](0044-bus-conflicts-named.md) | Bus conflicts named | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What forces the decision.

## Decision
What we do.

## Consequences
What gets easier, what gets harder, what to revisit.
```
