# Examples

Example Clockyard project files (`*.clockyard.json`). Each example is also a
test fixture: the Rust and frontend test suites load them and check their
behavior through the real engine. Expected outputs live in tests, never baked
into the example files.

Load one with **Import** in the editor. `crates/sim-core/tests/examples.rs`
checks their outputs natively, `apps/web/src/storage/file.test.ts` checks every
file parses, and the Playwright tests in `apps/web/e2e/` drive them in the browser.

Bundled (✅) and planned:

| File | Phase | Shows |
|------|-------|-------|
| ✅ `and-gate.clockyard.json` | 1 | Two switches, AND gate, LED |
| ✅ `cascade-fanout.clockyard.json` | 1 | Multi-level gates with fan-out |
| ✅ `half-adder.clockyard.json` | 1 | XOR + AND |
| `4-bit-adder.clockyard.json` | 2 | Reusable full-adder component instanced four times |
| `8-bit-counter.clockyard.json` | 3 | Clocked counter with reset |
