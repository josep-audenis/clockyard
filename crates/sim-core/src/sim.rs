//! Compile a circuit description into a netlist and settle it with
//! synchronous deltas (`docs/simulation-model.md`, ADR 0006).

use std::collections::BTreeMap;

use crate::catalog::Kind;
use crate::description::{CircuitDescription, Code, Diagnostic, Endpoint, PinSide};
use crate::elaborate::{elaborate, lift};

/// Net 0 is never driven: unconnected inputs read it as 0.
const GROUND: u32 = 0;

/// Component ID → port name → net index.
pub type PortNets = BTreeMap<String, BTreeMap<String, u32>>;

/// A compiled circuit and its current signal values.
///
/// Components are indexed in ascending document ID order, so the same
/// description always compiles to the same indices.
#[derive(Debug)]
pub struct Simulator {
    ids: Vec<String>,
    kinds: Vec<Kind>,
    inputs: Vec<Vec<u32>>,
    outputs: Vec<Option<u32>>,
    state: Vec<u8>,
    fanout: Vec<Vec<u32>>,
    nets: Vec<u8>,
    wire_nets: BTreeMap<String, u32>,
    port_nets: PortNets,
    /// Components still dirty when the last settle hit its delta limit; the
    /// next settle resumes them, so a live loop is reported until it resolves.
    unsettled: Vec<u32>,
}

/// A node of the connection graph: a component port or a junction.
#[derive(Clone, Copy)]
enum End {
    Out(usize),
    In(usize, usize),
    /// For a custom component's pin, its index in the description's junctions and its side.
    Junction(Option<(usize, PinSide)>),
}

/// Union-find root of `node`, halving paths on the way.
fn find(parent: &mut [usize], mut node: usize) -> usize {
    while parent[node] != node {
        parent[node] = parent[parent[node]];
        node = parent[node];
    }
    node
}

/// "wire w0 connects" or "wires w0, w1 connect".
fn wires_verb(wires: &[String], verb: &str) -> String {
    let (s, verb_s) = if wires.len() == 1 {
        ("", "s")
    } else {
        ("s", "")
    };
    format!("wire{s} {} {verb}{verb_s}", wires.join(", "))
}

/// One net as joined by wires: its outputs, inputs (component, slot) and wires.
#[derive(Default)]
struct Group<'a> {
    outputs: Vec<usize>,
    inputs: Vec<(usize, usize)>,
    wires: Vec<&'a str>,
    /// Custom components' pins it reaches (junction indexes and sides).
    pins: Vec<(usize, PinSide)>,
}

/// The level an elaborated ID was wired at: `x/y/g` → `x/y/`, a top-level ID → "".
fn level(id: &str) -> &str {
    &id[..id.rfind('/').map_or(0, |i| i + 1)]
}

/// Whether an undriven net that reaches custom components' pins is legal, its readers reading 0.
/// It is judged level by level, as the user wired it: no level may join two or more inputs without
/// something there that drives them. Inside its instance an input pin is a switch (it drives) and an
/// output pin an LED (it reads); one level up they are the instance's input (reads) and output (drives).
fn undriven_ok<'a>(
    pins: impl Iterator<Item = (&'a str, PinSide)>,
    inputs: impl Iterator<Item = &'a str>,
) -> bool {
    // Per level: (inputs, drivers).
    let mut levels: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for id in inputs {
        levels.entry(level(id)).or_default().0 += 1;
    }
    for (id, side) in pins {
        let inside = level(id);
        let outside = level(&inside[..inside.len().saturating_sub(1)]);
        let (reads, drives) = match side {
            PinSide::Input => (outside, inside),
            PinSide::Output => (inside, outside),
        };
        levels.entry(reads).or_default().0 += 1;
        levels.entry(drives).or_default().1 += 1;
    }
    levels
        .values()
        .all(|&(inputs, drivers)| inputs < 2 || drivers > 0)
}

impl Simulator {
    /// Validates and compiles `description`, then settles it from all-zero
    /// nets. Returns the simulator with warnings (unconnected inputs, an
    /// unstable initial settle), or the validation errors.
    pub fn load(
        description: &CircuitDescription,
    ) -> Result<(Simulator, Vec<Diagnostic>), Vec<Diagnostic>> {
        // Custom components are flattened first (ADR 0012); diagnostics name top-level IDs.
        let flat = elaborate(description)?;
        match Self::compile(&flat) {
            Ok((sim, warnings)) => Ok((sim, lift(warnings))),
            Err(errors) => Err(lift(errors)),
        }
    }

    fn compile(
        description: &CircuitDescription,
    ) -> Result<(Simulator, Vec<Diagnostic>), Vec<Diagnostic>> {
        let mut errors = Vec::new();

        let mut sorted: Vec<_> = description.components.iter().collect();
        sorted.sort_by(|a, b| a.id.cmp(&b.id));
        let mut ids = Vec::new();
        let mut kinds = Vec::new();
        for (i, component) in sorted.iter().enumerate() {
            if i > 0 && sorted[i - 1].id == component.id {
                let message = format!("component ID {} is used more than once", component.id);
                errors.push(Diagnostic::error(
                    Code::DuplicateId,
                    message,
                    vec![component.id.clone()],
                ));
            } else if let Some(kind) = Kind::from_name(&component.kind) {
                ids.push(component.id.clone());
                kinds.push(kind);
            } else {
                let message = format!("{} has unknown kind '{}'", component.id, component.kind);
                errors.push(Diagnostic::error(
                    Code::UnknownKind,
                    message,
                    vec![component.id.clone()],
                ));
            }
        }
        // Graph nodes: every port, inputs before the output, then every junction.
        let mut ends = Vec::new();
        let mut base = Vec::new();
        for (c, kind) in kinds.iter().enumerate() {
            base.push(ends.len());
            ends.extend((0..kind.inputs().len()).map(|slot| End::In(c, slot)));
            if !kind.outputs().is_empty() {
                ends.push(End::Out(c));
            }
        }
        let mut junctions = BTreeMap::new();
        for (j, junction) in description.junctions.iter().enumerate() {
            let id = junction.id.as_str();
            if junctions.contains_key(id) || ids.binary_search(&junction.id).is_ok() {
                let message = format!("junction ID {id} is used more than once");
                errors.push(Diagnostic::error(
                    Code::DuplicateId,
                    message,
                    vec![id.into()],
                ));
            } else {
                junctions.insert(id, ends.len());
                ends.push(End::Junction(junction.pin.map(|side| (j, side))));
            }
        }
        // Wire errors against unknown components would only repeat these.
        if !errors.is_empty() {
            return Err(errors);
        }

        let resolve = |wire: &str, end: &Endpoint| -> Result<usize, Diagnostic> {
            let port = match end {
                Endpoint::Port(port) => port,
                Endpoint::Junction { junction } => {
                    return junctions.get(junction.as_str()).copied().ok_or_else(|| {
                        let message = format!("wire {wire} references unknown junction {junction}");
                        Diagnostic::error(Code::UnknownJunction, message, vec![wire.into()])
                    });
                }
            };
            let Ok(c) = ids.binary_search(&port.component) else {
                let message = format!(
                    "wire {wire} references unknown component {}",
                    port.component
                );
                return Err(Diagnostic::error(
                    Code::UnknownComponent,
                    message,
                    vec![wire.into()],
                ));
            };
            let kind = kinds[c];
            if kind.outputs().contains(&port.port.as_str()) {
                Ok(base[c] + kind.inputs().len())
            } else if let Some(slot) = kind.inputs().iter().position(|name| *name == port.port) {
                Ok(base[c] + slot)
            } else {
                let message = format!(
                    "wire {wire}: {} {} has no port '{}'",
                    kind.name(),
                    port.component,
                    port.port
                );
                Err(Diagnostic::error(
                    Code::UnknownPort,
                    message,
                    vec![wire.into(), port.component.clone()],
                ))
            }
        };

        // Join every port and junction that a wire connects (ADR 0010).
        let mut parent: Vec<usize> = (0..ends.len()).collect();
        let mut joined = Vec::new();
        let mut wire_ids = std::collections::BTreeSet::new();
        for wire in &description.connections {
            if !wire_ids.insert(wire.id.as_str()) {
                let message = format!("wire ID {} is used more than once", wire.id);
                errors.push(Diagnostic::error(
                    Code::DuplicateId,
                    message,
                    vec![wire.id.clone()],
                ));
                continue;
            }
            match (resolve(&wire.id, &wire.from), resolve(&wire.id, &wire.to)) {
                (Ok(a), Ok(b)) => {
                    let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
                    parent[ra] = rb;
                    joined.push((wire.id.as_str(), a));
                }
                (from, to) => errors.extend([from.err(), to.err()].into_iter().flatten()),
            }
        }
        if !errors.is_empty() {
            return Err(errors);
        }

        let mut groups: BTreeMap<usize, Group> = BTreeMap::new();
        for (wire, node) in &joined {
            let root = find(&mut parent, *node);
            groups.entry(root).or_default().wires.push(wire);
        }
        // Nets are checked in order of their first port or junction, never of
        // which way a wire was drawn, so diagnostics come out in a stable order.
        let mut order = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for (node, end) in ends.iter().enumerate() {
            let root = find(&mut parent, node);
            // Ports no wire touches stay alone: an output drives nothing, an input reads 0.
            let Some(group) = groups.get_mut(&root) else {
                continue;
            };
            if seen.insert(root) {
                order.push(root);
            }
            match *end {
                End::Out(c) => group.outputs.push(c),
                End::In(c, slot) => group.inputs.push((c, slot)),
                End::Junction(pin) => group.pins.extend(pin),
            }
        }

        let mut net_count = 1;
        let outputs: Vec<Option<u32>> = kinds
            .iter()
            .map(|kind| {
                (!kind.outputs().is_empty()).then(|| {
                    net_count += 1;
                    net_count - 1
                })
            })
            .collect();

        // Per component, per input slot: the driving net.
        let mut drivers: Vec<Vec<Option<u32>>> =
            kinds.iter().map(|k| vec![None; k.inputs().len()]).collect();
        let mut wire_nets = BTreeMap::new();
        for root in order {
            let group = &groups[&root];
            let mut wires: Vec<String> = group.wires.iter().map(|w| (*w).to_string()).collect();
            wires.sort();
            let net = match (group.outputs.as_slice(), group.inputs.as_slice()) {
                ([driver], _) => outputs[*driver].expect("an output port has a net"),
                // A dangling branch: its input (if any) stays unconnected and reads 0. One reaching
                // pins is judged level by level below, even when no input inside reads them.
                ([], []) | ([], [_]) if group.pins.is_empty() => GROUND,
                // A pin left unconnected (an instance input outside, an output inside): its readers read 0.
                ([], inputs)
                    if !group.pins.is_empty()
                        && undriven_ok(
                            group
                                .pins
                                .iter()
                                .map(|&(j, side)| (description.junctions[j].id.as_str(), side)),
                            inputs.iter().map(|&(c, _)| ids[c].as_str()),
                        ) =>
                {
                    GROUND
                }
                ([], _) => {
                    let message = format!(
                        "{} inputs and nothing drives them",
                        wires_verb(&wires, "connect")
                    );
                    errors.push(Diagnostic::error(Code::InputToInput, message, wires));
                    continue;
                }
                (_, []) => {
                    let count = match group.outputs.len() {
                        2 => "two".to_string(),
                        n => n.to_string(),
                    };
                    let message = format!("{} {count} outputs", wires_verb(&wires, "connect"));
                    errors.push(Diagnostic::error(Code::OutputToOutput, message, wires));
                    continue;
                }
                (_, [(reader, slot), ..]) => {
                    let message = format!(
                        "input {}.{} has more than one driver",
                        ids[*reader],
                        kinds[*reader].inputs()[*slot]
                    );
                    let mut culprits: Vec<String> =
                        group.inputs.iter().map(|(c, _)| ids[*c].clone()).collect();
                    culprits.dedup();
                    culprits.extend(wires);
                    errors.push(Diagnostic::error(Code::MultipleDrivers, message, culprits));
                    continue;
                }
            };
            for (reader, slot) in &group.inputs {
                drivers[*reader][*slot] = Some(net);
            }
            wire_nets.extend(wires.into_iter().map(|w| (w, net)));
        }
        if !errors.is_empty() {
            return Err(errors);
        }

        let mut warnings = Vec::new();
        let mut inputs = Vec::new();
        let mut port_nets = PortNets::new();
        let mut fanout = vec![Vec::new(); net_count as usize];
        for (c, slots) in drivers.iter().enumerate() {
            let kind = kinds[c];
            let mut ports = BTreeMap::new();
            let mut nets = Vec::new();
            for (slot, driver) in slots.iter().enumerate() {
                let name = kind.inputs()[slot];
                let net = driver.unwrap_or(GROUND);
                if net == GROUND {
                    let message = format!("input {}.{name} is unconnected and reads 0", ids[c]);
                    warnings.push(Diagnostic::warning(
                        Code::UnconnectedInput,
                        message,
                        vec![ids[c].clone()],
                    ));
                } else if fanout[net as usize].last() != Some(&(c as u32)) {
                    fanout[net as usize].push(c as u32);
                }
                ports.insert(name.to_string(), net);
                nets.push(net);
            }
            if let Some(net) = outputs[c] {
                ports.insert(kind.outputs()[0].to_string(), net);
            }
            port_nets.insert(ids[c].clone(), ports);
            inputs.push(nets);
        }

        let count = ids.len();
        let mut sim = Simulator {
            ids,
            kinds,
            inputs,
            outputs,
            state: vec![0; count],
            fanout,
            nets: vec![0; net_count as usize],
            wire_nets,
            port_nets,
            unsettled: Vec::new(),
        };
        warnings.extend(sim.settle((0..count as u32).collect()));
        Ok((sim, warnings))
    }

    /// Sets a switch and settles. Returns an `Unstable` diagnostic if the
    /// circuit did not settle.
    pub fn set_input(
        &mut self,
        component: &str,
        value: bool,
    ) -> Result<Option<Diagnostic>, String> {
        let c = self
            .ids
            .binary_search_by(|id| id.as_str().cmp(component))
            .map_err(|_| format!("unknown component {component}"))?;
        if self.kinds[c] != Kind::Switch {
            return Err(format!(
                "{component} is a {}, not a switch",
                self.kinds[c].name()
            ));
        }
        self.state[c] = value.into();
        Ok(self.settle(vec![c as u32]).map(|d| lift(vec![d]).remove(0)))
    }

    /// Current value of every net, 0 or 1. Net 0 is ground.
    pub fn nets(&self) -> &[u8] {
        &self.nets
    }

    /// Wire ID → net index, for coloring wires.
    pub fn wire_nets(&self) -> &BTreeMap<String, u32> {
        &self.wire_nets
    }

    pub fn port_nets(&self) -> &PortNets {
        &self.port_nets
    }

    fn eval(&self, c: usize) -> u8 {
        let input = |slot: usize| {
            self.inputs[c]
                .get(slot)
                .map_or(0, |&net| self.nets[net as usize])
        };
        self.kinds[c].eval(input(0), input(1), self.state[c])
    }

    /// Runs deltas until no net changes, bounded so oscillation cannot hang.
    fn settle(&mut self, mut dirty: Vec<u32>) -> Option<Diagnostic> {
        // Acyclic circuits settle in at most depth + 1 <= components + 1 deltas.
        let limit = self.kinds.len() + 64;
        dirty.append(&mut self.unsettled);
        let mut changed = Vec::new();
        for _ in 0..limit {
            dirty.sort_unstable();
            dirty.dedup();
            if dirty.is_empty() {
                return None;
            }
            // Every dirty component reads the same snapshot; writes apply after.
            let writes: Vec<(u32, u8)> = dirty
                .iter()
                .filter_map(|&c| Some((self.outputs[c as usize]?, self.eval(c as usize))))
                .collect();
            dirty.clear();
            changed.clear();
            for (net, value) in writes {
                if self.nets[net as usize] != value {
                    self.nets[net as usize] = value;
                    changed.push(net);
                    dirty.extend_from_slice(&self.fanout[net as usize]);
                }
            }
        }
        if dirty.is_empty() {
            return None;
        }
        let culprits = changed
            .iter()
            .filter_map(|&net| self.outputs.iter().position(|&out| out == Some(net)))
            .map(|c| self.ids[c].clone())
            .collect();
        self.unsettled = dirty;
        let message = format!("circuit did not settle within {limit} deltas: oscillating loop");
        Some(Diagnostic::error(Code::Unstable, message, culprits))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::description::{ComponentDesc, Connection, JunctionDesc, PortRef, Severity};

    /// "component.port", or a bare junction ID.
    fn end(spec: &str) -> Endpoint {
        match spec.split_once('.') {
            Some((component, port)) => Endpoint::Port(PortRef {
                component: component.into(),
                port: port.into(),
            }),
            None => Endpoint::Junction {
                junction: spec.into(),
            },
        }
    }

    /// Components as (id, kind); wires as ("from.port", "to.port") or junction IDs,
    /// with IDs w0, w1, …. Junctions are declared with `with_junctions`.
    fn circuit(components: &[(&str, &str)], wires: &[(&str, &str)]) -> CircuitDescription {
        CircuitDescription {
            junctions: Vec::new(),
            definitions: Vec::new(),
            components: components
                .iter()
                .map(|(id, kind)| ComponentDesc {
                    id: (*id).into(),
                    kind: (*kind).into(),
                    definition: None,
                })
                .collect(),
            connections: wires
                .iter()
                .enumerate()
                .map(|(i, (from, to))| Connection {
                    id: format!("w{i}"),
                    from: end(from),
                    to: end(to),
                })
                .collect(),
        }
    }

    fn load(description: &CircuitDescription) -> Simulator {
        let (sim, warnings) = Simulator::load(description).expect("valid circuit");
        assert_eq!(warnings, vec![]);
        sim
    }

    fn value(sim: &Simulator, component: &str, port: &str) -> u8 {
        sim.nets()[sim.port_nets()[component][port] as usize]
    }

    fn codes(result: Result<(Simulator, Vec<Diagnostic>), Vec<Diagnostic>>) -> Vec<Code> {
        result
            .expect_err("invalid circuit")
            .iter()
            .map(|d| d.code)
            .collect()
    }

    fn and_demo() -> CircuitDescription {
        circuit(
            &[("a", "switch"), ("b", "switch"), ("g", "and"), ("l", "led")],
            &[("a.out", "g.a"), ("b.out", "g.b"), ("g.out", "l.in")],
        )
    }

    #[test]
    fn switches_and_led_follow_all_four_combinations() {
        let mut sim = load(&and_demo());
        for (a, b, led) in [(0, 0, 0), (0, 1, 0), (1, 0, 0), (1, 1, 1), (0, 1, 0)] {
            assert_eq!(sim.set_input("a", a == 1), Ok(None));
            assert_eq!(sim.set_input("b", b == 1), Ok(None));
            assert_eq!(value(&sim, "l", "in"), led, "a={a} b={b}");
            // Every wire carries its driver's value.
            assert_eq!(sim.nets()[sim.wire_nets()["w2"] as usize], led);
        }
    }

    #[test]
    fn cascade_with_fan_out() {
        // y = (a XOR b) AND a = a AND NOT b; `a` fans out to the XOR, the AND and an LED.
        let mut sim = load(&circuit(
            &[
                ("a", "switch"),
                ("b", "switch"),
                ("x", "xor"),
                ("y", "and"),
                ("la", "led"),
                ("ly", "led"),
            ],
            &[
                ("a.out", "x.a"),
                ("b.out", "x.b"),
                ("x.out", "y.a"),
                ("a.out", "y.b"),
                ("a.out", "la.in"),
                ("y.out", "ly.in"),
            ],
        ));
        for (a, b) in [(0, 0), (1, 0), (1, 1), (0, 1), (1, 0)] {
            sim.set_input("a", a == 1).unwrap();
            sim.set_input("b", b == 1).unwrap();
            assert_eq!(value(&sim, "la", "in"), a);
            assert_eq!(value(&sim, "ly", "in"), a & (b ^ 1), "a={a} b={b}");
        }
    }

    #[test]
    fn identities_hold() {
        let mut sim = load(&circuit(
            &[
                ("x", "switch"),
                ("one", "switch"),
                ("n1", "not"),
                ("n2", "not"),
                ("xx", "xor"),
                ("x1", "and"),
            ],
            &[
                ("x.out", "n1.in"),
                ("n1.out", "n2.in"),
                ("x.out", "xx.a"),
                ("x.out", "xx.b"),
                ("x.out", "x1.a"),
                ("one.out", "x1.b"),
            ],
        ));
        sim.set_input("one", true).unwrap();
        for x in [0, 1, 0] {
            sim.set_input("x", x == 1).unwrap();
            assert_eq!(value(&sim, "n2", "out"), x, "NOT(NOT x) = x");
            assert_eq!(value(&sim, "xx", "out"), 0, "x XOR x = 0");
            assert_eq!(value(&sim, "x1", "out"), x, "x AND 1 = x");
        }
    }

    #[test]
    fn compiled_result_ignores_listing_order_and_wire_direction() {
        let forward = and_demo();
        let mut reversed = and_demo();
        reversed.components.reverse();
        for wire in &mut reversed.connections {
            std::mem::swap(&mut wire.from, &mut wire.to);
        }
        let (mut a, mut b) = (load(&forward), load(&reversed));
        for sim in [&mut a, &mut b] {
            sim.set_input("a", true).unwrap();
            sim.set_input("b", true).unwrap();
        }
        assert_eq!(a.nets(), b.nets());
        assert_eq!(a.port_nets(), b.port_nets());
        assert_eq!(a.wire_nets(), b.wire_nets());
    }

    #[test]
    fn lone_not_settles_high_and_warns_about_its_input() {
        let (sim, warnings) = Simulator::load(&circuit(&[("n", "not")], &[])).unwrap();
        assert_eq!(value(&sim, "n", "out"), 1);
        assert_eq!(value(&sim, "n", "in"), 0);
        assert_eq!(warnings.len(), 1);
        assert_eq!(
            (warnings[0].severity, warnings[0].code),
            (Severity::Warning, Code::UnconnectedInput)
        );
    }

    #[test]
    fn oscillator_is_reported_not_hung() {
        let (mut sim, warnings) = Simulator::load(&circuit(
            &[("n", "not"), ("s", "switch")],
            &[("n.out", "n.in")],
        ))
        .unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, Code::Unstable);
        assert_eq!(warnings[0].ids, vec!["n".to_string()]);
        // The engine keeps working, and the loop, still live, is reported again.
        let again = sim.set_input("s", true).unwrap().expect("still unstable");
        assert_eq!(
            (again.code, again.ids),
            (Code::Unstable, vec!["n".to_string()])
        );
    }

    #[test]
    fn an_unrelated_input_does_not_hide_a_live_loop() {
        // o = NAND(en, o) oscillates while en = 1; t is unrelated.
        let mut sim = load(&circuit(
            &[("en", "switch"), ("o", "nand"), ("t", "switch")],
            &[("en.out", "o.a"), ("o.out", "o.b")],
        ));
        let unstable = |r: Result<Option<Diagnostic>, String>| r.unwrap().map(|d| d.code);
        assert_eq!(unstable(sim.set_input("en", true)), Some(Code::Unstable));
        assert_eq!(unstable(sim.set_input("t", true)), Some(Code::Unstable));
        // Disabling the loop settles it consistently: NAND(0, x) = 1.
        assert_eq!(unstable(sim.set_input("en", false)), None);
        assert_eq!(value(&sim, "o", "out"), 1);
        assert_eq!(value(&sim, "o", "b"), 1);
    }

    #[test]
    fn an_input_can_settle_a_loop_left_unstable_by_load() {
        // o = NOR(s, o) oscillates from the all-zero start; s = 1 makes it stable.
        let (mut sim, warnings) = Simulator::load(&circuit(
            &[("s", "switch"), ("o", "nor")],
            &[("s.out", "o.a"), ("o.out", "o.b")],
        ))
        .unwrap();
        assert_eq!(warnings[0].code, Code::Unstable);
        assert_eq!(sim.set_input("s", true), Ok(None));
        assert_eq!(value(&sim, "o", "out"), 0);
    }

    #[test]
    fn stable_feedback_holds_its_value() {
        // OR with its output fed back: once set, stays set.
        let mut sim = load(&circuit(
            &[("s", "switch"), ("o", "or")],
            &[("s.out", "o.a"), ("o.out", "o.b")],
        ));
        assert_eq!(value(&sim, "o", "out"), 0);
        assert_eq!(sim.set_input("s", true), Ok(None));
        assert_eq!(value(&sim, "o", "out"), 1);
        assert_eq!(sim.set_input("s", false), Ok(None));
        assert_eq!(value(&sim, "o", "out"), 1);
    }

    #[test]
    fn duplicate_wire_ids_are_rejected() {
        let mut description = circuit(
            &[("a", "switch"), ("b", "switch"), ("g", "and")],
            &[("a.out", "g.a"), ("b.out", "g.b")],
        );
        description.connections[1].id = "w0".into();
        assert_eq!(
            codes(Simulator::load(&description)),
            vec![Code::DuplicateId]
        );
    }

    #[test]
    fn invalid_components_are_rejected() {
        let result = Simulator::load(&circuit(
            &[("a", "switch"), ("a", "led"), ("z", "flux")],
            &[],
        ));
        assert_eq!(codes(result), vec![Code::DuplicateId, Code::UnknownKind]);
    }

    #[test]
    fn invalid_wires_are_rejected() {
        let parts = [("a", "switch"), ("b", "switch"), ("g", "and"), ("l", "led")];
        let cases = [
            (("a.out", "nope.in"), Code::UnknownComponent),
            (("a.out", "g.c"), Code::UnknownPort),
            (("a.out", "b.out"), Code::OutputToOutput),
            (("g.a", "l.in"), Code::InputToInput),
        ];
        for (wire, code) in cases {
            assert_eq!(
                codes(Simulator::load(&circuit(&parts, &[wire]))),
                vec![code],
                "{wire:?}"
            );
        }
        let two_drivers = circuit(&parts, &[("a.out", "g.a"), ("b.out", "g.a")]);
        let errors = Simulator::load(&two_drivers).unwrap_err();
        assert_eq!(errors[0].code, Code::MultipleDrivers);
        assert_eq!(errors[0].ids, vec!["g", "w0", "w1"]);
    }

    #[test]
    fn duplicate_wire_from_same_output_is_allowed() {
        let (sim, _) = Simulator::load(&circuit(
            &[("a", "switch"), ("l", "led")],
            &[("a.out", "l.in"), ("a.out", "l.in")],
        ))
        .expect("redundant wire is valid");
        assert_eq!(sim.wire_nets()["w0"], sim.wire_nets()["w1"]);
    }

    #[test]
    fn set_input_rejects_non_switches() {
        let mut sim = load(&and_demo());
        assert!(sim.set_input("g", true).is_err());
        assert!(sim.set_input("missing", true).is_err());
    }

    fn with_junctions(mut description: CircuitDescription, ids: &[&str]) -> CircuitDescription {
        description.junctions = ids
            .iter()
            .map(|id| JunctionDesc {
                id: (*id).into(),
                pin: None,
            })
            .collect();
        description
    }

    #[test]
    fn a_junction_fans_one_output_out_and_every_wire_reports_its_net() {
        // a ─ j ─┬─ g.a
        //        └─ g.b   (and the LED reads g)
        let description = with_junctions(
            circuit(
                &[("a", "switch"), ("g", "and"), ("l", "led")],
                &[
                    ("a.out", "j"),
                    ("j", "g.a"),
                    ("g.b", "j"),
                    ("g.out", "l.in"),
                ],
            ),
            &["j"],
        );
        let mut sim = load(&description);
        for a in [0, 1] {
            sim.set_input("a", a == 1).unwrap();
            assert_eq!(value(&sim, "l", "in"), a, "a AND a = a");
            for wire in ["w0", "w1", "w2"] {
                assert_eq!(sim.nets()[sim.wire_nets()[wire] as usize], a, "{wire}");
            }
        }
    }

    #[test]
    fn junctions_chain_and_a_dangling_branch_reads_zero() {
        // a ─ j1 ─ j2 ─ l, plus a stub j2 ─ j3 and an input n.in on its own branch j4.
        let description = with_junctions(
            circuit(
                &[("a", "switch"), ("l", "led"), ("n", "not"), ("m", "led")],
                &[
                    ("a.out", "j1"),
                    ("j1", "j2"),
                    ("j2", "l.in"),
                    ("j2", "j3"),
                    ("n.in", "j4"),
                    ("n.out", "m.in"),
                ],
            ),
            &["j1", "j2", "j3", "j4"],
        );
        let (mut sim, warnings) = Simulator::load(&description).expect("valid circuit");
        assert_eq!(
            warnings
                .iter()
                .map(|d| (d.code, d.ids.clone()))
                .collect::<Vec<_>>(),
            vec![(Code::UnconnectedInput, vec!["n".to_string()])]
        );
        assert_eq!(sim.wire_nets()["w4"], GROUND);
        sim.set_input("a", true).unwrap();
        assert_eq!(value(&sim, "l", "in"), 1);
        assert_eq!(
            sim.nets()[sim.wire_nets()["w3"] as usize],
            1,
            "the stub is on a's net"
        );
        assert_eq!(value(&sim, "m", "in"), 1, "NOT of an unconnected input");
    }

    #[test]
    fn nets_joined_through_junctions_are_checked_as_a_whole() {
        let parts = [("a", "switch"), ("b", "switch"), ("g", "and"), ("l", "led")];
        let cases = [
            (
                vec![("a.out", "j"), ("j", "b.out")],
                Code::OutputToOutput,
                vec!["w0", "w1"],
            ),
            (
                vec![("g.a", "j"), ("j", "l.in")],
                Code::InputToInput,
                vec!["w0", "w1"],
            ),
            (
                vec![("a.out", "j"), ("b.out", "k"), ("j", "g.a"), ("k", "g.a")],
                Code::MultipleDrivers,
                vec!["g", "w0", "w1", "w2", "w3"],
            ),
            (vec![("a.out", "gone")], Code::UnknownJunction, vec!["w0"]),
        ];
        for (wires, code, ids) in cases {
            let description = with_junctions(circuit(&parts, &wires), &["j", "k"]);
            let errors = Simulator::load(&description).unwrap_err();
            assert_eq!(
                errors
                    .iter()
                    .map(|d| (d.code, d.ids.clone()))
                    .collect::<Vec<_>>(),
                vec![(code, ids.iter().map(|id| id.to_string()).collect())],
                "{wires:?}"
            );
        }
        // Errors come out in the same order whichever way each wire was drawn.
        let forward = circuit(&parts, &[("b.out", "g.out"), ("g.a", "l.in")]);
        let backward = circuit(&parts, &[("g.out", "b.out"), ("l.in", "g.a")]);
        assert_eq!(
            codes(Simulator::load(&forward)),
            codes(Simulator::load(&backward))
        );
        assert_eq!(
            codes(Simulator::load(&forward)),
            vec![Code::OutputToOutput, Code::InputToInput] // b.out is an earlier port than g.a
        );

        let clash = with_junctions(circuit(&parts, &[]), &["j", "j", "g"]);
        assert_eq!(
            codes(Simulator::load(&clash)),
            vec![Code::DuplicateId, Code::DuplicateId]
        );
    }
}
