//! The reference CPU (ADR 0019) against its specification, `docs/reference-cpu.md`.
//!
//! `Model` below is written from that page alone and lives only here, as the
//! independent reference. Each test loads `examples/reference-cpu.clockyard.json`
//! with a program in its ROM, runs the netlist one cycle at a time, and after
//! every cycle compares what the sheet shows (its register LEDs, the status
//! LEDs, the phase, the RAM and the I/O devices) with the model's state.
//! The keyboard is an input both are given, cycle by cycle (ADR 0022).

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
    sptr: u8,
    hex: u8,
    screen: Vec<u8>,
}

impl State {
    /// `RAM[n]` as a load sees it (I/O section): RAM up to 0xEF, devices above.
    fn data(&self, n: u8, key: u8) -> u8 {
        match n {
            0xFF => key,
            0xFE => self.sptr,
            0xFD => self.screen[usize::from(self.sptr)],
            0xFC => self.hex,
            0xF0..=0xFB => 0,
            _ => self.ram[usize::from(n)],
        }
    }

    /// `RAM[n] ← value` as a store does it.
    fn store(&mut self, n: u8, value: u8) {
        match n {
            0xFE => self.sptr = value,
            0xFD => self.screen[usize::from(self.sptr)] = value,
            0xFC => self.hex = value,
            0xF0..=0xFF => {}
            _ => self.ram[usize::from(n)] = value,
        }
    }
}

/// The specification as code: one call is one clock cycle (Timing section).
struct Model {
    rom: Vec<u16>,
    state: State,
    /// The key held during the next cycle.
    key: u8,
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
                sptr: 0,
                hex: 0,
                screen: vec![0; 256],
            },
            key: 0,
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
        let data = s.data(n, self.key);
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
            0x2 => load(s, data),
            0x3 => s.store(n, s.a),
            0x4 => add(s, data),
            0x5 => sub(s, data),
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

/// Seven-segment patterns of the hex digits (segment a on bit 0), as the specification shows them.
const HEX_DIGITS: [u32; 16] = [
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71,
];

/// What the sheet shows: its LEDs (stable top-level IDs, so this also checks the display wiring),
/// the phase register's flip-flop, the data RAM, the I/O registers and the screen. The Fetch LED
/// must agree with T and H, and the two digits with HEX.
fn read(sim: &Simulator) -> State {
    let led = |id: &str| {
        assert!(sim.port_nets().contains_key(id), "the sheet has {id}");
        value(sim, id, "in")
    };
    let t = value(sim, "t/r", "q") == 1;
    let h = led("haltled") == 1;
    assert_eq!(led("fetchled") == 1, !t && !h, "Fetch = ¬T ∧ ¬H");
    let hex = value(sim, "hex/r", "q");
    let digits = (value(sim, "hexhigh", "seg"), value(sim, "hexlow", "seg"));
    let shown = (
        HEX_DIGITS[(hex >> 4) as usize],
        HEX_DIGITS[(hex & 0xF) as usize],
    );
    assert_eq!(digits, shown, "the digits show HEX {hex:02X}");
    let bytes = |id: &str| -> Vec<u8> {
        let words = sim
            .memory(id)
            .unwrap_or_else(|| panic!("the sheet has {id}"));
        words.iter().map(|&w| w as u8).collect()
    };
    State {
        pc: led("pcled") as u8,
        ir: led("irled") as u16,
        a: led("aled") as u8,
        out: led("outled") as u8,
        z: led("zled") == 1,
        c: led("cled") == 1,
        t,
        h,
        ram: bytes("ram"),
        sptr: value(sim, "sptr/r", "q") as u8,
        hex: hex as u8,
        screen: bytes("screen"),
    }
}

/// Runs `program` for up to `limit` instructions, or until it halts and three more cycles pass,
/// checking the netlist against the model after every cycle. Returns the final state.
fn check(text: &str, program: &[u16], limit: usize) -> State {
    check_keys(text, program, limit, |_| 0)
}

/// As `check`, with `keys(cycle)` held on the keyboard during each cycle (from 1).
fn check_keys(text: &str, program: &[u16], limit: usize, keys: impl Fn(usize) -> u8) -> State {
    let mut sim = cpu(text, program);
    let mut model = Model::new(program);
    assert_eq!(read(&sim), model.state, "after reset");
    let mut after_halt = 0;
    for cycle in 1..=2 * limit {
        model.key = keys(cycle);
        sim.set_input("key", u32::from(model.key))
            .expect("the keyboard");
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
    for i in 0..200u64 {
        // 256 raw words, reserved opcodes and bits included. Operands: any value in even programs;
        // 0x00-0x0F when i % 4 == 1, so stores and loads meet the same RAM bytes and jumps stay near
        // the start; 0xF0-0xFF when i % 4 == 3, so the devices are met often.
        let window = if i % 2 == 0 { 0xFFFF } else { 0xF00F };
        let io = if i % 4 == 3 { 0x00F0 } else { 0 };
        let program: Vec<u16> = (0..256).map(|_| (next() as u16 & window) | io).collect();
        // A key code that changes every few cycles, from a hash of the cycle and the program.
        let keys =
            move |cycle: usize| ((cycle as u64 / 3 + i).wrapping_mul(0x9E37_79B9) >> 8) as u8;
        check_keys(&text, &program, 64, keys);
    }
}

#[test]
fn io_devices_run_as_specified() {
    let text = example("reference-cpu");
    let programs = [
        // Every device written and read back; ADD and SUB read devices too.
        "LDI 0x2A\nSTA 0xFC\nLDI 7\nSTA 0xFE\nLDI 0x81\nSTA 0xFD\nLDI 0\nLDA 0xFC\nOUT\nLDA 0xFE\nOUT\nLDA 0xFD\nOUT\nADD 0xFD\nSUB 0xFC\nOUT\nHLT",
        // The pointer moves; each byte keeps its value; a load from SDATA follows the pointer.
        "LDI 255\nSTA 0xFE\nSTA 0xFD\nLDI 0\nSTA 0xFE\nLDI 1\nSTA 0xFD\nLDI 255\nSTA 0xFE\nLDA 0xFD\nOUT\nHLT",
        // Stores to KEY and the reserved addresses change nothing; loads from them read 0, and RAM is untouched.
        "LDI 9\nSTA 0xFF\nSTA 0xF0\nSTA 0xFB\nSTA 0xEF\nLDA 0xF0\nOUT\nLDA 0xFB\nADD 0xEF\nOUT\nHLT",
        // A device store just before HLT lands.
        "LDI 3\nSTA 0xFC\nHLT",
    ];
    let states: Vec<State> = programs
        .iter()
        .map(|source| {
            let state = check(&text, &assemble(source), 64);
            assert!(state.h, "{source} halts");
            state
        })
        .collect();
    let s = &states[0];
    assert_eq!((s.hex, s.sptr, s.screen[7], s.out), (0x2A, 7, 0x81, 0xD8));
    let s = &states[1];
    assert_eq!((s.screen[255], s.screen[0], s.out), (255, 1, 255));
    let s = &states[2];
    assert_eq!((s.out, s.ram[0xEF], s.ram[0xF0], s.ram[0xFF]), (9, 9, 0, 0));
    assert_eq!(states[3].hex, 3);
}

/// docs/reference-cpu.md, "draw the key held".
const KEY_PROGRAM: &str =
    "loop: LDA 0xFF\nJZ loop\nSTA 0xFC\nSTA 0xFE\nLDI 0xFF\nSTA 0xFD\nJMP loop";

#[test]
fn the_key_program_draws_the_key_held() {
    // Nothing until a key, then its code on the digits and eight pixels at its byte. 'A' is held
    // from cycle 20 to 39, then nothing, then '0'.
    let text = example("reference-cpu");
    let keys = |cycle: usize| match cycle {
        20..40 => b'A',
        60..80 => b'0',
        _ => 0,
    };
    let state = check_keys(&text, &assemble(KEY_PROGRAM), 60, keys);
    assert_eq!((state.hex, state.sptr), (b'0', b'0'));
    assert_eq!((state.screen[0x41], state.screen[0x30]), (0xFF, 0xFF));
    assert_eq!(state.screen.iter().filter(|&&b| b != 0).count(), 2);
}

#[test]
fn reset_clears_the_devices() {
    // Reset (Machine section): SPTR, HEX and every screen byte back to 0, as at load.
    let text = example("reference-cpu");
    let program = assemble(KEY_PROGRAM);
    let mut sim = cpu(&text, &program);
    sim.set_input("key", u32::from(b'A')).expect("the keyboard");
    for _ in 0..40 {
        assert_eq!(sim.step_cycle(), None, "settles");
    }
    let drawn = read(&sim);
    assert_eq!(
        (drawn.hex, drawn.sptr, drawn.screen[0x41]),
        (b'A', b'A', 0xFF)
    );
    assert_eq!(sim.reset(), None, "settles");
    assert_eq!(read(&sim), Model::new(&program).state);
}

#[test]
fn the_shipped_program_is_the_key_program_and_draws_the_key_held() {
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
    assert_eq!(data, assemble(KEY_PROGRAM));
    // The file as shipped, not a copy with the ROM replaced: 'A' held shows 41 and lights byte 0x41.
    let (mut sim, _) = Simulator::load(&description(&text)).expect("valid circuit");
    sim.set_input("key", u32::from(b'A')).expect("the keyboard");
    for _ in 0..20 {
        assert_eq!(sim.step_cycle(), None, "settles");
    }
    let digits = (value(&sim, "hexhigh", "seg"), value(&sim, "hexlow", "seg"));
    assert_eq!(digits, (HEX_DIGITS[4], HEX_DIGITS[1]));
    assert_eq!(sim.memory("screen").expect("the screen")[0x41], 0xFF);
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

/// scripts/catch.asm, the game of ADR 0023 (rules: docs/reference-cpu.md, "Catch").
const CATCH: &str = include_str!("../../../scripts/catch.asm");
const LEFT: u8 = 0x82;
const RIGHT: u8 = 0x83;
const BLOCK: u8 = 0x3C;

/// The screen's lit bytes, by address.
fn lit(state: &State) -> Vec<(usize, u8)> {
    (0..256)
        .filter(|&i| state.screen[i] != 0)
        .map(|i| (i, state.screen[i]))
        .collect()
}

#[test]
fn catch_scores_the_first_block_speeds_up_and_halts_on_a_miss() {
    // No keys: the first block falls in the paddle's lane 3 and is caught; the second, in lane
    // 3 + 5 - 8 = 0, is missed and left where it landed.
    let program = assemble(CATCH);
    assert!(
        program.len() <= 256,
        "fits the ROM: {} words",
        program.len()
    );
    let state = check(&example("reference-cpu"), &program, 100_000);
    assert!(state.h, "halts");
    assert_eq!(state.hex, 1, "one point");
    assert_eq!(state.ram[3], 100 - 8, "the second block fell faster");
    assert_eq!(lit(&state), [(248, BLOCK), (251, 0xFF)]);
}

#[test]
fn the_catch_paddle_stops_at_both_edges() {
    // Held from the start, an arrow moves the paddle a lane per step until the edge; the first
    // block, in lane 3, is then missed.
    let text = example("reference-cpu");
    let program = assemble(CATCH);
    for (key, lane) in [(LEFT, 0), (RIGHT, 7)] {
        let state = check_keys(&text, &program, 100_000, |_| key);
        assert!(state.h, "halts");
        assert_eq!((state.ram[0], state.hex), (lane, 0));
        let mut shown = vec![(248 + usize::from(lane), 0xFF), (251, BLOCK)];
        shown.sort();
        assert_eq!(lit(&state), shown);
    }
}

#[test]
fn moving_the_paddle_catches_a_block_in_another_lane() {
    // Left held from the first catch on: the paddle reaches lane 0 for the second block, then
    // stays there while the third falls in lane 5.
    let program = assemble(CATCH);
    let mut model = Model::new(&program);
    let mut first = 0;
    while model.state.ram[4] == 0 {
        model.cycle();
        first += 1;
    }
    let keys = |cycle: usize| if cycle > first { LEFT } else { 0 };
    let state = check_keys(&example("reference-cpu"), &program, 100_000, keys);
    assert!(state.h, "halts");
    assert_eq!((state.hex, state.ram[0], state.ram[3]), (2, 0, 100 - 16));
    assert_eq!(lit(&state), [(248, 0xFF), (253, BLOCK)]);
}

#[test]
fn reset_starts_catch_again() {
    // The circuit alone: a game to its end, Reset, and the same game again.
    let text = example("reference-cpu");
    let program = assemble(CATCH);
    let mut sim = cpu(&text, &program);
    let play = |sim: &mut Simulator| {
        while !read(sim).h {
            assert_eq!(sim.step_cycle(), None, "settles");
        }
        (sim.time(), read(sim))
    };
    let first = play(&mut sim);
    assert_eq!(sim.reset(), None, "settles");
    assert_eq!(read(&sim), Model::new(&program).state);
    let second = play(&mut sim);
    assert_eq!(second.1, first.1);
    assert_eq!(second.0, first.0, "as many cycles");
}
