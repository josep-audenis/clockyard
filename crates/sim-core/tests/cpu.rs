//! The reference CPU (ADR 0019) against its specification, `docs/reference-cpu.md`.
//!
//! `Model` below is written from that page alone and lives only here, as the
//! independent reference. Each test loads `examples/reference-cpu.clockyard.json`
//! with a program in its ROM, runs the netlist two cycles at a time, and after
//! every instruction compares its registers and RAM with the model's.

mod common;

use common::{description, example, value};
use serde_json::{Value, json};
use sim_core::Simulator;

/// The machine state the specification defines, after each whole instruction.
#[derive(Clone, Debug, PartialEq, Eq)]
struct State {
    pc: u8,
    a: u8,
    out: u8,
    z: bool,
    c: bool,
    h: bool,
    ram: Vec<u8>,
}

/// The specification as code: one call is one instruction (two cycles).
struct Model {
    rom: Vec<u16>,
    state: State,
}

impl Model {
    fn new(program: &[u16]) -> Model {
        Model {
            rom: program.to_vec(),
            state: State {
                pc: 0,
                a: 0,
                out: 0,
                z: false,
                c: false,
                h: false,
                ram: vec![0; 256],
            },
        }
    }

    fn step(&mut self) {
        let s = &mut self.state;
        if s.h {
            return;
        }
        let word = self.rom.get(usize::from(s.pc)).copied().unwrap_or(0);
        s.pc = s.pc.wrapping_add(1);
        let n = (word & 0xFF) as u8;
        let load = |s: &mut State, value: u8| {
            s.a = value;
            s.z = value == 0;
        };
        let add = |s: &mut State, b: u8| {
            let sum = u16::from(s.a) + u16::from(b);
            s.c = sum > 0xFF;
            load(s, sum as u8);
        };
        let sub = |s: &mut State, b: u8| {
            s.c = s.a >= b;
            load(s, s.a.wrapping_sub(b));
        };
        match word >> 12 {
            0x1 => load(s, n),
            0x2 => load(s, s.ram[usize::from(n)]),
            0x3 => s.ram[usize::from(n)] = s.a,
            0x4 => add(s, s.ram[usize::from(n)]),
            0x5 => sub(s, s.ram[usize::from(n)]),
            0x6 => add(s, n),
            0x7 => sub(s, n),
            0x8 => s.pc = n,
            0x9 if s.z => s.pc = n,
            0xA if s.c => s.pc = n,
            0xB => s.out = s.a,
            0xC => s.h = true,
            _ => {}
        }
    }
}

/// The example circuit with `program` in its ROM, loaded without warnings.
fn cpu(text: &str, program: &[u16]) -> Simulator {
    let mut document: Value = serde_json::from_str(text).expect("valid project file");
    let rom = document["circuit"]["components"]
        .as_array_mut()
        .expect("components")
        .iter_mut()
        .find(|c| c["id"] == "rom")
        .expect("the program ROM");
    rom["props"]["data"] = json!(program);
    let (sim, warnings) =
        Simulator::load(&description(&document.to_string())).expect("valid circuit");
    assert_eq!(warnings, vec![], "the CPU loads without warnings");
    sim
}

/// The state as the netlist holds it: each register's flip-flop, by elaborated ID.
fn read(sim: &Simulator) -> State {
    let register = |id: &str| value(sim, &format!("{id}/r"), "q");
    State {
        pc: register("pc") as u8,
        a: register("a") as u8,
        out: register("outr") as u8,
        z: register("z") == 1,
        c: register("c") == 1,
        h: register("h") == 1,
        ram: sim
            .memory("ram")
            .expect("the data RAM")
            .iter()
            .map(|&w| w as u8)
            .collect(),
    }
}

/// Runs `program` for up to `limit` instructions, or until it halts, checking the
/// netlist against the model after each one. Returns the final state.
fn check(text: &str, program: &[u16], limit: usize) -> State {
    let mut sim = cpu(text, program);
    let mut model = Model::new(program);
    assert_eq!(read(&sim), model.state, "after reset");
    for k in 1..=limit {
        for _ in 0..2 {
            assert_eq!(sim.step_cycle(), None, "settles");
        }
        let halted = model.state.h;
        model.step();
        assert_eq!(
            read(&sim),
            model.state,
            "after {k} instructions of {program:04X?}"
        );
        if halted {
            break;
        }
    }
    model.state
}

fn assemble(source: &str) -> Vec<u16> {
    asm::assemble(source).expect("assembles")
}

#[test]
fn the_specification_examples_run_as_specified() {
    let text = example("reference-cpu");
    let add = check(&text, &assemble("LDI 5\nADI 3\nOUT\nHLT"), 10);
    assert_eq!((add.out, add.h), (8, true));
    let countdown = "        LDI 10\nloop:   OUT\n        SBI 1\n        JZ done\n        JMP loop\ndone:   OUT\n        HLT\n";
    let end = check(&text, &assemble(countdown), 100);
    assert_eq!((end.out, end.a, end.h), (0, 0, true));
}

#[test]
fn every_instruction_and_flag_case_runs_as_specified() {
    let text = example("reference-cpu");
    let programs = [
        // Loads, stores and Z.
        "LDI 0\nLDI 7\nSTA 3\nLDI 0\nLDA 3\nSTA 255\nLDA 4\nOUT\nHLT",
        // Additions with and without carry; C kept by loads.
        "LDI 200\nADI 55\nADI 1\nLDI 3\nADI 4\nSTA 0\nADD 0\nLDI 250\nSTA 1\nADD 1\nOUT\nHLT",
        // Subtractions: borrow or not, a result of 0.
        "LDI 5\nSBI 5\nSBI 1\nLDI 9\nSTA 2\nLDI 4\nSUB 2\nLDI 20\nSUB 2\nOUT\nHLT",
        // Jumps taken and not taken.
        "LDI 1\nJZ 9\nSBI 1\nJZ 5\nHLT\nJC 7\nHLT\nJMP 8\nHLT\nNOP\nOUT\nHLT",
        // A jump to itself until a carry: the PC holds while looping.
        "LDI 250\nloop: ADI 1\nJC end\nJMP loop\nend: OUT\nHLT",
        // Reserved opcodes and bits run as NOP; HLT stops everything after it.
        "LDI 3\nNOP\nHLT\nLDI 9\nOUT",
    ];
    for source in programs {
        let mut words = assemble(source);
        // Reserved opcodes and set reserved bits, appended after the HLT where they must not run.
        words.extend([0xD123, 0x1F05, 0xB0FF]);
        check(&text, &words, 64);
    }
    // The same reserved words where they do run: as NOP, and as LDI and OUT with bits 11-8 ignored.
    let state = check(&text, &[0xD123, 0x1F05, 0xB0FF, 0xC000], 10);
    assert_eq!((state.a, state.out, state.h), (5, 5, true));
}

#[test]
fn random_programs_run_as_specified() {
    let text = example("reference-cpu");
    // xorshift64: a fixed seed, so every run checks the same programs.
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for _ in 0..200 {
        // 256 raw words, reserved opcodes and bits included; HLT is as likely as any opcode.
        let program: Vec<u16> = (0..256).map(|_| next() as u16).collect();
        check(&text, &program, 64);
    }
}
