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
    #[serde(default)]
    props: Props,
}

/// The props the editor projects to the engine (ADR 0014); `label` stays in the editor.
#[derive(Default, Deserialize)]
struct Props {
    width: Option<f64>,
    fields: Option<Vec<f64>>,
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

fn description(name: &str) -> CircuitDescription {
    let path = format!(
        "{}/../../examples/{name}.clockyard.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let document: Document = serde_json::from_str(&text).expect("valid project file");
    let parts = |c: &Circuit| {
        c.components
            .iter()
            .map(|p| ComponentDesc {
                width: p.props.width,
                fields: p.props.fields.clone(),
                ..p.desc.clone()
            })
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
    CircuitDescription {
        components: parts(&document.circuit),
        junctions: document.circuit.junctions.clone(),
        connections: document.circuit.wires.clone(),
        definitions,
    }
}

fn load(name: &str) -> Simulator {
    let (sim, warnings) = Simulator::load(&description(name)).expect("valid circuit");
    assert_eq!(warnings, vec![], "{name} loads without warnings");
    sim
}

fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}

const INPUTS: [(u32, u32); 4] = [(0, 0), (0, 1), (1, 0), (1, 1)];

#[test]
fn and_gate() {
    let mut sim = load("and-gate");
    for (a, b) in INPUTS {
        sim.set_input("a", a).unwrap();
        sim.set_input("b", b).unwrap();
        assert_eq!(value(&sim, "led", "in"), a & b, "a={a} b={b}");
    }
}

#[test]
fn cascade_fanout() {
    let mut sim = load("cascade-fanout");
    for (a, b) in INPUTS {
        sim.set_input("a", a).unwrap();
        sim.set_input("b", b).unwrap();
        assert_eq!(value(&sim, "led-a", "in"), a, "fan-out of a, a={a} b={b}");
        assert_eq!(value(&sim, "led-y", "in"), (a ^ b) & a, "a={a} b={b}");
    }
}

#[test]
fn half_adder() {
    let mut sim = load("half-adder");
    for (a, b) in INPUTS {
        sim.set_input("a", a).unwrap();
        sim.set_input("b", b).unwrap();
        let total = value(&sim, "led-carry", "in") * 2 + value(&sim, "led-sum", "in");
        assert_eq!(total, a + b, "a={a} b={b}");
    }
}

#[test]
fn four_bit_adder() {
    // Four instances of one full-adder definition, carries chained (ADR 0012).
    let mut sim = load("4-bit-adder");
    for a in 0..16u32 {
        for b in 0..16u32 {
            for cin in 0..2u32 {
                for i in 0..4 {
                    sim.set_input(&format!("a{i}"), a >> i & 1).unwrap();
                    sim.set_input(&format!("b{i}"), b >> i & 1).unwrap();
                }
                sim.set_input("cin", cin).unwrap();
                let bits: u32 = (0..4)
                    .map(|i| value(&sim, &format!("s{i}"), "in") << i)
                    .sum();
                let total = bits + (value(&sim, "cout", "in") << 4);
                assert_eq!(total, a + b + cin, "{a}+{b}+{cin}");
            }
        }
    }
}

#[test]
fn eight_bit_adder() {
    // ADR 0014: 8-bit A and B split into bits, eight instances of the 4-bit
    // adder's full-adder definition, the sums merged into one 8-bit LED.
    let mut sim = load("8-bit-adder");
    for a in 0..256 {
        sim.set_input("a", a).unwrap();
        for b in 0..256 {
            sim.set_input("b", b).unwrap();
            for cin in 0..2 {
                sim.set_input("cin", cin).unwrap();
                let total = a + b + cin;
                assert_eq!(value(&sim, "sum", "in"), total % 256, "{a}+{b}+{cin}");
                assert_eq!(value(&sim, "cout", "in"), total >> 8, "{a}+{b}+{cin}");
            }
        }
    }
}

#[test]
fn eight_bit_counter() {
    // ADR 0017: an 8-bit register fed back through the 8-bit adder as a component.
    // Count is the carry in; Add (switch `step`) is added each cycle as well.
    let mut sim = load("8-bit-counter");
    assert_eq!(value(&sim, "out", "in"), 0);
    sim.set_input("count", 1).unwrap();
    for n in 1..=300u32 {
        assert_eq!(sim.step_cycle(), None);
        assert_eq!(value(&sim, "out", "in"), n % 256, "after {n} cycles");
    }
    sim.set_inputs(&[("count", 0), ("step", 3)]).unwrap();
    sim.step_cycle();
    assert_eq!(value(&sim, "out", "in"), (300 + 3) % 256);
    // Reset clears the register and keeps the switches.
    sim.reset();
    assert_eq!(value(&sim, "out", "in"), 0);
    // Running by ticks gives what the same number of steps gives.
    sim.tick(2 * 10);
    assert_eq!((sim.time(), value(&sim, "out", "in")), (20, 30));
}
