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
