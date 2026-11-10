//! Assembler and disassembler for the reference CPU, as specified in
//! `docs/reference-cpu.md` (ADR 0019). It turns text into ROM words and back;
//! it simulates nothing.

use std::collections::BTreeMap;
use std::fmt;

/// Words a program may hold: the program ROM's size.
pub const MAX_WORDS: usize = 256;

/// Each instruction's mnemonic, opcode and whether it takes an operand, in
/// opcode order. Opcodes 0xD to 0xF are reserved and execute as `NOP`.
pub const INSTRUCTIONS: [(&str, u16, bool); 13] = [
    ("NOP", 0x0, false),
    ("LDI", 0x1, true),
    ("LDA", 0x2, true),
    ("STA", 0x3, true),
    ("ADD", 0x4, true),
    ("SUB", 0x5, true),
    ("ADI", 0x6, true),
    ("SBI", 0x7, true),
    ("JMP", 0x8, true),
    ("JZ", 0x9, true),
    ("JC", 0xA, true),
    ("OUT", 0xB, false),
    ("HLT", 0xC, false),
];

/// A problem in the source, on a 1-based line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

/// One instruction as written: its line, mnemonic and operand token.
struct Line<'a> {
    number: usize,
    mnemonic: &'a str,
    operands: Vec<&'a str>,
}

fn valid_label(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A number from 0 to 255 in decimal, `0x` hex or `0b` binary.
fn number(token: &str) -> Option<Result<u16, String>> {
    let lower = token.to_ascii_lowercase();
    let (digits, radix) = match lower.as_str() {
        t if t.starts_with("0x") => (&t[2..], 16),
        t if t.starts_with("0b") => (&t[2..], 2),
        t if t.starts_with(|c: char| c.is_ascii_digit()) => (t, 10),
        _ => return None,
    };
    let parsed = (!digits.is_empty())
        .then(|| u32::from_str_radix(digits, radix).ok())
        .flatten();
    Some(match parsed {
        Some(value) if value <= 255 => Ok(value as u16),
        Some(_) => Err(format!("{token} is out of range: operands are 0 to 255")),
        None => Err(format!("{token} is not a number")),
    })
}

/// Assembles `source` into ROM words, one per instruction from address 0.
/// Every error is reported, each with its line, not only the first.
pub fn assemble(source: &str) -> Result<Vec<u16>, Vec<Error>> {
    let mut errors = Vec::new();
    let mut labels: BTreeMap<&str, (u16, usize)> = BTreeMap::new();
    let mut lines = Vec::new();
    for (index, text) in source.lines().enumerate() {
        let number = index + 1;
        let code = text.split(';').next().unwrap_or("");
        let mut tokens: Vec<&str> = code.split_whitespace().collect();
        // Labels come first: `name:`, possibly with the instruction on the same line.
        while let Some(label) = tokens.first().and_then(|t| t.strip_suffix(':')) {
            tokens.remove(0);
            if !valid_label(label) {
                let message = format!(
                    "{label}: is not a label: names are letters, digits and _, not starting with a digit"
                );
                errors.push(Error {
                    line: number,
                    message,
                });
            } else if let Some(&(_, first)) = labels.get(label) {
                let message = format!("label {label} is already defined on line {first}");
                errors.push(Error {
                    line: number,
                    message,
                });
            } else {
                labels.insert(label, (lines.len() as u16, number));
            }
        }
        let Some((&mnemonic, operands)) = tokens.split_first() else {
            continue;
        };
        if lines.len() == MAX_WORDS {
            let message =
                format!("more than {MAX_WORDS} instructions: the program ROM holds {MAX_WORDS}");
            errors.push(Error {
                line: number,
                message,
            });
            break;
        }
        lines.push(Line {
            number,
            mnemonic,
            operands: operands.to_vec(),
        });
    }

    let mut words = Vec::with_capacity(lines.len());
    for line in &lines {
        let error = |message: String| Error {
            line: line.number,
            message,
        };
        let name = line.mnemonic.to_ascii_uppercase();
        let Some(&(name, opcode, takes)) = INSTRUCTIONS.iter().find(|(n, _, _)| *n == name) else {
            errors.push(error(format!("unknown instruction {}", line.mnemonic)));
            continue;
        };
        let operand = match (takes, line.operands.as_slice()) {
            (false, []) => 0,
            (false, _) => {
                errors.push(error(format!("{name} takes no operand")));
                continue;
            }
            (true, []) => {
                errors.push(error(format!("{name} needs an operand")));
                continue;
            }
            (true, [_, _, ..]) => {
                errors.push(error(format!("{name} takes one operand")));
                continue;
            }
            (true, [token]) => match number(token) {
                Some(Ok(value)) => value,
                Some(Err(message)) => {
                    errors.push(error(message));
                    continue;
                }
                None if valid_label(token) => match labels.get(token) {
                    Some(&(address, _)) => address,
                    None => {
                        errors.push(error(format!("unknown label {token}")));
                        continue;
                    }
                },
                None => {
                    errors.push(error(format!("{token} is not a number or a label")));
                    continue;
                }
            },
        };
        words.push(opcode << 12 | operand);
    }
    if errors.is_empty() {
        Ok(words)
    } else {
        errors.sort_by_key(|e| e.line);
        Err(errors)
    }
}

/// One ROM word as assembly. A word the assembler would not write (a reserved
/// opcode, reserved bits set, or an operand on an instruction without one)
/// shows what it executes as, with the raw word in a comment, so the text
/// assembles to a program that behaves the same.
pub fn disassemble(word: u16) -> String {
    let opcode = word >> 12;
    let operand = word & 0xFF;
    let (name, _, takes) = INSTRUCTIONS
        .iter()
        .copied()
        .find(|&(_, code, _)| code == opcode)
        .unwrap_or(("NOP", opcode, false));
    let text = if takes {
        format!("{name} {operand}")
    } else {
        name.to_string()
    };
    let exact = opcode <= 0xC && word & 0x0F00 == 0 && (takes || operand == 0);
    if exact {
        text
    } else {
        format!("{text} ; 0x{word:04X}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn errors(source: &str) -> Vec<(usize, String)> {
        assemble(source)
            .expect_err("errors")
            .into_iter()
            .map(|e| (e.line, e.message))
            .collect()
    }

    #[test]
    fn the_specification_examples_assemble() {
        let add = "        LDI 5\n        ADI 3\n        OUT\n        HLT\n";
        assert_eq!(assemble(add), Ok(vec![0x1005, 0x6003, 0xB000, 0xC000]));
        let countdown = "        LDI 10\nloop:   OUT\n        SBI 1\n        JZ done\n        JMP loop\ndone:   OUT\n        HLT\n";
        assert_eq!(
            assemble(countdown),
            Ok(vec![0x100A, 0xB000, 0x7001, 0x9005, 0x8001, 0xB000, 0xC000])
        );
    }

    #[test]
    fn every_instruction_encodes_its_opcode_and_operand() {
        for (name, opcode, takes) in INSTRUCTIONS {
            let source = if takes {
                format!("{name} 0xAB")
            } else {
                name.to_string()
            };
            let operand = if takes { 0xAB } else { 0 };
            assert_eq!(
                assemble(&source),
                Ok(vec![opcode << 12 | operand]),
                "{name}"
            );
        }
    }

    #[test]
    fn mnemonics_ignore_case_labels_do_not_and_numbers_take_three_bases() {
        let source = "start:\n  ldi 0b1010 ; ten\n  Jmp start\nStart: jz 0X0f\n  sta 255\n";
        assert_eq!(assemble(source), Ok(vec![0x100A, 0x8000, 0x900F, 0x30FF]));
        // A label stands for the address of the next instruction, on its own line or not.
        assert_eq!(
            assemble("a: b:\nc: NOP\nJMP b\nJMP c"),
            Ok(vec![0, 0x8000, 0x8000])
        );
        assert_eq!(assemble("; only a comment\n\n   \n"), Ok(vec![]));
    }

    #[test]
    fn every_error_is_reported_with_its_line() {
        let source = "LDX 1\nLDI\nOUT 3\nLDI 1 2\nLDI 256\nJMP nowhere\nx: NOP\nx: NOP\nLDI @\n9a: NOP\nLDI 0x\n";
        assert_eq!(
            errors(source),
            [
                (1, "unknown instruction LDX".to_string()),
                (2, "LDI needs an operand".to_string()),
                (3, "OUT takes no operand".to_string()),
                (4, "LDI takes one operand".to_string()),
                (5, "256 is out of range: operands are 0 to 255".to_string()),
                (6, "unknown label nowhere".to_string()),
                (8, "label x is already defined on line 7".to_string()),
                (9, "@ is not a number or a label".to_string()),
                (
                    10,
                    "9a: is not a label: names are letters, digits and _, not starting with a digit"
                        .to_string()
                ),
                (11, "0x is not a number".to_string()),
            ]
        );
    }

    #[test]
    fn a_program_holds_at_most_256_instructions() {
        assert_eq!(assemble(&"NOP\n".repeat(256)).map(|w| w.len()), Ok(256));
        assert_eq!(
            errors(&"NOP\n".repeat(257)),
            [(
                257,
                "more than 256 instructions: the program ROM holds 256".to_string()
            )]
        );
    }

    #[test]
    fn disassembly_assembles_back_to_the_same_behaviour() {
        assert_eq!(disassemble(0x1005), "LDI 5");
        assert_eq!(disassemble(0xB000), "OUT");
        // Not what the assembler writes: the raw word goes in a comment.
        assert_eq!(disassemble(0xD012), "NOP ; 0xD012");
        assert_eq!(disassemble(0x1305), "LDI 5 ; 0x1305");
        assert_eq!(disassemble(0xB007), "OUT ; 0xB007");
        // Every word disassembles to text that assembles; exact words come back unchanged.
        for word in 0..=u16::MAX {
            let back = assemble(&disassemble(word)).expect("assembles")[0];
            let exact = word >> 12 <= 0xC
                && word & 0x0F00 == 0
                && (INSTRUCTIONS[usize::from(word >> 12)].2 || word & 0xFF == 0);
            if exact {
                assert_eq!(back, word);
            } else {
                // The same opcode and operand where they mean something; a reserved opcode is a NOP.
                let opcode = if word >> 12 > 0xC { 0 } else { word >> 12 };
                assert_eq!(back >> 12, opcode, "{word:04X}");
            }
        }
    }
}
