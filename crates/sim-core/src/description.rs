//! Engine input and diagnostics: the Rust ↔ TypeScript contract
//! (`docs/architecture.md#circuit-description-engine-input`).

use serde::{Deserialize, Serialize};

/// Geometry-free circuit projected from the editable document.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct CircuitDescription {
    pub components: Vec<ComponentDesc>,
    /// Junction points joining wires into one net (ADR 0010).
    #[serde(default)]
    pub junctions: Vec<JunctionDesc>,
    pub connections: Vec<Connection>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct JunctionDesc {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ComponentDesc {
    pub id: String,
    pub kind: String,
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
    }
}
