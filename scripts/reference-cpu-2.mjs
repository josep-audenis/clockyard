// Writes examples/reference-cpu-2.clockyard.json: Reference CPU 2 of ADR 0036, as specified in
// docs/reference-cpu-2.md. It is the first reference CPU's sheet (scripts/reference-cpu.mjs) with
// parts added and a few wires moved: a wider control ROM, a logic and shift unit beside the adder,
// a second source for C, JNZ, and a return stack.
//
//   node scripts/reference-cpu-2.mjs           writes the file
//   node scripts/reference-cpu-2.mjs --check   fails if the file is not what it would write

import { blocks, chip, CONTROL, control, ones, part, register, wires } from "./cpu-pieces.mjs";
import { components as first, emit, junctions, pairs as firstPairs } from "./reference-cpu.mjs";

// --- A small assembler --------------------------------------------------------

// Each mnemonic's word with operand 0, and whether it takes an operand: crates/asm's table. The
// native tests fail if a program here is not what crates/asm makes of its source.
const WORDS = {
  NOP: [0x0000, false], LDI: [0x1000, true], LDA: [0x2000, true], STA: [0x3000, true], ADD: [0x4000, true],
  SUB: [0x5000, true], ADI: [0x6000, true], SBI: [0x7000, true], JMP: [0x8000, true], JZ: [0x9000, true],
  JC: [0xa000, true], OUT: [0xb000, false], HLT: [0xc000, false], JNZ: [0xd000, true], AND: [0xf000, true],
  OR: [0xf100, true], XOR: [0xf200, true], ANI: [0xf300, true], ORI: [0xf400, true], XRI: [0xf500, true],
  SHL: [0xf600, false], SHR: [0xf700, false], CALL: [0xf800, true], RET: [0xf900, false],
};

/** `source` as ROM words. Only what the programs here use: labels, one instruction a line, comments. */
export function assemble(source) {
  const lines = [];
  const labels = new Map();
  for (const text of source.split("\n")) {
    let code = text.split(";")[0].trim();
    for (let colon = code.indexOf(":"); colon >= 0; colon = code.indexOf(":")) {
      labels.set(code.slice(0, colon).trim(), lines.length);
      code = code.slice(colon + 1).trim();
    }
    if (code) lines.push(code.split(/\s+/));
  }
  return lines.map(([mnemonic, operand]) => {
    const entry = WORDS[mnemonic.toUpperCase()];
    if (!entry || entry[1] !== (operand !== undefined)) throw new Error(`cannot assemble: ${mnemonic} ${operand ?? ""}`);
    const value = operand === undefined ? 0 : (labels.get(operand) ?? Number(operand));
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`bad operand: ${mnemonic} ${operand}`);
    return entry[0] | value;
  });
}

// --- The control ROM: one word per high byte of the instruction ----------------

// The first CPU's control bits, then: JNZ; the unit's result into A, and which (AND, OR, XOR, SHL
// by u1 and u0; SHR by u2); C from the bit a shift drops; CALL and RET.
const CONTROL2 = [...CONTROL, "jnz", "unit", "u0", "u1", "u2", "cShift", "call", "ret"];
const word2 = (...names) => names.reduce((w, n) => w | (1 << CONTROL2.indexOf(n)), 0);
const field2 = (name) => `cs.f${CONTROL2.indexOf(name)}`;
/** The ten instructions under opcode 0xF, by bits 11-8 (docs/reference-cpu-2.md); 0xA-0xF do nothing. */
const under = [
  word2("aLoad", "unit"), // AND n
  word2("aLoad", "unit", "u0"), // OR n
  word2("aLoad", "unit", "u1"), // XOR n
  word2("aLoad", "unit", "aluImm"), // ANI n
  word2("aLoad", "unit", "u0", "aluImm"), // ORI n
  word2("aLoad", "unit", "u1", "aluImm"), // XRI n
  word2("aLoad", "unit", "u0", "u1", "cLoad", "cShift"), // SHL
  word2("aLoad", "unit", "u2", "cLoad", "cShift"), // SHR
  word2("jmp", "call"), // CALL n
  word2("ret"), // RET
];
/**
 * The ROM is addressed by the instruction's whole high byte. For every opcode but 0xF the word
 * depends on the opcode alone, so bits 11-8 are ignored as on the first CPU; under 0xF they choose.
 */
const control2 = Array.from({ length: 256 }, (_, high) => {
  const [opcode, which] = [high >> 4, high & 15];
  if (opcode === 0xf) return under[which] ?? 0;
  if (opcode === 0xd) return word2("jnz");
  return control[opcode] ?? 0;
});

// --- The program the example opens with -----------------------------------------

// A diagonal of 32 single pixels, each lit by one shared routine: bit operations, shifts, CALL
// and RET, and a loop that ends in JNZ.
const program = [
  "; Draws a diagonal line, one pixel at a time: plot is called 32 times.",
  "; RAM: 0 the pixel's column and row, 1 to 3 scratch.",
  "",
  "        LDI 0",
  "        STA 0",
  "next:   CALL plot",
  "        LDA 0",
  "        ADI 1",
  "        STA 0",
  "        STA 0xFC        ; HEX: how many so far",
  "        SBI 32",
  "        JNZ next",
  "        LDA 0",
  "        OUT",
  "        HLT",
  "",
  "; plot: lights the pixel at column RAM[0], row RAM[0].",
  "plot:   LDA 0",
  "        SHL",
  "        SHL",
  "        SHL",
  "        STA 1           ; row * 8",
  "        LDA 0",
  "        SHR",
  "        SHR",
  "        SHR             ; column / 8",
  "        ADD 1",
  "        STA 0xFE        ; SPTR: the screen byte",
  "        LDA 0",
  "        ANI 7",
  "        STA 2           ; how far right in the byte",
  "        LDI 0x80        ; the leftmost pixel",
  "shift:  STA 3",
  "        LDA 2",
  "        JZ done",
  "        SBI 1",
  "        STA 2",
  "        LDA 3",
  "        SHR",
  "        JMP shift",
  "done:   LDA 3",
  "        OR 0xFD         ; SDATA: the pixels already there",
  "        STA 0xFD",
  "        RET",
  "",
].join("\n");

// --- The sheet -----------------------------------------------------------------

/** The first CPU's parts, with the program ROM and the control ROM and its splitter replaced. */
const kept = first
  .filter((c) => c.id !== "opsplit")
  .map((c) => {
    if (c.id === "rom") return { ...c, props: { ...c.props, data: assemble(program), source: program } };
    if (c.id === "ctl") return { ...c, props: { label: "Control", width: CONTROL2.length, addressWidth: 8, data: control2 } };
    if (c.id === "cs") return { ...c, props: { fields: ones(CONTROL2.length) } };
    return c;
  });

const added = [
  // JNZ: one more way to a jump.
  part("nz", "not", 92, 44),
  part("jnzt", "and", 98, 44),
  part("j3", "or", 98, 52),

  // The logic and shift unit: AND, OR and XOR of A with the ALU's B, and A moved one bit either way.
  part("land", "and", 82, 94, { width: 8 }),
  part("lor", "or", 82, 100, { width: 8 }),
  part("lxor", "xor", 82, 106, { width: 8 }),
  part("asplit", "split", 70, 112, { fields: ones(8) }),
  part("shlm", "merge", 78, 112, { fields: ones(8) }),
  part("shrm", "merge", 78, 124, { fields: ones(8) }),
  chip("m1", "mux8", 92, 94, { label: "AND or OR" }),
  chip("m2", "mux8", 92, 104, { label: "XOR or SHL" }),
  chip("m3", "mux8", 102, 98, { label: "Logic or shift" }),
  chip("m4", "mux8", 112, 102, { label: "Or SHR" }),
  chip("amux3", "mux8", 122, 102, { label: "A or unit" }),

  // C: the adder's carry, or the bit a shift drops (bit 7 going left, bit 0 going right).
  part("nu2", "not", 132, 112),
  part("sb1", "and", 138, 108),
  part("sb2", "and", 138, 114),
  part("sbo", "or", 146, 110),
  part("ncs", "not", 132, 122),
  part("c1", "and", 152, 104),
  part("c2", "and", 152, 112),
  part("co", "or", 160, 108),

  // The return stack: 16 bytes, a 4-bit pointer, and one adder that gives SP + 1 or SP - 1 (add 15).
  part("callx", "and", 0, 96),
  part("retx", "and", 0, 104),
  part("spen", "or", 8, 100),
  part("zero4", "merge", 0, 112, { fields: ones(4) }),
  chip("sp", "reg4", 16, 96, { label: "SP" }),
  part("spled", "led", 24, 106, { label: "SP", width: 4 }),
  part("spw", "merge", 26, 96, { fields: [4, 4] }),
  part("spb", "merge", 26, 112, { fields: ones(8) }),
  chip("spadd", "adder8", 34, 96, { label: "SP ± 1" }),
  part("sumsplit", "split", 44, 108, { fields: [4, 4] }),
  chip("spmux", "mux8", 44, 96, { label: "Stack address" }),
  part("addrsplit", "split", 52, 96, { fields: [4, 4] }),
  part("stack", "ram", 58, 94, { label: "Stack", width: 8, addressWidth: 4 }),
  chip("pcmux2", "mux8", 14, 28, { label: "PC or return" }),
  part("pcen2", "or", 26, 40),
];

/** Wires of the first CPU that Reference CPU 2 replaces, as "from>to". */
const moved = new Set([
  "irh.q>opsplit.in",
  "opsplit.f1>ctl.addr",
  "amux2.out>a.d",
  "amux2.out>zs.in",
  "alu.cout>c.d",
  "j2.out>jump.a",
  "pcmux.out>pc.d",
  "pcen.out>pc.en",
]);
const keptPairs = firstPairs.filter(([from, to]) => !moved.has(`${from}>${to}`));
if (keptPairs.length !== firstPairs.length - moved.size) throw new Error("a wire to replace is not on the first CPU's sheet");

const addedPairs = [
  ["clk.out", "sp.clk"],
  ["clk.out", "stack.clk"],

  // Control: the whole high byte addresses the ROM.
  ["irh.q", "ctl.addr"],

  // JNZ.
  ["z.q", "nz.in"],
  [field2("jnz"), "jnzt.a"],
  ["nz.out", "jnzt.b"],
  ["j2.out", "j3.a"],
  ["jnzt.out", "j3.b"],
  ["j3.out", "jump.a"],

  // The unit, and its result into A and Z in place of the adder's side.
  ["a.q", "land.a"],
  ["bmux.out", "land.b"],
  ["a.q", "lor.a"],
  ["bmux.out", "lor.b"],
  ["a.q", "lxor.a"],
  ["bmux.out", "lxor.b"],
  ["a.q", "asplit.in"],
  ["zero.out", "shlm.f0"],
  ...Array.from({ length: 7 }, (_, i) => [`asplit.f${i}`, `shlm.f${i + 1}`]),
  ...Array.from({ length: 7 }, (_, i) => [`asplit.f${i + 1}`, `shrm.f${i}`]),
  ["zero.out", "shrm.f7"],
  ["land.out", "m1.a"],
  ["lor.out", "m1.b"],
  [field2("u0"), "m1.s"],
  ["lxor.out", "m2.a"],
  ["shlm.out", "m2.b"],
  [field2("u0"), "m2.s"],
  ["m1.out", "m3.a"],
  ["m2.out", "m3.b"],
  [field2("u1"), "m3.s"],
  ["m3.out", "m4.a"],
  ["shrm.out", "m4.b"],
  [field2("u2"), "m4.s"],
  ["amux2.out", "amux3.a"],
  ["m4.out", "amux3.b"],
  [field2("unit"), "amux3.s"],
  ["amux3.out", "a.d"],
  ["amux3.out", "zs.in"],

  // C.
  [field2("u2"), "nu2.in"],
  ["asplit.f7", "sb1.a"],
  ["nu2.out", "sb1.b"],
  ["asplit.f0", "sb2.a"],
  [field2("u2"), "sb2.b"],
  ["sb1.out", "sbo.a"],
  ["sb2.out", "sbo.b"],
  [field2("cShift"), "ncs.in"],
  ["alu.cout", "c1.a"],
  ["ncs.out", "c1.b"],
  ["sbo.out", "c2.a"],
  [field2("cShift"), "c2.b"],
  ["c1.out", "co.a"],
  ["c2.out", "co.b"],
  ["co.out", "c.d"],

  // The stack. CALL writes the PC at SP, which the fetch has already moved past the CALL; RET reads
  // at SP - 1, the adder's output, which a RAM gives at once.
  [field2("call"), "callx.a"],
  ["exec.out", "callx.b"],
  [field2("ret"), "retx.a"],
  ["exec.out", "retx.b"],
  ["callx.out", "spen.a"],
  ["retx.out", "spen.b"],
  ...Array.from({ length: 4 }, (_, i) => ["zero.out", `zero4.f${i}`]),
  ["sp.q", "spw.f0"],
  ["zero4.out", "spw.f1"],
  ["one.out", "spb.f0"],
  ...Array.from({ length: 3 }, (_, i) => [field2("ret"), `spb.f${i + 1}`]),
  ...Array.from({ length: 4 }, (_, i) => ["zero.out", `spb.f${i + 4}`]),
  ["spw.out", "spadd.a"],
  ["spb.out", "spadd.b"],
  ["zero.out", "spadd.cin"],
  ["spadd.sum", "sumsplit.in"],
  ["sumsplit.f0", "sp.d"],
  ["spen.out", "sp.en"],
  ["sp.q", "spled.in"],
  ["spw.out", "spmux.a"],
  ["spadd.sum", "spmux.b"],
  [field2("ret"), "spmux.s"],
  ["spmux.out", "addrsplit.in"],
  ["addrsplit.f0", "stack.addr"],
  ["pc.q", "stack.din"],
  ["callx.out", "stack.we"],
  ["pcmux.out", "pcmux2.a"],
  ["stack.out", "pcmux2.b"],
  ["retx.out", "pcmux2.s"],
  ["pcmux2.out", "pc.d"],
  ["pcen.out", "pcen2.a"],
  ["retx.out", "pcen2.b"],
  ["pcen2.out", "pc.en"],
];

const components = [...kept, ...added];

// No part may sit on another. Sizes in grid cells, from apps/web/src/canvas/layout.ts; a chip is
// taken as 6 by 6, more than any of these needs (each is 4 wide and 6 tall). Captions and net labels
// are not checked. The screen, far from every new part, is
// left out.
const size = (c) => {
  const fields = c.props.fields?.length;
  const wide = (c.props.width ?? 1) > 1;
  switch (c.kind) {
    case "custom":
      return [6, 6];
    case "split":
    case "merge":
      return [3, fields + 1];
    case "switch":
    case "led":
      return [wide ? 5 : 2, 2];
    case "not":
      return [3, 2];
    case "clock":
      return [2, 2];
    case "rom":
      return [5, 4];
    case "ram":
      return [5, 8];
    case "seg7":
      return [3, 4];
    case "keyboard":
      return [4, 2];
    default:
      return [4, 4];
  }
};
const boxes = components.filter((c) => c.kind !== "screen").map((c) => ({ id: c.id, x: c.position.x, y: c.position.y, size: size(c) }));
for (const a of added) {
  const [w, h] = size(a);
  for (const b of boxes) {
    if (b.id === a.id) continue;
    const apart = a.position.x + w <= b.x || b.x + b.size[0] <= a.position.x || a.position.y + h <= b.y || b.y + b.size[1] <= a.position.y;
    if (!apart) throw new Error(`${a.id} sits on ${b.id}`);
  }
}

const document = {
  format: "clockyard",
  version: 11,
  metadata: {
    name: "Reference CPU 2",
    createdAt: "2026-11-21T12:00:00.000Z",
    modifiedAt: "2026-11-21T12:00:00.000Z",
    notes:
      "Reference CPU 2 (docs/reference-cpu-2.md): the reference CPU with eleven more instructions. It can work on single bits (AND, OR, XOR), shift a byte one bit left or right, loop with JNZ, and call a routine and return from it, on a small stack of its own.\n\nSet the speed to 1 kHz or more and press Run. The program in the ROM draws a diagonal line on the screen one pixel at a time, calling the same routine for each of its 32 pixels, and halts with their count on the hex digits.\n\nSelect the ROM to read the program in assembly. Its routine, plot, works out which screen byte a pixel is in and which bit, and writes the byte back with that bit set. Most of the added parts are below the read bus: the logic and shift unit, and the stack with its pointer, SP.",
  },
  circuit: { components, junctions, wires: wires([...keptPairs, ...addedPairs]) },
  definitions: [...blocks, register("reg4", "Register 4", 4)],
};

if (import.meta.main) emit("reference-cpu-2.mjs", [["reference-cpu-2", document]]);
