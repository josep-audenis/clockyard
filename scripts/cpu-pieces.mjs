// The pieces of the reference CPU (ADR 0019, docs/reference-cpu.md) that more than one script builds
// from: scripts/reference-cpu.mjs for the example sheets, scripts/challenges.mjs for the cut CPU,
// the screen interface and the benches of ADR 0034. Importing this writes nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** A part: `props` holds label, width, fields, addressWidth, data and source as the editor stores them. */
export const part = (id, kind, x, y, props = {}, extra = {}) => ({ id, kind, ...extra, position: { x, y }, rotation: 0, props });
export const chip = (id, definition, x, y, props = {}) => part(id, "custom", x, y, props, { definition });

/** Wires from "part.port" to "part.port" (or a junction's ID, with no dot); ids w0, w1, … per circuit. */
export function wires(pairs) {
  const end = (spec) => {
    const [component, port] = spec.split(".");
    return port ? { component, port } : { junction: spec };
  };
  return pairs.map(([from, to], i) => ({ id: `w${i}`, from: end(from), to: end(to) }));
}

export const ones = (n) => Array(n).fill(1);

// --- Pieces used many times ------------------------------------------------

/** 8-bit 2-to-1 multiplexer: out = s ? b : a. A 1-bit select drives all 8 bits through a merger. */
export const mux8 = {
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
export function register(id, name, width) {
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

export const CONTROL = ["aLoad", "aFromRam", "aFromAlu", "aluImm", "sub", "cLoad", "outLoad", "ramWe", "jmp", "jz", "jc", "hlt"];
export const bit = Object.fromEntries(CONTROL.map((name, i) => [name, 1 << i]));
export const word = (...names) => names.reduce((w, n) => w | bit[n], 0);
/** Control words by opcode, from the instruction table in docs/reference-cpu.md; 0xD–0xF do nothing. */
export const control = [
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
export const field = (name) => `cs.f${CONTROL.indexOf(name)}`;

// --- The I/O decoder: one word per data address (ADR 0022) -------------------

export const IO = ["io", "key", "sptr", "sdata", "hex"];
export const ioBit = (name) => 1 << IO.indexOf(name);
/** 0x00-0xEF are RAM (0); 0xF0-0xFF are I/O, and four of them name a device (docs/reference-cpu.md, I/O). */
export const iodec = Array.from({ length: 256 }, (_, n) => {
  if (n < 0xf0) return 0;
  const device = { 0xff: "key", 0xfe: "sptr", 0xfd: "sdata", 0xfc: "hex" }[n];
  return ioBit("io") | (device ? ioBit(device) : 0);
});
export const io = (name) => `ios.f${IO.indexOf(name)}`;
/** Seven-segment patterns of the hex digits, segment a on bit 0 (ADR 0021). */
export const HEX_DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

/** The 8-bit adder example and its full adder, copied so a change there is picked up by every user. */
export const adder = JSON.parse(readFileSync(root("examples/8-bit-adder.clockyard.json"), "utf8"));
/** The reference CPU's building blocks as definitions: multiplexer, registers, adder and full adder. */
export const blocks = [
  mux8,
  register("reg8", "Register 8", 8),
  register("reg1", "Register 1", 1),
  { id: "adder8", name: "8-bit adder", circuit: adder.circuit },
  ...adder.definitions,
];
