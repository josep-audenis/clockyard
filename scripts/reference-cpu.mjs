// Writes examples/reference-cpu.clockyard.json: the reference CPU of ADR 0019,
// built from Clockyard parts, as specified in docs/reference-cpu.md, with the
// memory-mapped devices of ADR 0022.
//
//   node scripts/reference-cpu.mjs           writes the file
//   node scripts/reference-cpu.mjs --check   fails if the file is not what it would write
//
// The circuit is generated so it can be regenerated, diffed and kept in step
// with the specification. The 8-bit adder and its full adder are copied from
// examples/8-bit-adder.clockyard.json, so a change there is picked up here.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** A part: `props` holds label, width, fields, addressWidth, data and source as the editor stores them. */
const part = (id, kind, x, y, props = {}, extra = {}) => ({ id, kind, ...extra, position: { x, y }, rotation: 0, props });
const chip = (id, definition, x, y, props = {}) => part(id, "custom", x, y, props, { definition });

/** Wires from "part.port" to "part.port"; ids w0, w1, … per circuit. */
function wires(pairs) {
  const end = (spec) => {
    const [component, port] = spec.split(".");
    return { component, port };
  };
  return pairs.map(([from, to], i) => ({ id: `w${i}`, from: end(from), to: end(to) }));
}

const ones = (n) => Array(n).fill(1);

// --- Pieces used many times ------------------------------------------------

/** 8-bit 2-to-1 multiplexer: out = s ? b : a. A 1-bit select drives all 8 bits through a merger. */
const mux8 = {
  id: "mux8",
  name: "Mux 8",
  circuit: {
    components: [
      part("a", "switch", 0, 0, { label: "a", width: 8 }),
      part("b", "switch", 0, 4, { label: "b", width: 8 }),
      part("s", "switch", 0, 8, { label: "s" }),
      part("fill", "merge", 8, 6, { fields: ones(8) }),
      part("ns", "not", 14, 6, { width: 8 }),
      part("ga", "and", 20, 0, { width: 8 }),
      part("gb", "and", 20, 6, { width: 8 }),
      part("go", "or", 28, 2, { width: 8 }),
      part("out", "led", 36, 2, { label: "out", width: 8 }),
    ],
    junctions: [],
    wires: wires([
      ...Array.from({ length: 8 }, (_, i) => ["s.out", `fill.f${i}`]),
      ["fill.out", "ns.in"],
      ["a.out", "ga.a"],
      ["ns.out", "ga.b"],
      ["b.out", "gb.a"],
      ["fill.out", "gb.b"],
      ["ga.out", "go.a"],
      ["gb.out", "go.b"],
      ["go.out", "out.in"],
    ]),
  },
};

/** A register of `width` bits with load enable: on a rising clk, q takes d if en, else keeps its value. */
function register(id, name, width) {
  const wide = width > 1;
  const enable = wide
    ? [part("fill", "merge", 6, 4, { fields: ones(width) }), part("ne", "not", 12, 8, { width })]
    : [part("ne", "not", 6, 8)];
  const sized = wide ? { width } : {};
  return {
    id,
    name,
    circuit: {
      components: [
        part("d", "switch", 0, 0, { label: "d", ...sized }),
        part("en", "switch", 0, 4, { label: "en" }),
        part("clk", "switch", 0, 12, { label: "clk" }),
        ...enable,
        part("g1", "and", 18, 0, sized),
        part("g2", "and", 18, 6, sized),
        part("g3", "or", 26, 2, sized),
        part("r", "dff", 32, 2, sized),
        part("q", "led", 42, 2, { label: "q", ...sized }),
      ],
      junctions: [],
      wires: wires([
        ...(wide ? Array.from({ length: width }, (_, i) => ["en.out", `fill.f${i}`]) : []),
        [wide ? "fill.out" : "en.out", "ne.in"],
        ["d.out", "g1.a"],
        [wide ? "fill.out" : "en.out", "g1.b"],
        ["r.q", "g2.a"],
        ["ne.out", "g2.b"],
        ["g1.out", "g3.a"],
        ["g2.out", "g3.b"],
        ["g3.out", "r.d"],
        ["clk.out", "r.clk"],
        ["r.q", "q.in"],
      ]),
    },
  };
}

// --- The control ROM: one word per opcode -----------------------------------

const CONTROL = ["aLoad", "aFromRam", "aFromAlu", "aluImm", "sub", "cLoad", "outLoad", "ramWe", "jmp", "jz", "jc", "hlt"];
const bit = Object.fromEntries(CONTROL.map((name, i) => [name, 1 << i]));
const word = (...names) => names.reduce((w, n) => w | bit[n], 0);
/** Control words by opcode, from the instruction table in docs/reference-cpu.md; 0xD–0xF do nothing. */
const control = [
  word(), // NOP
  word("aLoad"), // LDI n
  word("aLoad", "aFromRam"), // LDA n
  word("ramWe"), // STA n
  word("aLoad", "aFromAlu", "cLoad"), // ADD n
  word("aLoad", "aFromAlu", "sub", "cLoad"), // SUB n
  word("aLoad", "aFromAlu", "aluImm", "cLoad"), // ADI n
  word("aLoad", "aFromAlu", "aluImm", "sub", "cLoad"), // SBI n
  word("jmp"), // JMP n
  word("jz"), // JZ n
  word("jc"), // JC n
  word("outLoad"), // OUT
  word("hlt"), // HLT
];
const field = (name) => `cs.f${CONTROL.indexOf(name)}`;

// --- The I/O decoder: one word per data address (ADR 0022) -------------------

const IO = ["io", "key", "sptr", "sdata", "hex"];
const ioBit = (name) => 1 << IO.indexOf(name);
/** 0x00-0xEF are RAM (0); 0xF0-0xFF are I/O, and four of them name a device (docs/reference-cpu.md, I/O). */
const iodec = Array.from({ length: 256 }, (_, n) => {
  if (n < 0xf0) return 0;
  const device = { 0xff: "key", 0xfe: "sptr", 0xfd: "sdata", 0xfc: "hex" }[n];
  return ioBit("io") | (device ? ioBit(device) : 0);
});
const io = (name) => `ios.f${IO.indexOf(name)}`;
/** Seven-segment patterns of the hex digits, segment a on bit 0 (ADR 0021). */
const HEX_DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

// --- The main sheet -----------------------------------------------------------

const program = "        LDI 5\n        ADI 3\n        OUT\n        HLT\n";

const components = [
  // Clock and constants: XNOR and XOR of a net with itself are 1 and 0.
  part("clk", "clock", 0, 0, { label: "Clock" }),
  part("one", "xnor", 6, 0),
  part("zero", "xor", 6, 6),
  part("zero8", "merge", 14, 6, { fields: ones(8) }),

  // Fetch: ROM[PC] into IR, PC + 1 into PC.
  part("rom", "rom", 22, 14, { label: "Program", width: 16, data: [0x1005, 0x6003, 0xb000, 0xc000], source: program }),
  part("romsplit", "split", 30, 14, { fields: [8, 8] }),
  chip("irl", "reg8", 36, 12, { label: "IR low" }),
  chip("irh", "reg8", 36, 20, { label: "IR high" }),
  part("irmerge", "merge", 44, 16, { fields: [8, 8] }),
  part("irled", "led", 50, 16, { label: "IR", width: 16 }),
  part("opsplit", "split", 44, 24, { fields: [4, 4] }),
  chip("inc", "adder8", 14, 18, { label: "PC + 1" }),
  chip("pcmux", "mux8", 22, 26, { label: "PC source" }),
  chip("pc", "reg8", 28, 26, { label: "PC" }),
  part("pcled", "led", 36, 30, { label: "PC", width: 8 }),

  // Control: the opcode addresses a control ROM; its bits are gated by the phase.
  part("ctl", "rom", 50, 24, { label: "Control", width: 12, addressWidth: 4, data: control }),
  part("cs", "split", 58, 24, { fields: ones(12) }),
  chip("t", "reg1", 0, 36, { label: "T" }),
  chip("h", "reg1", 0, 46, { label: "H" }),
  part("nt", "not", 8, 36),
  part("nh", "not", 8, 46),
  part("fetch", "and", 14, 38),
  part("exec", "and", 14, 46),
  part("aen", "and", 66, 20),
  part("cen", "and", 66, 26),
  part("outen", "and", 66, 32),
  part("we", "and", 66, 38),
  part("hlten", "and", 66, 44),
  part("jzt", "and", 72, 50),
  part("jct", "and", 72, 56),
  part("j1", "or", 80, 50),
  part("j2", "or", 86, 52),
  part("jump", "and", 92, 50),
  part("pcen", "or", 20, 40),

  // Execute: the ALU, A and its sources, the flags, RAM and the output register.
  part("ram", "ram", 74, 4, { label: "Data", width: 8 }),
  chip("bmux", "mux8", 82, 4, { label: "ALU B" }),
  part("subfill", "merge", 82, 14, { fields: ones(8) }),
  part("x8", "xor", 90, 6, { width: 8 }),
  chip("alu", "adder8", 98, 4, { label: "ALU" }),
  chip("amux1", "mux8", 106, 14, { label: "A source" }),
  chip("amux2", "mux8", 114, 14, { label: "A or ALU" }),
  chip("a", "reg8", 122, 14, { label: "A" }),
  part("aled", "led", 130, 18, { label: "A", width: 8 }),
  part("zs", "split", 114, 26, { fields: ones(8) }),
  part("o1", "or", 120, 26),
  part("o2", "or", 120, 32),
  part("o3", "or", 120, 38),
  part("o4", "or", 120, 44),
  part("o5", "or", 126, 28),
  part("o6", "or", 126, 40),
  part("o7", "or", 132, 34),
  part("isz", "not", 138, 34),
  chip("z", "reg1", 144, 30, { label: "Z" }),
  chip("c", "reg1", 144, 40, { label: "C" }),
  part("zled", "led", 152, 34, { label: "Z" }),
  part("cled", "led", 152, 44, { label: "C" }),
  chip("outr", "reg8", 130, 0, { label: "OUT" }),
  part("outled", "led", 140, 4, { label: "Output", width: 8 }),

  // Status outputs (docs/reference-cpu.md): Fetch = ¬T ∧ ¬H, Halted = H.
  part("fetchled", "led", 22, 36, { label: "Fetch" }),
  part("haltled", "led", 22, 46, { label: "Halted" }),

  // I/O (ADR 0022): the operand decoded, RAM writes gated off above 0xEF, the device registers,
  // and the read bus choosing RAM or a device for LDA, ADD and SUB.
  part("iodec", "rom", 60, 62, { label: "I/O decoder", width: IO.length, addressWidth: 8, data: iodec }),
  part("ios", "split", 68, 62, { fields: ones(IO.length) }),
  part("nio", "not", 74, 62),
  part("ramwe", "and", 80, 62),
  part("sptren", "and", 74, 68),
  part("hexen", "and", 74, 74),
  part("sdwe", "and", 74, 80),
  chip("sptr", "reg8", 84, 66, { label: "SPTR" }),
  chip("hex", "reg8", 84, 76, { label: "HEX" }),
  chip("rd0", "mux8", 92, 62, { label: "I/O or RAM" }),
  chip("rd1", "mux8", 100, 62, { label: "KEY" }),
  chip("rd2", "mux8", 108, 62, { label: "SPTR" }),
  chip("rd3", "mux8", 116, 62, { label: "SDATA" }),
  chip("rd4", "mux8", 124, 62, { label: "HEX" }),

  // The devices: the keyboard, a 64 x 32 screen, and HEX on two digits.
  part("key", "keyboard", 0, 62, { label: "Keyboard" }),
  part("screen", "screen", 96, 74, { label: "Screen", width: 8, addressWidth: 8, columns: 64 }),
  part("hexsplit", "split", 120, 76, { fields: [4, 4] }),
  part("hexhighrom", "rom", 126, 74, { label: "High digit", width: 8, addressWidth: 4, data: HEX_DIGITS }),
  part("hexlowrom", "rom", 126, 82, { label: "Low digit", width: 8, addressWidth: 4, data: HEX_DIGITS }),
  part("hexhigh", "seg7", 134, 76, { label: "HEX high" }),
  part("hexlow", "seg7", 138, 76, { label: "HEX low" }),
];

const clocked = ["irl", "irh", "pc", "t", "h", "a", "z", "c", "outr", "sptr", "hex"];
const main = wires([
  ["clk.out", "one.a"],
  ["clk.out", "one.b"],
  ["clk.out", "zero.a"],
  ["clk.out", "zero.b"],
  ...Array.from({ length: 8 }, (_, i) => ["zero.out", `zero8.f${i}`]),
  ...clocked.map((r) => ["clk.out", `${r}.clk`]),
  ["clk.out", "ram.clk"],
  ["clk.out", "screen.clk"],

  // Phase and halt.
  ["t.q", "nt.in"],
  ["h.q", "nh.in"],
  ["nt.out", "t.d"],
  ["nh.out", "t.en"],
  ["one.out", "h.d"],
  ["hlten.out", "h.en"],
  ["nt.out", "fetch.a"],
  ["nh.out", "fetch.b"],
  ["t.q", "exec.a"],
  ["nh.out", "exec.b"],

  // Fetch.
  ["pc.q", "rom.addr"],
  ["rom.out", "romsplit.in"],
  ["romsplit.f0", "irl.d"],
  ["romsplit.f1", "irh.d"],
  ["fetch.out", "irl.en"],
  ["fetch.out", "irh.en"],
  ["irl.q", "irmerge.f0"],
  ["irh.q", "irmerge.f1"],
  ["irmerge.out", "irled.in"],
  ["irh.q", "opsplit.in"],
  ["pc.q", "inc.a"],
  ["zero8.out", "inc.b"],
  ["one.out", "inc.cin"],
  ["inc.sum", "pcmux.a"],
  ["irl.q", "pcmux.b"],
  ["jump.out", "pcmux.s"],
  ["pcmux.out", "pc.d"],
  ["fetch.out", "pcen.a"],
  ["jump.out", "pcen.b"],
  ["pcen.out", "pc.en"],
  ["pc.q", "pcled.in"],

  // Control.
  ["opsplit.f1", "ctl.addr"],
  ["ctl.out", "cs.in"],
  [field("aLoad"), "aen.a"],
  ["exec.out", "aen.b"],
  [field("cLoad"), "cen.a"],
  ["exec.out", "cen.b"],
  [field("outLoad"), "outen.a"],
  ["exec.out", "outen.b"],
  [field("ramWe"), "we.a"],
  ["exec.out", "we.b"],
  [field("hlt"), "hlten.a"],
  ["exec.out", "hlten.b"],
  [field("jz"), "jzt.a"],
  ["z.q", "jzt.b"],
  [field("jc"), "jct.a"],
  ["c.q", "jct.b"],
  [field("jmp"), "j1.a"],
  ["jzt.out", "j1.b"],
  ["j1.out", "j2.a"],
  ["jct.out", "j2.b"],
  ["j2.out", "jump.a"],
  ["exec.out", "jump.b"],

  // Execute.
  ["irl.q", "ram.addr"],
  ["a.q", "ram.din"],
  ["ramwe.out", "ram.we"],
  ["rd4.out", "bmux.a"],
  ["irl.q", "bmux.b"],
  [field("aluImm"), "bmux.s"],
  ...Array.from({ length: 8 }, (_, i) => [field("sub"), `subfill.f${i}`]),
  ["bmux.out", "x8.a"],
  ["subfill.out", "x8.b"],
  ["a.q", "alu.a"],
  ["x8.out", "alu.b"],
  [field("sub"), "alu.cin"],
  ["irl.q", "amux1.a"],
  ["rd4.out", "amux1.b"],
  [field("aFromRam"), "amux1.s"],
  ["amux1.out", "amux2.a"],
  ["alu.sum", "amux2.b"],
  [field("aFromAlu"), "amux2.s"],
  ["amux2.out", "a.d"],
  ["aen.out", "a.en"],
  ["a.q", "aled.in"],
  ["amux2.out", "zs.in"],
  ["zs.f0", "o1.a"],
  ["zs.f1", "o1.b"],
  ["zs.f2", "o2.a"],
  ["zs.f3", "o2.b"],
  ["zs.f4", "o3.a"],
  ["zs.f5", "o3.b"],
  ["zs.f6", "o4.a"],
  ["zs.f7", "o4.b"],
  ["o1.out", "o5.a"],
  ["o2.out", "o5.b"],
  ["o3.out", "o6.a"],
  ["o4.out", "o6.b"],
  ["o5.out", "o7.a"],
  ["o6.out", "o7.b"],
  ["o7.out", "isz.in"],
  ["isz.out", "z.d"],
  ["aen.out", "z.en"],
  ["alu.cout", "c.d"],
  ["cen.out", "c.en"],
  ["z.q", "zled.in"],
  ["c.q", "cled.in"],
  ["a.q", "outr.d"],
  ["outen.out", "outr.en"],
  ["outr.q", "outled.in"],

  // Status.
  ["fetch.out", "fetchled.in"],
  ["h.q", "haltled.in"],

  // I/O: decode, write enables, device registers, the read bus.
  ["irl.q", "iodec.addr"],
  ["iodec.out", "ios.in"],
  [io("io"), "nio.in"],
  ["we.out", "ramwe.a"],
  ["nio.out", "ramwe.b"],
  ["we.out", "sptren.a"],
  [io("sptr"), "sptren.b"],
  ["we.out", "hexen.a"],
  [io("hex"), "hexen.b"],
  ["we.out", "sdwe.a"],
  [io("sdata"), "sdwe.b"],
  ["a.q", "sptr.d"],
  ["sptren.out", "sptr.en"],
  ["a.q", "hex.d"],
  ["hexen.out", "hex.en"],
  ["sptr.q", "screen.addr"],
  ["a.q", "screen.din"],
  ["sdwe.out", "screen.we"],
  ["ram.out", "rd0.a"],
  ["zero8.out", "rd0.b"],
  [io("io"), "rd0.s"],
  ["rd0.out", "rd1.a"],
  ["key.out", "rd1.b"],
  [io("key"), "rd1.s"],
  ["rd1.out", "rd2.a"],
  ["sptr.q", "rd2.b"],
  [io("sptr"), "rd2.s"],
  ["rd2.out", "rd3.a"],
  ["screen.out", "rd3.b"],
  [io("sdata"), "rd3.s"],
  ["rd3.out", "rd4.a"],
  ["hex.q", "rd4.b"],
  [io("hex"), "rd4.s"],
  ["hex.q", "hexsplit.in"],
  ["hexsplit.f1", "hexhighrom.addr"],
  ["hexsplit.f0", "hexlowrom.addr"],
  ["hexhighrom.out", "hexhigh.seg"],
  ["hexlowrom.out", "hexlow.seg"],
]);

const adder = JSON.parse(readFileSync(root("examples/8-bit-adder.clockyard.json"), "utf8"));
const document = {
  format: "clockyard",
  version: 9,
  metadata: { name: "Reference CPU", createdAt: "2026-11-10T12:00:00.000Z", modifiedAt: "2026-11-10T12:00:00.000Z" },
  circuit: { components, junctions: [], wires: main },
  definitions: [
    mux8,
    register("reg8", "Register 8", 8),
    register("reg1", "Register 1", 1),
    { id: "adder8", name: "8-bit adder", circuit: adder.circuit },
    ...adder.definitions,
  ],
};
const target = root("examples/reference-cpu.clockyard.json");
const text = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes("--check")) {
  // Line endings may follow the checkout's settings; the content may not differ.
  if (readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== text) {
    console.error("examples/reference-cpu.clockyard.json is out of date: run node scripts/reference-cpu.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(target, text);
  console.log(`examples/reference-cpu.clockyard.json: ${components.length} parts, ${main.length} wires on the main sheet`);
}
