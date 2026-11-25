// Writes examples/reference-cpu.clockyard.json: the reference CPU of ADR 0019,
// built from Clockyard parts, as specified in docs/reference-cpu.md, with the
// memory-mapped devices of ADR 0022. And examples/catch.clockyard.json: the same
// circuit with the game of ADR 0023, scripts/catch.asm, in its ROM.
//
//   node scripts/reference-cpu.mjs           writes the files
//   node scripts/reference-cpu.mjs --check   fails if a file is not what it would write
//
// The circuit is generated so it can be regenerated, diffed and kept in step
// with the specification. The 8-bit adder and its full adder are copied from
// examples/8-bit-adder.clockyard.json, so a change there is picked up here. The sheet is laid
// out in titled regions, joined by net labels (ADR 0039).

import { readFileSync, writeFileSync } from "node:fs";
import { blocks, chip, control, field, HEX_DIGITS, IO, io, iodec, ones, part, root, wires } from "./cpu-pieces.mjs";

// --- Regions (ADR 0039) ----------------------------------------------------------

/** A region: a rectangle of the sheet, its note at its top left corner (title, then what it does). */
export const REGION = { width: 44, height: 40, gap: 4 };
/** The region in column `col`, row `row` of the grid, at most three across. */
export const region = (key, col, row, text) => ({
  key,
  text,
  x: col * (REGION.width + REGION.gap),
  y: row * (REGION.height + REGION.gap),
});

/** Sizes in grid cells and port offsets, as apps/web/src/canvas/layout.ts lays parts out unrotated. */
const PINS = {
  mux8: [["a", "b", "s"], ["out"]],
  reg8: [["d", "en", "clk"], ["q"]],
  reg4: [["d", "en", "clk"], ["q"]],
  reg1: [["d", "en", "clk"], ["q"]],
  adder8: [["a", "b", "cin"], ["sum", "cout"]],
};
export function sizeOf(c) {
  const wide = (c.props.width ?? 1) > 1;
  switch (c.kind) {
    case "custom":
      return [4, 2 * Math.max(...PINS[c.definition].map((p) => p.length))];
    case "split":
    case "merge":
      return [3, c.props.fields.length + 1];
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
    case "screen": {
      const rows = Math.min(64, Math.ceil((2 ** c.props.addressWidth * c.props.width) / c.props.columns));
      return [Math.max(5, 2 + Math.ceil(c.props.columns / 4) + 1), Math.max(8, Math.ceil(rows / 4 + 1))];
    }
    default:
      return [4, 4];
  }
}
function portOf(c, port) {
  const [w] = sizeOf(c);
  const field = /^f(\d+)$/.exec(port);
  if (c.kind === "custom") {
    const [ins, outs] = PINS[c.definition];
    if (ins.includes(port)) return [0, 1 + 2 * ins.indexOf(port)];
    if (outs.includes(port)) return [4, 1 + 2 * outs.indexOf(port)];
  } else if (field) return [c.kind === "split" ? 3 : 0, 1 + Number(field[1])];
  else {
    const left = { a: 1, b: 3, in: 1, d: 1, clk: 3, addr: 1, din: 3, we: 5, seg: 2 };
    if (c.kind === "ram" || c.kind === "screen") left.clk = 7;
    if (port in left) return [0, left[port]];
    if (port === "out" || port === "q") return [w, ["and", "or", "xor", "xnor"].includes(c.kind) ? 2 : 1];
  }
  throw new Error(`no port ${c.id}.${port}`);
}

const boxOf = (c) => {
  const [w, h] = sizeOf(c);
  return { x0: c.position.x, y0: c.position.y, x1: c.position.x + w, y1: c.position.y + h };
};
const inside = (b, r) => b.x0 >= r.x && b.y0 >= r.y && b.x1 <= r.x + REGION.width && b.y1 <= r.y + REGION.height;
const apart = (a, b) => a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0;
/** A note's text box, as apps/web/src/editor/document.ts noteSize reckons it. */
const noteBox = (r) => {
  const lines = r.text.split("\n");
  return { x0: r.x, y0: r.y, x1: r.x + Math.ceil(Math.max(...lines.map((l) => [...l].length)) / 2), y1: r.y + lines.length };
};

/**
 * The sheet laid out in `regions`: each part lies in one; a wire whose ends lie in two regions becomes, in each, a wire
 * to that region's net label for the net, named by `names` (a port of the net, "part.port", to its name). `spots` places
 * a label: "name@region" to its offset in the region; by default it is 3 cells out from the first port wired to it.
 * Throws when a part lies outside every region or on a note, two parts or regions overlap, or a net to label has no name.
 */
export function inRegions(components, pairs, regions, names, spots = {}) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const problems = [];
  const fail = (problem) => problems.push(problem);
  for (const [i, a] of regions.entries()) {
    for (const b of regions.slice(i + 1)) {
      const box = (r) => ({ x0: r.x, y0: r.y, x1: r.x + REGION.width, y1: r.y + REGION.height });
      if (!apart(box(a), box(b))) fail(`regions ${a.key} and ${b.key} overlap`);
    }
  }
  const home = new Map();
  for (const c of components) {
    const r = regions.find((r) => inside(boxOf(c), r));
    if (!r) {
      fail(`${c.id} lies in no region`);
      continue;
    }
    if (!apart(boxOf(c), noteBox(r))) fail(`${c.id} lies on ${r.key}'s note`);
    home.set(c.id, r);
  }
  for (const [i, a] of components.entries()) {
    for (const b of components.slice(i + 1)) if (!apart(boxOf(a), boxOf(b))) fail(`${a.id} touches ${b.id}`);
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));

  // Nets of the whole sheet, and within each region.
  const parent = new Map();
  const find = (k) => {
    while (parent.has(k) && parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  const join = (a, b) => parent.set(find(a), find(b));
  for (const [a, b] of pairs) join(a, b);
  const nameOf = new Map();
  for (const [port, name] of Object.entries(names)) {
    const net = find(port);
    if (nameOf.has(net) && nameOf.get(net) !== name) fail(`${port}'s net is named twice`);
    nameOf.set(net, name);
  }
  const regionOf = (end) => home.get(end.split(".")[0]);
  const local = new Map();
  const findLocal = (k) => {
    while (local.has(k) && local.get(k) !== k) k = local.get(k);
    return k;
  };
  // Joined within their region first, so a label is wired only to ends no wire there already joins to it.
  for (const [a, b] of pairs) if (regionOf(a) === regionOf(b)) local.set(findLocal(a), findLocal(b));
  const junctions = [];
  const labels = new Map();
  const labelFor = (end) => {
    const r = regionOf(end);
    const name = nameOf.get(find(end));
    if (!name) throw new Error(`the net of ${end} crosses regions but has no name`);
    const key = `${name}@${r.key}`;
    let id = labels.get(key);
    if (!id) {
      id = `${name.replace(/[^A-Za-z0-9]/g, "")}-${r.key}`;
      const c = byId.get(end.split(".")[0]);
      const [px, py] = portOf(c, end.split(".")[1]);
      const away = px > 0 ? 1 : -1;
      const [dx, dy] = spots[key] ?? [c.position.x + px + 3 * away - r.x, c.position.y + py - r.y];
      junctions.push({ id, position: { x: r.x + dx, y: r.y + dy }, name });
      labels.set(key, id);
    }
    return id;
  };
  // Wires in the order of their pairs, which is the order they are routed in.
  const out = [];
  for (const [a, b] of pairs) {
    if (regionOf(a) === regionOf(b)) {
      out.push([a, b]);
      continue;
    }
    for (const end of [a, b]) {
      const label = labelFor(end);
      if (findLocal(end) === findLocal(label)) continue;
      out.push([end, label]);
      local.set(findLocal(end), findLocal(label));
    }
  }
  const unused = Object.keys(spots).filter((k) => !labels.has(k));
  if (unused.length > 0) fail(`no label for ${unused.join(", ")}`);
  const dotRegion = new Map();
  for (const j of junctions) {
    const dot = { x0: j.position.x, y0: j.position.y, x1: j.position.x, y1: j.position.y };
    const r = regions.find((r) => inside(dot, r));
    dotRegion.set(j.id, r);
    if (!r) fail(`label ${j.id} lies in no region`);
    else if (!apart(dot, noteBox(r))) fail(`label ${j.id} lies on ${r.key}'s note`);
    for (const c of components) if (!apart(boxOf(c), dot)) fail(`label ${j.id} touches ${c.id}`);
  }
  // Every wire's two ends lie in one region.
  const regionOfEnd = (end) => (end.includes(".") ? regionOf(end) : dotRegion.get(end));
  for (const [a, b] of out) if (regionOfEnd(a) !== regionOfEnd(b)) fail(`the wire from ${a} to ${b} leaves its region`);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const notes = regions.map((r) => ({ id: `note-${r.key}`, position: { x: r.x, y: r.y }, text: r.text }));
  return { components, junctions, wires: wires(out), notes };
}

// --- The main sheet -----------------------------------------------------------

// docs/reference-cpu.md, "draw the key held": the key's code on the digits, eight pixels at its byte.
const program = [
  "loop:   LDA 0xFF     ; KEY",
  "        JZ loop      ; no key held",
  "        STA 0xFC     ; HEX",
  "        STA 0xFE     ; SPTR",
  "        LDI 0xFF",
  "        STA 0xFD     ; SDATA",
  "        JMP loop",
  "",
].join("\n");

/** The regions, in the words of docs/reference-cpu.md; Reference CPU 2 fills the grid's gaps. */
export const DEV = region(
  "dev",
  0,
  0,
  "Devices\nData addresses 0xFC to 0xFF: KEY, the\nkey held; the screen's byte SPTR, SDATA;\nHEX on two digits. OUT, shown here.",
);
export const CLK = region(
  "clock",
  1,
  0,
  "Clock and phase\nTwo cycles an instruction: T = 0 fetch,\nT = 1 execute. HLT sets H.\nFetch = ¬T ∧ ¬H, Halted = H.",
);
export const FET = region(
  "fetch",
  2,
  0,
  "Fetch (PC, program ROM, IR)\nIR ← ROM[PC], PC ← PC + 1. A jump\nthat is taken overrides the PC the\nfetch left. n is IR's operand.",
);
export const MEM = region(
  "mem",
  0,
  1,
  "Memory and I/O\nn decoded: 0xF0-0xFF are I/O, so RAM\nwrites are gated off above 0xEF. The\nread bus gives RAM[n]: RAM or a device.",
);
export const CTL = region(
  "ctl",
  1,
  1,
  "Control\nThe opcode addresses a control ROM.\nIts bits are gated by the phase:\nthey act in the execute cycle.",
);
export const JMP = region(
  "jumps",
  2,
  1,
  "Jumps\nJMP, JZ if Z, JC if C: in the execute\ncycle, the PC takes n.",
);
export const REG = region("reg", 0, 2, "Registers (A, Z)\nA takes n, RAM[n] or ALU.\nZ ← 1 if the new A is 0.");
export const ALU = region(
  "alu",
  1,
  2,
  "ALU\nA + B, or A − B as A + ¬B + 1. B is\nRAM[n] or n. ALU is the sum; C takes\nits carry.",
);
export const at = (r, dx, dy) => [r.x + dx, r.y + dy];

/** The main sheet's parts. Reference CPU 2 (scripts/reference-cpu-2.mjs) is built from these and adds to them. */
export const components = [
  // Clock and constants: XNOR and XOR of a net with itself are 1 and 0.
  part("clk", "clock", ...at(CLK, 2, 12), { label: "Clock" }),
  part("one", "xnor", ...at(CLK, 10, 7)),
  part("zero", "xor", ...at(CLK, 10, 14)),
  part("zero8", "merge", ...at(CLK, 19, 13), { fields: ones(8) }),

  // Fetch: ROM[PC] into IR, PC + 1 into PC.
  part("rom", "rom", ...at(FET, 6, 27), { label: "Program", width: 16, data: [0x20ff, 0x9000, 0x30fc, 0x30fe, 0x10ff, 0x30fd, 0x8000], source: program }),
  part("romsplit", "split", ...at(FET, 14, 27), { fields: [8, 8] }),
  chip("irl", "reg8", ...at(FET, 22, 27), { label: "IR low" }),
  chip("irh", "reg8", ...at(FET, 22, 34), { label: "IR high" }),
  part("irmerge", "merge", ...at(FET, 31, 27), { fields: [8, 8] }),
  part("irled", "led", ...at(FET, 37, 27), { label: "IR", width: 16 }),
  part("opsplit", "split", ...at(FET, 31, 34), { fields: [4, 4] }),
  chip("inc", "adder8", ...at(FET, 8, 9), { label: "PC + 1" }),
  chip("pcmux", "mux8", ...at(FET, 16, 9), { label: "PC source" }),
  chip("pc", "reg8", ...at(FET, 32, 9), { label: "PC" }),
  part("pcled", "led", ...at(FET, 38, 9), { label: "PC", width: 8 }),

  // Control: the opcode addresses a control ROM; its bits are gated by the phase.
  part("ctl", "rom", ...at(CTL, 8, 7), { label: "Control", width: 12, addressWidth: 4, data: control }),
  part("cs", "split", ...at(CTL, 2, 13), { fields: ones(12) }),
  chip("t", "reg1", ...at(CLK, 10, 25), { label: "T" }),
  chip("h", "reg1", ...at(CLK, 10, 33), { label: "H" }),
  part("nt", "not", ...at(CLK, 19, 25)),
  part("nh", "not", ...at(CLK, 19, 33)),
  part("fetch", "and", ...at(CLK, 28, 24)),
  part("exec", "and", ...at(CLK, 28, 30)),
  part("aen", "and", ...at(CTL, 28, 13)),
  part("cen", "and", ...at(CTL, 28, 18)),
  part("outen", "and", ...at(CTL, 28, 23)),
  part("we", "and", ...at(CTL, 28, 28)),
  part("hlten", "and", ...at(CTL, 28, 33)),
  part("jzt", "and", ...at(JMP, 10, 7)),
  part("jct", "and", ...at(JMP, 10, 15)),
  part("j1", "or", ...at(JMP, 18, 6)),
  part("j2", "or", ...at(JMP, 26, 7)),
  part("jump", "and", ...at(JMP, 34, 8)),
  part("pcen", "or", ...at(FET, 16, 17)),

  // Execute: the ALU, A and its sources, the flags, RAM and the output register.
  part("ram", "ram", ...at(MEM, 36, 24), { label: "Data", width: 8 }),
  chip("bmux", "mux8", ...at(ALU, 8, 7), { label: "ALU B" }),
  part("subfill", "merge", ...at(ALU, 10, 15), { fields: ones(8) }),
  part("x8", "xor", ...at(ALU, 17, 7), { width: 8 }),
  chip("alu", "adder8", ...at(ALU, 26, 6), { label: "ALU" }),
  chip("amux1", "mux8", ...at(REG, 7, 6), { label: "A source" }),
  chip("amux2", "mux8", ...at(REG, 17, 6), { label: "A or ALU" }),
  chip("a", "reg8", ...at(REG, 33, 6), { label: "A" }),
  part("aled", "led", ...at(REG, 39, 6), { label: "A", width: 8 }),
  part("zs", "split", ...at(REG, 2, 20), { fields: ones(8) }),
  part("o1", "or", ...at(REG, 13, 19)),
  part("o2", "or", ...at(REG, 13, 24)),
  part("o3", "or", ...at(REG, 13, 29)),
  part("o4", "or", ...at(REG, 13, 34)),
  part("o5", "or", ...at(REG, 20, 21)),
  part("o6", "or", ...at(REG, 20, 31)),
  part("o7", "or", ...at(REG, 27, 26)),
  part("isz", "not", ...at(REG, 33, 27)),
  chip("z", "reg1", ...at(REG, 38, 27), { label: "Z" }),
  chip("c", "reg1", ...at(ALU, 34, 14), { label: "C" }),
  part("zled", "led", ...at(REG, 38, 36), { label: "Z" }),
  part("cled", "led", ...at(ALU, 41, 14), { label: "C" }),
  chip("outr", "reg8", ...at(DEV, 9, 33), { label: "OUT" }),
  part("outled", "led", ...at(DEV, 16, 33), { label: "Output", width: 8 }),

  // Status outputs (docs/reference-cpu.md): Fetch = ¬T ∧ ¬H, Halted = H.
  part("fetchled", "led", ...at(CLK, 38, 25), { label: "Fetch" }),
  part("haltled", "led", ...at(CLK, 19, 37), { label: "Halted" }),

  // I/O (ADR 0022): the operand decoded, RAM writes gated off above 0xEF, the device registers'
  // write enables, and the read bus choosing RAM or a device for LDA, ADD and SUB.
  part("iodec", "rom", ...at(MEM, 4, 27), { label: "I/O decoder", width: IO.length, addressWidth: 8, data: iodec }),
  part("ios", "split", ...at(MEM, 1, 19), { fields: ones(IO.length) }),
  part("nio", "not", ...at(MEM, 13, 28)),
  part("ramwe", "and", ...at(MEM, 19, 27)),
  part("sptren", "and", ...at(MEM, 6, 34)),
  part("hexen", "and", ...at(MEM, 26, 34)),
  part("sdwe", "and", ...at(MEM, 16, 34)),
  chip("rd0", "mux8", ...at(MEM, 6, 6), { label: "Read I/O or RAM" }),
  chip("rd1", "mux8", ...at(MEM, 13, 6), { label: "Read KEY" }),
  chip("rd2", "mux8", ...at(MEM, 20, 6), { label: "Read SPTR" }),
  chip("rd3", "mux8", ...at(MEM, 27, 6), { label: "Read SDATA" }),
  chip("rd4", "mux8", ...at(MEM, 34, 6), { label: "Read HEX" }),

  // The devices, together in one region so a game reads as one picture: the device registers
  // SPTR and HEX, the screen, HEX on two digits, the keyboard and OUT.
  chip("sptr", "reg8", ...at(DEV, 9, 6), { label: "SPTR" }),
  chip("hex", "reg8", ...at(DEV, 9, 24), { label: "HEX" }),
  part("key", "keyboard", ...at(DEV, 34, 33), { label: "Keyboard" }),
  part("screen", "screen", ...at(DEV, 19, 8), { label: "Screen", width: 8, addressWidth: 8, columns: 64 }),
  part("hexsplit", "split", ...at(DEV, 16, 24), { fields: [4, 4] }),
  part("hexhighrom", "rom", ...at(DEV, 23, 28), { label: "High digit", width: 8, addressWidth: 4, data: HEX_DIGITS }),
  part("hexlowrom", "rom", ...at(DEV, 23, 21), { label: "Low digit", width: 8, addressWidth: 4, data: HEX_DIGITS }),
  part("hexhigh", "seg7", ...at(DEV, 33, 23), { label: "High" }),
  part("hexlow", "seg7", ...at(DEV, 38, 23), { label: "Low" }),
];

const clocked = ["irl", "irh", "pc", "t", "h", "a", "z", "c", "outr", "sptr", "hex"];
/** The main sheet's connections, as pairs of ports; `inRegions` turns those across regions into net labels. */
export const pairs = [
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
];

/**
 * Names of the nets that cross regions, by one of their ports: as docs/reference-cpu.md names the signal where it does,
 * else as cpu-pieces.mjs names the control line (an executed one, gated by the phase, keeps the line's name).
 */
export const names = {
  "clk.out": "clk",
  "one.out": "one",
  "zero8.out": "zero8",
  "fetch.out": "Fetch",
  "exec.out": "Execute",
  "hlten.out": "hlt",
  "irl.q": "n",
  "opsplit.f1": "opcode",
  "jump.out": "jump",
  "aen.out": "aLoad",
  "cen.out": "cLoad",
  "outen.out": "outLoad",
  "we.out": "ramWe",
  ...Object.fromEntries(["aFromRam", "aFromAlu", "aluImm", "sub", "jmp", "jz", "jc"].map((n) => [field(n), n])),
  "a.q": "A",
  "z.q": "Z",
  "c.q": "C",
  "alu.sum": "ALU",
  "rd4.out": "RAM[n]",
  "sptr.q": "SPTR",
  "hex.q": "HEX",
  "sdwe.out": "sdataWe",
  "sptren.out": "sptrWe",
  "hexen.out": "hexWe",
  "key.out": "KEY",
  "screen.out": "SDATA",
};

/** Where labels sit in their regions, where 3 cells out from their first port does not do. */
export const spots = {
  "clk@mem": [33, 33],
  "A@mem": [35, 38],
  "hexWe@mem": [32, 39],
  "sdataWe@mem": [22, 39],
  "sptrWe@mem": [12, 39],
  "ramWe@mem": [4, 35],
  "n@mem": [2, 28],
  "HEX@mem": [32, 16],
  "SDATA@mem": [25, 16],
  "SPTR@mem": [18, 16],
  "KEY@mem": [11, 16],
  "zero8@mem": [4, 16],
  "RAM[n]@mem": [40, 7],
  "KEY@dev": [40, 34],
  "outLoad@dev": [6, 36],
  "hexWe@dev": [5, 27],
  "HEX@dev": [15, 28],
  "SDATA@dev": [40, 9],
  "SPTR@dev": [15, 10],
  "sdataWe@dev": [15, 13],
  "clk@dev": [8, 40],
  "sptrWe@dev": [5, 9],
  "A@dev": [7, 5],
  "one@clock": [18, 9],
  "zero8@clock": [26, 14],
  "clk@clock": [6, 21],
  "Fetch@clock": [35, 29],
  "Execute@clock": [36, 32],
  "hlt@clock": [6, 36],
  "zero8@fetch": [5, 12],
  "one@fetch": [5, 14],
  "jump@fetch": [13, 16],
  "Fetch@fetch": [12, 21],
  "n@fetch": [28, 24],
  "clk@fetch": [19, 24],
  "opcode@fetch": [38, 36],
  "opcode@ctl": [5, 8],
  "aFromRam@ctl": [9, 15],
  "aFromAlu@ctl": [9, 16],
  "aluImm@ctl": [9, 17],
  "sub@ctl": [9, 18],
  "jmp@ctl": [9, 22],
  "jz@ctl": [9, 23],
  "jc@ctl": [9, 24],
  "Execute@ctl": [24, 39],
  "jz@jumps": [6, 8],
  "Z@jumps": [6, 10],
  "jc@jumps": [6, 16],
  "C@jumps": [6, 18],
  "jmp@jumps": [15, 5],
  "Execute@jumps": [30, 14],
  "n@reg": [4, 7],
  "RAM[n]@reg": [4, 9],
  "aFromRam@reg": [5, 15],
  "ALU@reg": [14, 15],
  "aFromAlu@reg": [15, 17],
  "aLoad@reg": [31, 15],
  "clk@reg": [32, 17],
  "A@reg": [41, 11],
  "Z@reg": [36, 38],
  "RAM[n]@alu": [5, 8],
  "n@alu": [5, 10],
  "aluImm@alu": [5, 12],
  "sub@alu": [6, 19],
  "A@alu": [24, 3],
  "cLoad@alu": [30, 20],
  "clk@alu": [31, 22],
  "C@alu": [40, 20],
};

export const regions = [DEV, CLK, FET, MEM, CTL, JMP, REG, ALU];
export const sheet = inRegions(components, pairs, regions, names, spots);

const document = {
  format: "clockyard",
  version: 13,
  metadata: {
    name: "Reference CPU",
    createdAt: "2026-11-10T12:00:00.000Z",
    modifiedAt: "2026-11-10T12:00:00.000Z",
    // What the Notes panel shows (ADR 0027).
    notes: "The reference CPU (docs/reference-cpu.md), built from Clockyard parts: registers, multiplexers, an adder, a ROM for the program and a RAM for data.\n\nSet the speed to 100 Hz or more and press Run. Click the keyboard and hold a key: the program in the ROM shows the key's code on the two hex digits and lights eight pixels at that screen byte.\n\nSelect the ROM to read and edit its program in assembly, then Assemble to write it in. Run until Fetch steps one instruction at a time; Halted runs to the end. Data addresses 0xF0 to 0xFF reach the keyboard, the screen and the two digits.",
  },
  circuit: sheet,
  definitions: blocks,
};

// The game of ADR 0023: scripts/catch.asm as its source, and its words as assembled.
// crates/sim-core/tests/cpu.rs fails if the two drift apart.
const CATCH_WORDS = [
  0x1003, 0x3000, 0x3002, 0x1064, 0x3003, 0x10fb, 0x30fe, 0x10ff, 0x30fd, 0x2002, 0x3001, 0x30fe,
  0x103c, 0x30fd, 0x2002, 0x6005, 0x7008, 0xa013, 0x6008, 0x3002, 0x2003, 0x3005, 0x2005, 0x7001,
  0x3005, 0x901b, 0x8016, 0x20ff, 0x7082, 0x9021, 0x7001, 0x902b, 0x803a, 0x2000, 0x903a, 0x60f8,
  0x30fe, 0x1000, 0x30fd, 0x2000, 0x7001, 0x3000, 0x8036, 0x2000, 0x7007, 0x903a, 0x2000, 0x60f8,
  0x30fe, 0x1000, 0x30fd, 0x2000, 0x6001, 0x3000, 0x60f8, 0x30fe, 0x10ff, 0x30fd, 0x2001, 0x30fe,
  0x1000, 0x30fd, 0x2001, 0x6008, 0x3001, 0x30fe, 0x70f8, 0xa047, 0x103c, 0x30fd, 0x8014, 0x20fd,
  0x9056, 0x2004, 0x6001, 0x3004, 0x30fc, 0x2003, 0x7008, 0x3006, 0x7014, 0xa053, 0x8009, 0x2006,
  0x3003, 0x8009, 0x103c, 0x30fd, 0xc000,
];
const catchSource = readFileSync(root("scripts/catch.asm"), "utf8").replaceAll("\r\n", "\n");
const game = {
  ...document,
  metadata: {
    name: "Catch",
    createdAt: "2026-11-14T12:00:00.000Z",
    modifiedAt: "2026-11-14T12:00:00.000Z",
    notes: "A small game running on the reference CPU, its program in the ROM (scripts/catch.asm).\n\nSet the speed to 10,000, press Run, click the keyboard and hold Left or Right. Blocks fall in 8 lanes; each one caught on the paddle scores on the two hex digits and makes the next fall faster. A miss halts the CPU, and Reset plays again.\n\nNothing here is simulated in software: every instruction runs through the CPU's gates, registers and memories.",
  },
  circuit: {
    ...document.circuit,
    components: components.map((c) => (c.id === "rom" ? { ...c, props: { ...c.props, data: CATCH_WORDS, source: catchSource } } : c)),
    // ADR 0039: Catch's link is kept short, so its regions keep only their titles.
    notes: document.circuit.notes.map((n) => ({ ...n, text: n.text.split("\n")[0] })),
  },
};

/** Writes each example, or with --check fails if a file is not what would be written. `script` names the generator. */
export function emit(script, files) {
  for (const [name, doc] of files) {
    const path = `examples/${name}.clockyard.json`;
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    if (process.argv.includes("--check")) {
      // Line endings may follow the checkout's settings; the content may not differ.
      if (readFileSync(root(path), "utf8").replaceAll("\r\n", "\n") !== text) {
        console.error(`${path} is out of date: run node scripts/${script}`);
        process.exit(1);
      }
    } else {
      writeFileSync(root(path), text);
      console.log(`${path}: ${doc.circuit.components.length} parts, ${doc.circuit.wires.length} wires on the main sheet`);
    }
  }
}

// Importing this file (as scripts/reference-cpu-2.mjs does) writes nothing.
// A Node without import.meta.main would skip the block below, and --check would pass unrun.
if (import.meta.main === undefined) throw new Error("this script needs Node 22.18 or 24.2 or later");
if (import.meta.main) {
  emit("reference-cpu.mjs", [
    ["reference-cpu", document],
    ["catch", game],
  ]);
}
