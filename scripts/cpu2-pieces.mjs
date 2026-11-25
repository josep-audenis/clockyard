// The pieces of Reference CPU 2 (ADR 0036) shared by its example (scripts/reference-cpu-2.mjs) and its cut on
// the challenges' cpu2 bench (scripts/computer.mjs, ADR 0041): its control ROM, and the parts and wires it adds
// to the first CPU, by the example's part IDs.

import { chip, CONTROL, control, ones, part } from "./cpu-pieces.mjs";

// --- The control ROM: one word per high byte of the instruction ----------------

// The first CPU's control bits, then: JNZ; the unit's result into A, and which (AND, OR, XOR, SHL
// by u1 and u0; SHR by u2); C from the bit a shift drops; CALL and RET.
export const CONTROL2 = [...CONTROL, "jnz", "unit", "u0", "u1", "u2", "cShift", "call", "ret"];
const word2 = (...names) => names.reduce((w, n) => w | (1 << CONTROL2.indexOf(n)), 0);
export const field2 = (name) => `cs.f${CONTROL2.indexOf(name)}`;
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
export const control2 = Array.from({ length: 256 }, (_, high) => {
  const [opcode, which] = [high >> 4, high & 15];
  if (opcode === 0xf) return under[which] ?? 0;
  if (opcode === 0xd) return word2("jnz");
  return control[opcode] ?? 0;
});

/**
 * The parts Reference CPU 2 adds to the first CPU, each placed by `at(region, x, y)`: the example's regions, by key,
 * or wherever a cut CPU puts them.
 */
export const addedParts = (at) => [
  // JNZ: one more way to a jump.
  part("nz", "not", ...at("jumps", 2, 25)),
  part("jnzt", "and", ...at("jumps", 10, 23)),
  part("j3", "or", ...at("jumps", 34, 8)),

  // The logic and shift unit: AND, OR and XOR of A with the ALU's B, and A moved one bit either way.
  part("land", "and", ...at("logic", 8, 6), { width: 8 }),
  part("lor", "or", ...at("logic", 8, 12), { width: 8 }),
  part("lxor", "xor", ...at("logic", 8, 18), { width: 8 }),
  part("asplit", "split", ...at("shifts", 4, 18), { fields: ones(8) }),
  part("shlm", "merge", ...at("shifts", 17, 17), { fields: ones(8) }),
  part("shrm", "merge", ...at("shifts", 17, 29), { fields: ones(8) }),
  chip("m1", "mux8", ...at("logic", 16, 7), { label: "AND or OR" }),
  chip("m2", "mux8", ...at("logic", 16, 19), { label: "XOR or SHL" }),
  chip("m3", "mux8", ...at("logic", 24, 7), { label: "Logic or shift" }),
  chip("m4", "mux8", ...at("logic", 32, 7), { label: "Or SHR" }),
  chip("amux3", "mux8", ...at("reg", 25, 6), { label: "A or unit" }),

  // C: the adder's carry, or the bit a shift drops (bit 7 going left, bit 0 going right).
  part("nu2", "not", ...at("shifts", 23, 26)),
  part("sb1", "and", ...at("shifts", 28, 24)),
  part("sb2", "and", ...at("shifts", 28, 12)),
  part("sbo", "or", ...at("shifts", 33, 18)),
  part("ncs", "not", ...at("alu", 28, 14)),
  part("c1", "and", ...at("alu", 34, 8)),
  part("c2", "and", ...at("alu", 34, 16)),
  part("co", "or", ...at("alu", 30, 26)),

  // The return stack: 16 bytes, a 4-bit pointer, and one adder that gives SP + 1 or SP - 1 (add 15).
  part("callx", "and", ...at("stack", 6, 7)),
  part("retx", "and", ...at("stack", 6, 14)),
  part("spen", "or", ...at("stack", 13, 11)),
  part("zero4", "merge", ...at("stack", 22, 17), { fields: ones(4) }),
  chip("sp", "reg4", ...at("stack", 20, 10), { label: "SP" }),
  part("spled", "led", ...at("stack", 22, 5), { label: "SP", width: 4 }),
  part("spw", "merge", ...at("stack", 27, 10), { fields: [4, 4] }),
  part("spb", "merge", ...at("stack", 32, 12), { fields: ones(8) }),
  chip("spadd", "adder8", ...at("stack", 38, 10), { label: "SP ± 1" }),
  part("sumsplit", "split", ...at("stack", 39, 19), { fields: [4, 4] }),
  chip("spmux", "mux8", ...at("stack", 24, 26), { label: "Stack address" }),
  part("addrsplit", "split", ...at("stack", 31, 26), { fields: [4, 4] }),
  part("stack", "ram", ...at("stack", 37, 26), { label: "Stack", width: 8, addressWidth: 4 }),
  chip("pcmux2", "mux8", ...at("fetch", 24, 9), { label: "PC or return" }),
  part("pcen2", "or", ...at("fetch", 24, 17)),
];

/** Wires of the first CPU that Reference CPU 2 replaces, as "from>to". */
export const moved = new Set([
  "irh.q>opsplit.in",
  "opsplit.f1>ctl.addr",
  "amux2.out>a.d",
  "amux2.out>zs.in",
  "alu.cout>c.d",
  "j2.out>jump.a",
  "pcmux.out>pc.d",
  "pcen.out>pc.en",
]);
/** The wires Reference CPU 2 adds, by the example's part IDs. */
export const addedPairs = [
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
