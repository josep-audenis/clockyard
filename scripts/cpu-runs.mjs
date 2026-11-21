// A model of the reference CPU (docs/reference-cpu.md) and the runs of ADR 0034's challenges: for
// each program and key, what it leaves in OUT, the RAM and the screen, and how long it takes. The
// expected values written into the challenge files come from here; the reference solutions passing
// every run, in crates/sim-core/tests/challenges.rs, is what holds this model to the circuit.

/**
 * Runs `words` with `key` held, instruction by instruction, until HLT or `limit` instructions.
 * Returns what a check can see: OUT, whether it halted, the bytes stored (RAM and screen, by
 * address), and the clock cycles used (two per instruction).
 */
export function execute(words, key = 0, limit = 400) {
  const s = { pc: 0, a: 0, out: 0, z: false, c: false, sptr: 0, hex: 0 };
  const ram = new Map();
  const screen = new Map();
  const read = (n) => {
    if (n === 0xff) return key;
    if (n === 0xfe) return s.sptr;
    if (n === 0xfd) return screen.get(s.sptr) ?? 0;
    if (n === 0xfc) return s.hex;
    if (n >= 0xf0) return 0;
    return ram.get(n) ?? 0;
  };
  const store = (n, value) => {
    if (n === 0xfe) s.sptr = value;
    else if (n === 0xfd) screen.set(s.sptr, value);
    else if (n === 0xfc) s.hex = value;
    else if (n < 0xf0) ram.set(n, value);
  };
  const load = (value) => {
    s.a = value & 0xff;
    s.z = s.a === 0;
  };
  const add = (b) => {
    s.c = s.a + b > 0xff;
    load(s.a + b);
  };
  const sub = (b) => {
    s.c = s.a >= b;
    load(s.a - b);
  };
  let instructions = 0;
  let halted = false;
  while (!halted && instructions < limit) {
    const word = words[s.pc] ?? 0;
    s.pc = (s.pc + 1) & 0xff;
    instructions++;
    const n = word & 0xff;
    switch (word >> 12) {
      case 0x1: load(n); break;
      case 0x2: load(read(n)); break;
      case 0x3: store(n, s.a); break;
      case 0x4: add(read(n)); break;
      case 0x5: sub(read(n)); break;
      case 0x6: add(n); break;
      case 0x7: sub(n); break;
      case 0x8: s.pc = n; break;
      case 0x9: if (s.z) s.pc = n; break;
      case 0xa: if (s.c) s.pc = n; break;
      case 0xb: s.out = s.a; break;
      case 0xc: halted = true; break;
      default: break;
    }
  }
  return { out: s.out, halted, ram: Object.fromEntries(ram), screen: Object.fromEntries(screen), cycles: 2 * instructions };
}

/**
 * One run of a challenge: `words` (omitted when the user's own program is run) with `key` held
 * (undefined for a program that never reads it), until the CPU halts, then OUT and every byte the
 * program stored. The cycles allowed are the model's own and some more, so a correct circuit halts
 * well inside them. A second step clocks on past the halt: nothing may change, and `fetch` stays 0.
 */
export function run(name, words, key, { source, program = words } = {}) {
  const end = execute(program, key ?? 0);
  if (!end.halted) throw new Error(`${name} does not halt in the model`);
  const memory = {
    ...(Object.keys(end.ram).length > 0 && { ram: end.ram }),
    ...(Object.keys(end.screen).length > 0 && { screen: end.screen }),
  };
  return {
    name,
    ...(source !== undefined && { source }),
    ...(words && { words }),
    steps: [
      {
        ...(key !== undefined && { set: { key } }),
        cycles: end.cycles + 20,
        until: "halt",
        expect: { out: end.out },
        ...(Object.keys(memory).length > 0 && { memory }),
      },
      { cycles: 4, expect: { out: end.out, halt: 1, fetch: 0 }, ...(Object.keys(memory).length > 0 && { memory }) },
    ],
  };
}

// Challenge 10's programs: source as the assembler reads it, and its words written out by hand.
// crates/sim-core/tests/challenges.rs fails if `asm::assemble(source)` is not `words`. One program
// has no source: the assembler has no name for the reserved opcodes.
const PROGRAMS = [
  { name: "Load and show", source: "LDI 5\nOUT\nHLT", words: [0x1005, 0xb000, 0xc000] },
  {
    // Each jump is taken only with the right flag; a wrong one halts before OUT.
    name: "Add, subtract and flags",
    source: "LDI 200\nADI 100\nJC 5\nHLT\nHLT\nSBI 44\nJZ 8\nHLT\nLDI 3\nSBI 5\nJC 13\nOUT\nHLT\nHLT",
    words: [0x10c8, 0x6064, 0xa005, 0xc000, 0xc000, 0x702c, 0x9008, 0xc000, 0x1003, 0x7005, 0xa00d, 0xb000, 0xc000, 0xc000],
  },
  {
    name: "Store and load",
    source: "LDI 7\nSTA 16\nLDI 9\nSTA 17\nLDA 16\nADD 17\nSTA 18\nSUB 16\nOUT\nHLT",
    words: [0x1007, 0x3010, 0x1009, 0x3011, 0x2010, 0x4011, 0x3012, 0x5010, 0xb000, 0xc000],
  },
  {
    // Counts up once for each count down from the key: a loop whose length the key decides.
    name: "Count to the key",
    source: "LDA 0xFF\nSTA 0\nLDA 1\nADI 1\nSTA 1\nLDA 0\nSBI 1\nSTA 0\nJZ 10\nJMP 2\nLDA 1\nOUT\nHLT",
    words: [0x20ff, 0x3000, 0x2001, 0x6001, 0x3001, 0x2000, 0x7001, 0x3000, 0x900a, 0x8002, 0x2001, 0xb000, 0xc000],
    keys: [3, 9],
  },
  {
    name: "Branch on the key",
    source: "LDA 0xFF\nSBI 10\nJC 6\nLDI 1\nOUT\nHLT\nLDI 2\nOUT\nHLT",
    words: [0x20ff, 0x700a, 0xa006, 0x1001, 0xb000, 0xc000, 0x1002, 0xb000, 0xc000],
    keys: [4, 200],
  },
  {
    // Z and C survive every instruction that does not set them (LDI and LDA leave C; STA, OUT, NOP and
    // jumps leave both); ADD and SUB of a RAM byte set them; A changes after an OUT, which must not
    // show; and the words after the HLT would change OUT if the CPU did not stop.
    name: "Flags are kept",
    source:
      "LDI 200\nADI 100\nSTA 16\nLDI 0\nSTA 17\nOUT\nNOP\nJC 9\nHLT\nJZ 11\nHLT\nLDA 16\nADD 16\nJC 23\nSUB 16\nSUB 16\nJZ 18\nHLT\nJC 20\nHLT\nLDI 6\nOUT\nLDI 9\nHLT\nLDI 8\nOUT",
    words: [0x10c8, 0x6064, 0x3010, 0x1000, 0x3011, 0xb000, 0x0000, 0xa009, 0xc000, 0x900b, 0xc000, 0x2010, 0x4010, 0xa017, 0x5010, 0x5010, 0x9012, 0xc000, 0xa014, 0xc000, 0x1006, 0xb000, 0x1009, 0xc000, 0x1008, 0xb000],
  },
  {
    // Opcodes D, E and F do nothing, whatever their other bits.
    name: "Reserved opcodes",
    words: [0x1005, 0xd000, 0xe0ff, 0xf012, 0xb000, 0xc000],
  },
  {
    // A reserved address stores nothing and reads 0; NOP does nothing; the screen is reached through SPTR.
    name: "Devices",
    source: "LDI 9\nSTA 0xF0\nNOP\nLDA 0xF0\nJZ 6\nHLT\nLDI 3\nSTA 0xFE\nLDI 0x81\nSTA 0xFD\nLDA 0xFE\nOUT\nHLT",
    words: [0x1009, 0x30f0, 0x0000, 0x20f0, 0x9006, 0xc000, 0x1003, 0x30fe, 0x1081, 0x30fd, 0x20fe, 0xb000, 0xc000],
  },
];

/** Challenge 10's runs: each program once, or once for each of its keys. */
export const cpuRuns = PROGRAMS.flatMap(({ name, source, words, keys }) =>
  keys ? keys.map((key) => run(`${name}, key ${key}`, words, key, { source })) : [run(name, words, undefined, { source })],
);
