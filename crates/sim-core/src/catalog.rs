//! Built-in component catalog: kinds, port names and directions (ADR 0004).
//! Phase 1 signals are 1 bit wide, so widths are implicit.

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
}

impl Kind {
    pub const ALL: [Kind; 9] = [
        Kind::Switch,
        Kind::Led,
        Kind::Not,
        Kind::And,
        Kind::Nand,
        Kind::Or,
        Kind::Nor,
        Kind::Xor,
        Kind::Xnor,
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
        }
    }

    pub fn from_name(name: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|kind| kind.name() == name)
    }

    pub fn inputs(self) -> &'static [&'static str] {
        match self {
            Kind::Switch => &[],
            Kind::Led | Kind::Not => &["in"],
            _ => &["a", "b"],
        }
    }

    pub fn outputs(self) -> &'static [&'static str] {
        match self {
            Kind::Led => &[],
            _ => &["out"],
        }
    }

    /// Output value from input values `a`, `b` (0 or 1). A switch outputs its
    /// user-set `state`; an LED has no output and returns 0.
    pub(crate) fn eval(self, a: u8, b: u8, state: u8) -> u8 {
        match self {
            Kind::Switch => state,
            Kind::Led => 0,
            Kind::Not => a ^ 1,
            Kind::And => a & b,
            Kind::Nand => (a & b) ^ 1,
            Kind::Or => a | b,
            Kind::Nor => (a | b) ^ 1,
            Kind::Xor => a ^ b,
            Kind::Xnor => (a ^ b) ^ 1,
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
        // Rows: (a, b) = 00, 01, 10, 11.
        let table = |kind: Kind| [(0, 0), (0, 1), (1, 0), (1, 1)].map(|(a, b)| kind.eval(a, b, 0));
        assert_eq!(table(Kind::And), [0, 0, 0, 1]);
        assert_eq!(table(Kind::Nand), [1, 1, 1, 0]);
        assert_eq!(table(Kind::Or), [0, 1, 1, 1]);
        assert_eq!(table(Kind::Nor), [1, 0, 0, 0]);
        assert_eq!(table(Kind::Xor), [0, 1, 1, 0]);
        assert_eq!(table(Kind::Xnor), [1, 0, 0, 1]);
        assert_eq!([Kind::Not.eval(0, 0, 0), Kind::Not.eval(1, 0, 0)], [1, 0]);
        assert_eq!(
            [Kind::Switch.eval(0, 0, 0), Kind::Switch.eval(0, 0, 1)],
            [0, 1]
        );
    }
}
