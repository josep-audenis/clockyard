//! Challenges checked by behavioural tests (ADR 0025). A challenge names a
//! custom component to build; [`check`] puts it on a test bench of its own,
//! switches on its input pins and LEDs on its output pins, and runs the
//! challenge's steps on a fresh [`Simulator`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::description::{
    CircuitDescription, Code, ComponentDesc, Connection, DefinitionDesc, Endpoint, PortRef,
};
use crate::elaborate::{CUSTOM, elaborate};
use crate::sim::Simulator;

/// The bench's own parts. The definition's parts are all elaborated under `dut/`, so these never clash.
const DUT: &str = "dut";

/// What a challenge asks for. Title and text are the editor's; the engine ignores them.
#[derive(Clone, Debug, Deserialize)]
pub struct Challenge {
    /// The ID of the definition to build, fixed by the starter document.
    pub definition: String,
    pub inputs: Vec<PinSpec>,
    pub outputs: Vec<PinSpec>,
    /// The primitive kinds the definition may be built from, flattened; absent allows any.
    #[serde(default)]
    pub parts: Option<Vec<String>>,
    pub steps: Vec<Step>,
}

/// A pin by its part's ID, as instances name their ports (ADR 0013), and its width.
#[derive(Clone, Debug, Deserialize)]
pub struct PinSpec {
    pub name: String,
    pub width: u32,
}

/// Inputs set together, then outputs compared once the circuit settles.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Step {
    #[serde(default)]
    pub set: BTreeMap<String, u32>,
    #[serde(default)]
    pub expect: BTreeMap<String, u32>,
}

/// A pin's value, in the challenge's pin order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Reading {
    pub name: String,
    pub value: u32,
}

/// An output that read other than the step expects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Mismatch {
    pub name: String,
    pub expected: u32,
    pub got: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum Report {
    /// Every step passed.
    Passed { steps: usize },
    /// The first step whose outputs differ: its 0-based index, every input's
    /// value at that point, and the outputs that differ.
    Failed {
        step: usize,
        inputs: Vec<Reading>,
        mismatches: Vec<Mismatch>,
    },
    /// Why the bench could not run: a missing or mis-sized pin, a part not
    /// allowed, errors in the circuit, or a loop that did not settle.
    Refused { reason: String },
}

fn refused(reason: String) -> Report {
    Report::Refused { reason }
}

/// Runs `challenge` against its definition in `description`. The main circuit is not used.
pub fn check(description: &CircuitDescription, challenge: &Challenge) -> Report {
    match bench(description, challenge).and_then(|bench| run(&bench, challenge)) {
        Ok(report) | Err(report) => report,
    }
}

/// The definition on a bench: a switch per input pin, an LED per output pin.
fn bench(
    description: &CircuitDescription,
    challenge: &Challenge,
) -> Result<CircuitDescription, Report> {
    let Some(definition) = description
        .definitions
        .iter()
        .find(|d| d.id == challenge.definition)
    else {
        return Err(refused(
            "The component this challenge checks is missing; undo, or start the challenge again to get it back."
                .to_string(),
        ));
    };
    let mut components = vec![ComponentDesc {
        id: DUT.to_string(),
        kind: CUSTOM.to_string(),
        definition: Some(definition.id.clone()),
        ..Default::default()
    }];
    let mut connections = Vec::new();
    let pins = [
        ("input", "switch", &challenge.inputs),
        ("output", "led", &challenge.outputs),
    ];
    for (side, kind, specs) in pins {
        for spec in specs {
            pin_width(definition, side, spec)?;
            let id = format!("{side}:{}", spec.name);
            components.push(ComponentDesc {
                id: id.clone(),
                kind: kind.to_string(),
                width: (spec.width > 1).then_some(f64::from(spec.width)),
                ..Default::default()
            });
            let (own, theirs) = if kind == "switch" {
                ("out", DUT)
            } else {
                ("in", DUT)
            };
            let ours = Endpoint::Port(PortRef {
                component: id.clone(),
                port: own.to_string(),
            });
            let pin = Endpoint::Port(PortRef {
                component: theirs.to_string(),
                port: spec.name.clone(),
            });
            let (from, to) = if kind == "switch" {
                (ours, pin)
            } else {
                (pin, ours)
            };
            connections.push(Connection {
                id: format!("wire:{id}"),
                from,
                to,
            });
        }
    }
    Ok(CircuitDescription {
        components,
        junctions: Vec::new(),
        connections,
        definitions: description.definitions.clone(),
    })
}

/// Refuses a pin the definition lacks, or one of another width.
fn pin_width(definition: &DefinitionDesc, side: &str, spec: &PinSpec) -> Result<(), Report> {
    let pins = if side == "input" {
        &definition.inputs
    } else {
        &definition.outputs
    };
    let Some(pin) = pins.iter().find(|p| p.name == spec.name) else {
        return Err(refused(format!(
            "The component has no {side} pin {}; undo, or start the challenge again to get it back.",
            spec.name
        )));
    };
    let width = definition
        .components
        .iter()
        .find(|c| c.id == pin.component)
        .and_then(|c| c.ports_shape().ok())
        .map_or(1, |shape| shape.width);
    if width != spec.width {
        return Err(refused(format!(
            "Pin {} is {} wide; this challenge needs {}.",
            spec.name,
            bits(width),
            bits(spec.width)
        )));
    }
    Ok(())
}

fn bits(width: u32) -> String {
    if width == 1 {
        "1 bit".to_string()
    } else {
        format!("{width} bits")
    }
}

fn run(bench: &CircuitDescription, challenge: &Challenge) -> Result<Report, Report> {
    // Errors first: a part of an unknown kind is an error, not a part to allow.
    let (mut sim, warnings) = Simulator::load(bench).map_err(|errors| circuit_errors(&errors))?;
    if let Some(allowed) = &challenge.parts {
        // Flattened, so the user's own components count by what they are built of.
        let flat = elaborate(bench).map_err(|errors| circuit_errors(&errors))?;
        let prefix = format!("{DUT}/");
        let mut used: Vec<&str> = flat
            .components
            .iter()
            .filter(|c| c.id.starts_with(&prefix))
            .map(|c| c.kind.as_str())
            .filter(|kind| !allowed.iter().any(|a| a == kind))
            .collect();
        used.sort_unstable();
        used.dedup();
        if !used.is_empty() {
            return Err(refused(format!(
                "This challenge allows only these parts: {}. The component uses: {}.",
                list(allowed.iter().map(String::as_str)),
                list(used.into_iter())
            )));
        }
    }
    if let Some(d) = warnings.iter().find(|d| d.code == Code::Unstable) {
        return Err(refused(format!(
            "The circuit did not settle when it started: {}",
            plain(&d.message)
        )));
    }
    let mut inputs: Vec<Reading> = challenge
        .inputs
        .iter()
        .map(|p| Reading {
            name: p.name.clone(),
            value: 0,
        })
        .collect();
    for (step, s) in challenge.steps.iter().enumerate() {
        let mut values = Vec::new();
        for (name, &value) in &s.set {
            let Some(reading) = inputs.iter_mut().find(|r| &r.name == name) else {
                return Err(refused(format!(
                    "Step {} sets {name}, which is not an input pin.",
                    step + 1
                )));
            };
            reading.value = value;
            values.push((format!("input:{name}"), value));
        }
        let values: Vec<(&str, u32)> = values.iter().map(|(id, v)| (id.as_str(), *v)).collect();
        match sim.set_inputs(&values) {
            Err(message) => {
                return Err(refused(format!("Step {}: {}", step + 1, plain(&message))));
            }
            Ok(Some(d)) => {
                return Err(refused(format!(
                    "At step {} the circuit did not settle: {}",
                    step + 1,
                    plain(&d.message)
                )));
            }
            Ok(None) => {}
        }
        let mut mismatches = Vec::new();
        for output in &challenge.outputs {
            let Some(&expected) = s.expect.get(&output.name) else {
                continue;
            };
            let net = sim.port_nets()[format!("output:{}", output.name).as_str()]["in"];
            let got = sim.nets()[net as usize];
            if got != expected {
                mismatches.push(Mismatch {
                    name: output.name.clone(),
                    expected,
                    got,
                });
            }
        }
        if let Some(name) = s
            .expect
            .keys()
            .find(|n| !challenge.outputs.iter().any(|o| &o.name == *n))
        {
            return Err(refused(format!(
                "Step {} expects {name}, which is not an output pin.",
                step + 1
            )));
        }
        if !mismatches.is_empty() {
            return Ok(Report::Failed {
                step,
                inputs,
                mismatches,
            });
        }
    }
    Ok(Report::Passed {
        steps: challenge.steps.len(),
    })
}

/// The first error, as the editor's status bar would show it.
fn circuit_errors(errors: &[crate::Diagnostic]) -> Report {
    let first = errors.first().map_or("", |d| d.message.as_str());
    refused(format!(
        "The circuit has errors to fix first: {}",
        plain(first)
    ))
}

/// An engine message without the bench's own names, which the user never sees.
fn plain(message: &str) -> String {
    message
        .replace(&format!("{DUT}/"), "")
        .replace("input:", "")
        .replace("output:", "")
}

/// Kind names joined by commas, since "and" is a kind too.
fn list<'a>(kinds: impl Iterator<Item = &'a str>) -> String {
    kinds.collect::<Vec<_>>().join(", ")
}
