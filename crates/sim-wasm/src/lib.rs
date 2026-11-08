//! Thin wasm-bindgen adapter over `sim-core`. No simulation logic here.
//! Structured values cross the boundary as JSON; net values as a `Uint32Array`.

use serde::Serialize;
use sim_core::catalog::MAX_WIDTH;
use sim_core::{CircuitDescription, Code, Diagnostic, Kind, PortNets, Simulator};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Part {
    kind: &'static str,
    inputs: &'static [&'static str],
    outputs: &'static [&'static str],
    /// Present on kinds whose `width` prop sets every port's width.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    sized: bool,
    /// Present on split and merge: the ports their `fields` add.
    #[serde(skip_serializing_if = "Option::is_none")]
    field_ports: Option<FieldPorts>,
}

/// Field ports are named `{prefix}0`, `{prefix}1`, … on the given side.
#[derive(Serialize)]
struct FieldPorts {
    side: &'static str,
    prefix: &'static str,
}

/// The built-in catalog as JSON (ADRs 0004, 0014):
/// `[{ kind, inputs, outputs, sized?: true, fieldPorts?: { side, prefix } }]`.
/// `inputs` and `outputs` are the fixed ports; field ports come from `fieldPorts`.
#[wasm_bindgen]
pub fn catalog() -> String {
    let parts = Kind::ALL.map(|kind| Part {
        kind: kind.name(),
        inputs: kind.inputs(),
        outputs: kind.outputs(),
        sized: kind.sized(),
        field_ports: kind.field_ports().map(|(output, prefix)| FieldPorts {
            side: if output { "outputs" } else { "inputs" },
            prefix,
        }),
    });
    serde_json::to_string(&parts).expect("catalog serializes")
}

/// Widest signal a port may carry, so the editor never hard-codes it.
#[wasm_bindgen]
pub fn max_width() -> u32 {
    MAX_WIDTH
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Loaded<'a> {
    net_count: usize,
    wire_nets: &'a BTreeMap<String, u32>,
    /// Wire ID → width of its net. Per wire, since every undriven net is net 0.
    wire_widths: &'a BTreeMap<String, u32>,
    port_nets: &'a PortNets,
    /// Net index → the top-level part driving it, `null` for ground (ADR 0016).
    net_drivers: Vec<Option<&'a str>>,
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
    /// `{ netCount, wireNets, wireWidths, portNets, netDrivers, diagnostics, runtime }` as JSON;
    /// on validation errors the maps are empty and no circuit is loaded.
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
        let sim = self.sim.as_ref();
        let loaded = Loaded {
            net_count: sim.map_or(0, |sim| sim.nets().len()),
            wire_nets: sim.map_or(&empty.0, Simulator::wire_nets),
            wire_widths: sim.map_or(&empty.0, Simulator::wire_widths),
            port_nets: sim.map_or(&empty.1, Simulator::port_nets),
            net_drivers: sim.map_or_else(Vec::new, Simulator::net_drivers),
            diagnostics: &diagnostics,
            runtime: &runtime,
        };
        Ok(serde_json::to_string(&loaded)?)
    }

    /// Sets a switch to `value` and settles. Returns runtime diagnostics as a
    /// JSON array. `value` arrives as a JS number, so anything but a whole
    /// number from 0 to `u32::MAX` is refused rather than wrapped or truncated;
    /// the engine then refuses values wider than the switch.
    pub fn set_input(&mut self, component: &str, value: f64) -> Result<String, JsError> {
        let sim = self
            .sim
            .as_mut()
            .ok_or_else(|| JsError::new("no circuit loaded"))?;
        if value.fract() != 0.0 || !(0.0..=f64::from(u32::MAX)).contains(&value) {
            // `{:?}` keeps 1e-300, inf and NaN short.
            let message = format!(
                "switch value {value:?} is not a whole number from 0 to {}",
                u32::MAX
            );
            return Err(JsError::new(&message));
        }
        let diagnostics: Vec<Diagnostic> = sim
            .set_input(component, value as u32)
            .map_err(|e| JsError::new(&e))?
            .into_iter()
            .collect();
        Ok(serde_json::to_string(&diagnostics)?)
    }

    /// Current net values, each cut to its width, indexed by net. Empty when
    /// nothing is loaded.
    pub fn nets(&self) -> Vec<u32> {
        self.sim
            .as_ref()
            .map_or_else(Vec::new, |sim| sim.nets().to_vec())
    }
}
