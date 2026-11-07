# Architecture decision records

Short records of significant choices: context, decision, consequences.
Numbered, never renumbered. A superseded record stays and links to its
replacement.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-monorepo-layout.md) | Monorepo layout | Accepted |
| [0003](0003-wasm-toolchain.md) | WASM toolchain | Proposed |
| [0004](0004-document-vs-netlist.md) | Separate circuit document and compiled netlist | Accepted |
| [0005](0005-simulation-in-worker.md) | Host the engine in a Web Worker from the start | Accepted |
| [0006](0006-delta-cycle-evaluation.md) | Change-driven evaluation with synchronous deltas | Proposed |
| [0007](0007-frontend-stack.md) | Frontend stack | Accepted |
| [0008](0008-visual-identity.md) | Visual identity and design tokens | Accepted |
| [0009](0009-local-checks-instead-of-ci.md) | Local pre-push checks instead of hosted CI | Accepted |
| [0010](0010-junctions-and-nets.md) | Junctions, nets resolved in the engine, file format v2 | Accepted |
| [0011](0011-wire-routing.md) | Grid routing and user-shaped wires | Accepted |
| [0012](0012-custom-components.md) | Custom components: definitions, pins and flat elaboration | Accepted; amended by 0013 and by its own amendment (renaming and deleting definitions) |
| [0013](0013-instance-ports-by-pin-id.md) | Instance ports are named by their pin part's ID | Accepted |
| [0014](0014-multi-bit-signals.md) | Multi-bit signals, buses and splitters | Proposed |

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
