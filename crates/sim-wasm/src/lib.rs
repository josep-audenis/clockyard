//! Thin wasm-bindgen adapter over `sim-core`. No simulation logic here.
//! Structured values cross the boundary as JSON; net values as a `Uint8Array`.

use serde::Serialize;
use sim_core::{CircuitDescription, Code, Diagnostic, Kind, PortNets, Simulator};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct Part {
    kind: &'static str,
    inputs: &'static [&'static str],
    outputs: &'static [&'static str],
}

/// The built-in catalog as JSON: `[{ kind, inputs, outputs }]` (ADR 0004).
#[wasm_bindgen]
pub fn catalog() -> String {
    // shortcut: split and merge stay out of the catalog until it carries their
    // field-port rule and the editor has their layouts (ADR 0014 steps 2 and 4).
    let parts: Vec<Part> = Kind::ALL
        .into_iter()
        .filter(|kind| kind.sized())
        .map(|kind| Part {
            kind: kind.name(),
            inputs: kind.inputs(),
            outputs: kind.outputs(),
        })
        .collect();
    serde_json::to_string(&parts).expect("catalog serializes")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Loaded<'a> {
    net_count: usize,
    wire_nets: &'a BTreeMap<String, u32>,
    port_nets: &'a PortNets,
    /// Validation results: errors, or warnings such as unconnected inputs.
    diagnostics: &'a [Diagnostic],
    /// Result of the initial settle (an unstable loop), superseded by later settles.
    runtime: &'a [Diagnostic],
}

/// One loaded circuit. `load` replaces it.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    sim: Option<Simulator>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine::default()
    }

    /// Compiles a circuit description (JSON). Returns
    /// `{ netCount, wireNets, portNets, diagnostics, runtime }` as JSON; on validation
    /// errors the maps are empty and no circuit is loaded.
    pub fn load(&mut self, description: &str) -> Result<String, JsError> {
        let description: CircuitDescription = serde_json::from_str(description)?;
        let empty = (BTreeMap::new(), PortNets::new());
        let (sim, diagnostics) = match Simulator::load(&description) {
            Ok((sim, warnings)) => (Some(sim), warnings),
            Err(errors) => (None, errors),
        };
        self.sim = sim;
        let (runtime, diagnostics): (Vec<_>, Vec<_>) = diagnostics
            .into_iter()
            .partition(|d| d.code == Code::Unstable);
        let loaded = Loaded {
            net_count: self.sim.as_ref().map_or(0, |sim| sim.nets().len()),
            wire_nets: self.sim.as_ref().map_or(&empty.0, Simulator::wire_nets),
            port_nets: self.sim.as_ref().map_or(&empty.1, Simulator::port_nets),
            diagnostics: &diagnostics,
            runtime: &runtime,
        };
        Ok(serde_json::to_string(&loaded)?)
    }

    /// Sets a switch and settles. Returns runtime diagnostics as a JSON array.
    pub fn set_input(&mut self, component: &str, value: bool) -> Result<String, JsError> {
        let sim = self
            .sim
            .as_mut()
            .ok_or_else(|| JsError::new("no circuit loaded"))?;
        let diagnostics: Vec<Diagnostic> = sim
            .set_input(component, value.into())
            .map_err(|e| JsError::new(&e))?
            .into_iter()
            .collect();
        Ok(serde_json::to_string(&diagnostics)?)
    }

    /// Current net values (0/1), indexed by net. Empty when nothing is loaded.
    pub fn nets(&self) -> Vec<u8> {
        // shortcut: the editor projects no widths yet, so every net is 0 or 1;
        // step 2 of ADR 0014 sends the `u32` values as a `Uint32Array`.
        self.sim.as_ref().map_or_else(Vec::new, |sim| {
            sim.nets().iter().map(|&value| value as u8).collect()
        })
    }
}
