//! Challenges checked by behavioural tests (ADR 0025). A challenge names a
//! custom component to build; [`check`] puts it on a test bench of its own,
//! switches on its input pins and LEDs on its output pins, and runs the
//! challenge's steps on a fresh [`Simulator`].
//!
//! Challenges 10 to 12 (ADR 0034) are checked on a bench that is a circuit of
//! its own, a computer with one slot: [`check_on`] puts the definition in the
//! slot and runs the challenge's runs, each a program on a fresh bench.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::catalog::mask;
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
    #[serde(default)]
    pub steps: Vec<Step>,
    /// For a challenge with a bench (ADR 0034): each run starts a fresh bench.
    #[serde(default)]
    pub runs: Vec<Run>,
    /// The bench's name, `challenges/benches/<name>`: whoever calls reads the file and gives it to [`check_on`].
    #[serde(default)]
    pub bench: Option<String>,
}

/// One program run on a fresh bench: the words for the bench's program ROM, if
/// the challenge supplies the program, and the steps.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Run {
    pub name: String,
    #[serde(default)]
    pub words: Option<Vec<u32>>,
    pub steps: Vec<Step>,
}

/// A pin by its part's ID, as instances name their ports (ADR 0013), and its width.
#[derive(Clone, Debug, Deserialize)]
pub struct PinSpec {
    pub name: String,
    pub width: u32,
}

/// Inputs set together, then outputs compared once the circuit settles. On a
/// bench (ADR 0034), in this order: `set` with the clock low; `cycles` clock
/// cycles, stopping early once the LED `until` names is lit; then `expect` and
/// `memory`.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Step {
    #[serde(default)]
    pub set: BTreeMap<String, u32>,
    #[serde(default)]
    pub expect: BTreeMap<String, u32>,
    /// Clock cycles to run: the bench's `clk` switch set to 1, then to 0.
    #[serde(default)]
    pub cycles: u32,
    /// A bench LED that ends the cycles once it reads 1; not reading 1 by the last cycle fails the step.
    #[serde(default)]
    pub until: Option<String>,
    /// Bytes expected in a bench memory, by its part ID and address.
    #[serde(default)]
    pub memory: BTreeMap<String, BTreeMap<u32, u32>>,
}

/// No run may ask for more cycles than this, so a check's time is bounded (ADR 0034 item 4).
pub const MAX_RUN_CYCLES: u32 = 1000;
/// IDs of the definitions a bench owns start with this: a check always takes them from the bench.
pub const BENCH_PREFIX: &str = "bench-";
/// The bench's clock switch and program ROM, by part ID.
const BENCH_CLOCK: &str = "clk";
const BENCH_ROM: &str = "rom";

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
    /// The bits of `got` that are not known (ADR 0035): `X` where `got` has a 1, `Z` where it has a 0.
    #[serde(skip_serializing_if = "is_zero")]
    pub unknown: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum Report {
    /// Every step passed.
    Passed { steps: usize },
    /// The first step whose outputs differ: its 0-based index, every input's
    /// value at that point, and the outputs that differ.
    /// On a bench, `run` names the run, and a memory byte is named `ram[16]`.
    Failed {
        #[serde(skip_serializing_if = "Option::is_none")]
        run: Option<String>,
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
/// A challenge names its bench (`bench`, the editor's to read); with runs it is checked by [`check_on`].
pub fn check(description: &CircuitDescription, challenge: &Challenge) -> Report {
    // Never a pass by default: a challenge with runs needs its bench, and one with no steps checks nothing.
    if !challenge.runs.is_empty() {
        return fault("it was not given".to_string());
    }
    if challenge.steps.is_empty() {
        return fault("it has no steps".to_string());
    }
    match bench(description, challenge).and_then(|bench| run(&bench, challenge)) {
        Ok(report) | Err(report) => report,
    }
}

/// Runs `challenge` against its definition in `description`, in the slot of
/// `bench`: a circuit with an instance of the definition on it (ADR 0034).
///
/// The bench's own definitions (IDs starting [`BENCH_PREFIX`]) are the
/// bench's; every other definition is the user's, so a part the bench provides
/// cannot be edited to pass.
pub fn check_on(
    description: &CircuitDescription,
    challenge: &Challenge,
    bench: &CircuitDescription,
) -> Report {
    match computer(description, challenge, bench).and_then(|c| run_on(&c, challenge)) {
        Ok(report) | Err(report) => report,
    }
}

/// The bench with the user's definitions in place of its own slot.
fn computer(
    description: &CircuitDescription,
    challenge: &Challenge,
    bench: &CircuitDescription,
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
    for (side, specs) in [("input", &challenge.inputs), ("output", &challenge.outputs)] {
        for spec in specs {
            pin_width(definition, side, spec)?;
        }
    }
    let owned = |d: &&DefinitionDesc| d.id.starts_with(BENCH_PREFIX);
    let definitions = bench
        .definitions
        .iter()
        .filter(owned)
        .chain(description.definitions.iter().filter(|d| !owned(d)))
        .cloned()
        .collect();
    Ok(CircuitDescription {
        definitions,
        ..bench.clone()
    })
}

/// A fault in a bench or challenge file, not in the user's circuit.
fn fault(what: String) -> Report {
    refused(format!("This challenge's bench cannot run: {what}."))
}

/// Kinds used inside `slots` (instance paths) that `allowed` leaves out, as a refusal.
fn parts_allowed(
    circuit: &CircuitDescription,
    slots: &[String],
    allowed: &[String],
) -> Result<(), Report> {
    // Flattened, so the user's own components count by what they are built of.
    let flat = elaborate(circuit).map_err(|errors| circuit_errors(&errors))?;
    let mut used: Vec<&str> = flat
        .components
        .iter()
        .filter(|c| slots.iter().any(|slot| c.id.starts_with(slot)))
        .map(|c| c.kind.as_str())
        .filter(|kind| !allowed.iter().any(|a| a == kind))
        .collect();
    used.sort_unstable();
    used.dedup();
    if used.is_empty() {
        return Ok(());
    }
    Err(refused(format!(
        "This challenge allows only these parts: {}. The component uses: {}.",
        list(allowed.iter().map(String::as_str)),
        list(used.into_iter())
    )))
}

fn run_on(computer: &CircuitDescription, challenge: &Challenge) -> Result<Report, Report> {
    if challenge.runs.is_empty() {
        return Err(fault("it has no runs".to_string()));
    }
    // The slot: the bench's instances of the definition under test.
    let slots: Vec<String> = computer
        .components
        .iter()
        .filter(|c| c.definition.as_deref() == Some(challenge.definition.as_str()))
        .map(|c| format!("{}/", c.id))
        .collect();
    if slots.is_empty() {
        return Err(fault(format!("it has no {}", challenge.definition)));
    }
    // Errors first, as `run` has them: a part of an unknown kind is an error, not a part to allow.
    Simulator::load(computer).map_err(|errors| circuit_errors(&errors))?;
    if let Some(allowed) = &challenge.parts {
        parts_allowed(computer, &slots, allowed)?;
    }
    let mut steps = 0;
    for run in &challenge.runs {
        if run.steps.is_empty() {
            return Err(fault(format!("run {} has no steps", run.name)));
        }
        let cycles: u64 = run.steps.iter().map(|s| u64::from(s.cycles)).sum();
        if cycles > u64::from(MAX_RUN_CYCLES) {
            return Err(fault(format!(
                "run {} asks for more than {MAX_RUN_CYCLES} cycles",
                run.name
            )));
        }
        let mut computer = computer.clone();
        if let Some(words) = &run.words {
            let Some(rom) = computer
                .components
                .iter_mut()
                .find(|c| c.id == BENCH_ROM && c.kind == "rom")
            else {
                return Err(fault("it has no program ROM".to_string()));
            };
            // Checked here, so words that do not fit are the challenge's fault, not an error in the user's circuit.
            let fits = rom.ports_shape().is_ok_and(|shape| {
                words.len() <= 1 << shape.address && words.iter().all(|&w| w <= mask(shape.width))
            });
            if !fits {
                return Err(fault(format!(
                    "run {}'s words do not fit the program ROM",
                    run.name
                )));
            }
            rom.data = Some(words.iter().map(|&w| f64::from(w)).collect());
        }
        let (mut sim, warnings) =
            Simulator::load(&computer).map_err(|errors| circuit_errors(&errors))?;
        if let Some(d) = warnings.iter().find(|d| d.code == Code::Unstable) {
            return Err(refused(format!(
                "The circuit did not settle when it started: {}",
                d.message
            )));
        }
        // What the steps so far set, for the report.
        let mut inputs: BTreeMap<&str, u32> = BTreeMap::new();
        for (step, s) in run.steps.iter().enumerate() {
            let mismatches = bench_step(&mut sim, s).map_err(|problem| match problem {
                Problem::Fault(what) => {
                    fault(format!("run {}, step {}: {what}", run.name, step + 1))
                }
                Problem::Unsettled(message) => refused(format!(
                    "In run {}, at step {} the circuit did not settle: {message}",
                    run.name,
                    step + 1
                )),
            })?;
            inputs.extend(s.set.iter().map(|(name, &value)| (name.as_str(), value)));
            if !mismatches.is_empty() {
                return Ok(Report::Failed {
                    run: Some(run.name.clone()),
                    step,
                    inputs: inputs
                        .iter()
                        .map(|(&name, &value)| Reading {
                            name: name.to_string(),
                            value,
                        })
                        .collect(),
                    mismatches,
                });
            }
            steps += 1;
        }
    }
    Ok(Report::Passed { steps })
}

/// Why a bench step could not be carried out.
enum Problem {
    /// The bench or the challenge file is wrong.
    Fault(String),
    /// The circuit did not settle, with the engine's message.
    Unsettled(String),
}

/// One step on a bench: its switches set, its cycles run, and what differs from what it expects.
fn bench_step(sim: &mut Simulator, step: &Step) -> Result<Vec<Mismatch>, Problem> {
    let settle = |result: Result<Option<crate::Diagnostic>, String>| match result {
        Err(message) => Err(Problem::Fault(message)),
        Ok(Some(d)) if d.is_error() => Err(Problem::Unsettled(d.message)),
        // A warning that a loop's X remains stops nothing: the X fails what is compared.
        Ok(_) => Ok(()),
    };
    // An LED's value and its unknown bits.
    let led = |sim: &Simulator, name: &str| {
        let net = sim.port_nets().get(name).and_then(|ports| ports.get("in"));
        net.map(|&net| (sim.nets()[net as usize], sim.unknown()[net as usize]))
            .ok_or_else(|| Problem::Fault(format!("the bench has no LED {name}")))
    };
    let values: Vec<(&str, u32)> = step.set.iter().map(|(n, &v)| (n.as_str(), v)).collect();
    settle(sim.set_inputs(&values))?;
    for _ in 0..step.cycles {
        if let Some(until) = &step.until
            && led(sim, until)? == (1, 0)
        {
            break;
        }
        for level in [1, 0] {
            settle(sim.set_input(BENCH_CLOCK, level))?;
        }
    }
    let mut mismatches = Vec::new();
    let mut compare = |name: String, expected: u32, (got, unknown): (u32, u32)| {
        if got != expected || unknown != 0 {
            mismatches.push(Mismatch {
                name,
                expected,
                got,
                unknown,
            });
        }
    };
    if let Some(until) = &step.until {
        compare(until.clone(), 1, led(sim, until)?);
    }
    for (name, &expected) in &step.expect {
        compare(name.clone(), expected, led(sim, name)?);
    }
    for (part, bytes) in &step.memory {
        let (Some(words), Some(unknown)) = (sim.memory(part), sim.memory_unknown(part)) else {
            return Err(Problem::Fault(format!("the bench has no memory {part}")));
        };
        for (&address, &expected) in bytes {
            let Some(&got) = words.get(address as usize) else {
                return Err(Problem::Fault(format!("{part} has no address {address}")));
            };
            let unknown = unknown.get(address as usize).copied().unwrap_or(0);
            compare(format!("{part}[{address}]"), expected, (got, unknown));
        }
    }
    Ok(mismatches)
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
        parts_allowed(bench, &[format!("{DUT}/")], allowed)?;
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
            Ok(Some(d)) if d.is_error() => {
                return Err(refused(format!(
                    "At step {} the circuit did not settle: {}",
                    step + 1,
                    plain(&d.message)
                )));
            }
            Ok(_) => {}
        }
        let mut mismatches = Vec::new();
        for output in &challenge.outputs {
            let Some(&expected) = s.expect.get(&output.name) else {
                continue;
            };
            let net = sim.port_nets()[format!("output:{}", output.name).as_str()]["in"];
            let (got, unknown) = (sim.nets()[net as usize], sim.unknown()[net as usize]);
            if got != expected || unknown != 0 {
                mismatches.push(Mismatch {
                    name: output.name.clone(),
                    expected,
                    got,
                    unknown,
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
                run: None,
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
