# Examples

Example Clockyard project files (`*.clockyard.json`). Each example is also a
test fixture: the Rust and frontend test suites load them and check their
behavior through the real engine. Expected outputs live in tests, never baked
into the example files.

Examples use the current file format (version 6, ADRs 0010, 0012, 0013, 0014 and 0015). Load one with
**Import** in the editor. `crates/sim-core/tests/examples.rs` checks their
outputs natively, `apps/web/src/storage/file.test.ts` checks every file parses,
and the Playwright tests in `apps/web/e2e/` drive them in the browser.

Bundled (✅) and planned:

| File | Phase | Shows |
|------|-------|-------|
| ✅ `and-gate.clockyard.json` | 1 | Two switches, AND gate, LED |
| ✅ `cascade-fanout.clockyard.json` | 1 | Multi-level gates with fan-out |
| ✅ `half-adder.clockyard.json` | 2 | XOR + AND, each input fanned out through a junction; labelled pins |
| ✅ `4-bit-adder.clockyard.json` | 2 | Reusable full-adder component instanced four times (format v3 definitions) |
| ✅ `8-bit-adder.clockyard.json` | 2 | 8-bit buses split into bits, eight full-adder instances, sums merged into one 8-bit LED (ADR 0014) |
| `8-bit-counter.clockyard.json` | 3 | Clocked counter with reset |
