//! Reference CPU 2's model, written from `docs/reference-cpu-2.md` and `docs/reference-cpu.md`:
//! `cpu2.rs` holds the circuit to it, and `challenges.rs` runs challenge 16's solution on it.

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
