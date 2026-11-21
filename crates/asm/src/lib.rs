//! Assembler and disassembler for the reference CPUs, as specified in
//! `docs/reference-cpu.md` (ADR 0019) and `docs/reference-cpu-2.md` (ADR
//! 0036). One language serves both: Reference CPU 2 runs every instruction
//! here, and the first runs the first thirteen and ignores the rest. It
//! turns text into ROM words and back; it simulates nothing.

use std::collections::BTreeMap;
use std::fmt;

/// Words a program may hold: the program ROM's size.
pub const MAX_WORDS: usize = 256;

/// Each instruction's mnemonic, its word with operand 0, and whether it
/// takes an operand, in word order. The first thirteen are the reference
/// CPU's, an opcode each in bits 15-12. The rest are Reference CPU 2's:
/// `JNZ` on opcode 0xD, and ten under opcode 0xF, told apart by bits 11-8.
/// Opcode 0xE and 0xFA to 0xFF are reserved and execute as `NOP`.
pub const INSTRUCTIONS: [(&str, u16, bool); 24] = [
    ("NOP", 0x0000, false),
    ("LDI", 0x1000, true),
    ("LDA", 0x2000, true),
    ("STA", 0x3000, true),
    ("ADD", 0x4000, true),
    ("SUB", 0x5000, true),
    ("ADI", 0x6000, true),
    ("SBI", 0x7000, true),
    ("JMP", 0x8000, true),
    ("JZ", 0x9000, true),
    ("JC", 0xA000, true),
    ("OUT", 0xB000, false),
    ("HLT", 0xC000, false),
    ("JNZ", 0xD000, true),
    ("AND", 0xF000, true),
    ("OR", 0xF100, true),
    ("XOR", 0xF200, true),
    ("ANI", 0xF300, true),
    ("ORI", 0xF400, true),
    ("XRI", 0xF500, true),
    ("SHL", 0xF600, false),
    ("SHR", 0xF700, false),
    ("CALL", 0xF800, true),
    ("RET", 0xF900, false),
];

/// The named instruction a word is on Reference CPU 2, if any (a reserved
/// word has none, and executes as `NOP`): by its opcode, and under opcode 0xF
/// by bits 11-8 as well.
fn instruction(word: u16) -> Option<(&'static str, u16, bool)> {
    let key = if word >> 12 == 0xF {
        word & 0xFF00
    } else {
        word & 0xF000
    };
    INSTRUCTIONS
        .iter()
        .copied()
        .find(|&(_, base, _)| base == key)
}

/// Whether only Reference CPU 2 runs this word: the first reference CPU
/// executes it as `NOP` (ADR 0036).
pub fn needs_cpu_2(word: u16) -> bool {
    instruction(word).is_some_and(|(_, base, _)| base >= 0xD000)
}

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
    if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
        return Some(Err(format!("{token} is not a number")));
    }
    Some(match u32::from_str_radix(digits, radix) {
        Ok(value) if value <= 255 => Ok(value as u16),
        _ => Err(format!("{token} is out of range: operands are 0 to 255")),
    })
}

/// Assembles `source` into ROM words, one per instruction from address 0.
/// Every error is reported, each with its line, not only the first.
pub fn assemble(source: &str) -> Result<Vec<u16>, Vec<Error>> {
    let mut errors = Vec::new();
    // Each label's address and the line it is defined on.
    let mut labels: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    let mut lines = Vec::new();
    for (index, text) in source.lines().enumerate() {
        let number = index + 1;
        let code = text.split(';').next().unwrap_or("");
        let mut tokens: Vec<&str> = code.split_whitespace().collect();
        // Labels come first: `name:`, possibly with the instruction on the same line.
        while let Some((label, rest)) = tokens.first().and_then(|t| t.split_once(':')) {
            if rest.is_empty() {
                tokens.remove(0);
            } else {
                tokens[0] = rest;
            }
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
                labels.insert(label, (lines.len(), number));
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
        let Some(&(name, base, takes)) = INSTRUCTIONS.iter().find(|(n, _, _)| *n == name) else {
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
                    // A label after the last instruction of a full ROM names address 256.
                    Some(&(address, _)) if address >= MAX_WORDS => {
                        errors.push(error(format!(
                            "label {token} is past the end of the program ROM"
                        )));
                        continue;
                    }
                    Some(&(address, _)) => address as u16,
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
        words.push(base | operand);
    }
    if errors.is_empty() {
        Ok(words)
    } else {
        errors.sort_by_key(|e| e.line);
        Err(errors)
    }
}

/// One ROM word as assembly: the instruction Reference CPU 2 executes it as,
/// whichever CPU the ROM feeds. A word the assembler would not write (a
/// reserved opcode, reserved bits set, or an operand on an instruction without
/// one) has the raw word in a comment. The text assembles to a program that
/// behaves the same on either CPU.
pub fn disassemble(word: u16) -> String {
    let operand = word & 0xFF;
    let Some((name, base, takes)) = instruction(word) else {
        return format!("NOP ; 0x{word:04X}");
    };
    let text = if takes {
        format!("{name} {operand}")
    } else {
        name.to_string()
    };
    // What the assembler writes for this text.
    if base | if takes { operand } else { 0 } == word {
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
        for (name, base, takes) in INSTRUCTIONS {
            let source = if takes {
                format!("{name} 0xAB")
            } else {
                name.to_string()
            };
            let operand = if takes { 0xAB } else { 0 };
            assert_eq!(assemble(&source), Ok(vec![base | operand]), "{name}");
        }
        // The first thirteen are an opcode each, in order; the rest are Reference CPU 2's alone.
        for (i, (name, base, _)) in INSTRUCTIONS.into_iter().enumerate() {
            assert_eq!(needs_cpu_2(base), i >= 13, "{name}");
            if i < 13 {
                assert_eq!(usize::from(base), i << 12, "{name}");
            }
        }
        assert!(
            !needs_cpu_2(0xE000) && !needs_cpu_2(0xFA00),
            "reserved on both"
        );
        assert!(
            needs_cpu_2(0xD712) && needs_cpu_2(0xF9FF),
            "whatever the ignored bits hold"
        );
    }

    #[test]
    fn the_second_cpus_words_are_as_its_page_gives_them() {
        // docs/reference-cpu-2.md's table, word for word.
        assert_eq!(
            assemble("JNZ 1\nAND 1\nOR 1\nXOR 1\nANI 1\nORI 1\nXRI 1\nSHL\nSHR\nCALL 1\nRET"),
            Ok(vec![
                0xD001, 0xF001, 0xF101, 0xF201, 0xF301, 0xF401, 0xF501, 0xF600, 0xF700, 0xF801,
                0xF900
            ])
        );
    }

    #[test]
    fn the_second_cpus_examples_assemble() {
        // docs/reference-cpu-2.md: a routine that doubles A, called twice.
        let twice = "        LDI 5\n        CALL twice\n        CALL twice\n        OUT\n        HLT\ntwice:  SHL\n        RET\n";
        assert_eq!(
            assemble(twice),
            Ok(vec![0x1005, 0xF805, 0xF805, 0xB000, 0xC000, 0xF600, 0xF900])
        );
        let pixel = "LDI 25\nSTA 0xFE\nLDA 0xFD\nORI 0b00100000\nSTA 0xFD\nHLT";
        assert_eq!(
            assemble(pixel),
            Ok(vec![0x1019, 0x30FE, 0x20FD, 0xF420, 0x30FD, 0xC000])
        );
        assert_eq!(
            errors("SHL 3\nRET 1\nCALL\nJNZ"),
            [
                (1, "SHL takes no operand".to_string()),
                (2, "RET takes no operand".to_string()),
                (3, "CALL needs an operand".to_string()),
                (4, "JNZ needs an operand".to_string()),
            ]
        );
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
    fn numbers_take_only_digits_of_their_base_and_labels_may_touch_their_instruction() {
        assert_eq!(
            errors("LDI 0x+5\nLDI 0b+1"),
            [
                (1, "0x+5 is not a number".to_string()),
                (2, "0b+1 is not a number".to_string()),
            ]
        );
        assert_eq!(
            errors("LDI 99999999999"),
            [(
                1,
                "99999999999 is out of range: operands are 0 to 255".to_string()
            )]
        );
        assert_eq!(assemble("loop:OUT\na:b:JMP loop"), Ok(vec![0xB000, 0x8000]));
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
        // A label after a full ROM's last instruction would be address 256, outside the operand.
        let full = format!("JMP end\n{}end:\n", "NOP\n".repeat(255));
        assert_eq!(
            errors(&full),
            [(
                1,
                "label end is past the end of the program ROM".to_string()
            )]
        );
        // Past the limit every line is still read: later errors are reported, later labels known.
        let over = format!("JMP end\n{}end: HLT\nLDX\n", "NOP\n".repeat(256));
        assert_eq!(
            errors(&over),
            [
                (
                    1,
                    "label end is past the end of the program ROM".to_string()
                ),
                (
                    257,
                    "more than 256 instructions: the program ROM holds 256".to_string()
                ),
                (259, "unknown instruction LDX".to_string()),
            ]
        );
    }

    #[test]
    fn disassembly_assembles_back_to_the_same_behaviour() {
        assert_eq!(disassemble(0x1005), "LDI 5");
        assert_eq!(disassemble(0xB000), "OUT");
        // Reference CPU 2's words read as its instructions (ADR 0036), on whichever CPU the ROM is.
        assert_eq!(disassemble(0xD012), "JNZ 18");
        assert_eq!(disassemble(0xF420), "ORI 32");
        assert_eq!(disassemble(0xF600), "SHL");
        // Not what the assembler writes: the raw word goes in a comment.
        assert_eq!(disassemble(0xD123), "JNZ 35 ; 0xD123");
        assert_eq!(disassemble(0xF612), "SHL ; 0xF612");
        assert_eq!(disassemble(0xE012), "NOP ; 0xE012");
        assert_eq!(disassemble(0xFA00), "NOP ; 0xFA00");
        assert_eq!(disassemble(0x1305), "LDI 5 ; 0x1305");
        assert_eq!(disassemble(0xB007), "OUT ; 0xB007");
        // Every word disassembles to text that assembles to one word with the same effect on either CPU: its
        // instruction (a reserved word runs as NOP) and, where that takes one, its operand. The bits an
        // instruction ignores (11-8 outside opcode 0xF, 7-0 where there is no operand) come back as 0.
        for word in 0..=u16::MAX {
            // From the two pages, not from this crate's table: which bits each word's instruction uses.
            let expected = match word >> 12 {
                // NOP, OUT, HLT: no operand.
                0x0 | 0xB | 0xC => word & 0xF000,
                // Reserved on both CPUs.
                0xE => 0,
                0xF => match (word >> 8) & 0xF {
                    // AND, OR, XOR, ANI, ORI, XRI, CALL: the operand.
                    0x0..=0x5 | 0x8 => word,
                    // SHL, SHR, RET: no operand.
                    0x6 | 0x7 | 0x9 => word & 0xFF00,
                    _ => 0,
                },
                // Every other opcode takes an operand, and ignores bits 11-8.
                _ => word & 0xF0FF,
            };
            assert_eq!(
                assemble(&disassemble(word)),
                Ok(vec![expected]),
                "{word:04X}"
            );
            assert_eq!(needs_cpu_2(word), needs_cpu_2(expected), "{word:04X}");
        }
    }
}
