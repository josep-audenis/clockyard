# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-06

## Context

Clockyard is a long-lived open-source project with a deliberately phased
roadmap. Choices made early (engine boundary, document format, evaluation
semantics) shape everything later. Contributors need to know why, not only what.

## Decision

Keep lightweight ADRs in `docs/decisions/`, one file per significant decision,
using the template in the [index](README.md). Any material deviation from
[the brief](../brief.md) gets an ADR.

## Consequences

- Decisions are reviewable in pull requests like code.
- Small, local choices do not need an ADR; a code comment is enough.
