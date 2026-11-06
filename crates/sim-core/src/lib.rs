//! Clockyard simulation engine.
//!
//! Phase 0 holds a single AND evaluator that proves the browser → WASM → Rust
//! round trip. The netlist, settling and diagnostics described in
//! `docs/simulation-model.md` arrive in Phase 1.

/// Two-input AND gate.
pub fn and_gate(a: bool, b: bool) -> bool {
    a && b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn and_truth_table() {
        assert!(!and_gate(false, false));
        assert!(!and_gate(false, true));
        assert!(!and_gate(true, false));
        assert!(and_gate(true, true));
    }
}
