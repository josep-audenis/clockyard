//! The bundled examples (`examples/*.clockyard.json`) checked natively through
//! the engine. Expected outputs live here, never in the example files.

use serde::Deserialize;
use sim_core::description::{
    ComponentDesc, Connection, DefinitionDesc, Endpoint, JunctionDesc, PinDesc, PortRef,
};
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
    // shortcut: built here from that definition until format v5 lets the
    // editor open `examples/8-bit-adder.clockyard.json` (ADR 0014 step 3).
    let definitions = description("4-bit-adder").definitions;
    let part = |id: &str, kind: &str| ComponentDesc {
        id: id.into(),
        kind: kind.into(),
        ..Default::default()
    };
    let bus = |id: &str, kind: &str| ComponentDesc {
        width: Some(8.0),
        ..part(id, kind)
    };
    let bits = |id: &str, kind: &str| ComponentDesc {
        fields: Some(vec![1.0; 8]),
        ..part(id, kind)
    };
    let mut components = vec![
        bus("a", "switch"),
        bus("b", "switch"),
        part("cin", "switch"),
        bits("sa", "split"),
        bits("sb", "split"),
        bits("ms", "merge"),
        bus("sum", "led"),
        part("cout", "led"),
    ];
    let mut wires = vec![
        ("a", "out", "sa", "in"),
        ("b", "out", "sb", "in"),
        ("cin", "out", "fa0", "cin"),
        ("fa7", "cout", "cout", "in"),
        ("ms", "out", "sum", "in"),
    ]
    .into_iter()
    .map(|(a, ap, b, bp)| {
        (
            (a.to_string(), ap.to_string()),
            (b.to_string(), bp.to_string()),
        )
    })
    .collect::<Vec<_>>();
    for i in 0..8 {
        let fa = format!("fa{i}");
        let field = format!("f{i}");
        components.push(ComponentDesc {
            definition: Some("full-adder".into()),
            ..part(&fa, "custom")
        });
        for (from, to) in [
            (("sa", field.as_str()), (fa.as_str(), "a")),
            (("sb", field.as_str()), (fa.as_str(), "b")),
            ((fa.as_str(), "s"), ("ms", field.as_str())),
        ] {
            wires.push(((from.0.into(), from.1.into()), (to.0.into(), to.1.into())));
        }
        if i < 7 {
            wires.push((
                (fa.clone(), "cout".into()),
                (format!("fa{}", i + 1), "cin".into()),
            ));
        }
    }
    let port = |(component, port): (String, String)| Endpoint::Port(PortRef { component, port });
    let connections = wires
        .into_iter()
        .enumerate()
        .map(|(i, (from, to))| Connection {
            id: format!("w{i}"),
            from: port(from),
            to: port(to),
        })
        .collect();
    let adder = CircuitDescription {
        components,
        junctions: Vec::new(),
        connections,
        definitions,
    };
    let (mut sim, warnings) = Simulator::load(&adder).expect("valid circuit");
    assert_eq!(warnings, vec![]);
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
