//! Compile a circuit description into a netlist and settle it with
//! synchronous deltas (`docs/simulation-model.md`, ADR 0006).

use std::collections::BTreeMap;

use crate::catalog::Kind;
use crate::description::{CircuitDescription, Code, Diagnostic, PortRef};

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
}

enum End {
    Out(usize),
    In(usize, usize),
}

impl Simulator {
    /// Validates and compiles `description`, then settles it from all-zero
    /// nets. Returns the simulator with warnings (unconnected inputs, an
    /// unstable initial settle), or the validation errors.
    pub fn load(
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
        // Wire errors against unknown components would only repeat these.
        if !errors.is_empty() {
            return Err(errors);
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

        let resolve = |wire: &str, port: &PortRef| -> Result<End, Diagnostic> {
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
                Ok(End::Out(c))
            } else if let Some(slot) = kind.inputs().iter().position(|name| *name == port.port) {
                Ok(End::In(c, slot))
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

        // Per component, per input slot: (driving net, wire ID).
        let mut drivers: Vec<Vec<Option<(u32, &str)>>> =
            kinds.iter().map(|k| vec![None; k.inputs().len()]).collect();
        let mut wire_nets = BTreeMap::new();
        for wire in &description.connections {
            let (driver, reader, slot) =
                match (resolve(&wire.id, &wire.from), resolve(&wire.id, &wire.to)) {
                    (Ok(End::Out(d)), Ok(End::In(r, s))) | (Ok(End::In(r, s)), Ok(End::Out(d))) => {
                        (d, r, s)
                    }
                    (Ok(End::Out(_)), Ok(End::Out(_))) => {
                        let message = format!("wire {} connects two outputs", wire.id);
                        errors.push(Diagnostic::error(
                            Code::OutputToOutput,
                            message,
                            vec![wire.id.clone()],
                        ));
                        continue;
                    }
                    (Ok(End::In(..)), Ok(End::In(..))) => {
                        let message =
                            format!("wire {} connects two inputs and has no driver", wire.id);
                        errors.push(Diagnostic::error(
                            Code::InputToInput,
                            message,
                            vec![wire.id.clone()],
                        ));
                        continue;
                    }
                    (from, to) => {
                        errors.extend([from.err(), to.err()].into_iter().flatten());
                        continue;
                    }
                };
            let net = outputs[driver].expect("an output port has a net");
            match drivers[reader][slot] {
                // A duplicate wire from the same output is redundant, not a conflict.
                Some((existing, _)) if existing == net => {}
                Some((_, other)) => {
                    let message = format!(
                        "input {}.{} has more than one driver",
                        ids[reader],
                        kinds[reader].inputs()[slot]
                    );
                    let culprits = vec![ids[reader].clone(), other.into(), wire.id.clone()];
                    errors.push(Diagnostic::error(Code::MultipleDrivers, message, culprits));
                    continue;
                }
                None => drivers[reader][slot] = Some((net, &wire.id)),
            }
            wire_nets.insert(wire.id.clone(), net);
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
                let net = driver.map_or(GROUND, |(net, _)| net);
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
        Ok(self.settle(vec![c as u32]))
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
        let message = format!("circuit did not settle within {limit} deltas: oscillating loop");
        Some(Diagnostic::error(Code::Unstable, message, culprits))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::description::{ComponentDesc, Connection, Severity};

    fn port(spec: &str) -> PortRef {
        let (component, port) = spec.split_once('.').expect("component.port");
        PortRef {
            component: component.into(),
            port: port.into(),
        }
    }

    /// Components as (id, kind); wires as ("from.port", "to.port"), IDs w0, w1, ….
    fn circuit(components: &[(&str, &str)], wires: &[(&str, &str)]) -> CircuitDescription {
        CircuitDescription {
            components: components
                .iter()
                .map(|(id, kind)| ComponentDesc {
                    id: (*id).into(),
                    kind: (*kind).into(),
                })
                .collect(),
            connections: wires
                .iter()
                .enumerate()
                .map(|(i, (from, to))| Connection {
                    id: format!("w{i}"),
                    from: port(from),
                    to: port(to),
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
        // The engine keeps working afterwards.
        assert_eq!(sim.set_input("s", true), Ok(None));
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
}
