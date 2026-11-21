//! Reference CPU 2 (ADR 0036) as its specification has it: `docs/reference-cpu-2.md`,
//! read with `docs/reference-cpu.md`, which it adds to.
//!
//! `Model` below is written from those two pages alone, apart from the first CPU's
//! model in `cpu.rs`, and is the independent reference the circuit will be held
//! to. Until the circuit exists (ADR 0036, step 3), the tests here hold the model
//! itself to results worked out by hand from the pages.

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

    /// Runs until halted, at most `limit` cycles; the cycles it took.
    pub fn run(&mut self, limit: usize) -> usize {
        let mut cycles = 0;
        while !self.state.h && cycles < limit {
            self.cycle();
            cycles += 1;
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
    let mut model = Model::new(&assemble(source));
    model.key = key;
    model.run(10_000);
    assert!(model.state.h, "{source} halts");
    model.state
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
    let mut model = Model::new(&assemble("LDI 5\nADI 3\nOUT\nHLT"));
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
    let mut model = Model::new(&[0xD703, 0x1009, 0xC000, 0xC000]);
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
    let mut model = Model::new(&assemble(&nest(17)));
    model.run(5_000);
    assert!(!model.state.h, "it never gets back to the top");
    assert_eq!(model.state.out, 0);
}

#[test]
fn a_ret_with_nothing_stored_goes_where_the_stack_says_and_sp_wraps() {
    // After reset STACK[15] is 0: the RET jumps to 0 and SP is 15. Here that loops.
    let mut model = Model::new(&assemble("ADI 1\nRET"));
    for _ in 0..4 {
        model.cycle();
    }
    assert_eq!((model.state.pc, model.state.sp, model.state.a), (0, 15, 1));
    // Bits 7-0 of SHL, SHR and RET are ignored: 0xF9nn is RET, 0xF6nn SHL, 0xF7nn SHR.
    let mut model = Model::new(&[0x1005, 0xF6AB, 0xF7CD, 0xF6FF, 0xC000]);
    model.run(100);
    assert_eq!(model.state.a, 10);
    let mut model = Model::new(&[0xF803, 0xB000, 0xC000, 0x1007, 0xF9EE]);
    model.run(100);
    assert_eq!((model.state.out, model.state.h), (7, true));
}

#[test]
fn a_call_at_the_last_address_stores_0_and_a_call_to_itself_stores_the_address_after_it() {
    let mut rom = vec![0u16; 256];
    rom[0] = 0x80FF; // JMP 255
    rom[255] = 0xF810; // CALL 16
    rom[16] = 0xC000;
    let mut model = Model::new(&rom);
    model.run(100);
    assert_eq!(
        (model.state.stack[0], model.state.sp, model.state.pc),
        (0, 1, 17)
    );

    // here: CALL here, at address 2: every stack byte ends as 3.
    let mut model = Model::new(&assemble("NOP\nNOP\nhere: CALL here"));
    model.run(200);
    assert_eq!(model.state.stack, [3; 16]);
    assert!(!model.state.h);
}

#[test]
fn a_halted_cpu_keeps_its_stack_and_reserved_words_do_nothing() {
    let state = halted("CALL f\nHLT\nf: CALL g\nHLT\ng: HLT");
    assert_eq!((state.sp, state.stack[0], state.stack[1]), (2, 1, 3));
    // 0xE and 0xFA to 0xFF, whatever their other bits: A, the flags, SP and the PC's march untouched.
    let mut model = Model::new(&[
        0x1005, 0xE0FF, 0xEA12, 0xFA00, 0xFB34, 0xFFFF, 0xB000, 0xC000,
    ]);
    assert_eq!(model.run(100), 16);
    let s = &model.state;
    assert_eq!(
        (s.a, s.out, s.z, s.c, s.sp, s.pc),
        (5, 5, false, false, 0, 8)
    );
}
