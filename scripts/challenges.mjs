// Writes the challenges of ADR 0025 into challenges/: for each, the challenge
// (NN-name.json), a reference solution (solutions/NN-name.clockyard.json) and
// the starter the editor opens (starters/NN-name.clockyard.json). And the benches
// of ADR 0034 (benches/), with the reference parts on them, from scripts/computer.mjs.
//
//   node scripts/challenges.mjs           writes the files
//   node scripts/challenges.mjs --check   fails if a file is not what it would write
//
// Steps are written out as data. crates/sim-core/tests/challenges.rs holds them
// against the solutions, run in the engine, and checks every starter fails.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computers, program } from "./computer.mjs";
import { cpuRuns, displayRuns, programRuns, SUM } from "./cpu-runs.mjs";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const part = (id, kind, x, y, props = {}, extra = {}) => ({ id, kind, ...extra, position: { x, y }, rotation: 0, props });
const chip = (id, definition, x, y) => part(id, "custom", x, y, {}, { definition });

/** Wires from "part.port" to "part.port"; ids w0, w1, … per circuit. */
function wires(pairs) {
  const end = (spec) => {
    const [component, port] = spec.split(".");
    return { component, port };
  };
  return pairs.map(([from, to], i) => ({ id: `w${i}`, from: end(from), to: end(to) }));
}

const GATES = ["not", "and", "nand", "or", "nor", "xor", "xnor"];
const ones = (n) => Array(n).fill(1);

/** Pin parts, labelled with their IDs: inputs down the left, outputs down the right. */
function pins(inputs, outputs, right) {
  const pin = (kind, x) => ([name, width], i) => part(name, kind, x, i * 4, { label: name, ...(width > 1 ? { width } : {}) });
  return [...inputs.map(pin("switch", 0)), ...outputs.map(pin("led", right))];
}

/** Every combination of 1-bit inputs, first input most significant. */
function table(names, outputs) {
  return Array.from({ length: 2 ** names.length }, (_, row) => {
    const set = Object.fromEntries(names.map((n, i) => [n, (row >> (names.length - 1 - i)) & 1]));
    return { set, expect: outputs(set) };
  });
}

/** A fixed pseudo-random sequence (an LCG), so the steps never change between runs. */
function* random(seed) {
  let x = seed;
  for (;;) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    yield x >>> 16;
  }
}

const fullAdder = {
  id: "full-adder",
  name: "Full adder",
  circuit: {
    components: [
      ...pins([["A", 1], ["B", 1], ["Cin", 1]], [["S", 1], ["Cout", 1]], 30),
      part("x1", "xor", 8, 0),
      part("x2", "xor", 18, 0),
      part("n1", "and", 8, 8),
      part("n2", "and", 18, 6),
      part("o", "or", 24, 8),
    ],
    junctions: [],
    wires: wires([
      ["A.out", "x1.a"],
      ["B.out", "x1.b"],
      ["x1.out", "x2.a"],
      ["Cin.out", "x2.b"],
      ["x2.out", "S.in"],
      ["A.out", "n1.a"],
      ["B.out", "n1.b"],
      ["x1.out", "n2.a"],
      ["Cin.out", "n2.b"],
      ["n1.out", "o.a"],
      ["n2.out", "o.b"],
      ["o.out", "Cout.in"],
    ]),
  },
};

function adder8() {
  const fa = Array.from({ length: 8 }, (_, i) => chip(`fa${i}`, "full-adder", 20, i * 8));
  const bits = Array.from({ length: 8 }, (_, i) => [
    [`sa.f${i}`, `fa${i}.A`],
    [`sb.f${i}`, `fa${i}.B`],
    [`fa${i}.S`, `ms.f${i}`],
    [i === 0 ? "Cin.out" : `fa${i - 1}.Cout`, `fa${i}.Cin`],
  ]).flat();
  return {
    id: "adder8",
    name: "8-bit adder",
    circuit: {
      components: [
        ...pins([["A", 8], ["B", 8], ["Cin", 1]], [["S", 8], ["Cout", 1]], 44),
        part("sa", "split", 8, 0, { fields: ones(8) }),
        part("sb", "split", 8, 8, { fields: ones(8) }),
        ...fa,
        part("ms", "merge", 32, 0, { fields: ones(8) }),
      ],
      junctions: [],
      wires: wires([["A.out", "sa.in"], ["B.out", "sb.in"], ...bits, ["ms.out", "S.in"], ["fa7.Cout", "Cout.in"]]),
    },
  };
}

function adderSteps() {
  const edges = [
    [0, 0, 0],
    [1, 1, 0],
    [255, 1, 0],
    [255, 0, 1],
    [255, 255, 1],
    [128, 128, 0],
    [0x55, 0xaa, 0],
    [0x55, 0xaa, 1],
    [0x0f, 0x01, 0],
    [0x7f, 0x01, 0],
  ];
  const r = random(25);
  const more = Array.from({ length: 22 }, () => [r.next().value & 255, r.next().value & 255, r.next().value & 1]);
  return [...edges, ...more].map(([A, B, Cin]) => {
    const total = A + B + Cin;
    return { set: { A, B, Cin }, expect: { S: total & 255, Cout: total >> 8 } };
  });
}

/**
 * Steps for a clocked circuit, from a model of it. An object sets inputs with clk low; "pulse" raises clk, then
 * lowers it; `{ high }` is a pulse that also sets inputs while clk is high. Nothing changes in the step that raises
 * clk, so each edge samples inputs that have settled, and an input changed while clk is high must change nothing:
 * a clock gated by such an input fails. `next` gives the state after a rising edge; the output is expected to show
 * the state after every step. Every input starts at 0.
 */
function clocked(output, next, inputs, ops) {
  let state = 0;
  const expect = () => {
    if (!Number.isInteger(state)) throw new Error(`the model's state is ${state}`);
    return { [output]: state };
  };
  return ops.flatMap((op) => {
    if (op !== P && !op.high) {
      Object.assign(inputs, op);
      return [{ set: op, expect: expect() }];
    }
    state = next(inputs, state);
    const rise = { set: { clk: 1 }, expect: expect() };
    if (op.high) Object.assign(inputs, op.high);
    return [rise, ...(op.high ? [{ set: op.high, expect: expect() }] : []), { set: { clk: 0 }, expect: expect() }];
  });
}
const P = "pulse";
const pulses = (n) => Array(n).fill(P);
const holds = (i, q) => (i.load ? i.D : q);

/** A register's parts: d = load ? D : q from gates `width` bits wide, into a flip-flop; `load` names a signal that wide. */
function register(width, load) {
  const w = width > 1 ? { width } : {};
  return {
    parts: [part("nl", "not", 8, 10, w), part("a1", "and", 14, 0, w), part("a2", "and", 14, 8, w), part("o", "or", 20, 4, w), part("ff", "dff", 26, 4, w)],
    wires: [
      ["D.out", "a1.a"],
      [load, "a1.b"],
      [load, "nl.in"],
      ["ff.q", "a2.a"],
      ["nl.out", "a2.b"],
      ["a1.out", "o.a"],
      ["a2.out", "o.b"],
      ["o.out", "ff.d"],
      ["clk.out", "ff.clk"],
      ["ff.q", "Q.in"],
    ],
  };
}

/** A 1-bit signal fanned out to 8 bits through a merge `id`, fed by `from`. */
const widen = (id, from, x, y) => ({
  part: part(id, "merge", x, y, { fields: ones(8) }),
  wires: Array.from({ length: 8 }, (_, i) => [from, `${id}.f${i}`]),
});

function register1() {
  const { parts, wires: inside } = register(1, "load.out");
  return {
    id: "register",
    name: "One-bit register",
    circuit: { components: [...pins([["D", 1], ["load", 1], ["clk", 1]], [["Q", 1]], 34), ...parts], junctions: [], wires: wires(inside) },
  };
}

function register8() {
  const { parts, wires: inside } = register(8, "lw.out");
  const load = widen("lw", "load.out", 4, 10);
  return {
    id: "register8",
    name: "8-bit register",
    circuit: {
      components: [...pins([["D", 8], ["load", 1], ["clk", 1]], [["Q", 8]], 34), load.part, ...parts],
      junctions: [],
      wires: wires([...load.wires, ...inside]),
    },
  };
}

function counter8() {
  const bits = Array.from({ length: 8 }, (_, i) => i);
  return {
    id: "counter8",
    name: "8-bit counter",
    circuit: {
      components: [
        ...pins([["en", 1], ["clr", 1], ["clk", 1]], [["Q", 8]], 52),
        part("ff", "dff", 44, 0, { width: 8 }),
        part("sq", "split", 8, 0, { fields: ones(8) }),
        part("nc", "not", 8, 40),
        ...bits.map((i) => part(`x${i}`, "xor", 20, i * 5)),
        ...bits.slice(0, 7).map((i) => part(`h${i}`, "and", 26, i * 5 + 2)),
        ...bits.map((i) => part(`k${i}`, "and", 32, i * 5)),
        part("m", "merge", 38, 0, { fields: ones(8) }),
      ],
      junctions: [],
      // q + en, a half adder per bit with en as the first carry; then each bit cleared while clr is 1.
      wires: wires([
        ["ff.q", "sq.in"],
        ["clr.out", "nc.in"],
        ...bits.flatMap((i) => {
          const carry = i === 0 ? "en.out" : `h${i - 1}.out`;
          return [
            [`sq.f${i}`, `x${i}.a`],
            [carry, `x${i}.b`],
            ...(i < 7 ? [[`sq.f${i}`, `h${i}.a`], [carry, `h${i}.b`]] : []),
            [`x${i}.out`, `k${i}.a`],
            ["nc.out", `k${i}.b`],
            [`k${i}.out`, `m.f${i}`],
          ];
        }),
        ["m.out", "ff.d"],
        ["clk.out", "ff.clk"],
        ["ff.q", "Q.in"],
      ]),
    },
  };
}

function alu() {
  const s = widen("sw", "sub.out", 8, 12);
  return {
    id: "alu",
    name: "ALU",
    circuit: {
      components: [
        ...pins([["A", 8], ["B", 8], ["sub", 1]], [["Y", 8], ["C", 1], ["Z", 1]], 50),
        s.part,
        part("bx", "xor", 14, 4, { width: 8 }),
        chip("ad", "adder8", 22, 0),
        part("sy", "split", 30, 10, { fields: ones(8) }),
        ...[0, 1, 2, 3, 4, 5].map((i) => part(`o${i}`, "or", 36 + (i >> 2) * 6, (i % 4) * 4 + 8)),
        part("z", "nor", 46, 12),
      ],
      junctions: [],
      // B, inverted when subtracting, plus sub as the carry in: A - B is A + ~B + 1.
      wires: wires([
        ...s.wires,
        ["B.out", "bx.a"],
        ["sw.out", "bx.b"],
        ["A.out", "ad.A"],
        ["bx.out", "ad.B"],
        ["sub.out", "ad.Cin"],
        ["ad.S", "Y.in"],
        ["ad.Cout", "C.in"],
        ["ad.S", "sy.in"],
        ...[0, 1, 2, 3].flatMap((i) => [
          [`sy.f${2 * i}`, `o${i}.a`],
          [`sy.f${2 * i + 1}`, `o${i}.b`],
        ]),
        ["o0.out", "o4.a"],
        ["o1.out", "o4.b"],
        ["o2.out", "o5.a"],
        ["o3.out", "o5.b"],
        ["o4.out", "z.a"],
        ["o5.out", "z.b"],
        ["z.out", "Z.in"],
      ]),
    },
  };
}

function aluSteps() {
  const edges = [
    [0, 0, 0],
    [5, 5, 1],
    [3, 5, 1],
    [255, 1, 0],
    [0, 1, 1],
    [128, 128, 0],
    [200, 100, 1],
    [100, 200, 1],
    [0x55, 0xaa, 0],
    [255, 255, 1],
  ];
  // Every single bit of Y alone, so a Z that misses one fails; A - 0, whose carry is 1 (nothing borrowed).
  const bits = Array.from({ length: 8 }, (_, i) => [1 << i, 0, 0]);
  const minusZero = [
    [0, 0, 1],
    [7, 0, 1],
  ];
  const r = random(9);
  const more = Array.from({ length: 22 }, () => [r.next().value & 255, r.next().value & 255, r.next().value & 1]);
  return [...edges, ...bits, ...minusZero, ...more].map(([A, B, sub]) => {
    const total = A + (sub ? ~B & 255 : B) + sub;
    return { set: { A, B, sub }, expect: { Y: total & 255, C: total >> 8, Z: (total & 255) === 0 ? 1 : 0 } };
  });
}

const challenges = [
  {
    file: "01-inverter",
    title: "Inverter",
    text: "Build a NOT gate from NAND gates: Y is 1 when A is 0, and 0 when A is 1.",
    parts: ["nand"],
    definition: {
      id: "inverter",
      name: "Inverter",
      circuit: {
        components: [...pins([["A", 1]], [["Y", 1]], 20), part("g", "nand", 8, 0)],
        junctions: [],
        wires: wires([["A.out", "g.a"], ["A.out", "g.b"], ["g.out", "Y.in"]]),
      },
    },
    steps: table(["A"], ({ A }) => ({ Y: 1 - A })),
  },
  {
    file: "02-xor",
    title: "XOR from NAND gates",
    text: "Build XOR from NAND gates alone: Y is 1 when exactly one of A and B is 1.",
    parts: ["nand"],
    definition: {
      id: "xor",
      name: "XOR",
      circuit: {
        components: [
          ...pins([["A", 1], ["B", 1]], [["Y", 1]], 36),
          part("n1", "nand", 8, 2),
          part("n2", "nand", 18, 0),
          part("n3", "nand", 18, 6),
          part("n4", "nand", 28, 2),
        ],
        junctions: [],
        wires: wires([
          ["A.out", "n1.a"],
          ["B.out", "n1.b"],
          ["A.out", "n2.a"],
          ["n1.out", "n2.b"],
          ["n1.out", "n3.a"],
          ["B.out", "n3.b"],
          ["n2.out", "n4.a"],
          ["n3.out", "n4.b"],
          ["n4.out", "Y.in"],
        ]),
      },
    },
    steps: table(["A", "B"], ({ A, B }) => ({ Y: A ^ B })),
  },
  {
    file: "03-half-adder",
    title: "Half adder",
    text: "Add two bits: S is the sum bit of A + B, and C the carry.",
    parts: GATES,
    definition: {
      id: "half-adder",
      name: "Half adder",
      circuit: {
        components: [...pins([["A", 1], ["B", 1]], [["S", 1], ["C", 1]], 20), part("x", "xor", 8, 0), part("n", "and", 8, 4)],
        junctions: [],
        wires: wires([["A.out", "x.a"], ["B.out", "x.b"], ["x.out", "S.in"], ["A.out", "n.a"], ["B.out", "n.b"], ["n.out", "C.in"]]),
      },
    },
    steps: table(["A", "B"], ({ A, B }) => ({ S: A ^ B, C: A & B })),
  },
  {
    file: "04-full-adder",
    title: "Full adder",
    text: "Add three bits: S is the sum bit of A + B + Cin, and Cout the carry out.",
    parts: GATES,
    definition: fullAdder,
    steps: table(["A", "B", "Cin"], ({ A, B, Cin }) => ({ S: (A + B + Cin) & 1, Cout: (A + B + Cin) >> 1 })),
  },
  {
    file: "05-adder8",
    title: "8-bit adder",
    text: "Add two 8-bit numbers and a carry in: S is A + B + Cin modulo 256, and Cout is 1 when the sum is 256 or more. A full adder is provided.",
    parts: [...GATES, "split", "merge"],
    definition: adder8(),
    given: [fullAdder],
    steps: adderSteps(),
  },
  {
    file: "06-register",
    title: "One-bit register",
    text: "Store one bit: Q starts at 0. At each rising edge of clk, Q takes D when load is 1, and keeps its value when load is 0.",
    parts: [...GATES, "dff"],
    definition: register1(),
    steps: clocked("Q", holds, { D: 0, load: 0 }, [
      { D: 1 },
      P,
      { load: 1 },
      P,
      { D: 0 },
      { load: 0 },
      P,
      { load: 1 },
      P,
      { D: 1 },
      P,
      { load: 0 },
      { D: 0 },
      P,
      // load rising while clk is high is no edge.
      { high: { load: 1 } },
      P,
    ]),
  },
  {
    file: "07-register8",
    title: "8-bit register",
    text: "Store eight bits: Q starts at 0. At each rising edge of clk, Q takes D when load is 1, and keeps its value when load is 0.",
    parts: [...GATES, "dff", "split", "merge"],
    definition: register8(),
    // 0x12 and 0x0f read differently with their bits in another order, so every bit must go to its own place.
    steps: clocked("Q", holds, { D: 0, load: 0 }, [
      { D: 0x12 },
      P,
      { load: 1 },
      P,
      { D: 0x0f, load: 0 },
      P,
      { load: 1 },
      P,
      { D: 0xff },
      P,
      { D: 0 },
      { load: 0 },
      P,
      { load: 1 },
      P,
      { D: 0x5a, load: 0 },
      { high: { load: 1 } },
      P,
    ]),
  },
  {
    file: "08-counter8",
    title: "8-bit counter",
    text: "Count clock edges: Q starts at 0. At each rising edge of clk, Q goes back to 0 when clr is 1; otherwise it adds 1 when en is 1, wrapping from 255 to 0, and keeps its value when en is 0.",
    parts: [...GATES, "dff", "split", "merge"],
    definition: counter8(),
    steps: clocked("Q", (i, q) => (i.clr ? 0 : (q + i.en) & 255), { en: 0, clr: 0 }, [
      P,
      { en: 1 },
      ...pulses(3),
      { en: 0 },
      P,
      { clr: 1 },
      P,
      { clr: 0, en: 1 },
      ...pulses(2),
      { clr: 1 },
      P,
      { clr: 0, en: 0 },
      // en rising while clk is high is no edge.
      { high: { en: 1 } },
      // To 255, held there, then round to 0, so every carry is used.
      ...pulses(255),
      { en: 0 },
      P,
      { en: 1 },
      P,
      // To 254, then cleared with en 0, so clearing reaches every bit that is set.
      ...pulses(254),
      { en: 0, clr: 1 },
      P,
    ]),
  },
  {
    file: "09-alu",
    title: "ALU",
    text: "Add or subtract: Y is A + B, or A - B when sub is 1, modulo 256. C is the carry out; when subtracting it is 1 when nothing is borrowed (A is at least B). Z is 1 when Y is 0. An 8-bit adder is provided.",
    parts: [...GATES, "split", "merge"],
    definition: alu(),
    given: [adder8(), fullAdder],
    steps: aluSteps(),
  },
];

// Format 10 names the challenge, so an imported solution or starter opens with its panel.
const document = (name, challenge, definitions) => ({
  format: "clockyard",
  version: 10,
  metadata: { name, createdAt: "2026-11-15T12:00:00.000Z", modifiedAt: "2026-11-15T12:00:00.000Z", challenge },
  circuit: { components: [], junctions: [], wires: [] },
  definitions,
});

const files = [];

// The benches of ADR 0034, one per slot, and the reference parts on them: each a whole computer.
// The bench holds its slot empty; the solution is the same sheet with the reference part in it.
const computer = (name, sheet, definitions, challenge) => ({
  format: "clockyard",
  version: 11,
  metadata: { name, createdAt: "2026-11-21T12:00:00.000Z", modifiedAt: "2026-11-21T12:00:00.000Z", ...(challenge && { challenge }) },
  circuit: sheet,
  definitions,
});
for (const [slot, c] of Object.entries(computers)) {
  files.push([`challenges/benches/${slot}.clockyard.json`, computer(`Bench: ${slot}`, c.sheet, [c.empty, ...c.owned])]);
}

// Challenges checked on a bench (ADR 0034): the part to build sits in the bench's slot, and the starter
// is the bench itself, so the main sheet is a computer to run the part in.
const INSTRUCTIONS = [
  "0 NOP: nothing",
  "1 LDI n: A = n",
  "2 LDA n: A = RAM[n]",
  "3 STA n: RAM[n] = A",
  "4 ADD n: A = A + RAM[n]",
  "5 SUB n: A = A - RAM[n]",
  "6 ADI n: A = A + n",
  "7 SBI n: A = A - n",
  "8 JMP n: PC = n",
  "9 JZ n: PC = n if Z",
  "A JC n: PC = n if C",
  "B OUT: out = A",
  "C HLT: halt",
].join("; ");
const benchChallenges = [
  {
    file: "10-cpu",
    slot: "cpu",
    title: "CPU",
    text:
      "Build a CPU that runs programs. Each instruction is a 16-bit word: its top four bits are the opcode and its low eight the operand n. " +
      "It takes two clock cycles. In the first, the word on instr is kept and PC goes up by one; in the second, the instruction is carried out. " +
      `The opcodes: ${INSTRUCTIONS}. D to F do nothing. ` +
      "A and PC are 8 bits and wrap; everything starts at 0. " +
      "Whenever A is loaded (LDI, LDA and the four additions and subtractions), Z becomes 1 if the new A is 0, else 0. " +
      "An addition makes C 1 on a carry, else 0; a subtraction makes C 1 when nothing is borrowed, else 0. Every other instruction leaves Z and C as they are, and LDI and LDA leave C. " +
      "pc is the address of the next word. For RAM[n], put n on addr: the byte there arrives on din. To store, hold A on dout and we at 1 through the second cycle. " +
      "we is 0 at any other time. fetch is 1 during a first cycle. Once halted, halt is 1, fetch is 0 and nothing changes. " +
      "Registers, a multiplexer and an 8-bit adder are provided, and a ROM can decode the opcode. The main sheet is a computer to run your CPU in.",
    parts: [...GATES, "dff", "split", "merge", "rom"],
    runs: cpuRuns,
  },
  {
    file: "11-program",
    slot: "program",
    title: "Program",
    // The reference: the sum, by a loop that counts the key down.
    reference: program(SUM.words, SUM.source),
    text:
      "Write a program for the CPU. It reads a number from 1 to 22 at address 0xFF, adds up 1 + 2 + ... up to it, shows the sum with OUT, and halts: 5 gives 15. " +
      "Open Program, select its ROM, write the program in assembly, and press Assemble. " +
      `The instructions: ${INSTRUCTIONS}. n is a number, such as 16 or 0xFF. RAM[n] is a byte of memory you can use, for n from 0 to 0xEF. ` +
      "Z is set when A becomes 0, and C by an addition that carries or a subtraction that borrows nothing. " +
      "The main sheet is the computer: set Key, then step the Clock switch or wire a clock in to watch your program run.",
    parts: ["rom"],
    runs: programRuns,
  },
  {
    file: "12-display",
    slot: "display",
    title: "Display",
    text:
      "Connect the screen to the CPU. The CPU puts an address on addr and a byte on dout, with we at 1 through the clock cycle of a store. " +
      "sptr is the screen pointer, 8 bits: a store to address 0xFE sets it to dout at the rising clk, and nothing else changes it. " +
      "swe is 1 while a store to address 0xFD is under way, and 0 at any other time: the screen then takes dout at the byte sptr points to. " +
      "A register is provided. The main sheet is the computer, with the screen on it.",
    parts: [...GATES, "dff", "split", "merge"],
    runs: displayRuns,
  },
];
for (const c of benchChallenges) {
  const { empty, given, owned, sheet } = computers[c.slot];
  const reference = c.reference ?? computers[c.slot].reference;
  const pins = (kind) => reference.circuit.components.filter((p) => p.kind === kind).map((p) => ({ name: p.id, width: p.props.width ?? 1 }));
  files.push(
    [
      `challenges/${c.file}.json`,
      { title: c.title, text: c.text, definition: reference.id, bench: c.slot, inputs: pins("switch"), outputs: pins("led"), parts: c.parts, steps: [], runs: c.runs },
    ],
    [`challenges/solutions/${c.file}.clockyard.json`, computer(`${c.title}: solution`, sheet, [reference, ...given, ...owned], c.file)],
    [`challenges/starters/${c.file}.clockyard.json`, computer(c.title, sheet, [empty, ...given, ...owned], c.file)],
  );
}

for (const c of challenges) {
  const { id, circuit } = c.definition;
  const kinds = (kind) => circuit.components.filter((p) => p.kind === kind);
  const spec = (p) => ({ name: p.id, width: p.props.width ?? 1 });
  const challenge = {
    title: c.title,
    text: c.text,
    definition: id,
    inputs: kinds("switch").map(spec),
    outputs: kinds("led").map(spec),
    parts: c.parts,
    steps: c.steps,
  };
  const given = c.given ?? [];
  // The starter keeps only the pins, so there is nothing between them; provided parts stay.
  const starter = { ...c.definition, circuit: { components: [...kinds("switch"), ...kinds("led")], junctions: [], wires: [] } };
  files.push(
    [`challenges/${c.file}.json`, challenge],
    [`challenges/solutions/${c.file}.clockyard.json`, document(`${c.title}: solution`, c.file, [c.definition, ...given])],
    [`challenges/starters/${c.file}.clockyard.json`, document(c.title, c.file, [starter, ...given])],
  );
}

/** JSON as written: indented, except a challenge's steps, one to a line, so long step lists stay readable. */
function format(value) {
  if (!value.steps) return `${JSON.stringify(value, null, 2)}\n`;
  const lines = (items) => (items.length > 0 ? `[\n${items.map((s) => `    ${JSON.stringify(s)}`).join(",\n")}\n  ]` : "[]");
  return `${JSON.stringify({ ...value, steps: [], ...(value.runs && { runs: [] }) }, null, 2)
    .replace('"steps": []', () => `"steps": ${lines(value.steps)}`)
    .replace('"runs": []', () => `"runs": ${lines(value.runs ?? [])}`)}\n`;
}

let stale = false;
for (const [path, value] of files) {
  const text = format(value);
  if (process.argv.includes("--check")) {
    let current = null;
    try {
      // Line endings may follow the checkout's settings; the content may not differ.
      current = readFileSync(root(path), "utf8").replaceAll("\r\n", "\n");
    } catch {}
    if (current !== text) {
      console.error(`${path} is out of date: run node scripts/challenges.mjs`);
      stale = true;
    }
  } else {
    mkdirSync(root(path.slice(0, path.lastIndexOf("/"))), { recursive: true });
    writeFileSync(root(path), text);
  }
}
if (stale) process.exit(1);
if (!process.argv.includes("--check")) console.log(`${challenges.length + benchChallenges.length} challenges written to challenges/`);
