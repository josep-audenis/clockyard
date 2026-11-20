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

/// What `assemble` returns: an empty program and a failed one both have no
/// words, so the editor tells them apart by `errors`.
#[derive(Serialize)]
struct Assembled {
    words: Vec<u16>,
    errors: Vec<AsmError>,
}

#[derive(Serialize)]
struct AsmError {
    line: usize,
    message: String,
}

/// Assembles reference-CPU source (ADR 0019) as JSON `{ words, errors }`:
/// the ROM words when it assembles, else every error with its 1-based line.
#[wasm_bindgen]
pub fn assemble(source: &str) -> String {
    let assembled = match asm::assemble(source) {
        Ok(words) => Assembled {
            words,
            errors: Vec::new(),
        },
        Err(errors) => Assembled {
            words: Vec::new(),
            errors: errors
                .into_iter()
                .map(|e| AsmError {
                    line: e.line,
                    message: e.message,
                })
                .collect(),
        },
    };
    serde_json::to_string(&assembled).expect("plain data serializes")
}

/// One ROM word as reference-CPU assembly (ADR 0019). A JS number that is
/// not a whole number from 0 to 0xFFFF is refused, not wrapped.
#[wasm_bindgen]
pub fn disassemble(word: f64) -> Result<String, JsError> {
    if word.fract() != 0.0 || !(0.0..=f64::from(u16::MAX)).contains(&word) {
        return Err(JsError::new(&format!("{word:?} is not a 16-bit ROM word")));
    }
    Ok(asm::disassemble(word as u16))
}

/// Checks a challenge (ADR 0025) against a circuit description, both JSON, on
/// a bench of its own: the report as JSON, `{ result: "passed" | "failed" |
/// "refused", … }`. A description or challenge that does not parse is an error.
#[wasm_bindgen]
pub fn check(description: &str, challenge: &str) -> Result<String, JsError> {
    let description: CircuitDescription = serde_json::from_str(description)
        .map_err(|e| JsError::new(&format!("invalid circuit description: {e}")))?;
    let challenge: sim_core::check::Challenge = serde_json::from_str(challenge)
        .map_err(|e| JsError::new(&format!("invalid challenge: {e}")))?;
    let report = sim_core::check::check(&description, &challenge);
    Ok(serde_json::to_string(&report).expect("plain data serializes"))
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

/// A switch value as a `u32`: anything but a whole number from 0 to `u32::MAX`
/// is refused rather than wrapped or truncated.
fn whole(value: f64) -> Result<u32, JsError> {
    if value.fract() != 0.0 || !(0.0..=f64::from(u32::MAX)).contains(&value) {
        // `{:?}` keeps 1e-300, inf and NaN short.
        let message = format!(
            "switch value {value:?} is not a whole number from 0 to {}",
            u32::MAX
        );
        return Err(JsError::new(&message));
    }
    Ok(value as u32)
}

/// One loaded circuit. `load` replaces it.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    sim: Option<Simulator>,
    /// The last circuit that compiled, while an edit has errors: the edit's fix carries its state (ADR 0033).
    kept: Option<Simulator>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine::default()
    }

    /// Compiles a circuit description (JSON). Returns
    /// `{ netCount, wireNets, wireWidths, portNets, netDrivers, diagnostics, runtime }` as JSON;
    /// on validation errors the maps are empty and no circuit is loaded. A
    /// description that does not parse is an error, and also leaves none loaded.
    ///
    /// With `keep` (an edit, ADR 0033), state is carried from the circuit loaded before, or from the last one that
    /// compiled if that edit had errors; on errors this one keeps it for the next. Without `keep` (an open), nothing
    /// is carried or kept.
    pub fn load(&mut self, description: &str, keep: bool) -> Result<String, JsError> {
        let previous = self
            .sim
            .take()
            .or_else(|| self.kept.take())
            .filter(|_| keep);
        let description: CircuitDescription = serde_json::from_str(description)?;
        let empty = (BTreeMap::new(), PortNets::new());
        let loaded = match &previous {
            Some(previous) => Simulator::load_keeping(&description, previous),
            None => Simulator::load(&description),
        };
        let (sim, diagnostics) = match loaded {
            Ok((sim, warnings)) => (Some(sim), warnings),
            Err(errors) => {
                self.kept = previous;
                (None, errors)
            }
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

    /// Sets a switch or keyboard (ADR 0021) to `value` and settles. Returns runtime diagnostics as a
    /// JSON array. `value` arrives as a JS number, so anything but a whole
    /// number from 0 to `u32::MAX` is refused rather than wrapped or truncated;
    /// the engine then refuses values wider than the switch.
    pub fn set_input(&mut self, component: &str, value: f64) -> Result<String, JsError> {
        let value = whole(value)?;
        let diagnostic = self
            .loaded()?
            .set_input(component, value)
            .map_err(|e| JsError::new(&e))?;
        Ok(serde_json::to_string(&Vec::from_iter(diagnostic))?)
    }

    /// Sets several switches or keyboards, `{ id: value }` as JSON, in one settle, as if they
    /// changed together (ADR 0017); values are checked as `set_input` checks them,
    /// and nothing is set if any is refused.
    pub fn set_inputs(&mut self, values: &str) -> Result<String, JsError> {
        let values: BTreeMap<String, f64> = serde_json::from_str(values)?;
        let values = values
            .iter()
            .map(|(id, &value)| Ok((id.as_str(), whole(value)?)))
            .collect::<Result<Vec<_>, JsError>>()?;
        let diagnostic = self
            .loaded()?
            .set_inputs(&values)
            .map_err(|e| JsError::new(&e))?;
        Ok(serde_json::to_string(&Vec::from_iter(diagnostic))?)
    }

    /// Advances the clock `count` ticks (half periods), settling after each;
    /// stops at the first that does not settle. Returns runtime diagnostics
    /// as a JSON array (ADR 0017).
    pub fn tick(&mut self, count: u32) -> Result<String, JsError> {
        let sim = self.loaded()?;
        Ok(serde_json::to_string(&Vec::from_iter(
            sim.tick(u64::from(count)),
        ))?)
    }

    /// Ticks like `tick` until LED `led` lights from dark (ADR 0019 item 6), at
    /// most `count` ticks. Returns `{ ticks, rose, diagnostics }` as JSON. Any
    /// part with an `in` port is accepted; the editor offers only LEDs.
    pub fn tick_until(&mut self, count: u32, led: &str) -> Result<String, JsError> {
        let sim = self.loaded()?;
        let net = sim
            .port_nets()
            .get(led)
            .and_then(|ports| ports.get("in"))
            .copied()
            .ok_or_else(|| JsError::new(&format!("{led} has no `in` port on this sheet")))?;
        let run = sim.tick_until(u64::from(count), net);
        let result = serde_json::json!({
            "ticks": run.ticks,
            "rose": run.rose,
            "diagnostics": Vec::from_iter(run.unstable),
        });
        Ok(result.to_string())
    }

    /// One clock cycle: until the clock has risen once and is low again.
    pub fn step_cycle(&mut self) -> Result<String, JsError> {
        Ok(serde_json::to_string(&Vec::from_iter(
            self.loaded()?.step_cycle(),
        ))?)
    }

    /// Flip-flops, the clock and time back to 0; switch values are kept. While an edit has errors, drops the
    /// circuit kept for its fix, so the fix starts clean (ADR 0033).
    pub fn reset(&mut self) -> Result<String, JsError> {
        let Some(sim) = self.sim.as_mut() else {
            self.kept = None;
            return Ok("[]".to_string());
        };
        Ok(serde_json::to_string(&Vec::from_iter(sim.reset()))?)
    }

    /// The first `count` words of ROM or RAM `component` (elaborated ID, `instance/ram` inside an
    /// instance), or nothing if it is not a memory or nothing is loaded (ADR 0018).
    pub fn memory(&self, component: &str, count: u32) -> Option<Vec<u32>> {
        let words = self.sim.as_ref()?.memory(component)?;
        Some(words[..words.len().min(count as usize)].to_vec())
    }

    /// Records the nets of `wires`, each once; a net already recorded keeps its record, and a load with `keep`
    /// carries them (ADRs 0026, 0033). Wires not in the circuit record nothing.
    pub fn watch(&mut self, wires: Vec<String>) -> Result<(), JsError> {
        let wires: Vec<&str> = wires.iter().map(String::as_str).collect();
        self.loaded()?.watch_wires(&wires);
        Ok(())
    }

    /// The nets recorded, in the order `wave` indexes them; empty when nothing is loaded.
    pub fn recorded_nets(&self) -> Vec<u32> {
        self.sim
            .as_ref()
            .map_or_else(Vec::new, Simulator::recorded_nets)
    }

    /// The `index`th watched net's changes as `[t0, v0, t1, v1, …]`, oldest first; times are exact
    /// up to 2^53 ticks, values always. Nothing if no such net is watched or nothing is loaded.
    pub fn wave(&self, index: u32) -> Option<Vec<f64>> {
        let changes = self.sim.as_ref()?.wave(index as usize)?;
        Some(
            changes
                .flat_map(|(t, v)| [t as f64, f64::from(v)])
                .collect(),
        )
    }

    /// Virtual time in ticks (exact as a JS number up to 2^53): while an edit has errors, the kept circuit's;
    /// 0 when nothing is loaded or kept.
    pub fn time(&self) -> f64 {
        self.sim
            .as_ref()
            .or(self.kept.as_ref())
            .map_or(0.0, |sim| sim.time() as f64)
    }

    fn loaded(&mut self) -> Result<&mut Simulator, JsError> {
        self.sim
            .as_mut()
            .ok_or_else(|| JsError::new("no circuit loaded"))
    }

    /// Current net values, each cut to its width, indexed by net. Empty when
    /// nothing is loaded.
    pub fn nets(&self) -> Vec<u32> {
        self.sim
            .as_ref()
            .map_or_else(Vec::new, |sim| sim.nets().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A flip-flop `t` that toggles on every rising edge of clock `k`, with an LED on `t` when `led`; with `broken`,
    /// a second driver on that LED's input.
    fn toggle(led: bool, broken: bool) -> String {
        let mut components = vec![
            serde_json::json!({ "id": "k", "kind": "clock" }),
            serde_json::json!({ "id": "n", "kind": "not" }),
            serde_json::json!({ "id": "t", "kind": "dff" }),
        ];
        let port = |c: &str, p: &str| serde_json::json!({ "component": c, "port": p });
        let mut connections = vec![
            serde_json::json!({ "id": "w1", "from": port("t", "q"), "to": port("n", "in") }),
            serde_json::json!({ "id": "w2", "from": port("n", "out"), "to": port("t", "d") }),
            serde_json::json!({ "id": "w3", "from": port("k", "out"), "to": port("t", "clk") }),
        ];
        if led {
            components.push(serde_json::json!({ "id": "l", "kind": "led" }));
            connections.push(
                serde_json::json!({ "id": "w4", "from": port("t", "q"), "to": port("l", "in") }),
            );
        }
        if broken {
            connections.push(
                serde_json::json!({ "id": "w5", "from": port("n", "out"), "to": port("l", "in") }),
            );
        }
        serde_json::json!({ "components": components, "connections": connections }).to_string()
    }

    fn q(engine: &Engine) -> u32 {
        let sim = engine.sim.as_ref().expect("loaded");
        sim.nets()[sim.port_nets()["t"]["q"] as usize]
    }

    #[test]
    fn an_edit_with_errors_keeps_the_last_circuit_and_its_fix_carries_it() {
        let mut engine = Engine::new();
        engine.load(&toggle(false, false), false).unwrap();
        engine.tick(3).unwrap();
        assert_eq!((engine.time(), q(&engine)), (3.0, 0));

        // The edit has errors: nothing is loaded, time stands still.
        engine.load(&toggle(true, true), true).unwrap();
        assert!(engine.sim.is_none());
        assert_eq!(engine.time(), 3.0);
        // A second edit with errors still keeps it.
        engine.load(&toggle(true, true), true).unwrap();
        assert_eq!(engine.time(), 3.0);

        // The fix carries the state from before the errors.
        engine.load(&toggle(true, false), true).unwrap();
        assert_eq!((engine.time(), q(&engine)), (3.0, 0));
        engine.tick(2).unwrap();
        assert_eq!(q(&engine), 1);
    }

    #[test]
    fn an_open_or_a_reset_during_errors_starts_clean() {
        let mut engine = Engine::new();
        engine.load(&toggle(false, false), false).unwrap();
        engine.tick(5).unwrap();
        engine.load(&toggle(true, true), true).unwrap();
        // Reset while the edit has errors drops what was kept.
        assert_eq!(engine.reset().unwrap(), "[]");
        assert_eq!(engine.time(), 0.0);
        engine.load(&toggle(true, false), true).unwrap();
        assert_eq!(engine.time(), 0.0);

        // An open carries nothing, from a loaded circuit or a kept one.
        engine.tick(5).unwrap();
        engine.load(&toggle(true, false), false).unwrap();
        assert_eq!(engine.time(), 0.0);
        engine.tick(5).unwrap();
        engine.load(&toggle(true, true), true).unwrap();
        engine.load(&toggle(true, false), false).unwrap();
        assert_eq!(engine.time(), 0.0);
    }

    #[test]
    fn watched_wires_are_recorded_by_net_and_carried_by_an_edit() {
        let mut engine = Engine::new();
        engine.load(&toggle(false, false), false).unwrap();
        engine
            .watch(vec![
                "w1".to_string(),
                "w3".to_string(),
                "missing".to_string(),
            ])
            .unwrap();
        let nets = engine.recorded_nets();
        assert_eq!(nets.len(), 2);
        engine.tick(4).unwrap();
        let before = engine.wave(0).unwrap();
        engine.load(&toggle(true, false), true).unwrap();
        // The worker watches again after every load; the records stay.
        engine
            .watch(vec!["w1".to_string(), "w3".to_string()])
            .unwrap();
        assert_eq!(engine.wave(0).unwrap(), before);
    }
}
