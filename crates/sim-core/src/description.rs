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
#[serde(untagged)]
pub enum Endpoint {
    Port(PortRef),
    Junction { junction: String },
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
