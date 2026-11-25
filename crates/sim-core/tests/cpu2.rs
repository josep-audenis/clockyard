//! Reference CPU 2 (ADR 0036) against its specification: `docs/reference-cpu-2.md`,
//! read with `docs/reference-cpu.md`, which it adds to.
//!
//! `Model` below is written from those two pages, apart from the first CPU's model in
//! `cpu.rs`: no code is shared, though its part for the first CPU's thirteen
//! instructions mirrors that model's, since the pages agree there. It is the
//! independent reference. Every test runs its program
//! on the model and on `examples/reference-cpu-2.clockyard.json` together, one clock
//! cycle at a time, and after every cycle compares what the sheet shows (its register
//! LEDs, the phase, the stack and its pointer, the RAM and the devices) with the
//! model's state. The results the tests assert were worked out by hand from the pages.

mod common;

use common::{description, example, value};
use serde_json::{Value, json};
use sim_core::Simulator;

/// The machine state the two pages define.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub pc: u8,
    pub ir: u16,
    pub a: u8,
    pub out: u8,
    pub z: bool,
    pub c: bool,
    pub t: bool,
    pub h: bool,
    /// The stack pointer, 4 bits.
    pub sp: u8,
    pub stack: [u8; 16],
    pub ram: Vec<u8>,
    pub sptr: u8,
    pub hex: u8,
    pub screen: Vec<u8>,
}

impl State {
    /// `RAM[n]` as a load sees it: RAM up to 0xEF, devices above.
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

/// The specification as code: one call to `cycle` is one clock cycle.
pub struct Model {
    rom: Vec<u16>,
    pub state: State,
    /// The key held during the next cycle.
    pub key: u8,
}

impl Model {
    pub fn new(program: &[u16]) -> Model {
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
                sp: 0,
                stack: [0; 16],
                ram: vec![0; 256],
                sptr: 0,
                hex: 0,
                screen: vec![0; 256],
            },
            key: 0,
        }
    }

    pub fn cycle(&mut self) {
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
        // "Set": Z from the new A.
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
            // The reference CPU's thirteen.
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
            // Reference CPU 2's: JNZ, and ten under 0xF told apart by bits 11-8.
            0xD if !s.z => s.pc = n,
            0xF => match (s.ir >> 8) & 0xF {
                0x0 => load(s, s.a & data),
                0x1 => load(s, s.a | data),
                0x2 => load(s, s.a ^ data),
                0x3 => load(s, s.a & n),
                0x4 => load(s, s.a | n),
                0x5 => load(s, s.a ^ n),
                0x6 => {
                    s.c = s.a & 0x80 != 0;
                    load(s, s.a << 1);
                }
                0x7 => {
                    s.c = s.a & 1 != 0;
                    load(s, s.a >> 1);
                }
                0x8 => {
                    // The PC is already the address after the CALL; SP as it was.
                    s.stack[usize::from(s.sp)] = s.pc;
                    s.sp = (s.sp + 1) & 0xF;
                    s.pc = n;
                }
                0x9 => {
                    s.sp = s.sp.wrapping_sub(1) & 0xF;
                    s.pc = s.stack[usize::from(s.sp)];
                }
                _ => {}
            },
            // NOP, a jump not taken, and the reserved words.
            _ => {}
        }
    }
}

/// The example with `program` in its ROM, loaded without warnings.
fn cpu(program: &[u16]) -> Simulator {
    let mut document: Value =
        serde_json::from_str(&example("reference-cpu-2")).expect("valid project file");
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

/// Seven-segment patterns of the hex digits (segment a on bit 0), as the first page shows them.
const HEX_DIGITS: [u32; 16] = [
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71,
];

/// What the sheet shows: its LEDs, the phase register's flip-flop, the stack and its pointer, the
/// data RAM, the I/O registers and the screen. The Fetch LED must agree with T and H, and the two
/// digits with HEX. No bit anywhere may be unknown: the sheet has no tri-state buffer.
fn read(sim: &Simulator) -> State {
    assert!(sim.unknown().iter().all(|&u| u == 0), "every net is known");
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
        sp: led("spled") as u8,
        stack: bytes("stack").try_into().expect("16 stack bytes"),
        ram: bytes("ram"),
        sptr: value(sim, "sptr/r", "q") as u8,
        hex: hex as u8,
        screen: bytes("screen"),
    }
}

/// The model and the circuit, run together: after reset and after every cycle they must agree.
struct Run {
    model: Model,
    sim: Simulator,
    cycles: usize,
}

impl std::ops::Deref for Run {
    type Target = Model;
    fn deref(&self) -> &Model {
        &self.model
    }
}

impl std::ops::DerefMut for Run {
    fn deref_mut(&mut self) -> &mut Model {
        &mut self.model
    }
}

impl Run {
    fn new(program: &[u16]) -> Run {
        let run = Run {
            model: Model::new(program),
            sim: cpu(program),
            cycles: 0,
        };
        assert_eq!(read(&run.sim), run.model.state, "after reset");
        run
    }

    /// One clock cycle on both, with the model's key held on the keyboard.
    fn cycle(&mut self) {
        self.cycles += 1;
        self.sim
            .set_input("key", u32::from(self.model.key))
            .expect("the keyboard");
        assert_eq!(self.sim.step_cycle(), None, "settles");
        self.model.cycle();
        assert_eq!(
            read(&self.sim),
            self.model.state,
            "after cycle {}",
            self.cycles
        );
    }

    /// Runs until halted, at most `limit` cycles; the cycles it took. Three more follow a halt, where
    /// nothing may change.
    fn run(&mut self, limit: usize) -> usize {
        let mut cycles = 0;
        while !self.model.state.h && cycles < limit {
            self.cycle();
            cycles += 1;
        }
        if self.model.state.h {
            let halted = self.model.state.clone();
            for _ in 0..3 {
                self.cycle();
                assert_eq!(self.model.state, halted, "halted: nothing changes");
            }
        }
        cycles
    }
}

fn assemble(source: &str) -> Vec<u16> {
    asm::assemble(source).unwrap_or_else(|e| panic!("{source} assembles: {e:?}"))
}

/// The state after `source` has run to its `HLT`.
fn halted(source: &str) -> State {
    halted_with(source, 0)
}

fn halted_with(source: &str, key: u8) -> State {
    let mut run = Run::new(&assemble(source));
    run.key = key;
    run.run(10_000);
    assert!(run.state.h, "{source} halts");
    run.state.clone()
}

#[test]
fn the_specification_examples_give_what_the_page_says() {
    // A routine that doubles A, called twice: 5, 10, 20.
    let twice = "LDI 5\nCALL twice\nCALL twice\nOUT\nHLT\ntwice: SHL\nRET";
    let state = halted(twice);
    assert_eq!((state.out, state.sp), (20, 0));
    // Each call left its return address where SP then pointed: 2, then 3 over it.
    assert_eq!(state.stack[0], 3);

    // The pixel at column 10, row 3: byte 25, bit 5.
    let pixel = "LDI 25\nSTA 0xFE\nLDA 0xFD\nORI 0b00100000\nSTA 0xFD\nHLT";
    let state = halted(pixel);
    let lit: Vec<(usize, u8)> = state
        .screen
        .iter()
        .copied()
        .enumerate()
        .filter(|&(_, b)| b != 0)
        .collect();
    assert_eq!(lit, [(25, 0x20)]);

    // The 1 bits of the key held.
    let count = "LDA 0xFF\nSTA 0\nLDI 0\nSTA 1\nloop: LDA 0\nSHR\nSTA 0\nJC one\nJMP next\none: LDA 1\nADI 1\nSTA 1\nnext: LDA 0\nJNZ loop\nLDA 1\nOUT\nHLT";
    for (key, ones) in [(0u8, 0u8), (0x41, 2), (0xFF, 8), (0x80, 1)] {
        assert_eq!(halted_with(count, key).out, ones, "key {key:#04x}");
    }
}

#[test]
fn the_first_cpus_programs_run_as_on_the_first_cpu() {
    // docs/reference-cpu.md's examples: none holds a word of opcode 0xD or 0xF.
    assert_eq!(halted("LDI 5\nADI 3\nOUT\nHLT").out, 8);
    let countdown = "LDI 10\nloop: OUT\nSBI 1\nJZ done\nJMP loop\ndone: OUT\nHLT";
    let state = halted(countdown);
    assert_eq!((state.out, state.a, state.z), (0, 0, true));
    // Two cycles an instruction: 4 instructions, 8 cycles.
    let mut model = Run::new(&assemble("LDI 5\nADI 3\nOUT\nHLT"));
    assert_eq!(model.run(100), 8);
}

#[test]
fn the_bit_operations_set_z_and_keep_c() {
    // C is set first by an addition that carries (200 + 100), then must survive each of the six.
    let carry = "LDI 200\nADI 100\n";
    let with = |tail: &str| {
        halted(&format!(
            "{carry}LDI 0b1100\nSTA 0\nLDI 0b1010\n{tail}\nHLT"
        ))
    };
    for (tail, a) in [
        ("AND 0", 0b1000),
        ("OR 0", 0b1110),
        ("XOR 0", 0b0110),
        ("ANI 0b1100", 0b1000),
        ("ORI 0b1100", 0b1110),
        ("XRI 0b1100", 0b0110),
    ] {
        let state = with(tail);
        assert_eq!((state.a, state.z, state.c), (a, false, true), "{tail}");
    }
    // A result of 0 sets Z, and C is still kept.
    for tail in ["ANI 0b0101", "XRI 0b1010", "ORI 0\nANI 0"] {
        let state = with(tail);
        assert_eq!((state.a, state.z, state.c), (0, true, true), "{tail}");
    }
    // And a C that is 0 stays 0.
    let state = halted("LDI 3\nORI 4\nHLT");
    assert_eq!((state.a, state.c), (7, false));
}

#[test]
fn the_logic_instructions_read_devices_as_add_does_and_the_immediate_ones_read_nothing() {
    // XOR 0xFD combines A with the screen byte at SPTR; XRI 0xFD uses the number 0xFD.
    let source =
        "LDI 7\nSTA 0xFE\nLDI 0xF0\nSTA 0xFD\nLDI 0x3C\nXOR 0xFD\nOUT\nLDI 0x3C\nXRI 0xFD\nHLT";
    let state = halted(source);
    assert_eq!(state.out, 0xF0 ^ 0x3C);
    assert_eq!(state.a, 0x3C ^ 0xFD);
    // AND with the key held, OR with the hex register.
    let source = "LDI 0x0F\nAND 0xFF\nOUT\nLDI 0x81\nSTA 0xFC\nLDI 0x18\nOR 0xFC\nHLT";
    let state = halted_with(source, 0x35);
    assert_eq!((state.out, state.a), (0x05, 0x99));
}

#[test]
fn a_shift_moves_one_bit_and_puts_the_bit_it_drops_in_c() {
    for (source, a, z, c) in [
        ("LDI 0b10000001\nSHL\nHLT", 0b0000_0010, false, true),
        ("LDI 0b01000001\nSHL\nHLT", 0b1000_0010, false, false),
        ("LDI 0b10000000\nSHL\nHLT", 0, true, true),
        ("LDI 0b10000001\nSHR\nHLT", 0b0100_0000, false, true),
        ("LDI 0b10000010\nSHR\nHLT", 0b0100_0001, false, false),
        ("LDI 1\nSHR\nHLT", 0, true, true),
        // Three times left multiplies by 8.
        ("LDI 5\nSHL\nSHL\nSHL\nHLT", 40, false, false),
    ] {
        let state = halted(source);
        assert_eq!((state.a, state.z, state.c), (a, z, c), "{source}");
    }
}

#[test]
fn jnz_jumps_while_z_is_0_and_z_is_0_after_reset() {
    // A JNZ that comes first is taken: no instruction has set Z, though A is 0.
    assert_eq!(halted("JNZ skip\nLDI 1\nskip: OUT\nHLT").out, 0);
    // Not taken once a result was 0; taken when it was not.
    assert_eq!(halted("LDI 0\nJNZ skip\nLDI 9\nskip: OUT\nHLT").out, 9);
    assert_eq!(halted("LDI 4\nJNZ skip\nLDI 9\nskip: OUT\nHLT").out, 4);
    // A countdown with one jump a round: 3, 2, 1, then out.
    let state = halted("LDI 3\nloop: STA 0\nADD 1\nSTA 1\nLDA 0\nSBI 1\nJNZ loop\nLDA 1\nOUT\nHLT");
    assert_eq!(state.out, 3 + 2 + 1);
    // Bits 11-8 of its word are ignored, as for every instruction of the first CPU.
    let mut model = Run::new(&[0xD703, 0x1009, 0xC000, 0xC000]);
    model.run(100);
    assert_eq!((model.state.a, model.state.pc), (0, 4));
}

#[test]
fn call_and_ret_keep_a_and_the_flags() {
    // Z and C set before the call (255 + 1 = 0, carry) come back with A's new value untouched by RET.
    let state = halted("LDI 255\nADI 1\nCALL f\nHLT\nf: RET");
    assert_eq!((state.a, state.z, state.c, state.sp), (0, true, true, 0));
    // A routine's answer in a flag: is A odd? C after SHR, kept through RET.
    let odd = "LDI 7\nCALL odd\nJC yes\nLDI 0\nOUT\nHLT\nyes: LDI 1\nOUT\nHLT\nodd: SHR\nRET";
    assert_eq!(halted(odd).out, 1);
    assert_eq!(halted(&odd.replace("LDI 7", "LDI 6")).out, 0);
}

#[test]
fn routines_nest_sixteen_deep_and_the_seventeenth_writes_over_the_oldest() {
    // f0 calls f1 ... calls the last, which adds 1 to A; each returns. Sixteen calls deep in all,
    // counting the one from the top.
    let nest = |depth: usize| {
        let mut source = String::from("CALL f0\nOUT\nHLT\n");
        for i in 0..depth - 1 {
            source += &format!("f{i}: CALL f{}\nRET\n", i + 1);
        }
        source + &format!("f{}: ADI 1\nRET\n", depth - 1)
    };
    let state = halted(&nest(16));
    assert_eq!((state.out, state.sp), (1, 0));
    // The top's return address is 1; f0's call returns to address 4, f1's to 6, and so on.
    assert_eq!(state.stack[..3], [1, 4, 6]);

    // Seventeen: the innermost call stores at STACK[0], over the return to the top. Coming back out,
    // f0's RET goes there instead: to the address after the innermost CALL, in f15, for ever.
    let mut model = Run::new(&assemble(&nest(17)));
    model.run(5_000);
    assert!(!model.state.h, "it never gets back to the top");
    assert_eq!(model.state.out, 0);
}

#[test]
fn a_ret_with_nothing_stored_goes_where_the_stack_says_and_sp_wraps() {
    // After reset STACK[15] is 0: the RET jumps to 0 and SP is 15. Here that loops.
    let mut model = Run::new(&assemble("ADI 1\nRET"));
    for _ in 0..4 {
        model.cycle();
    }
    assert_eq!((model.state.pc, model.state.sp, model.state.a), (0, 15, 1));
    // Bits 7-0 of SHL, SHR and RET are ignored: 0xF9nn is RET, 0xF6nn SHL, 0xF7nn SHR.
    let mut model = Run::new(&[0x1005, 0xF6AB, 0xF7CD, 0xF6FF, 0xC000]);
    model.run(100);
    assert_eq!(model.state.a, 10);
    let mut model = Run::new(&[0xF803, 0xB000, 0xC000, 0x1007, 0xF9EE]);
    model.run(100);
    assert_eq!((model.state.out, model.state.h), (7, true));
}

#[test]
fn a_call_at_the_last_address_stores_0_and_a_call_to_itself_stores_the_address_after_it() {
    let mut rom = vec![0u16; 256];
    rom[0] = 0x80FF; // JMP 255
    rom[255] = 0xF810; // CALL 16
    rom[16] = 0xC000;
    let mut model = Run::new(&rom);
    model.run(100);
    assert_eq!(
        (model.state.stack[0], model.state.sp, model.state.pc),
        (0, 1, 17)
    );

    // here: CALL here, at address 2: every stack byte ends as 3.
    let mut model = Run::new(&assemble("NOP\nNOP\nhere: CALL here"));
    model.run(200);
    assert_eq!(model.state.stack, [3; 16]);
    assert!(!model.state.h);
}

#[test]
fn a_halted_cpu_keeps_its_stack_and_reserved_words_do_nothing() {
    let state = halted("CALL f\nHLT\nf: CALL g\nHLT\ng: HLT");
    assert_eq!((state.sp, state.stack[0], state.stack[1]), (2, 1, 3));
    // 0xE and 0xFA to 0xFF, whatever their other bits: A, the flags, SP and the PC's march untouched.
    let mut model = Run::new(&[
        0x1005, 0xE0FF, 0xEA12, 0xFA00, 0xFB34, 0xFFFF, 0xB000, 0xC000,
    ]);
    assert_eq!(model.run(100), 16);
    let s = &model.state;
    assert_eq!(
        (s.a, s.out, s.z, s.c, s.sp, s.pc),
        (5, 5, false, false, 0, 8)
    );
}

#[test]
fn the_first_cpus_instruction_and_flag_cases_run_the_same_here() {
    // The programs of cpu.rs's own test of the first CPU: none holds a word of opcode 0xD or 0xF.
    for source in [
        "LDI 0\nLDI 7\nSTA 3\nLDI 0\nLDA 3\nSTA 255\nLDA 4\nOUT\nHLT",
        "LDI 200\nADI 55\nADI 1\nLDI 3\nADI 4\nSTA 0\nADD 0\nLDI 250\nSTA 1\nADD 1\nOUT\nHLT",
        "LDI 5\nSBI 5\nSBI 1\nLDI 9\nSTA 2\nLDI 4\nSUB 2\nLDI 20\nSUB 2\nOUT\nHLT",
        "LDI 1\nJZ 9\nSBI 1\nJZ 5\nHLT\nJC 7\nHLT\nJMP 8\nHLT\nNOP\nOUT\nHLT",
        "LDI 250\nloop: ADI 1\nJC end\nJMP loop\nend: OUT\nHLT",
        "LDI 3\nNOP\nHLT\nLDI 9\nOUT",
    ] {
        halted(source);
    }
    // That test's program of reserved words is another program here: 0xD123 is JNZ 0x23, taken, since Z
    // is 0 after reset. With a HLT where it lands, and the first CPU's other two words run on the way.
    let mut rom = vec![0xD123, 0xC000];
    rom.resize(0x23, 0);
    rom.extend([0x1F05, 0xB0FF, 0xC000]);
    let mut run = Run::new(&rom);
    run.run(100);
    assert_eq!((run.state.a, run.state.out, run.state.h), (5, 5, true));
    // The PC wraps from 255 to 0.
    let mut wrap = vec![0x1009];
    wrap.resize(255, 0);
    wrap.push(0xB000);
    let mut run = Run::new(&wrap);
    for _ in 0..2 * 258 {
        run.cycle();
    }
    assert_eq!((run.state.pc, run.state.out), (2, 9));
}

#[test]
fn random_programs_run_as_specified() {
    // xorshift64: a fixed seed, so every run checks the same programs.
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut calls = 0;
    for i in 0..200u64 {
        // 256 raw words, reserved words and ignored bits included. Operands: any value in even programs;
        // 0x00-0x0F when i % 4 == 1, so stores, loads, jumps and calls meet near the start; 0xF0-0xFF when
        // i % 4 == 3, so the devices are met often. One program in three is made mostly of the eleven new
        // instructions, which random opcodes alone would meet one word in eight.
        let window = if i % 2 == 0 { 0xFFFF } else { 0xF00F };
        let io = if i % 4 == 3 { 0x00F0 } else { 0 };
        let program: Vec<u16> = (0..256)
            .map(|_| {
                let word = (next() as u16 & window) | io;
                match (i % 3, next() % 4) {
                    (0, 0) => 0xD000 | word & 0x0FFF,
                    (0, 1 | 2) => 0xF000 | word & 0x0FFF,
                    _ => word,
                }
            })
            .collect();
        calls += program.iter().filter(|&&w| w & 0xFF00 == 0xF800).count();
        let mut run = Run::new(&program);
        for cycle in 1..=128usize {
            // A key code that changes every few cycles, from a hash of the cycle and the program.
            run.key = ((cycle as u64 / 3 + i).wrapping_mul(0x9E37_79B9) >> 8) as u8;
            run.cycle();
        }
    }
    assert!(
        calls > 300,
        "the programs hold {calls} CALLs: too few to test the stack"
    );
}

#[test]
fn the_shipped_program_is_its_source_as_assembled_and_draws_a_diagonal_one_pixel_at_a_time() {
    let document: Value = serde_json::from_str(&example("reference-cpu-2")).expect("valid");
    let rom = document["circuit"]["components"]
        .as_array()
        .expect("components")
        .iter()
        .find(|c| c["id"] == "rom")
        .expect("the program ROM");
    let words: Vec<u16> = rom["props"]["data"]
        .as_array()
        .expect("words")
        .iter()
        .map(|w| w.as_u64().expect("a word") as u16)
        .collect();
    // scripts/reference-cpu-2.mjs has an assembler of its own for this: the real one must agree.
    assert_eq!(
        words,
        assemble(rom["props"]["source"].as_str().expect("its source"))
    );

    let mut run = Run::new(&words);
    let cycles = run.run(20_000);
    assert!(run.state.h, "it halts");
    // Pixel n of the diagonal is column n, row n: screen byte 8n + n/8, bit 7 - n mod 8.
    let mut screen = vec![0u8; 256];
    for n in 0..32 {
        screen[8 * n + n / 8] |= 0x80 >> (n % 8);
    }
    assert_eq!(run.state.screen, screen);
    assert_eq!((run.state.out, run.state.hex, run.state.sp), (32, 32, 0));
    // The notes ask for 1 kHz or more: at that speed the line takes this long to draw.
    assert!((3_000..5_000).contains(&cycles), "{cycles} cycles");
}

/// The state after `words` run until halted, at most `limit` cycles, on the model and the circuit.
fn after(words: &[u16], limit: usize) -> State {
    let mut run = Run::new(words);
    run.run(limit);
    run.state.clone()
}

#[test]
fn a_shift_moves_in_a_0_whatever_c_held() {
    // C set first (200 + 100 carries): a rotate through carry would move it in.
    let state = halted("LDI 200\nADI 100\nLDI 1\nSHL\nHLT");
    assert_eq!((state.a, state.c), (2, false));
    let state = halted("LDI 200\nADI 100\nLDI 2\nSHR\nHLT");
    assert_eq!((state.a, state.c), (1, false));
    let state = halted("LDI 200\nADI 100\nLDI 0x80\nSHR\nHLT");
    assert_eq!((state.a, state.c), (0x40, false));
}

#[test]
fn the_bit_operations_keep_a_c_that_is_0_and_set_z_either_way() {
    // No carry first: C is 0, and stays 0 through each of the six.
    let with = |tail: &str| halted(&format!("LDI 0b1100\nSTA 0\nLDI 0b1010\n{tail}\nHLT"));
    for tail in [
        "AND 0",
        "OR 0",
        "XOR 0",
        "ANI 0b1100",
        "ORI 0b1100",
        "XRI 0b1100",
    ] {
        assert!(!with(tail).c, "{tail}");
    }
    // Z goes from 1 to 0: A was 0 (LDI 0 sets Z), and the result is not.
    for tail in ["OR 0", "XOR 0", "ORI 5", "XRI 5"] {
        let state = halted(&format!("LDI 0b1100\nSTA 0\nLDI 0\n{tail}\nHLT"));
        assert!(state.a != 0 && !state.z, "{tail}");
    }
    // And from 0 to 1: A is 7, RAM[1] is 0.
    for tail in ["AND 1", "ANI 0"] {
        let state = halted(&format!("LDI 7\n{tail}\nHLT"));
        assert_eq!((state.a, state.z), (0, true), "{tail}");
    }
}

#[test]
fn call_ret_and_jnz_leave_flags_that_are_0_at_0_and_a_carry_set() {
    // Z and C both 0 before the call: they come back 0.
    let state = halted("LDI 1\nCALL f\nHLT\nf: RET");
    assert_eq!((state.a, state.z, state.c), (1, false, false));
    // A taken JNZ keeps C.
    let state = halted("LDI 200\nADI 100\nJNZ next\nnext: HLT");
    assert_eq!((state.a, state.z, state.c), (44, false, true));
}

#[test]
fn the_stack_is_apart_from_the_data_ram() {
    let state = halted("LDI 9\nCALL f\nOUT\nHLT\nf: CALL g\nRET\ng: RET");
    assert_eq!(state.out, 9);
    assert!(
        state.ram.iter().all(|&b| b == 0),
        "no call wrote the data RAM"
    );
    // CALL f at 1 stored 2; CALL g at 4 stored 5.
    assert_eq!(state.stack[..2], [2, 5]);
}

#[test]
fn every_reserved_word_does_what_nop_does() {
    // A program that touches A, the flags, RAM, OUT and the stack, with a reserved word
    // after each instruction. It must end as the same program with 0x0000 there, the IR apart.
    // Each word is followed by the reserved one, so the program's own words sit at even addresses: the
    // routine f is at 10, and the CALL at 4 returns to 5, a reserved word, then the OUT at 6.
    let program = [
        0x1005, // LDI 5
        0x3010, // STA 0x10
        0xF80A, // CALL f
        0xB000, // OUT
        0xC000, // HLT
        0x6001, // f: ADI 1
        0xF900, // RET
    ];
    let reserved = [
        0xE000, 0xE700, 0xEFFF, 0xFA00, 0xFB12, 0xFC12, 0xFD00, 0xFE34, 0xFFFF,
    ];
    for &word in &reserved {
        let with: Vec<u16> = program.iter().flat_map(|&w| [w, word]).collect();
        let without: Vec<u16> = program.iter().flat_map(|&w| [w, 0x0000]).collect();
        let (mut a, mut b) = (after(&with, 200), after(&without, 200));
        assert!(a.h && b.h, "{word:04X} halts");
        (a.ir, b.ir) = (0, 0);
        assert_eq!(a, b, "{word:04X}");
    }
}

const CATCH2: &str = include_str!("../../../scripts/catch2.asm");
const LEFT: u8 = 0x82;
const RIGHT: u8 = 0x83;

/// Catch 2's RAM, as docs/reference-cpu-2.md lists it.
const PADDLE: usize = 0;
const COLUMN: usize = 1;
const TOP: usize = 2;
const DELAY: usize = 4;
const SCORE: usize = 5;

/// The screen's lit pixels as (column, row).
fn pixels(state: &State) -> Vec<(usize, usize)> {
    (0..64 * 32)
        .filter(|&n| state.screen[n / 8] & (0x80 >> (n % 8)) != 0)
        .map(|n| (n % 64, n / 64))
        .collect()
}

/// The paddle at `left` and a block at `column` on rows `top` and `top + 1`, as pixels.
fn picture(left: usize, block: Option<(usize, usize)>) -> Vec<(usize, usize)> {
    let mut lit: Vec<(usize, usize)> = (left..left + 8).map(|c| (c, 31)).collect();
    if let Some((column, top)) = block {
        lit.extend([
            (column, top),
            (column + 1, top),
            (column, top + 1),
            (column + 1, top + 1),
        ]);
    }
    lit.sort_by_key(|&(c, r)| (r, c));
    lit
}

/// Plays Catch 2 on the model and the circuit together until it halts or `limit` cycles pass,
/// with `key(state)` held each cycle.
fn play(limit: usize, key: impl Fn(&State) -> u8) -> Run {
    let mut run = Run::new(&assemble(CATCH2));
    for _ in 0..limit {
        if run.state.h {
            break;
        }
        run.key = key(&run.state);
        run.cycle();
    }
    run
}

#[test]
fn catch_2_scores_the_first_block_and_halts_on_a_miss_with_single_pixels() {
    // No key: the first block falls in column 28, over the paddle at 28 to 35; the second in column 51.
    let run = play(80_000, |_| 0);
    assert!(run.state.h, "a miss halts");
    assert_eq!((run.state.ram[SCORE], run.state.hex), (1, 1));
    // The missed block stays where it landed, on rows 29 and 30, beside the paddle.
    assert_eq!(pixels(&run.state), picture(28, Some((51, 29))));
}

#[test]
fn catch_2_moves_the_paddle_one_pixel_at_a_time_to_catch_a_block_elsewhere() {
    // Right is held while the second block falls, until the paddle's left column is 46: under 51 and 52.
    let run = play(120_000, |s| {
        if s.ram[SCORE] == 1 && s.ram[PADDLE] < 46 {
            RIGHT
        } else {
            0
        }
    });
    assert!(run.state.h);
    // Caught: the third block, in column 51 + 23 - 63 = 11, is missed.
    assert_eq!(run.state.ram[SCORE], 2);
    assert_eq!(pixels(&run.state), picture(46, Some((11, 29))));
}

/// Catch 2 on the model alone, for its timing: what the circuit does cycle by cycle is held above.
fn on_model(limit: usize, key: impl Fn(&State) -> u8) -> (Model, Vec<(u8, usize)>) {
    let mut model = Model::new(&assemble(CATCH2));
    // Each row the block reaches, and the cycle it got there.
    let mut rows = Vec::new();
    for cycle in 1..=limit {
        if model.state.h {
            break;
        }
        model.key = key(&model.state);
        let top = model.state.ram[TOP];
        model.cycle();
        if model.state.ram[TOP] != top {
            rows.push((model.state.ram[TOP], cycle));
        }
    }
    (model, rows)
}

#[test]
fn catch_2_stops_the_paddle_at_both_edges() {
    let row = |state: &State| -> Vec<usize> {
        pixels(state)
            .into_iter()
            .filter(|&(_, r)| r == 31)
            .map(|(c, _)| c)
            .collect()
    };
    let (model, _) = on_model(80_000, |_| LEFT);
    assert_eq!(
        (model.state.ram[PADDLE], row(&model.state)),
        (0, (0..8).collect())
    );
    let (model, _) = on_model(80_000, |_| RIGHT);
    assert_eq!(
        (model.state.ram[PADDLE], row(&model.state)),
        (56, (56..64).collect())
    );
}

#[test]
fn catch_2_keeps_an_even_pace_within_its_budget_and_speeds_up_down_to_a_delay_of_6() {
    // A row of fall is the wait, 8 cycles a round of the delay and 4 to start it, then the rest, the
    // same whatever the block's column; and with both paddle moves no more than 1,000 cycles.
    let row =
        |rows: &[(u8, usize)]| -> Vec<usize> { rows.windows(2).map(|w| w[1].1 - w[0].1).collect() };
    let (_, still) = on_model(30_000, |_| 0);
    let (_, moving) = on_model(30_000, |s| {
        if s.ram[TOP] >= 1 {
            if s.ram[PADDLE] > 0 { LEFT } else { 0 }
        } else {
            0
        }
    });
    let wait = 8 * 60 + 4;
    let still: Vec<usize> = row(&still)[1..20].to_vec();
    assert!(still.iter().all(|&c| c == still[0]), "{still:?}");
    assert_eq!(still[0] - wait, 436, "a row with no key");
    // Both moves, each way: a move left is 106 instructions, a move right 109, so a row is 832 or 844
    // cycles before the wait.
    let moving = row(&moving)[2..10].to_vec();
    assert!(moving.iter().all(|&c| c - wait == 832), "{moving:?}");
    let (_, right) = on_model(30_000, |s| {
        if s.ram[TOP] >= 1 && s.ram[PADDLE] < 56 {
            RIGHT
        } else {
            0
        }
    });
    let right = row(&right)[2..10].to_vec();
    assert!(right.iter().all(|&c| c - wait == 844), "{right:?}");
    // Two pixels a row while a key is held: five rows of Right take the paddle from 28 to 38.
    let (model, _) = on_model(30_000, |s| if s.ram[TOP] < 5 { RIGHT } else { 0 });
    assert_eq!(model.state.ram[PADDLE], 38);
    // The same whatever the column. The first block falls in column 28 and the second in 51, with the
    // delay held at 60: between them they take each branch of locate's bit both ways (28 has bit 2 of its
    // low three set, 51 bits 1 and 0).
    let mut model = Model::new(&assemble(CATCH2));
    let mut cycles: Vec<(u8, usize)> = Vec::new();
    let (mut top, mut at) = (0, 0);
    for cycle in 1..80_000 {
        model.state.ram[DELAY] = 60;
        model.cycle();
        if model.state.ram[TOP] != top {
            if (2..28).contains(&model.state.ram[TOP]) {
                cycles.push((model.state.ram[COLUMN], cycle - at));
            }
            (top, at) = (model.state.ram[TOP], cycle);
        }
    }
    let columns: Vec<u8> = cycles.iter().map(|&(c, _)| c).collect();
    assert!(
        columns.contains(&28) && columns.contains(&51),
        "{columns:?}"
    );
    assert!(cycles.iter().all(|&(_, c)| c == still[0]), "{cycles:?}");

    // Each catch takes 6 off the delay, down to 6: nine catches, then it stays. A paddle that follows the block.
    let (model, _) = on_model(2_000_000, |s| {
        let target = s.ram[COLUMN].saturating_sub(3).min(56);
        match s.ram[PADDLE] {
            p if p < target => RIGHT,
            p if p > target => LEFT,
            _ => 0,
        }
    });
    let state = &model.state;
    assert!(state.ram[SCORE] >= 12, "score {}", state.ram[SCORE]);
    assert_eq!(state.ram[DELAY], 6);
}

#[test]
fn the_catch_2_example_holds_the_game_as_assembled() {
    let document: Value = serde_json::from_str(&example("catch-2")).expect("valid");
    let rom = document["circuit"]["components"]
        .as_array()
        .expect("components")
        .iter()
        .find(|c| c["id"] == "rom")
        .expect("the program ROM");
    let words: Vec<u16> = rom["props"]["data"]
        .as_array()
        .expect("words")
        .iter()
        .map(|w| w.as_u64().expect("a word") as u16)
        .collect();
    assert_eq!(words, assemble(CATCH2));
    assert_eq!(
        rom["props"]["source"].as_str(),
        Some(CATCH2.replace("\r\n", "\n").as_str())
    );
    // The same sheet as Reference CPU 2's, the ROM apart.
    let sheet: Value = serde_json::from_str(&example("reference-cpu-2")).expect("valid");
    let parts = |d: &Value| d["circuit"]["components"].as_array().expect("parts").len();
    assert_eq!(parts(&document), parts(&sheet));
    assert!(words.len() <= 256);
}

#[test]
fn a_catch_needs_the_paddle_under_both_of_the_blocks_columns() {
    // The second block falls in column 51, columns 51 and 52. The paddle is moved there during its fall and
    // left at `left`: 45 covers 45 to 52, the last that catches on that side; 44 covers 51 but not 52; 52
    // covers 52 but not 51.
    for (left, caught) in [(45u8, true), (44, false), (51, true), (52, false)] {
        let (model, _) = on_model(200_000, |s| match (s.ram[SCORE], s.ram[PADDLE]) {
            (1, p) if p < left => RIGHT,
            _ => 0,
        });
        assert!(model.state.h, "{left}");
        assert_eq!(model.state.ram[PADDLE], left);
        assert_eq!(
            model.state.ram[SCORE],
            if caught { 2 } else { 1 },
            "the paddle at {left}"
        );
    }
}

// --- The cut CPU on its bench (ADR 0041) ------------------------------------------------

/// `challenges/benches/cpu2.clockyard.json` with `program` in the ROM of its `program` slot, loaded
/// without warnings.
fn bench(program: &[u16]) -> Simulator {
    let path = format!(
        "{}/../../challenges/benches/cpu2.clockyard.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let mut document: Value = serde_json::from_str(&text).expect("valid project file");
    let slot = document["definitions"]
        .as_array_mut()
        .expect("definitions")
        .iter_mut()
        .find(|d| d["id"] == "program")
        .expect("the program slot");
    let rom = slot["circuit"]["components"]
        .as_array_mut()
        .expect("components")
        .iter_mut()
        .find(|c| c["id"] == "rom")
        .expect("the slot's ROM");
    rom["props"]["data"] = json!(program);
    let (sim, warnings) =
        Simulator::load(&description(&document.to_string())).expect("valid circuit");
    assert_eq!(warnings, vec![], "the bench loads without warnings");
    sim
}

/// What the bench holds: the CPU's registers and stack inside the `cpu` instance, the bench's LEDs
/// on its outputs, and the memories and device registers on the bench sheet.
fn read_bench(sim: &Simulator) -> State {
    assert!(sim.unknown().iter().all(|&u| u == 0), "every net is known");
    let q = |id: &str| value(sim, id, "q");
    let led = |id: &str| value(sim, id, "in");
    let t = q("cpu/t/r") == 1;
    let h = led("halt") == 1;
    assert_eq!(h, q("cpu/h/r") == 1, "the halt pin shows H");
    assert_eq!(led("fetch") == 1, !t && !h, "Fetch = ¬T ∧ ¬H");
    let bytes = |id: &str| -> Vec<u8> {
        let words = sim
            .memory(id)
            .unwrap_or_else(|| panic!("the bench has {id}"));
        words.iter().map(|&w| w as u8).collect()
    };
    State {
        pc: q("cpu/pcr/r") as u8,
        ir: (q("cpu/irh/r") << 8 | q("cpu/irl/r")) as u16,
        a: q("cpu/a/r") as u8,
        out: led("out") as u8,
        z: q("cpu/z/r") == 1,
        c: q("cpu/c/r") == 1,
        t,
        h,
        sp: q("cpu/sp/r") as u8,
        stack: bytes("cpu/stack").try_into().expect("16 stack bytes"),
        ram: bytes("ram"),
        sptr: q("sptr/r") as u8,
        hex: q("hex/r") as u8,
        screen: bytes("screen"),
    }
}

/// The program run on the bench and on the model, a cycle at a time, the clock a switch set to 1,
/// then to 0, with the key set while it is low, as a challenge's steps do it.
fn check_bench(program: &[u16], cycles: usize, keys: impl Fn(usize) -> u8) {
    let mut sim = bench(program);
    let mut model = Model::new(program);
    assert_eq!(read_bench(&sim), model.state, "after reset");
    for cycle in 1..=cycles {
        model.key = keys(cycle);
        for (id, value) in [("key", u32::from(model.key)), ("clk", 1), ("clk", 0)] {
            assert_eq!(sim.set_input(id, value).expect("a switch"), None, "settles");
        }
        model.cycle();
        assert_eq!(
            read_bench(&sim),
            model.state,
            "after cycle {cycle} of {program:04X?}"
        );
    }
}

#[test]
fn the_cut_cpu_on_its_bench_runs_as_specified() {
    // The specification's examples, and the example's own program, run to their halt and past it.
    for source in [
        "LDI 5\nCALL twice\nCALL twice\nOUT\nHLT\ntwice: SHL\nRET",
        "LDI 25\nSTA 0xFE\nLDA 0xFD\nORI 0b00100000\nSTA 0xFD\nHLT",
        "LDA 0xFF\nSTA 0\nLDI 0\nSTA 1\nloop: LDA 0\nSHR\nSTA 0\nJC one\nJMP next\none: LDA 1\nADI 1\nSTA 1\nnext: LDA 0\nJNZ loop\nLDA 1\nOUT\nHLT",
        "LDI 0x2A\nSTA 0xFC\nLDI 7\nSTA 0xFE\nLDI 0x81\nSTA 0xFD\nLDA 0xFD\nXOR 0xFC\nAND 0xFE\nOR 0xFF\nOUT\nHLT",
    ] {
        check_bench(&assemble(source), 200, |_| 0x41);
    }
    // Random words, as `random_programs_run_as_specified` makes them, fewer: a bench cycle is two settles.
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for i in 0..40u64 {
        let window = if i % 2 == 0 { 0xFFFF } else { 0xF00F };
        let io = if i % 4 == 3 { 0x00F0 } else { 0 };
        let program: Vec<u16> = (0..256)
            .map(|_| {
                let word = (next() as u16 & window) | io;
                match (i % 3, next() % 4) {
                    (0, 0) => 0xD000 | word & 0x0FFF,
                    (0, 1 | 2) => 0xF000 | word & 0x0FFF,
                    _ => word,
                }
            })
            .collect();
        let keys =
            move |cycle: usize| ((cycle as u64 / 3 + i).wrapping_mul(0x9E37_79B9) >> 8) as u8;
        check_bench(&program, 128, keys);
    }
}
