# 0006. Change-driven evaluation with synchronous deltas

- Status: Proposed — implemented for combinational logic in Phase 1; sequential part confirmed in Phase 3
- Date: 2026-11-06

## Context

The engine must be deterministic, order-independent, handle feedback, and never
hang on oscillating loops. Re-evaluating every gate each step wastes work.
Edge-triggered state must sample consistently.

## Decision

- Evaluate only components whose inputs changed (worklist).
- Each **delta** evaluates all dirty components against the same net snapshot;
  writes apply after the delta. Dirty components are processed in ascending
  compiled index for reproducibility.
- Settling is bounded by a delta limit; exceeding it yields an `Unstable`
  diagnostic and halts settling without hanging.
- Edge-triggered elements sample from the **pre-edge settled state** of the
  timestep and update together (see [simulation model](../simulation-model.md#sequential-logic-phase-3-design-target)).
- Virtual time is a tick counter independent of wall-clock time.

## Consequences

- Results are independent of evaluation order and frame rate.
- Oscillators are detected rather than freezing the worker.
- Symmetric unit-delay races (e.g. NOR latch released from `S=R=1`) report as
  unstable rather than resolving arbitrarily.
- Topological ordering of acyclic regions remains available as a later
  optimization, provided results are identical.
