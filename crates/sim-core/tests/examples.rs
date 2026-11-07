//! The bundled examples (`examples/*.clockyard.json`) checked natively through
//! the engine. Expected outputs live here, never in the example files.

use serde::Deserialize;
use sim_core::description::{ComponentDesc, Connection, DefinitionDesc, JunctionDesc, PinDesc};
use sim_core::{CircuitDescription, Simulator};

/// The parts of a project file the engine needs; geometry only orders pins.
#[derive(Deserialize)]
struct Document {
    circuit: Circuit,
    #[serde(default)]
    definitions: Vec<Definition>,
}

#[derive(Deserialize)]
struct Definition {
    id: String,
    circuit: Circuit,
}

#[derive(Deserialize)]
struct Circuit {
    components: Vec<Part>,
    junctions: Vec<JunctionDesc>,
    wires: Vec<Connection>,
}

#[derive(Deserialize)]
struct Part {
    #[serde(flatten)]
    desc: ComponentDesc,
    position: Position,
}

#[derive(Deserialize)]
struct Position {
    x: i64,
    y: i64,
}

/// Pins as the editor projects them (ADRs 0012, 0013): switches in, LEDs out, named by part ID, top to bottom.
fn pins(parts: &[Part], kind: &str) -> Vec<PinDesc> {
    let mut chosen: Vec<&Part> = parts.iter().filter(|p| p.desc.kind == kind).collect();
    chosen.sort_by_key(|p| (p.position.y, p.position.x));
    chosen
        .into_iter()
        .map(|p| PinDesc {
            name: p.desc.id.clone(),
            component: p.desc.id.clone(),
        })
        .collect()
}

fn load(name: &str) -> Simulator {
    let path = format!(
        "{}/../../examples/{name}.clockyard.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let document: Document = serde_json::from_str(&text).expect("valid project file");
    let parts = |c: &Circuit| {
        c.components
            .iter()
            .map(|p| p.desc.clone())
            .collect::<Vec<_>>()
    };
    let definitions = document
        .definitions
        .iter()
        .map(|d| DefinitionDesc {
            id: d.id.clone(),
            components: parts(&d.circuit),
            junctions: d.circuit.junctions.clone(),
            connections: d.circuit.wires.clone(),
            inputs: pins(&d.circuit.components, "switch"),
            outputs: pins(&d.circuit.components, "led"),
        })
        .collect();
    let description = CircuitDescription {
        components: parts(&document.circuit),
        junctions: document.circuit.junctions.clone(),
        connections: document.circuit.wires.clone(),
        definitions,
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

#[test]
fn four_bit_adder() {
    // Four instances of one full-adder definition, carries chained (ADR 0012).
    let mut sim = load("4-bit-adder");
    for a in 0..16u8 {
        for b in 0..16u8 {
            for cin in 0..2u8 {
                for i in 0..4 {
                    sim.set_input(&format!("a{i}"), a >> i & 1 == 1).unwrap();
                    sim.set_input(&format!("b{i}"), b >> i & 1 == 1).unwrap();
                }
                sim.set_input("cin", cin == 1).unwrap();
                let bits: u8 = (0..4)
                    .map(|i| value(&sim, &format!("s{i}"), "in") << i)
                    .sum();
                let total = bits + (value(&sim, "cout", "in") << 4);
                assert_eq!(total, a + b + cin, "{a}+{b}+{cin}");
            }
        }
    }
}
