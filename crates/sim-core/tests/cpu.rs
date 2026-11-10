//! The reference CPU (ADR 0019) against its specification, `docs/reference-cpu.md`.
//!
//! `Model` below is written from that page alone and lives only here, as the
//! independent reference. Each test loads `examples/reference-cpu.clockyard.json`
//! with a program in its ROM, runs the netlist one cycle at a time, and after
//! every cycle compares what the sheet shows (its register LEDs, the status
//! LEDs, the phase and the RAM) with the model's state.

mod common;

use common::{description, example, value};
use serde_json::{Value, json};
use sim_core::Simulator;

/// The machine state the specification defines.
#[derive(Clone, Debug, PartialEq, Eq)]
struct State {
    pc: u8,
    ir: u16,
    a: u8,
    out: u8,
    z: bool,
    c: bool,
    t: bool,
    h: bool,
    ram: Vec<u8>,
}

/// The specification as code: one call is one clock cycle (Timing section).
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
                ir: 0,
                a: 0,
                out: 0,
                z: false,
                c: false,
                t: false,
                h: false,
                ram: vec![0; 256],
            },
        }
    }

    fn cycle(&mut self) {
        let s = &mut self.state;
        if s.h {
            return;
        }
        if !s.t {
            // Fetch.
            s.ir = self.rom.get(usize::from(s.pc)).copied().unwrap_or(0);
            s.pc = s.pc.wrapping_add(1);
            s.t = true;
            return;
        }
        // Execute.
        s.t = false;
        let n = (s.ir & 0xFF) as u8;
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
        match s.ir >> 12 {
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

/// What the sheet shows: its LEDs (stable top-level IDs, so this also checks the display wiring),
/// the phase register's flip-flop, and the data RAM. The Fetch LED must agree with T and H.
fn read(sim: &Simulator) -> State {
    let led = |id: &str| {
        assert!(sim.port_nets().contains_key(id), "the sheet has {id}");
        value(sim, id, "in")
    };
    let t = value(sim, "t/r", "q") == 1;
    let h = led("haltled") == 1;
    assert_eq!(led("fetchled") == 1, !t && !h, "Fetch = ¬T ∧ ¬H");
    State {
        pc: led("pcled") as u8,
        ir: led("irled") as u16,
        a: led("aled") as u8,
        out: led("outled") as u8,
        z: led("zled") == 1,
        c: led("cled") == 1,
        t,
        h,
        ram: sim
            .memory("ram")
            .expect("the data RAM")
            .iter()
            .map(|&w| w as u8)
            .collect(),
    }
}

/// Runs `program` for up to `limit` instructions, or until it halts and three more cycles pass,
/// checking the netlist against the model after every cycle. Returns the final state.
fn check(text: &str, program: &[u16], limit: usize) -> State {
    let mut sim = cpu(text, program);
    let mut model = Model::new(program);
    assert_eq!(read(&sim), model.state, "after reset");
    let mut after_halt = 0;
    for cycle in 1..=2 * limit {
        assert_eq!(sim.step_cycle(), None, "settles");
        model.cycle();
        assert_eq!(
            read(&sim),
            model.state,
            "after cycle {cycle} of {program:04X?}"
        );
        if model.state.h {
            after_halt += 1;
            if after_halt > 3 {
                break;
            }
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
        // A loop that adds until a carry, then jumps out.
        "LDI 250\nloop: ADI 1\nJC end\nJMP loop\nend: OUT\nHLT",
        // Reserved opcodes and bits run as NOP; HLT stops everything after it.
        "LDI 3\nNOP\nHLT\nLDI 9\nOUT",
    ];
    for source in programs {
        let mut words = assemble(source);
        // Reserved opcodes and set reserved bits, appended after the HLT where they must not run.
        words.extend([0xD123, 0x1F05, 0xB0FF]);
        assert!(check(&text, &words, 64).h, "{source} halts");
    }
    // The same reserved words where they do run: as NOP, and as LDI and OUT with bits 11-8 ignored.
    let state = check(&text, &[0xD123, 0x1F05, 0xB0FF, 0xC000], 10);
    assert_eq!((state.a, state.out, state.h), (5, 5, true));
    // The PC wraps from 255 to 0: 255 NOPs, then an OUT at 255, and the LDI at 0 runs again.
    let mut wrap = vec![0x1009];
    wrap.resize(255, 0);
    wrap.push(0xB000);
    let state = check(&text, &wrap, 258);
    assert_eq!((state.pc, state.out), (2, 9));
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
    for i in 0..200 {
        // 256 raw words, reserved opcodes and bits included. In half the programs operands stay
        // within 0-15, so stores and loads meet the same RAM bytes and jumps stay near the start.
        let window = if i % 2 == 0 { 0xFFFF } else { 0xF00F };
        let program: Vec<u16> = (0..256).map(|_| next() as u16 & window).collect();
        check(&text, &program, 64);
    }
}

#[test]
fn the_shipped_program_is_its_source_and_shows_8_after_eight_steps() {
    let text = example("reference-cpu");
    let document: Value = serde_json::from_str(&text).expect("valid project file");
    let rom = document["circuit"]["components"]
        .as_array()
        .expect("components")
        .iter()
        .find(|c| c["id"] == "rom")
        .expect("the program ROM");
    let source = rom["props"]["source"].as_str().expect("source");
    let data: Vec<u16> =
        serde_json::from_value(rom["props"]["data"].clone()).expect("the ROM's words");
    assert_eq!(assemble(source), data);
    let (mut sim, _) = Simulator::load(&description(&text)).expect("valid circuit");
    for _ in 0..8 {
        sim.step_cycle();
    }
    assert_eq!(
        (value(&sim, "outled", "in"), value(&sim, "haltled", "in")),
        (8, 1)
    );
}

#[test]
fn run_until_stops_where_the_specification_says_and_never_depends_on_how_the_run_is_split() {
    let text = example("reference-cpu");
    let program = assemble("LDI 5\nADI 3\nOUT\nHLT");
    let mut sim = cpu(&text, &program);
    let net = |sim: &Simulator, id: &str| sim.port_nets()[id]["in"];
    let fetch = net(&sim, "fetchled");
    // Fetch is lit at reset, so it must go dark and light again: one instruction, stopping with the
    // clock high as the next fetch begins (ADR 0019 item 6).
    let first = sim.tick_until(100, fetch);
    assert_eq!((first.ticks, first.rose, sim.time()), (3, true, 3));
    let second = sim.tick_until(100, fetch);
    assert_eq!((second.ticks, second.rose, sim.time()), (4, true, 7));
    // Run until Halted ends the program: HLT executes on the eighth rising edge.
    let halted = sim.tick_until(100, net(&sim, "haltled"));
    assert_eq!((halted.rose, sim.time()), (true, 15));
    assert_eq!(value(&sim, "outled", "in"), 8);
    // Once halted, Fetch never rises: the run goes on until its count runs out.
    let never = sim.tick_until(10, fetch);
    assert_eq!((never.ticks, never.rose), (10, false));
    // The same run split into calls of any size stops at the same tick: Fetch, lit at the start, and
    // Halted, dark at the start.
    for size in [1, 2, 3] {
        let mut split = cpu(&text, &program);
        let fetch = net(&split, "fetchled");
        while !split.tick_until(size, fetch).rose {}
        assert_eq!(split.time(), 3, "Fetch in calls of {size} ticks");
    }
    for size in [1, 2, 3, 5] {
        let mut split = cpu(&text, &program);
        let halt = net(&split, "haltled");
        while !split.tick_until(size, halt).rose {}
        assert_eq!(split.time(), 15, "calls of {size} ticks");
    }
}
