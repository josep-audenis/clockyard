//! Loading project files as the editor projects them, shared by the tests
//! that run the bundled examples. Each test crate uses only some of it.
#![allow(dead_code)]

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

/// The props the editor projects to the engine (ADRs 0014, 0018); `label` and `source` stay in the editor.
#[derive(Default, Deserialize)]
struct Props {
    width: Option<f64>,
    fields: Option<Vec<f64>>,
    #[serde(rename = "addressWidth")]
    address_width: Option<f64>,
    data: Option<Vec<f64>>,
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

/// The text of `examples/{name}.clockyard.json`.
pub fn example(name: &str) -> String {
    let path = format!(
        "{}/../../examples/{name}.clockyard.json",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// A project file's circuit as the editor sends it to the engine.
pub fn description(text: &str) -> CircuitDescription {
    let document: Document = serde_json::from_str(text).expect("valid project file");
    let parts = |c: &Circuit| {
        c.components
            .iter()
            .map(|p| ComponentDesc {
                width: p.props.width,
                fields: p.props.fields.clone(),
                address_width: p.props.address_width,
                data: p.props.data.clone(),
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

/// The example `name`, loaded; it must load without warnings.
pub fn load(name: &str) -> Simulator {
    let (sim, warnings) = Simulator::load(&description(&example(name))).expect("valid circuit");
    assert_eq!(warnings, vec![], "{name} loads without warnings");
    sim
}

/// The value on a port, by elaborated ID (`instance/part` inside an instance).
pub fn value(sim: &Simulator, component: &str, port: &str) -> u32 {
    sim.nets()[sim.port_nets()[component][port] as usize]
}
