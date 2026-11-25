//! Built-in component catalog: kinds, port names, directions and widths
//! (ADRs 0004, 0014, 0017).

use std::borrow::Cow;

use crate::description::Shape;

/// Widest signal a port may carry: one net's value fits a `u32` (ADR 0014).
pub const MAX_WIDTH: u32 = 32;

/// Widest address a ROM or RAM may have: 2^16 words (ADR 0018).
pub const MAX_ADDRESS: u32 = 16;

/// The most inputs a gate may have (ADR 0038), and their port names in order.
pub const MAX_INPUTS: u32 = 8;
const GATE_INPUTS: [&str; MAX_INPUTS as usize] = ["a", "b", "c", "d", "e", "f", "g", "h"];

/// The low `width` bits set, for a width from 1 to `MAX_WIDTH`. Never built
/// by shifting 1, which overflows at 32.
pub(crate) fn mask(width: u32) -> u32 {
    u32::MAX >> (MAX_WIDTH - width)
}

/// A built-in primitive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// An input the user sets: `out`, 1 to 32 bits.
    Switch,
    /// An output the user sees: `in`, 1 to 32 bits.
    Led,
    /// `out` is the bitwise NOT of `in`.
    Not,
    /// `out` is the bitwise AND of its inputs, `a` to `h`.
    And,
    /// `out` is the bitwise NAND of its inputs.
    Nand,
    /// `out` is the bitwise OR of its inputs.
    Or,
    /// `out` is the bitwise NOR of its inputs.
    Nor,
    /// `out` is the bitwise XOR of its inputs: 1 where an odd number are 1.
    Xor,
    /// `out` is the bitwise XNOR of its inputs.
    Xnor,
    /// Splits `in` into fields `f0`, `f1`, …, least significant first.
    Split,
    /// Joins fields `f0`, `f1`, …, least significant first, into `out`.
    Merge,
    /// A 1-bit `out` at the global clock's level: low on even ticks, high on odd (ADR 0017).
    Clock,
    /// A D flip-flop, or a register when wide: `q` takes `d` on a rising `clk`.
    Dff,
    /// `out` is the word of `data` at `addr` (ADR 0018).
    Rom,
    /// `out` is the word at `addr`; a rising `clk` writes `din` there while `we` is 1.
    Ram,
    /// A seven-segment display: an LED with an 8-bit `seg`, bit 0 segment a to
    /// bit 6 g, bit 7 the point (ADR 0021).
    Seg7,
    /// A RAM whose words are its pixels (ADR 0021).
    Screen,
    /// A switch with an 8-bit `out`: the code of the key held, or 0 when none
    /// is (ADR 0021).
    Keyboard,
    /// A tri-state buffer (ADR 0035): `out` is `in` while `en` is 1, and drives nothing while it is 0.
    Tri,
    /// A push button (ADR 0038): a 1-bit switch the editor holds at 1 while it is pressed.
    Button,
}

/// One port of a part, with the width its props give it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Port {
    /// Its name, which wire ends use: `in`, `out`, `a`, `f0`, ….
    pub name: Cow<'static, str>,
    /// Its width in bits, 1 to 32.
    pub width: u32,
    /// Whether the part drives it.
    pub output: bool,
}

impl Kind {
    /// Every kind, in catalog order.
    pub const ALL: [Kind; 20] = [
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
        Kind::Clock,
        Kind::Dff,
        Kind::Rom,
        Kind::Ram,
        Kind::Seg7,
        Kind::Screen,
        Kind::Keyboard,
        Kind::Tri,
        Kind::Button,
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
            Kind::Clock => "clock",
            Kind::Dff => "dff",
            Kind::Rom => "rom",
            Kind::Ram => "ram",
            Kind::Seg7 => "seg7",
            Kind::Screen => "screen",
            Kind::Keyboard => "keyboard",
            Kind::Tri => "tri",
            Kind::Button => "button",
        }
    }

    /// The kind a description's name stands for, if it is in the catalog.
    pub fn from_name(name: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|kind| kind.name() == name)
    }

    /// Whether the `width` prop sets its ports' widths (switch, LED, gates,
    /// and a flip-flop's `d` and `q`). A clock is always 1 bit; a seven-segment
    /// display and a keyboard always 8 (ADR 0021).
    pub fn sized(self) -> bool {
        !self.fielded() && self.fixed_width().is_none()
    }

    /// The width of a part whose ports never take a `width` prop.
    pub fn fixed_width(self) -> Option<u32> {
        match self {
            Kind::Clock | Kind::Button => Some(1),
            Kind::Seg7 | Kind::Keyboard => Some(8),
            _ => None,
        }
    }

    /// Whether the part is a memory, with `addressWidth` setting its `addr` port
    /// (ADR 0018). A screen is a RAM whose words are pixels (ADR 0021).
    pub fn addressed(self) -> bool {
        matches!(self, Kind::Rom | Kind::Ram | Kind::Screen)
    }

    /// Whether `inputCount` sets how many inputs it has, `a` to `h` (ADR 0038):
    /// every gate but NOT.
    pub fn counted(self) -> bool {
        matches!(
            self,
            Kind::And | Kind::Nand | Kind::Or | Kind::Nor | Kind::Xor | Kind::Xnor
        )
    }

    /// Whether the `fields` prop adds field ports `f0`, `f1`, … (split, merge).
    pub fn fielded(self) -> bool {
        self.field_ports().is_some()
    }

    /// The naming rule for field ports: whether they are outputs (a split's)
    /// or inputs (a merge's), and the prefix their index follows.
    pub fn field_ports(self) -> Option<(bool, &'static str)> {
        match self {
            Kind::Split => Some((true, "f")),
            Kind::Merge => Some((false, "f")),
            _ => None,
        }
    }

    /// Fixed input ports. A merge's field inputs come from `ports`; a gate's
    /// are its first two, and `ports` gives the rest of its `inputCount`.
    pub fn inputs(self) -> &'static [&'static str] {
        match self {
            Kind::Switch | Kind::Merge | Kind::Clock | Kind::Keyboard | Kind::Button => &[],
            Kind::Led | Kind::Not | Kind::Split => &["in"],
            Kind::Seg7 => &["seg"],
            Kind::Dff => &["d", "clk"],
            Kind::Tri => &["in", "en"],
            Kind::Rom => &["addr"],
            Kind::Ram | Kind::Screen => &["addr", "din", "we", "clk"],
            _ => &GATE_INPUTS[..2],
        }
    }

    /// Fixed output ports. A split's field outputs come from `ports`.
    pub fn outputs(self) -> &'static [&'static str] {
        match self {
            Kind::Led | Kind::Split | Kind::Seg7 => &[],
            Kind::Dff => &["q"],
            _ => &["out"],
        }
    }

    /// Every port, inputs first, for an already validated shape.
    /// A split's `in` and a merge's `out` are as wide as all fields together;
    /// `clk`, `we` and `en` are always 1 bit, and a memory's `addr` is its address width.
    pub fn ports(self, shape: &Shape) -> Vec<Port> {
        let (width, fields, address) = (shape.width, shape.fields.as_slice(), shape.address);
        let fixed_width = if self.sized() {
            width
        } else if self.fielded() {
            fields.iter().sum()
        } else {
            self.fixed_width().unwrap_or(1)
        };
        let fixed = |names: &'static [&'static str], output| {
            names.iter().map(move |name| Port {
                name: Cow::Borrowed(*name),
                width: match *name {
                    "clk" | "we" | "en" => 1,
                    "addr" => address,
                    _ => fixed_width,
                },
                output,
            })
        };
        let (output, prefix) = self.field_ports().unwrap_or((false, ""));
        let field_ports = fields.iter().enumerate().map(move |(i, &width)| Port {
            name: Cow::Owned(format!("{prefix}{i}")),
            width,
            output,
        });
        let inputs = if self.counted() {
            &GATE_INPUTS[..shape.inputs.clamp(2, MAX_INPUTS) as usize]
        } else {
            self.inputs()
        };
        let mut ports: Vec<Port> = fixed(inputs, false).collect();
        if self == Kind::Merge {
            ports.extend(field_ports.clone());
        }
        ports.extend(fixed(self.outputs(), true));
        if self == Kind::Split {
            ports.extend(field_ports);
        }
        ports
    }

    /// A gate with any number of inputs as the gate it folds with, and
    /// whether it inverts once at the end (ADR 0038): NAND, NOR and XNOR do
    /// not chain.
    pub(crate) fn base(self) -> (Kind, bool) {
        match self {
            Kind::Nand => (Kind::And, true),
            Kind::Nor => (Kind::Or, true),
            Kind::Xnor => (Kind::Xor, true),
            kind => (kind, false),
        }
    }

    /// A gate's output over all its inputs, bit by bit and not yet masked
    /// (ADR 0038): AND of all, OR of any, XOR their parity.
    pub(crate) fn gate_all(self, mut inputs: impl Iterator<Item = u32>) -> u32 {
        let (base, invert) = self.base();
        let first = inputs.next().expect("a gate has inputs");
        let value = inputs.fold(first, |acc, x| base.gate(acc, x));
        if invert { !value } else { value }
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
            Kind::Switch
            | Kind::Led
            | Kind::Split
            | Kind::Merge
            | Kind::Clock
            | Kind::Dff
            | Kind::Rom
            | Kind::Ram
            | Kind::Seg7
            | Kind::Screen
            | Kind::Keyboard
            | Kind::Tri
            | Kind::Button => {
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

    fn shape(width: u32, fields: &[u32], address: u32) -> Shape {
        Shape {
            width,
            fields: fields.to_vec(),
            address,
            inputs: 0,
            data: Vec::new(),
        }
    }

    #[test]
    fn masks_and_field_ports() {
        assert_eq!([mask(1), mask(4), mask(32)], [1, 15, u32::MAX]);
        let names = |kind: Kind| -> Vec<(String, u32, bool)> {
            kind.ports(&shape(1, &[3, 5], 0))
                .into_iter()
                .map(|p| (p.name.into_owned(), p.width, p.output))
                .collect()
        };
        let port = |name: &str, width, output| (name.to_string(), width, output);
        let names_of = |kind: Kind, width| -> Vec<(String, u32, bool)> {
            kind.ports(&shape(width, &[], 0))
                .into_iter()
                .map(|p| (p.name.into_owned(), p.width, p.output))
                .collect()
        };
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
        let and: Vec<u32> = Kind::And
            .ports(&shape(8, &[], 0))
            .iter()
            .map(|p| p.width)
            .collect();
        assert_eq!(and, [8, 8, 8]);
        assert_eq!(
            names_of(Kind::Dff, 8),
            [
                port("d", 8, false),
                port("clk", 1, false),
                port("q", 8, true)
            ]
        );
        assert_eq!(names_of(Kind::Clock, 1), [port("out", 1, true)]);
        assert!(!Kind::Clock.sized() && Kind::Dff.sized());
        // ADR 0021: devices.
        assert_eq!(names_of(Kind::Seg7, 1), [port("seg", 8, false)]);
        assert_eq!(names_of(Kind::Keyboard, 1), [port("out", 8, true)]);
        assert!(!Kind::Seg7.sized() && !Kind::Keyboard.sized() && Kind::Screen.sized());
        assert!(Kind::Screen.addressed() && !Kind::Seg7.addressed());
    }
}
