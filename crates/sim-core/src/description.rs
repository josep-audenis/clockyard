//! Engine input and diagnostics: the Rust ↔ TypeScript contract
//! (`docs/architecture.md#circuit-description-engine-input`).

use serde::{Deserialize, Serialize};

use crate::catalog::{Kind, MAX_WIDTH};
use crate::elaborate::CUSTOM;

/// Geometry-free circuit projected from the editable document.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct CircuitDescription {
    pub components: Vec<ComponentDesc>,
    /// Junction points joining wires into one net (ADR 0010).
    #[serde(default)]
    pub junctions: Vec<JunctionDesc>,
    pub connections: Vec<Connection>,
    /// Custom component definitions that `custom` parts refer to (ADR 0012).
    #[serde(default)]
    pub definitions: Vec<DefinitionDesc>,
}

/// A reusable circuit. Its pins are switches (inputs) and LEDs (outputs) inside it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct DefinitionDesc {
    pub id: String,
    pub components: Vec<ComponentDesc>,
    #[serde(default)]
    pub junctions: Vec<JunctionDesc>,
    pub connections: Vec<Connection>,
    pub inputs: Vec<PinDesc>,
    pub outputs: Vec<PinDesc>,
}

/// A pin: the port name instances show, and the switch or LED inside that it is.
#[derive(Clone, Debug, Deserialize)]
pub struct PinDesc {
    pub name: String,
    pub component: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct JunctionDesc {
    pub id: String,
    /// A net label (ADR 0015): junctions with the same name on one sheet are one
    /// net. Empty or absent means a plain junction.
    #[serde(default)]
    pub name: Option<String>,
    /// Set by elaboration for a custom component's pin: a net reaching one but
    /// no output is a pin left unconnected (reads 0), not an error, since each
    /// level's own wiring was checked before flattening (ADR 0012).
    #[serde(skip)]
    pub pin: bool,
    /// Set by elaboration on a pin: its pin part's width, so a wire that reaches
    /// only the pin still reports it as its width (ADR 0014).
    #[serde(skip)]
    pub width: Option<u32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ComponentDesc {
    pub id: String,
    pub kind: String,
    /// For `custom` parts: the definition it is an instance of.
    #[serde(default)]
    pub definition: Option<String>,
    /// Port width of a switch, LED or gate (ADR 0014); absent means 1. A plain
    /// number, so a bad one (2.5, -1) is reported as `invalidWidth` by
    /// [`ComponentDesc::widths`] rather than failing the whole description.
    #[serde(default)]
    pub width: Option<f64>,
    /// Field widths of a split or merge, least significant first.
    #[serde(default)]
    pub fields: Option<Vec<f64>>,
}

impl ComponentDesc {
    /// The part's width and fields as whole numbers, or what is wrong with
    /// them (ADR 0014). Unknown kinds pass: they are reported as such later.
    pub fn widths(&self) -> Result<(u32, Vec<u32>), String> {
        let kind = Kind::from_name(&self.kind);
        if kind.is_none() && self.kind != CUSTOM {
            return Ok((1, Vec::new()));
        }
        let (sized, fielded) = kind.map_or((false, false), |k| (k.sized(), k.fielded()));
        let whole = |n: f64| {
            (n.fract() == 0.0 && (1.0..=MAX_WIDTH as f64).contains(&n)).then_some(n as u32)
        };
        let width = match self.width {
            None => 1,
            Some(_) if !sized => return Err(format!("a {} takes no width", self.kind)),
            Some(w) => whole(w)
                .ok_or_else(|| format!("width {w} is not a whole number from 1 to {MAX_WIDTH}"))?,
        };
        let fields = match &self.fields {
            None if fielded => return Err(format!("a {} needs fields", self.kind)),
            None => Vec::new(),
            Some(_) if !fielded => return Err(format!("a {} takes no fields", self.kind)),
            Some(list) if list.is_empty() => return Err("fields must not be empty".into()),
            // Every field is at least 1 bit, so this also keeps the sum below from overflowing.
            Some(list) if list.len() > MAX_WIDTH as usize => {
                return Err(format!(
                    "{} fields add up to more than {MAX_WIDTH} bits",
                    list.len()
                ));
            }
            Some(list) => list
                .iter()
                .map(|&f| whole(f))
                .collect::<Option<Vec<u32>>>()
                .ok_or_else(|| format!("fields must be whole numbers from 1 to {MAX_WIDTH}"))?,
        };
        let total: u32 = fields.iter().sum();
        if total > MAX_WIDTH {
            return Err(format!(
                "fields add up to {total} bits, more than {MAX_WIDTH}"
            ));
        }
        Ok((width, fields))
    }
}

/// A wire between two ends. Either end may be the output; the engine
/// normalizes direction and joins wires that share a port or junction into nets.
#[derive(Clone, Debug, Deserialize)]
pub struct Connection {
    pub id: String,
    pub from: Endpoint,
    pub to: Endpoint,
}

/// A wire end: a component port, or a junction (`{ "junction": id }`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "RawEnd")]
pub enum Endpoint {
    Port(PortRef),
    Junction { junction: String },
}

/// The fields a wire end may carry, so a malformed one gets a message that
/// says what is missing (serde's untagged enums only say "no variant matched").
#[derive(Deserialize)]
#[serde(expecting = "a wire end: {component, port} or {junction}")]
struct RawEnd {
    component: Option<String>,
    port: Option<String>,
    junction: Option<String>,
}

impl TryFrom<RawEnd> for Endpoint {
    type Error = String;

    fn try_from(end: RawEnd) -> Result<Self, String> {
        match end {
            RawEnd {
                component: Some(component),
                port: Some(port),
                junction: None,
            } => Ok(Endpoint::Port(PortRef { component, port })),
            RawEnd {
                component: None,
                port: None,
                junction: Some(junction),
            } => Ok(Endpoint::Junction { junction }),
            _ => Err(
                "a wire end needs either `component` and `port`, or `junction` alone".to_string(),
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct PortRef {
    pub component: String,
    pub port: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Code {
    // Validation
    DuplicateId,
    UnknownKind,
    UnknownComponent,
    UnknownJunction,
    UnknownPort,
    OutputToOutput,
    InputToInput,
    MultipleDrivers,
    UnconnectedInput,
    UnknownDefinition,
    RecursiveDefinition,
    InvalidPin,
    TooLarge,
    InvalidId,
    WidthMismatch,
    InvalidWidth,
    UnmatchedLabel,
    // Runtime
    Unstable,
}

/// A problem pointing at the document IDs (components, wires) involved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: Code,
    pub message: String,
    pub ids: Vec<String>,
}

impl Diagnostic {
    pub(crate) fn error(code: Code, message: String, ids: Vec<String>) -> Self {
        Diagnostic {
            severity: Severity::Error,
            code,
            message,
            ids,
        }
    }

    pub(crate) fn warning(code: Code, message: String, ids: Vec<String>) -> Self {
        Diagnostic {
            severity: Severity::Warning,
            code,
            message,
            ids,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn end(json: &str) -> Result<Endpoint, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }

    #[test]
    fn wire_ends_are_a_port_or_a_junction_and_say_what_is_wrong() {
        assert_eq!(
            end(r#"{"component":"g","port":"a"}"#),
            Ok(Endpoint::Port(PortRef {
                component: "g".into(),
                port: "a".into()
            }))
        );
        assert_eq!(
            end(r#"{"junction":"j"}"#),
            Ok(Endpoint::Junction {
                junction: "j".into()
            })
        );
        for bad in [
            r#"{"component":"g"}"#,
            r#"{"junction":"j","component":"g","port":"a"}"#,
            r#"{"junktion":"j"}"#,
        ] {
            let error = end(bad).unwrap_err();
            assert!(
                error.contains("needs either `component` and `port`"),
                "{bad}: {error}"
            );
        }
        // Not an object at all: the message names a wire end, not an internal type.
        let error = end(r#""s.out""#).unwrap_err();
        assert!(error.contains("expected a wire end"), "{error}");
    }
}
