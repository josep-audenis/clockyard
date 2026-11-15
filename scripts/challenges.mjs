// Writes the challenges of ADR 0025 into challenges/: for each, the challenge
// (NN-name.json), a reference solution (solutions/NN-name.clockyard.json) and
// the starter the editor opens (starters/NN-name.clockyard.json).
//
//   node scripts/challenges.mjs           writes the files
//   node scripts/challenges.mjs --check   fails if a file is not what it would write
//
// Steps are written out as data. crates/sim-core/tests/challenges.rs holds them
// against the solutions, run in the engine, and checks every starter fails.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
];

const document = (name, definitions) => ({
  format: "clockyard",
  version: 9,
  metadata: { name, createdAt: "2026-11-15T12:00:00.000Z", modifiedAt: "2026-11-15T12:00:00.000Z" },
  circuit: { components: [], junctions: [], wires: [] },
  definitions,
});

const files = [];
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
    [`challenges/solutions/${c.file}.clockyard.json`, document(`${c.title}: solution`, [c.definition, ...given])],
    [`challenges/starters/${c.file}.clockyard.json`, document(c.title, [starter, ...given])],
  );
}

let stale = false;
for (const [path, value] of files) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
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
if (!process.argv.includes("--check")) console.log(`${challenges.length} challenges written to challenges/`);
