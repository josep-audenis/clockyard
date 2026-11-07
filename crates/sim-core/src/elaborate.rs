//! Flattening custom components into one circuit before compiling (ADR 0012).
//!
//! Each instance is replaced, depth first, by a copy of its definition with IDs
//! prefixed `instance/`. A definition's pin switches and LEDs become junctions,
//! and wires to the instance's ports are joined to them, so net resolution
//! (ADR 0010) sees one flat circuit and every instance has its own state.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use crate::catalog::Kind;
use crate::description::{
    CircuitDescription, Code, ComponentDesc, Connection, DefinitionDesc, Diagnostic, Endpoint,
    JunctionDesc, PortRef,
};
use crate::sim::{find, width_mismatch, wires_verb};

/// Kind of a part that is an instance of a definition.
pub const CUSTOM: &str = "custom";

/// Most items a flattened circuit may hold ("excessive complexity"): parts, junctions,
/// wires and instance expansions all count, so no small file can expand into a huge one.
pub const MAX_PARTS: usize = 200_000;

/// The top-level ID an elaborated ID belongs to: an ID inside an instance is reported as that instance.
pub fn top(id: &str) -> &str {
    id.split('/').next().unwrap_or(id)
}

/// Rewrites diagnostic IDs to top-level IDs, without repeats.
pub fn lift(diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics
        .into_iter()
        .map(|mut d| {
            let mut seen = BTreeSet::new();
            d.ids = d
                .ids
                .iter()
                .map(|id| top(id).to_string())
                .filter(|id| seen.insert(id.clone()))
                .collect();
            d
        })
        .collect()
}

/// The circuit with every instance replaced by its definition's contents.
/// Borrowed unchanged when there is nothing to flatten.
pub fn elaborate(
    description: &CircuitDescription,
) -> Result<Cow<'_, CircuitDescription>, Vec<Diagnostic>> {
    let mut errors = Vec::new();
    let top_level = (
        &description.components[..],
        &description.junctions[..],
        &description.connections[..],
    );
    check_ids(top_level, None, &mut errors);
    check_widths(&description.components, None, &mut errors);
    for d in &description.definitions {
        check_ids(
            (&d.components, &d.junctions, &d.connections),
            Some(&d.id),
            &mut errors,
        );
        check_widths(&d.components, Some(&d.id), &mut errors);
    }
    let has_instances = description.components.iter().any(|c| c.kind == CUSTOM);
    if errors.is_empty() && description.definitions.is_empty() && !has_instances {
        return Ok(Cow::Borrowed(description));
    }
    let mut definitions = BTreeMap::new();
    for definition in &description.definitions {
        if definitions
            .insert(definition.id.as_str(), definition)
            .is_some()
        {
            let message = format!("definition ID {} is used more than once", definition.id);
            errors.push(Diagnostic::error(
                Code::DuplicateId,
                message,
                vec![definition.id.clone()],
            ));
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    let mut flat = Flat {
        definitions,
        out: CircuitDescription::default(),
        errors: Vec::new(),
        stack: Vec::new(),
        pins_ok: BTreeMap::new(),
        wired: BTreeSet::new(),
        size: 0,
    };
    flat.level(
        &description.components,
        &description.junctions,
        &description.connections,
        "",
        None,
    );
    if flat.errors.is_empty() {
        Ok(Cow::Owned(flat.out))
    } else {
        Err(flat.errors)
    }
}

/// IDs never contain `/`, which separates instance paths, and no other component on a level shares
/// an instance's ID (expanded, the two could not be told apart). Problems inside a definition name it.
/// Unlike pins, this checks every definition, used or not.
fn check_ids(
    (components, junctions, connections): (&[ComponentDesc], &[JunctionDesc], &[Connection]),
    definition: Option<&str>,
    errors: &mut Vec<Diagnostic>,
) {
    let at = |id: &str| vec![definition.unwrap_or(id).to_string()];
    let ids = components
        .iter()
        .map(|c| &c.id)
        .chain(junctions.iter().map(|j| &j.id))
        .chain(connections.iter().map(|w| &w.id));
    for id in ids.filter(|id| id.contains('/')) {
        let message = format!("ID {id} contains '/', which separates the parts inside components");
        errors.push(Diagnostic::error(Code::InvalidId, message, at(id)));
    }
    let mut count = BTreeMap::new();
    for c in components {
        *count.entry(c.id.as_str()).or_insert(0) += 1;
    }
    let mut reported = BTreeSet::new();
    for c in components {
        if c.kind == CUSTOM && count[c.id.as_str()] > 1 && reported.insert(c.id.as_str()) {
            let message = format!("component ID {} is used more than once", c.id);
            errors.push(Diagnostic::error(Code::DuplicateId, message, at(&c.id)));
        }
    }
}

/// Widths and fields must be whole numbers in range, on the kinds that take them (ADR 0014). Like
/// `check_ids` this checks every definition, used or not, because pin widths type instance ports.
fn check_widths(
    components: &[ComponentDesc],
    definition: Option<&str>,
    errors: &mut Vec<Diagnostic>,
) {
    for c in components {
        if let Err(problem) = c.widths() {
            let at = definition.map_or_else(String::new, |d| format!("definition {d}: "));
            let message = format!("{at}{}: {problem}", c.id);
            let id = definition.unwrap_or(&c.id).to_string();
            errors.push(Diagnostic::error(Code::InvalidWidth, message, vec![id]));
        }
    }
}

/// Pin names must be present and unique, and name a switch (input) or LED (output) of the definition.
/// Problems are reported against `instance`, the part the user can see.
fn check_pins(definition: &DefinitionDesc, instance: &str, errors: &mut Vec<Diagnostic>) {
    let kinds: BTreeMap<&str, &str> = definition
        .components
        .iter()
        .map(|c| (c.id.as_str(), c.kind.as_str()))
        .collect();
    let mut names = BTreeSet::new();
    let mut parts = BTreeSet::new();
    let pins = definition
        .inputs
        .iter()
        .map(|p| (p, "switch"))
        .chain(definition.outputs.iter().map(|p| (p, "led")));
    for (pin, kind) in pins {
        let problem = if pin.name.is_empty() {
            Some("has a pin without a name".to_string())
        } else if !names.insert(pin.name.as_str()) {
            Some(format!("has more than one pin named '{}'", pin.name))
        } else if !parts.insert(pin.component.as_str()) {
            Some(format!("has more than one pin on part {}", pin.component))
        } else if kinds.get(pin.component.as_str()) != Some(&kind) {
            Some(format!("pin '{}' is not a {kind} of it", pin.name))
        } else {
            None
        };
        if let Some(problem) = problem {
            let message = format!("{instance}: definition {} {problem}", definition.id);
            errors.push(Diagnostic::error(
                Code::InvalidPin,
                message,
                vec![top(instance).to_string()],
            ));
        }
    }
}

/// What a wire end does on its own level: drives the wires there, or reads them.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Drives,
    Reads,
}

/// Checks one level's own wiring as the user drew it. Flattening joins levels through pins, so
/// only here can two pins driving one wire, or inputs joined with nothing driving them, be told
/// from a pin passing a signal through; and pins become junctions, which have no width. An
/// instance's input port reads and its output port drives; inside a definition, its pin switches
/// drive and its pin LEDs read. Every net's widths are checked (ADR 0014); its drivers and readers
/// only where it touches a pin, the rest being left to net resolution, which sees nets whole.
fn check_wiring<'a>(
    components: &[ComponentDesc],
    connections: &'a [Connection],
    prefix: &str,
    pins: &BTreeMap<&str, &str>,
    instances: &BTreeMap<&str, &DefinitionDesc>,
) -> Vec<Diagnostic> {
    let parts: BTreeMap<&str, &ComponentDesc> =
        components.iter().map(|c| (c.id.as_str(), c)).collect();
    // A switch's or LED's width; widths were checked before any wiring.
    let width = |c: &ComponentDesc| c.widths().map_or(1, |(width, _)| width);
    // Role of a port end, whether it is a pin (an instance's port or a pin part), and its width.
    let role = |port: &PortRef| -> Option<(Role, bool, u32)> {
        let name = port.port.as_str();
        if let Some(definition) = instances.get(port.component.as_str()) {
            let inputs = definition.inputs.iter().map(|p| (p, Role::Reads));
            let outputs = definition.outputs.iter().map(|p| (p, Role::Drives));
            let (pin, role) = inputs.chain(outputs).find(|(p, _)| p.name == name)?;
            // Pins were checked to name a part of the definition before it was expanded.
            let part = definition
                .components
                .iter()
                .find(|c| c.id == pin.component)?;
            return Some((role, true, width(part)));
        }
        let part = *parts.get(port.component.as_str())?;
        if let Some(&own) = pins.get(port.component.as_str()) {
            let role = if own == "out" {
                Role::Drives
            } else {
                Role::Reads
            };
            return (name == own).then_some((role, true, width(part)));
        }
        let kind = Kind::from_name(&part.kind)?;
        let (part_width, fields) = part.widths().ok()?;
        let port = kind
            .ports(part_width, &fields)
            .into_iter()
            .find(|p| p.name == name)?;
        let role = if port.output {
            Role::Drives
        } else {
            Role::Reads
        };
        Some((role, false, port.width))
    };
    // Union-find over this level's ends: ports by (component, port), junctions by ID.
    let mut nodes: BTreeMap<(bool, &'a str, &'a str), usize> = BTreeMap::new();
    let mut ends = Vec::new();
    let mut keys = Vec::new();
    let mut node = |end: &'a Endpoint| -> usize {
        let key = match end {
            Endpoint::Port(p) => (false, p.component.as_str(), p.port.as_str()),
            Endpoint::Junction { junction } => (true, junction.as_str(), ""),
        };
        *nodes.entry(key).or_insert_with(|| {
            ends.push(match end {
                Endpoint::Port(p) => role(p),
                Endpoint::Junction { .. } => None,
            });
            keys.push((key.1, key.2));
            ends.len() - 1
        })
    };
    let joined: Vec<(&str, usize, usize)> = connections
        .iter()
        .map(|w| (w.id.as_str(), node(&w.from), node(&w.to)))
        .collect();
    let mut parent: Vec<usize> = (0..ends.len()).collect();
    for &(_, a, b) in &joined {
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        parent[ra] = rb;
    }
    // Per net (by root): drivers, readers, whether it touches a pin, and its first port of each width.
    #[derive(Clone, Default)]
    struct Tally {
        drives: usize,
        reads: usize,
        pin: bool,
        widths: Vec<(u32, usize)>,
    }
    let mut tally = vec![Tally::default(); ends.len()];
    for (node, end) in ends.iter().enumerate() {
        if let Some((role, pin, width)) = *end {
            let net = &mut tally[find(&mut parent, node)];
            match role {
                Role::Drives => net.drives += 1,
                Role::Reads => net.reads += 1,
            }
            net.pin |= pin;
            // Name each width by its first port in (component, port) order, never by wire direction.
            match net.widths.iter_mut().find(|w| w.0 == width) {
                Some(w) if keys[node] < keys[w.1] => w.1 = node,
                Some(_) => {}
                None => net.widths.push((width, node)),
            }
        }
    }
    for net in &mut tally {
        net.widths.sort_by_key(|&(_, node)| keys[node]);
    }
    // The wires of each net that breaks a rule, nets in order of their first wire.
    let mut broken: BTreeMap<usize, usize> = BTreeMap::new();
    let mut found: Vec<(Code, usize, Vec<String>)> = Vec::new();
    for &(wire, a, _) in &joined {
        let root = find(&mut parent, a);
        let net = &tally[root];
        let code = match (net.widths.len(), net.drives, net.reads, net.pin) {
            (2.., ..) => Code::WidthMismatch,
            (_, _, _, false) => continue,
            (_, 2.., 0, _) => Code::OutputToOutput,
            (_, 2.., _, _) => Code::MultipleDrivers,
            (_, 0, 2.., _) => Code::InputToInput,
            _ => continue,
        };
        let at = *broken.entry(root).or_insert_with(|| {
            found.push((code, root, Vec::new()));
            found.len() - 1
        });
        found[at].2.push(format!("{prefix}{wire}"));
    }
    found
        .into_iter()
        .map(|(code, root, mut wires)| {
            wires.sort();
            if code == Code::WidthMismatch {
                // One port per width, then the IDs: the net's wires and those ports' parts.
                let ports: Vec<(String, u32)> = tally[root]
                    .widths
                    .iter()
                    .map(|&(width, node)| {
                        (format!("{prefix}{}.{}", keys[node].0, keys[node].1), width)
                    })
                    .collect();
                let message = width_mismatch(&wires, &ports);
                let parts = tally[root]
                    .widths
                    .iter()
                    .map(|&(_, node)| format!("{prefix}{}", keys[node].0));
                let mut seen = BTreeSet::new();
                let ids = wires
                    .iter()
                    .cloned()
                    .chain(parts)
                    .map(|id| top(&id).to_string())
                    .filter(|id| seen.insert(id.clone()))
                    .collect();
                return Diagnostic::error(code, message, ids);
            }
            let what = match code {
                Code::OutputToOutput => "outputs",
                Code::MultipleDrivers => "an input to more than one driver",
                _ => "inputs and nothing drives them",
            };
            let message = format!("{} {what}", wires_verb(&wires, "connect"));
            let mut ids: Vec<String> = wires.iter().map(|w| top(w).to_string()).collect();
            ids.sort();
            ids.dedup();
            Diagnostic::error(code, message, ids)
        })
        .collect()
}

struct Flat<'a> {
    definitions: BTreeMap<&'a str, &'a DefinitionDesc>,
    out: CircuitDescription,
    errors: Vec<Diagnostic>,
    /// Definitions being expanded, outermost first: one appearing again is recursion.
    stack: Vec<&'a str>,
    /// Whether each definition expanded so far has valid pins. Unused definitions are not checked,
    /// so an unlabelled switch in one does not break circuits that do not use it.
    pins_ok: BTreeMap<&'a str, bool>,
    /// Definitions whose own wiring has been checked (once, at their first instance).
    wired: BTreeSet<&'a str>,
    /// Items emitted or expanded so far, against `MAX_PARTS`.
    size: usize,
}

impl<'a> Flat<'a> {
    /// Copies one level (the main circuit, or a definition inside an instance at `prefix`).
    fn level(
        &mut self,
        components: &'a [ComponentDesc],
        junctions: &'a [JunctionDesc],
        connections: &'a [Connection],
        prefix: &str,
        definition: Option<&'a DefinitionDesc>,
    ) {
        // Inside a definition its pin parts become junctions joined to the instance's ports.
        // Each pin part's own port: a switch's `out`, an LED's `in`.
        let pins: BTreeMap<&str, &str> = definition
            .map(|d| {
                let ins = d.inputs.iter().map(|p| (p.component.as_str(), "out"));
                ins.chain(d.outputs.iter().map(|p| (p.component.as_str(), "in")))
                    .collect()
            })
            .unwrap_or_default();
        let mut instances = BTreeMap::new();
        for c in components {
            let id = format!("{prefix}{}", c.id);
            if !self.grow(&id) {
                return;
            }
            if c.kind == CUSTOM {
                let name = c.definition.as_deref().unwrap_or("");
                match self.definitions.get(name).copied() {
                    None => {
                        let message = format!("{id} refers to unknown definition '{name}'");
                        self.error(Code::UnknownDefinition, message, &id);
                    }
                    Some(_) if self.stack.contains(&name) => {
                        let message = format!(
                            "{id}: definition '{name}' contains itself, so it cannot be built"
                        );
                        self.error(Code::RecursiveDefinition, message, &id);
                    }
                    Some(inner) if !self.pins_valid(inner, &id) => {}
                    Some(inner) => {
                        instances.insert(c.id.as_str(), inner);
                        self.stack.push(name);
                        self.level(
                            &inner.components,
                            &inner.junctions,
                            &inner.connections,
                            &format!("{id}/"),
                            Some(inner),
                        );
                        self.stack.pop();
                    }
                }
            } else if pins.contains_key(c.id.as_str()) {
                let width = c.widths().ok().map(|(width, _)| width);
                self.out.junctions.push(JunctionDesc {
                    id,
                    pin: true,
                    width,
                });
            } else {
                self.out.components.push(ComponentDesc { id, ..c.clone() });
            }
            if self.size > MAX_PARTS {
                return;
            }
        }
        for j in junctions {
            let id = format!("{prefix}{}", j.id);
            if !self.grow(&id) {
                return;
            }
            self.out.junctions.push(JunctionDesc {
                id,
                ..Default::default()
            });
        }
        for w in connections {
            let id = format!("{prefix}{}", w.id);
            if !self.grow(&id) {
                return;
            }
            let (from, to) = (
                self.end(&w.from, prefix, &pins, &instances, &id),
                self.end(&w.to, prefix, &pins, &instances, &id),
            );
            if let (Some(from), Some(to)) = (from, to) {
                self.out.connections.push(Connection { id, from, to });
            }
        }
        if definition.is_none_or(|d| self.wired.insert(d.id.as_str())) {
            let found = check_wiring(components, connections, prefix, &pins, &instances);
            self.errors.extend(found);
        }
    }

    /// A wire end in flattened terms: a port of an instance becomes the junction of the pin it names.
    fn end(
        &mut self,
        end: &Endpoint,
        prefix: &str,
        pins: &BTreeMap<&str, &str>,
        instances: &BTreeMap<&str, &DefinitionDesc>,
        wire: &str,
    ) -> Option<Endpoint> {
        let port = match end {
            Endpoint::Junction { junction } => {
                return Some(Endpoint::Junction {
                    junction: format!("{prefix}{junction}"),
                });
            }
            Endpoint::Port(port) => port,
        };
        if let Some(definition) = instances.get(port.component.as_str()) {
            let pin = definition
                .inputs
                .iter()
                .chain(&definition.outputs)
                .find(|p| p.name == port.port);
            return match pin {
                Some(pin) => Some(Endpoint::Junction {
                    junction: format!("{prefix}{}/{}", port.component, pin.component),
                }),
                None => {
                    let message = format!(
                        "wire {wire}: component {}{} has no pin '{}'",
                        prefix, port.component, port.port
                    );
                    self.error(Code::UnknownPort, message, wire);
                    None
                }
            };
        }
        if let Some(&own) = pins.get(port.component.as_str()) {
            if port.port != own {
                let message = format!(
                    "wire {wire}: pin {prefix}{} has no port '{}'",
                    port.component, port.port
                );
                self.error(Code::UnknownPort, message, wire);
                return None;
            }
            return Some(Endpoint::Junction {
                junction: format!("{prefix}{}", port.component),
            });
        }
        Some(Endpoint::Port(PortRef {
            component: format!("{prefix}{}", port.component),
            port: port.port.clone(),
        }))
    }

    /// Counts one more item at `id`; false (with one `TooLarge` error) once over the limit.
    fn grow(&mut self, id: &str) -> bool {
        self.size += 1;
        if self.size == MAX_PARTS + 1 {
            let message =
                format!("the circuit has more than {MAX_PARTS} items once components are expanded");
            self.error(Code::TooLarge, message, id);
        }
        self.size <= MAX_PARTS
    }

    /// Checks a definition's pins the first time it is expanded, reporting against that instance.
    fn pins_valid(&mut self, definition: &'a DefinitionDesc, instance: &str) -> bool {
        if let Some(&ok) = self.pins_ok.get(definition.id.as_str()) {
            return ok;
        }
        let before = self.errors.len();
        check_pins(definition, instance, &mut self.errors);
        let ok = self.errors.len() == before;
        self.pins_ok.insert(definition.id.as_str(), ok);
        ok
    }

    fn error(&mut self, code: Code, message: String, id: &str) {
        self.errors
            .push(Diagnostic::error(code, message, vec![top(id).to_string()]));
    }
}
