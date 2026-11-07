//! Built-in component catalog: kinds, port names, directions and widths
//! (ADRs 0004, 0014).

use std::borrow::Cow;

/// Widest signal a port may carry: one net's value fits a `u32` (ADR 0014).
pub const MAX_WIDTH: u32 = 32;

/// The low `width` bits set, for a width from 1 to `MAX_WIDTH`. Never built
/// by shifting 1, which overflows at 32.
pub(crate) fn mask(width: u32) -> u32 {
    u32::MAX >> (MAX_WIDTH - width)
}

/// A built-in primitive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Switch,
    Led,
    Not,
    And,
    Nand,
    Or,
    Nor,
    Xor,
    Xnor,
    Split,
    Merge,
}

/// One port of a part, with the width its props give it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Port {
    pub name: Cow<'static, str>,
    pub width: u32,
    pub output: bool,
}

impl Kind {
    pub const ALL: [Kind; 11] = [
        Kind::Switch,
        Kind::Led,
        Kind::Not,
        Kind::And,
        Kind::Nand,
        Kind::Or,
        Kind::Nor,
        Kind::Xor,
        Kind::Xnor,
        Kind::Split,
        Kind::Merge,
    ];

    /// Name used in circuit descriptions.
    pub fn name(self) -> &'static str {
        match self {
            Kind::Switch => "switch",
            Kind::Led => "led",
            Kind::Not => "not",
            Kind::And => "and",
            Kind::Nand => "nand",
            Kind::Or => "or",
            Kind::Nor => "nor",
            Kind::Xor => "xor",
            Kind::Xnor => "xnor",
            Kind::Split => "split",
            Kind::Merge => "merge",
        }
    }

    pub fn from_name(name: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|kind| kind.name() == name)
    }

    /// Whether the `width` prop sets every port's width (switch, LED, gates).
    pub fn sized(self) -> bool {
        !self.fielded()
    }

    /// Whether the `fields` prop adds field ports `f0`, `f1`, … (split, merge).
    pub fn fielded(self) -> bool {
        matches!(self, Kind::Split | Kind::Merge)
    }

    /// Fixed input ports. A merge's field inputs come from `ports`.
    pub fn inputs(self) -> &'static [&'static str] {
        match self {
            Kind::Switch | Kind::Merge => &[],
            Kind::Led | Kind::Not | Kind::Split => &["in"],
            _ => &["a", "b"],
        }
    }

    /// Fixed output ports. A split's field outputs come from `ports`.
    pub fn outputs(self) -> &'static [&'static str] {
        match self {
            Kind::Led | Kind::Split => &[],
            _ => &["out"],
        }
    }

    /// Every port, inputs first, for already validated `width` and `fields`.
    /// A split's `in` and a merge's `out` are as wide as all fields together.
    pub fn ports(self, width: u32, fields: &[u32]) -> Vec<Port> {
        let fixed_width = if self.sized() {
            width
        } else {
            fields.iter().sum()
        };
        let fixed = |names: &'static [&'static str], output| {
            names.iter().map(move |name| Port {
                name: Cow::Borrowed(*name),
                width: fixed_width,
                output,
            })
        };
        let field_ports = fields.iter().enumerate().map(|(i, &width)| Port {
            name: Cow::Owned(format!("f{i}")),
            width,
            output: self == Kind::Split,
        });
        let mut ports: Vec<Port> = fixed(self.inputs(), false).collect();
        if self == Kind::Merge {
            ports.extend(field_ports.clone());
        }
        ports.extend(fixed(self.outputs(), true));
        if self == Kind::Split {
            ports.extend(field_ports);
        }
        ports
    }

    /// A gate's output, bit by bit and not yet masked to its width (ADR 0014).
    pub(crate) fn gate(self, a: u32, b: u32) -> u32 {
        match self {
            Kind::Not => !a,
            Kind::And => a & b,
            Kind::Nand => !(a & b),
            Kind::Or => a | b,
            Kind::Nor => !(a | b),
            Kind::Xor => a ^ b,
            Kind::Xnor => !(a ^ b),
            Kind::Switch | Kind::Led | Kind::Split | Kind::Merge => {
                unreachable!("{} is not a gate", self.name())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for kind in Kind::ALL {
            assert_eq!(Kind::from_name(kind.name()), Some(kind));
        }
        assert_eq!(Kind::from_name("flux-capacitor"), None);
    }

    #[test]
    fn truth_tables() {
        // Rows: (a, b) = 00, 01, 10, 11, at width 1.
        let table = |kind: Kind| [(0, 0), (0, 1), (1, 0), (1, 1)].map(|(a, b)| kind.gate(a, b) & 1);
        assert_eq!(table(Kind::And), [0, 0, 0, 1]);
        assert_eq!(table(Kind::Nand), [1, 1, 1, 0]);
        assert_eq!(table(Kind::Or), [0, 1, 1, 1]);
        assert_eq!(table(Kind::Nor), [1, 0, 0, 0]);
        assert_eq!(table(Kind::Xor), [0, 1, 1, 0]);
        assert_eq!(table(Kind::Xnor), [1, 0, 0, 1]);
        assert_eq!(table(Kind::Not), [1, 1, 0, 0]);
    }

    #[test]
    fn masks_and_field_ports() {
        assert_eq!([mask(1), mask(4), mask(32)], [1, 15, u32::MAX]);
        let names = |kind: Kind| -> Vec<(String, u32, bool)> {
            kind.ports(1, &[3, 5])
                .into_iter()
                .map(|p| (p.name.into_owned(), p.width, p.output))
                .collect()
        };
        let port = |name: &str, width, output| (name.to_string(), width, output);
        assert_eq!(
            names(Kind::Split),
            [
                port("in", 8, false),
                port("f0", 3, true),
                port("f1", 5, true)
            ]
        );
        assert_eq!(
            names(Kind::Merge),
            [
                port("f0", 3, false),
                port("f1", 5, false),
                port("out", 8, true)
            ]
        );
        let and: Vec<u32> = Kind::And.ports(8, &[]).iter().map(|p| p.width).collect();
        assert_eq!(and, [8, 8, 8]);
    }
}
