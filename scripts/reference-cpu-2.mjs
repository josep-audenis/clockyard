// Writes examples/reference-cpu-2.clockyard.json: Reference CPU 2 of ADR 0036, as specified in
// docs/reference-cpu-2.md. It is the first reference CPU's sheet (scripts/reference-cpu.mjs) with
// parts added and a few wires moved: a wider control ROM, a logic and shift unit, a second source
// for C, JNZ, and a return stack. It keeps the first CPU's regions and adds three (ADR 0039).
//
//   node scripts/reference-cpu-2.mjs           writes the file
//   node scripts/reference-cpu-2.mjs --check   fails if the file is not what it would write

import { readFileSync } from "node:fs";
import { blocks, ones, register, root } from "./cpu-pieces.mjs";
import { addedPairs, addedParts, CONTROL2, control2, field2, moved } from "./cpu2-pieces.mjs";
import { ALU, at, components as first, CTL, emit, FET, inRegions, JMP, names, pairs as firstPairs, REG, region, regions, spots } from "./reference-cpu.mjs";

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

/** The first CPU's regions, a few saying more here, and three more: the logic unit, the shifts and the stack. */
const CTL2 = { ...CTL, text: "Control\nThe whole high byte of IR addresses the\ncontrol ROM. Its bits are gated by the\nphase: they act in the execute cycle." };
const JMP2 = { ...JMP, text: "Jumps\nJMP, JZ if Z, JC if C, JNZ if not Z:\nin the execute cycle, the PC takes n." };
const REG2 = { ...REG, text: "Registers (A, Z)\nA takes n, RAM[n], ALU or logic.\nZ ← 1 if the new A is 0." };
const ALU2 = {
  ...ALU,
  text: "ALU\nA + B, or A − B as A + ¬B + 1. B is\nRAM[n] or n. ALU is the sum; C takes\nits carry, or the bit a shift dropped.",
};
const FET2 = {
  ...FET,
  text: "Fetch (PC, program ROM, IR)\nIR ← ROM[PC], PC ← PC + 1. A jump\nthat is taken overrides it; RET puts\nSTACK in the PC. n is IR's operand.",
};
const LOG = region("logic", 2, 2, "Logic unit\nAND, OR and XOR of A with B, or A\nshifted (SHL, SHR): its result is logic.");
const SHF = region("shifts", 2, 3, "Shifts\nA moved one bit left (SHL) or right\n(SHR), and the bit it drops.");
const STK = region("stack", 0, 3, "Stack\n16 bytes and a 4-bit pointer, SP.\nCALL writes PC at SP, then SP + 1;\nRET reads at SP − 1 into STACK.");
const regions2 = regions.map((r) => ({ ctl: CTL2, jumps: JMP2, reg: REG2, alu: ALU2, fetch: FET2 })[r.key] ?? r).concat([LOG, SHF, STK]);
const R = Object.fromEntries(regions2.map((r) => [r.key, r]));

/** Parts of the first CPU placed elsewhere here, to make room: region and offset. */
const placed = {
  jump: [R.jumps, 34, 20],
  c: [R.alu, 37, 27],
  cled: [R.alu, 38, 36],
};

/** The first CPU's parts, with the program ROM and the control ROM and its splitter replaced. */
const kept = first
  .filter((c) => c.id !== "opsplit")
  .map((c) => {
    const moved = placed[c.id] ? { ...c, position: Object.fromEntries(at(...placed[c.id]).map((v, i) => [i ? "y" : "x", v])) } : c;
    if (c.id === "rom") return { ...moved, props: { ...c.props, data: assemble(program), source: program } };
    if (c.id === "ctl") return { ...moved, props: { label: "Control", width: CONTROL2.length, addressWidth: 8, data: control2 } };
    if (c.id === "cs") return { ...moved, props: { fields: ones(CONTROL2.length) } };
    return moved;
  });

const keptPairs = firstPairs.filter(([from, to]) => !moved.has(`${from}>${to}`));
if (keptPairs.length !== firstPairs.length - moved.size) throw new Error("a wire to replace is not on the first CPU's sheet");

/** Names of the nets that cross regions here and not on the first CPU's sheet. */
const names2 = {
  ...names,
  "zero.out": "zero",
  "irh.q": "IR high",
  "pc.q": "PC",
  "bmux.out": "B",
  "m4.out": "logic",
  "shlm.out": "SHL",
  "shrm.out": "SHR",
  "sbo.out": "dropped",
  "stack.out": "STACK",
  "retx.out": "return",
  ...Object.fromEntries(["jnz", "unit", "u0", "u1", "u2", "cShift", "call", "ret"].map((n) => [field2(n), n])),
};

/** Where labels sit here: the first CPU's, without its opcode's, and those of the parts added. */
const spots2 = {
  ...Object.fromEntries(Object.entries(spots).filter(([key]) => !key.startsWith("opcode@"))),
  "IR high@ctl": [5, 8],
  "IR high@fetch": [30, 35],
  "jnz@ctl": [9, 26],
  "unit@ctl": [9, 27],
  "u0@ctl": [9, 28],
  "u1@ctl": [9, 29],
  "u2@ctl": [9, 30],
  "cShift@ctl": [9, 31],
  "call@ctl": [9, 32],
  "ret@ctl": [9, 33],
  "zero@clock": [16, 23],
  "PC@fetch": [38, 14],
  "STACK@fetch": [26, 16],
  "return@fetch": [21, 23],
  "jnz@jumps": [7, 22],
  "logic@reg": [22, 15],
  "unit@reg": [23, 17],
  "B@alu": [14, 13],
  "ALU@alu": [33, 4],
  "cShift@alu": [25, 15],
  "dropped@alu": [31, 20],
  "cLoad@alu": [34, 32],
  "clk@alu": [35, 35],
  "C@alu": [35, 38],
  "A@logic": [4, 7],
  "B@logic": [4, 9],
  "u0@logic": [13, 26],
  "SHL@logic": [14, 28],
  "u1@logic": [22, 15],
  "SHR@logic": [29, 17],
  "u2@logic": [33, 17],
  "A@shifts": [2, 19],
  "zero@shifts": [3, 37],
  "u2@shifts": [25, 15],
  "dropped@shifts": [39, 20],
  "call@stack": [3, 8],
  "Execute@stack": [5, 24],
  "ret@stack": [3, 15],
  "one@stack": [31, 23],
  "zero@stack": [19, 23],
  "clk@stack": [17, 18],
  "PC@stack": [34, 31],
  "STACK@stack": [40, 36],
  "return@stack": [5, 22],
};

const added = addedParts((key, x, y) => at(R[key], x, y));
const components = [...kept, ...added];
const sheet2 = inRegions(components, [...keptPairs, ...addedPairs], regions2, names2, spots2);

const document = {
  format: "clockyard",
  version: 13,
  metadata: {
    name: "Reference CPU 2",
    createdAt: "2026-11-21T12:00:00.000Z",
    modifiedAt: "2026-11-21T12:00:00.000Z",
    notes:
      "Reference CPU 2 (docs/reference-cpu-2.md): the reference CPU with eleven more instructions. It can work on single bits (AND, OR, XOR), shift a byte one bit left or right, loop with JNZ, and call a routine and return from it, on a small stack of its own.\n\nSet the speed to 1 kHz or more and press Run. The program in the ROM draws a diagonal line on the screen one pixel at a time, calling the same routine for each of its 32 pixels, and halts with their count on the hex digits.\n\nSelect the ROM to read the program in assembly. Its routine, plot, works out which screen byte a pixel is in and which bit, and writes the byte back with that bit set. The added parts have regions of their own: the Logic unit, the Shifts and the Stack, with its pointer, SP.",
  },
  circuit: sheet2,
  definitions: [...blocks, register("reg4", "Register 4", 4)],
};

// Catch 2 (ADR 0036): the same sheet with scripts/catch2.asm in its ROM.
const catchSource = readFileSync(root("scripts/catch2.asm"), "utf8").replaceAll("\r\n", "\n");
const game = {
  ...document,
  metadata: {
    name: "Catch 2",
    createdAt: "2026-11-21T12:00:00.000Z",
    modifiedAt: "2026-11-21T12:00:00.000Z",
    notes:
      "Catch, drawn in single pixels, on Reference CPU 2 (its program is scripts/catch2.asm).\n\nSet the speed to 10,000, press Run, click the keyboard and hold Left or Right. A block two pixels square falls in any column; the paddle, eight pixels wide, moves one pixel at a time. Catch a block to score on the two hex digits and make the next fall faster. A miss halts the CPU, and Reset plays again.\n\nEvery pixel is drawn by one routine, toggle, which the game calls seven times from four routines. It finds the pixel's screen byte and bit through another routine, locate, and flips the bit with XOR.",
  },
  circuit: {
    ...document.circuit,
    components: components.map((c) => (c.id === "rom" ? { ...c, props: { ...c.props, data: assemble(catchSource), source: catchSource } } : c)),
  },
};

// A Node without import.meta.main would skip the block below, and --check would pass unrun.
if (import.meta.main === undefined) throw new Error("this script needs Node 22.18 or 24.2 or later");
if (import.meta.main) {
  emit("reference-cpu-2.mjs", [
    ["reference-cpu-2", document],
    ["catch-2", game],
  ]);
}
