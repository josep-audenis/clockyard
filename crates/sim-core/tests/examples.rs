//! The bundled examples (`examples/*.clockyard.json`) checked natively through
//! the engine. Expected outputs live here, never in the example files.

use serde::Deserialize;
use sim_core::description::{ComponentDesc, Connection};
use sim_core::{CircuitDescription, Simulator};

/// The parts of a project file the engine needs; geometry is ignored.
#[derive(Deserialize)]
struct Document {
    circuit: Circuit,
}

#[derive(Deserialize)]
struct Circuit {
    components: Vec<ComponentDesc>,
    wires: Vec<Connection>,
}

fn load(name: &str) -> Simulator {
    let path = format!(
        "{}/../../examples/{name}.clockyard.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let document: Document = serde_json::from_str(&text).expect("valid project file");
    let description = CircuitDescription {
        components: document.circuit.components,
        connections: document.circuit.wires,
    };
    let (sim, warnings) = Simulator::load(&description).expect("valid circuit");
    assert_eq!(warnings, vec![], "{name} loads without warnings");
    sim
}

fn value(sim: &Simulator, component: &str, port: &str) -> u8 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

const INPUTS: [(u8, u8); 4] = [(0, 0), (0, 1), (1, 0), (1, 1)];

#[test]
fn and_gate() {
    let mut sim = load("and-gate");
    for (a, b) in INPUTS {
        sim.set_input("a", a == 1).unwrap();
        sim.set_input("b", b == 1).unwrap();
        assert_eq!(value(&sim, "led", "in"), a & b, "a={a} b={b}");
    }
}

#[test]
fn cascade_fanout() {
    let mut sim = load("cascade-fanout");
    for (a, b) in INPUTS {
        sim.set_input("a", a == 1).unwrap();
        sim.set_input("b", b == 1).unwrap();
        assert_eq!(value(&sim, "led-a", "in"), a, "fan-out of a, a={a} b={b}");
        assert_eq!(value(&sim, "led-y", "in"), (a ^ b) & a, "a={a} b={b}");
    }
}

#[test]
fn half_adder() {
    let mut sim = load("half-adder");
    for (a, b) in INPUTS {
        sim.set_input("a", a == 1).unwrap();
        sim.set_input("b", b == 1).unwrap();
        let total = value(&sim, "led-carry", "in") * 2 + value(&sim, "led-sum", "in");
        assert_eq!(total, a + b, "a={a} b={b}");
    }
}
