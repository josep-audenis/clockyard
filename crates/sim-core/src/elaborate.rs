//! Flattening custom components into one circuit before compiling (ADR 0012).
//!
//! Each instance is replaced, depth first, by a copy of its definition with IDs
//! prefixed `instance/`. A definition's pin switches and LEDs become junctions,
//! and wires to the instance's ports are joined to them, so net resolution
//! (ADR 0010) sees one flat circuit and every instance has its own state.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use crate::description::{
    CircuitDescription, Code, ComponentDesc, Connection, DefinitionDesc, Diagnostic, Endpoint,
    JunctionDesc, PortRef,
};

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
    let has_instances = description.components.iter().any(|c| c.kind == CUSTOM);
    if description.definitions.is_empty() && !has_instances {
        return Ok(Cow::Borrowed(description));
    }
    let mut errors = Vec::new();
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

/// Pin names must be present and unique, and name a switch (input) or LED (output) of the definition.
/// Problems are reported against `instance`, the part the user can see.
fn check_pins(definition: &DefinitionDesc, instance: &str, errors: &mut Vec<Diagnostic>) {
    let kinds: BTreeMap<&str, &str> = definition
        .components
        .iter()
        .map(|c| (c.id.as_str(), c.kind.as_str()))
        .collect();
    let mut names = BTreeSet::new();
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

struct Flat<'a> {
    definitions: BTreeMap<&'a str, &'a DefinitionDesc>,
    out: CircuitDescription,
    errors: Vec<Diagnostic>,
    /// Definitions being expanded, outermost first: one appearing again is recursion.
    stack: Vec<&'a str>,
    /// Whether each definition expanded so far has valid pins. Unused definitions are not checked,
    /// so an unlabelled switch in one does not break circuits that do not use it.
    pins_ok: BTreeMap<&'a str, bool>,
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
        let pins: BTreeSet<&str> = definition
            .map(|d| {
                d.inputs
                    .iter()
                    .chain(&d.outputs)
                    .map(|p| p.component.as_str())
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
            } else if pins.contains(c.id.as_str()) {
                self.out.junctions.push(JunctionDesc { id, pin: true });
            } else {
                self.out.components.push(ComponentDesc {
                    id,
                    kind: c.kind.clone(),
                    definition: None,
                });
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
            self.out.junctions.push(JunctionDesc { id, pin: false });
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
    }

    /// A wire end in flattened terms: a port of an instance becomes the junction of the pin it names.
    fn end(
        &mut self,
        end: &Endpoint,
        prefix: &str,
        pins: &BTreeSet<&str>,
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
        if pins.contains(port.component.as_str()) {
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
