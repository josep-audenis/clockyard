# 0005. Host the engine in a Web Worker from the start

- Status: Accepted
- Date: 2026-11-06

## Context

Small circuits settle in microseconds on the main thread. Large circuits and
continuous clocked runs (Phase 3+) would block rendering and input. Moving the
engine into a worker later changes the API from synchronous to asynchronous,
touching every caller.

## Decision

Load the WASM engine in a module Web Worker from Phase 0. Communicate with
typed discriminated-union messages over `postMessage`; no RPC library unless
boilerplate becomes a real problem. No `SharedArrayBuffer` or cross-origin
isolation until profiling and compatibility justify them.

## Consequences

- The UI is asynchronous toward the engine from day one; no later rewrite.
- The main thread stays responsive during long runs.
- Each round trip has a small latency; commands and results are batched.
- Debugging spans two contexts; a debug log of messages helps.
