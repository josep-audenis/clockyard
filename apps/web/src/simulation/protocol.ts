// Messages between the main thread and the simulation worker (ADR 0005).
// Phase 0 only proves the round trip; the Phase 1 commands in
// docs/architecture.md#worker-protocol replace `evalAnd`.

export type Command = { type: "evalAnd"; a: boolean; b: boolean };

export type Result =
  | { type: "ready" }
  | { type: "andResult"; a: boolean; b: boolean; out: boolean }
  | { type: "error"; message: string };
