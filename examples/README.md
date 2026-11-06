# Examples

Example Clockyard project files (`*.clockyard.json`). Each example is also a
test fixture: the Rust and frontend test suites load them and check their
behavior through the real engine. Expected outputs live in tests, never baked
into the example files.

> Status: empty. The first example, `and-gate.clockyard.json` (two switches → AND → LED),
> arrives with the Phase 1 vertical slice.

Planned:

| File | Phase | Shows |
|------|-------|-------|
| `and-gate.clockyard.json` | 1 | Two switches, AND gate, LED |
| `cascade-fanout.clockyard.json` | 1 | Multi-level gates with fan-out |
| `half-adder.clockyard.json` | 1 | XOR + AND |
| `4-bit-adder.clockyard.json` | 2 | Reusable full-adder component instanced four times |
| `8-bit-counter.clockyard.json` | 3 | Clocked counter with reset |
