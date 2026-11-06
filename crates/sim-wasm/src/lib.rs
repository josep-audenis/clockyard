//! Thin wasm-bindgen adapter over `sim-core`. No simulation logic here.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn and_gate(a: bool, b: bool) -> bool {
    sim_core::and_gate(a, b)
}
