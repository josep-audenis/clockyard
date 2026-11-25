//! Engine input and diagnostics: the Rust ↔ TypeScript contract
//! (`docs/architecture.md#circuit-description-engine-input`).

use serde::{Deserialize, Serialize};

use crate::catalog::{Kind, MAX_ADDRESS, MAX_INPUTS, MAX_WIDTH, mask};
use crate::elaborate::CUSTOM;

/// Geometry-free circuit projected from the editable document.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct CircuitDescription {
    /// The parts on the top sheet.
    pub components: Vec<ComponentDesc>,
    /// Junction points joining wires into one net (ADR 0010).
    #[serde(default)]
    pub junctions: Vec<JunctionDesc>,
    /// The wires on the top sheet.
    pub connections: Vec<Connection>,
    /// Custom component definitions that `custom` parts refer to (ADR 0012).
    #[serde(default)]
    pub definitions: Vec<DefinitionDesc>,
}

/// A reusable circuit. Its pins are switches (inputs) and LEDs (outputs) inside it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct DefinitionDesc {
    /// The ID that `custom` parts name in their `definition`.
    pub id: String,
    /// The parts inside it.
    pub components: Vec<ComponentDesc>,
    /// The junctions inside it.
    #[serde(default)]
    pub junctions: Vec<JunctionDesc>,
    /// The wires inside it.
    pub connections: Vec<Connection>,
    /// Its input pins: switches inside, driven from outside.
    pub inputs: Vec<PinDesc>,
    /// Its output pins: LEDs inside, read from outside.
    pub outputs: Vec<PinDesc>,
}

/// A pin: the port name instances show, and the switch or LED inside that it is.
#[derive(Clone, Debug, Deserialize)]
pub struct PinDesc {
    /// The port name an instance shows.
    pub name: String,
    /// The ID of the switch or LED inside the definition.
    pub component: String,
}

/// A point where wires meet and join one net (ADR 0010), or a net label.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct JunctionDesc {
    /// Its document ID, which wire ends name.
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

/// A part: its kind and props, with no position.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct ComponentDesc {
    /// Its document ID, which wire ends and diagnostics name.
    pub id: String,
    /// A catalog name ([`Kind::from_name`]) or `custom`.
    pub kind: String,
    /// For `custom` parts: the definition it is an instance of.
    #[serde(default)]
    pub definition: Option<String>,
    /// Port width of a switch, LED or gate (ADR 0014); absent means 1. A plain
    /// number, so a bad one (2.5, -1) is reported as `invalidWidth` by
    /// [`ComponentDesc::shape`] rather than failing the whole description.
    #[serde(default)]
    pub width: Option<f64>,
    /// Field widths of a split or merge, least significant first.
    #[serde(default)]
    pub fields: Option<Vec<f64>>,
    /// Address width of a ROM or RAM (ADR 0018): it holds 2^address words; absent means 8.
    #[serde(default, rename = "addressWidth")]
    pub address_width: Option<f64>,
    /// A ROM's words from address 0 (ADR 0018); words past the end read 0.
    #[serde(default)]
    pub data: Option<Vec<f64>>,
    /// How many inputs a gate has (ADR 0038), 2 to 8; absent means 2.
    #[serde(default, rename = "inputCount")]
    pub input_count: Option<f64>,
}

/// A part's props as checked whole numbers (ADRs 0014, 0018).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Shape {
    /// Width of its data ports; 1 where it takes none.
    pub width: u32,
    /// A split's or merge's field widths.
    pub fields: Vec<u32>,
    /// A memory's address width; 0 for other parts.
    pub address: u32,
    /// A gate's input count (ADR 0038); 0 for other parts.
    pub inputs: u32,
    /// A ROM's words.
    pub data: Vec<u32>,
}

impl ComponentDesc {
    /// The part's width, fields, address width and contents as whole numbers,
    /// or what is wrong with them: `invalidWidth`, or `invalidContents` for a
    /// ROM's words (ADRs 0014, 0018). Unknown kinds pass: they are reported as
    /// such later.
    pub fn shape(&self) -> Result<Shape, (Code, String)> {
        let mut shape = self.ports_shape()?;
        let kind = Kind::from_name(&self.kind);
        let (width, address) = (shape.width, shape.address);
        shape.data = match &self.data {
            None => Vec::new(),
            _ if kind.is_none() => Vec::new(),
            Some(_) if kind != Some(Kind::Rom) => {
                let message = format!("a {} holds no data", self.kind);
                return Err((Code::InvalidContents, message));
            }
            Some(words) if words.len() > 1 << address => {
                let message = format!(
                    "{} words do not fit in {} addresses",
                    words.len(),
                    1u32 << address
                );
                return Err((Code::InvalidContents, message));
            }
            Some(words) => words
                .iter()
                .map(|&w| {
                    (w.fract() == 0.0 && (0.0..=f64::from(mask(width))).contains(&w))
                        .then_some(w as u32)
                })
                .collect::<Option<Vec<u32>>>()
                .ok_or_else(|| {
                    let message = format!("words must be whole numbers from 0 to {}", mask(width));
                    (Code::InvalidContents, message)
                })?,
        };
        Ok(shape)
    }

    /// What sets the part's ports: [`ComponentDesc::shape`] without a ROM's
    /// words, which are checked once and not again for every wire.
    pub fn ports_shape(&self) -> Result<Shape, (Code, String)> {
        let (width, fields) = self.widths().map_err(|e| (Code::InvalidWidth, e))?;
        let kind = Kind::from_name(&self.kind);
        // A custom part is refused one too; an unknown kind is reported as such later.
        let counted = kind.is_some_and(Kind::counted);
        let inputs = match self.input_count {
            None if counted => 2,
            None => 0,
            Some(_) if kind.is_none() && self.kind != CUSTOM => 0,
            Some(_) if !counted => {
                let message = format!("a {} takes no input count", self.kind);
                return Err((Code::InvalidWidth, message));
            }
            Some(n) if n.fract() == 0.0 && (2.0..=f64::from(MAX_INPUTS)).contains(&n) => n as u32,
            Some(n) => {
                let message =
                    format!("input count {n} is not a whole number from 2 to {MAX_INPUTS}");
                return Err((Code::InvalidWidth, message));
            }
        };
        if kind.is_none() {
            return Ok(Shape {
                width,
                fields,
                ..Shape::default()
            });
        }
        let addressed = kind.is_some_and(Kind::addressed);
        let address = match self.address_width {
            None if addressed => 8,
            None => 0,
            Some(_) if !addressed => {
                let message = format!("a {} takes no address width", self.kind);
                return Err((Code::InvalidWidth, message));
            }
            Some(a) if a.fract() == 0.0 && (1.0..=MAX_ADDRESS as f64).contains(&a) => a as u32,
            Some(a) => {
                let message =
                    format!("address width {a} is not a whole number from 1 to {MAX_ADDRESS}");
                return Err((Code::InvalidWidth, message));
            }
        };
        Ok(Shape {
            width,
            fields,
            address,
            inputs,
            data: Vec::new(),
        })
    }

    /// Memory words the part holds once compiled: `2^addressWidth` for a ROM or
    /// RAM, 0 for anything else or an invalid one (ADR 0018).
    pub fn words(&self) -> usize {
        self.ports_shape().map_or(0, |shape| {
            if shape.address > 0 {
                1 << shape.address
            } else {
                0
            }
        })
    }

    /// The part's width and fields as whole numbers, or what is wrong with
    /// them (ADR 0014). Unknown kinds pass: they are reported as such later.
    fn widths(&self) -> Result<(u32, Vec<u32>), String> {
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
    /// Its document ID, which diagnostics name.
    pub id: String,
    /// One end.
    pub from: Endpoint,
    /// The other end.
    pub to: Endpoint,
}

/// A wire end: a component port, or a junction (`{ "junction": id }`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "RawEnd")]
pub enum Endpoint {
    /// A component's port.
    Port(PortRef),
    /// A junction, by ID.
    Junction {
        /// The junction's ID.
        junction: String,
    },
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

/// A port of a part, by the part's ID and the port's name (`a`, `out`, …).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct PortRef {
    /// The part's ID.
    pub component: String,
    /// The port's name.
    pub port: String,
}

/// Whether a diagnostic stops what reported it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The circuit does not load, or the tick, run or check stops.
    Error,
    /// Reported, and the circuit runs on.
    Warning,
}

/// What a diagnostic is about, sent to the editor in camelCase (`docs/simulation-model.md`,
/// Diagnostics).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Code {
    // Validation
    /// Two parts or junctions on one sheet, two wires on one sheet, or two
    /// definitions share an ID.
    DuplicateId,
    /// A part's kind is not in the catalog.
    UnknownKind,
    /// A wire names a part that is not there.
    UnknownComponent,
    /// A wire names a junction that is not there.
    UnknownJunction,
    /// A wire names a port the part does not have.
    UnknownPort,
    /// Outputs drive one net that nothing reads, and not all of them are
    /// tri-state buffers (ADR 0035).
    OutputToOutput,
    /// Inputs are joined with nothing driving them.
    InputToInput,
    /// Outputs drive one net that is read, and not all of them are tri-state
    /// buffers (ADR 0035).
    MultipleDrivers,
    /// A warning: an input that nothing drives, which reads 0.
    UnconnectedInput,
    /// A `custom` part names a definition that is not there.
    UnknownDefinition,
    /// A definition contains itself, directly or through others (ADR 0012).
    RecursiveDefinition,
    /// A definition's pin has no name, shares a name or a part with another pin,
    /// or names no switch (input) or LED (output) inside it.
    InvalidPin,
    /// The circuit, once custom parts are expanded, has too many parts, junctions
    /// and wires, or memory words.
    TooLarge,
    /// An ID containing `/`, which separates instance paths.
    InvalidId,
    /// Ports of different widths share a net (ADR 0014).
    WidthMismatch,
    /// A width, field list, address width or input count out of range, or on a part
    /// that takes none.
    InvalidWidth,
    /// A warning: a net label that no other junction on its sheet carries (ADR 0015).
    UnmatchedLabel,
    /// A ROM's words that do not fit it, or data on a part that holds none (ADR 0018).
    InvalidContents,
    // Runtime
    /// A loop that did not settle within the delta limit: an error.
    Unstable,
    /// A warning: a loop that did not settle left outputs at `X` (ADR 0035).
    Unsettled,
}

/// A problem pointing at the document IDs (components, wires) involved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    /// Whether it stops what reported it.
    pub severity: Severity,
    /// What it is about.
    pub code: Code,
    /// What is wrong, in a sentence for the user.
    pub message: String,
    /// The document IDs it points at, for the editor to highlight.
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

    /// Whether it stops what reported it: a tick, a run, a challenge check.
    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
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
