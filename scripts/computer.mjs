// The computer of ADR 0034, in pieces: the reference CPU cut along its memory boundary (`cpu`), the
// screen interface (`display`), the program ROM as a component (`program`), and the bench sheet that
// wires one of each to a RAM, a key and a screen. scripts/challenges.mjs writes them to files.
//
// The CPU's insides are those of scripts/reference-cpu.mjs, part for part; crates/sim-core/tests/cpu.rs
// holds both circuits to the same model of docs/reference-cpu.md.

import { blocks, chip, control, field, IO, io, iodec, ones, part, register, wires } from "./cpu-pieces.mjs";
import { addedPairs, addedParts, CONTROL2, control2, moved } from "./cpu2-pieces.mjs";

/** Definitions the bench owns carry this prefix (ADR 0034 item 3): a check always takes them from the bench file. */
export const BENCH = "bench-";
/** `definition` renamed with `prefix`, and so the definitions its chips name: prefix those too, or they are missing. */
const prefixed = (prefix, definition) => ({
  ...definition,
  id: prefix + definition.id,
  circuit: {
    ...definition.circuit,
    components: definition.circuit.components.map((c) => (c.definition ? { ...c, definition: prefix + c.definition } : c)),
  },
});

const pin = (id, kind, x, y, width) => part(id, kind, x, y, { label: id, ...(width > 1 && { width }) });
/** A definition's pins only: what a starter, or a bench's slot, holds before anything is built. */
export const pinsOnly = (definition) => ({
  ...definition,
  circuit: { components: definition.circuit.components.filter((c) => c.pin), junctions: [], wires: [] },
});
/** Pins are marked while a circuit is put together and written as plain switches and LEDs. */
const plain = (definition) => ({
  ...definition,
  circuit: { ...definition.circuit, components: definition.circuit.components.map(({ pin: _, ...c }) => c) },
});
const input = (id, x, y, width = 1) => ({ ...pin(id, "switch", x, y, width), pin: true });
const output = (id, x, y, width = 1) => ({ ...pin(id, "led", x, y, width), pin: true });

// --- The CPU -------------------------------------------------------------------

/**
 * The reference CPU without its memories and devices (ADR 0034 item 2). In: `clk`, `instr` (the ROM
 * word at `pc`) and `din` (the byte at `addr`). Out: `pc`, `addr`, `dout`, `we`, `out`, `halt`, `fetch`.
 * `blocks` prefixes the building blocks' definition IDs.
 */
function cpuDefinition(id, blocksPrefix) {
  const { components, pairs } = cpuParts(blocksPrefix);
  return { id, name: "CPU", circuit: { components, junctions: [], wires: wires(pairs) } };
}

/** The cut CPU's parts and its wires as "part.port" pairs, before the wires are numbered. */
function cpuParts(blocksPrefix) {
  const block = (partId, definition, x, y, props) => chip(partId, blocksPrefix + definition, x, y, props);
  const components = [
    input("clk", -12, 13),
    input("instr", -12, 20, 16),
    input("din", -12, 60, 8),
    output("out", 162, 0, 8),
    output("addr", 162, 10, 8),
    output("dout", 162, 18, 8),
    output("pc", 162, 28, 8),
    output("we", 162, 38),
    output("fetch", 162, 44),
    output("halt", 162, 50),

    // Constants: XNOR and XOR of a net with itself are 1 and 0.
    part("one", "xnor", 5, 13),
    part("zero", "xor", 5, 19),
    part("zero8", "merge", 11, 19, { fields: ones(8) }),

    // Fetch: the instruction into IR, PC + 1 into PC.
    part("romsplit", "split", 30, 14, { fields: [8, 8] }),
    block("irl", "reg8", 36, 14, { label: "IR low" }),
    block("irh", "reg8", 36, 22, { label: "IR high" }),
    part("opsplit", "split", 44, 24, { fields: [4, 4] }),
    block("inc", "adder8", 14, 18, { label: "PC + 1" }),
    block("pcmux", "mux8", 22, 26, { label: "PC source" }),
    block("pcr", "reg8", 28, 26, { label: "PC" }),

    // Control: the opcode addresses a control ROM; its bits are gated by the phase.
    part("ctl", "rom", 50, 24, { label: "Control", width: 12, addressWidth: 4, data: control }),
    part("cs", "split", 58, 24, { fields: ones(12) }),
    block("t", "reg1", 0, 36, { label: "T" }),
    block("h", "reg1", 0, 46, { label: "H" }),
    part("nt", "not", 8, 36),
    part("nh", "not", 8, 46),
    part("fetchg", "and", 14, 38),
    part("exec", "and", 14, 46),
    part("aen", "and", 66, 20),
    part("cen", "and", 66, 26),
    part("outen", "and", 66, 32),
    part("weg", "and", 66, 38),
    part("hlten", "and", 66, 44),
    part("jzt", "and", 72, 50),
    part("jct", "and", 72, 56),
    part("j1", "or", 80, 50),
    part("j2", "or", 86, 52),
    part("jump", "and", 92, 50),
    part("pcen", "or", 20, 40),

    // Execute: the ALU, A and its sources, the flags and the output register.
    block("bmux", "mux8", 82, 4, { label: "ALU B" }),
    part("subfill", "merge", 82, 14, { fields: ones(8) }),
    part("x8", "xor", 90, 6, { width: 8 }),
    block("alu", "adder8", 98, 4, { label: "ALU" }),
    block("amux1", "mux8", 106, 14, { label: "A source" }),
    block("amux2", "mux8", 114, 14, { label: "A or ALU" }),
    block("a", "reg8", 122, 14, { label: "A" }),
    part("zs", "split", 114, 26, { fields: ones(8) }),
    part("o1", "or", 120, 26),
    part("o2", "or", 120, 32),
    part("o3", "or", 120, 38),
    part("o4", "or", 120, 44),
    part("o5", "or", 126, 28),
    part("o6", "or", 126, 40),
    part("o7", "or", 132, 34),
    part("isz", "not", 138, 34),
    block("z", "reg1", 144, 30, { label: "Z" }),
    block("c", "reg1", 144, 40, { label: "C" }),
    block("outr", "reg8", 130, 0, { label: "OUT" }),
  ];
  const clocked = ["irl", "irh", "pcr", "t", "h", "a", "z", "c", "outr"];
  const pairs = [
    ["clk.out", "one.a"],
    ["clk.out", "one.b"],
    ["clk.out", "zero.a"],
    ["clk.out", "zero.b"],
    ...Array.from({ length: 8 }, (_, i) => ["zero.out", `zero8.f${i}`]),
    ...clocked.map((r) => ["clk.out", `${r}.clk`]),

    // Phase and halt.
    ["t.q", "nt.in"],
    ["h.q", "nh.in"],
    ["nt.out", "t.d"],
    ["nh.out", "t.en"],
    ["one.out", "h.d"],
    ["hlten.out", "h.en"],
    ["nt.out", "fetchg.a"],
    ["nh.out", "fetchg.b"],
    ["t.q", "exec.a"],
    ["nh.out", "exec.b"],
    ["fetchg.out", "fetch.in"],
    ["h.q", "halt.in"],

    // Fetch.
    ["pcr.q", "pc.in"],
    ["instr.out", "romsplit.in"],
    ["romsplit.f0", "irl.d"],
    ["romsplit.f1", "irh.d"],
    ["fetchg.out", "irl.en"],
    ["fetchg.out", "irh.en"],
    ["irh.q", "opsplit.in"],
    ["pcr.q", "inc.a"],
    ["zero8.out", "inc.b"],
    ["one.out", "inc.cin"],
    ["inc.sum", "pcmux.a"],
    ["irl.q", "pcmux.b"],
    ["jump.out", "pcmux.s"],
    ["pcmux.out", "pcr.d"],
    ["fetchg.out", "pcen.a"],
    ["jump.out", "pcen.b"],
    ["pcen.out", "pcr.en"],

    // Control.
    ["opsplit.f1", "ctl.addr"],
    ["ctl.out", "cs.in"],
    [field("aLoad"), "aen.a"],
    ["exec.out", "aen.b"],
    [field("cLoad"), "cen.a"],
    ["exec.out", "cen.b"],
    [field("outLoad"), "outen.a"],
    ["exec.out", "outen.b"],
    [field("ramWe"), "weg.a"],
    ["exec.out", "weg.b"],
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

    // Execute: the data address and store byte leave; the byte read comes back on `din`.
    ["irl.q", "addr.in"],
    ["a.q", "dout.in"],
    ["weg.out", "we.in"],
    ["din.out", "bmux.a"],
    ["irl.q", "bmux.b"],
    [field("aluImm"), "bmux.s"],
    ...Array.from({ length: 8 }, (_, i) => [field("sub"), `subfill.f${i}`]),
    ["bmux.out", "x8.a"],
    ["subfill.out", "x8.b"],
    ["a.q", "alu.a"],
    ["x8.out", "alu.b"],
    [field("sub"), "alu.cin"],
    ["irl.q", "amux1.a"],
    ["din.out", "amux1.b"],
    [field("aFromRam"), "amux1.s"],
    ["amux1.out", "amux2.a"],
    ["alu.sum", "amux2.b"],
    [field("aFromAlu"), "amux2.s"],
    ["amux2.out", "a.d"],
    ["aen.out", "a.en"],
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
    ["a.q", "outr.d"],
    ["outen.out", "outr.en"],
    ["outr.q", "out.in"],
  ];
  return { components, pairs };
}

/**
 * Reference CPU 2 cut the same way (ADR 0041 item 6), with the same pins: the first CPU's cut with the parts and
 * wires the example adds to the first CPU's sheet. The example's `pc` register is `pcr` here, and its SP LED is
 * left out, since an LED inside a definition is a pin. The parts added sit below the first CPU's.
 */
function cpu2Definition(id, blocksPrefix) {
  const { components, pairs } = cpuParts(blocksPrefix);
  const rename = (end) => end.replace(/^pc\./, "pcr.");
  const added = addedParts(() => [0, 0])
    .filter((c) => c.id !== "spled")
    .map((c, i) => ({
      ...c,
      ...(c.definition && { definition: blocksPrefix + c.definition }),
      position: { x: (i % 12) * 14, y: 70 + Math.floor(i / 12) * 14 },
    }));
  const first = components
    .filter((c) => c.id !== "opsplit")
    .map((c) => {
      if (c.id === "ctl") return { ...c, props: { label: "Control", width: CONTROL2.length, addressWidth: 8, data: control2 } };
      if (c.id === "cs") return { ...c, props: { fields: ones(CONTROL2.length) } };
      return c;
    });
  const kept = pairs.filter(([from, to]) => !moved.has(`${from.replace(/^pcr\./, "pc.")}>${to.replace(/^pcr\./, "pc.")}`));
  if (kept.length !== pairs.length - moved.size) throw new Error("a wire Reference CPU 2 replaces is not on the cut CPU");
  const more = addedPairs.filter(([from, to]) => !`${from} ${to}`.includes("spled.")).map(([from, to]) => [rename(from), rename(to)]);
  return { id, name: "CPU 2", circuit: { components: [...first, ...added], junctions: [], wires: wires([...kept, ...more]) } };
}

// --- The screen interface --------------------------------------------------------

/**
 * What connects a screen to the CPU (ADR 0034 item 2): `sptr` is a register `STA 0xFE` writes, and
 * `swe` is 1 while a store to 0xFD is under way. Gates on the address bits, and one 8-bit register.
 */
function displayDefinition(registerId) {
  const components = [
    input("clk", 0, 30),
    input("addr", 0, 0, 8),
    input("dout", 0, 22, 8),
    input("we", 0, 14),
    output("sptr", 52, 22, 8),
    output("swe", 52, 10),
    part("bits", "split", 6, 0, { fields: ones(8) }),
    // 0xFE and 0xFD share their top six bits, all 1.
    part("h1", "and", 14, 0),
    part("h2", "and", 14, 5),
    part("h3", "and", 14, 10),
    part("h4", "and", 20, 2),
    part("high", "and", 26, 6),
    part("n0", "not", 14, 16),
    part("n1", "not", 14, 20),
    part("isfe", "and", 26, 18),
    part("isfd", "and", 26, 12),
    part("top", "and", 32, 8),
    part("sptren", "and", 38, 16),
    part("sweg", "and", 38, 10),
    chip("r", registerId, 44, 24, { label: "SPTR" }),
  ];
  const inside = wires([
    ["addr.out", "bits.in"],
    ["bits.f7", "h1.a"],
    ["bits.f6", "h1.b"],
    ["bits.f5", "h2.a"],
    ["bits.f4", "h2.b"],
    ["bits.f3", "h3.a"],
    ["bits.f2", "h3.b"],
    ["h1.out", "h4.a"],
    ["h2.out", "h4.b"],
    ["h4.out", "high.a"],
    ["h3.out", "high.b"],
    ["bits.f0", "n0.in"],
    ["bits.f1", "n1.in"],
    // 0xFE: bit 1 set, bit 0 clear. 0xFD: bit 1 clear, bit 0 set.
    ["bits.f1", "isfe.a"],
    ["n0.out", "isfe.b"],
    ["n1.out", "isfd.a"],
    ["bits.f0", "isfd.b"],
    ["high.out", "top.a"],
    ["we.out", "top.b"],
    ["top.out", "sptren.a"],
    ["isfe.out", "sptren.b"],
    ["top.out", "sweg.a"],
    ["isfd.out", "sweg.b"],
    ["sweg.out", "swe.in"],
    ["dout.out", "r.d"],
    ["sptren.out", "r.en"],
    ["clk.out", "r.clk"],
    ["r.q", "sptr.in"],
  ]);
  return { id: "display", name: "Display", circuit: { components, junctions: [], wires: inside } };
}

// --- The program ROM as a component -------------------------------------------------

/** A ROM of 256 words of 16 bits between two pins: what challenge 11 asks to be filled in. */
const programDefinition = (data = [], source) => ({
  id: "program",
  name: "Program",
  circuit: {
    components: [
      input("addr", 0, 2, 8),
      part("rom", "rom", 8, 0, { label: "Program", width: 16, ...(data.length > 0 && { data }), ...(source !== undefined && { source }) }),
      output("word", 18, 2, 16),
    ],
    junctions: [],
    wires: wires([
      ["addr.out", "rom.addr"],
      ["rom.out", "word.in"],
    ]),
  },
});

// --- The bench sheet ---------------------------------------------------------------

/**
 * The computer round a slot (ADR 0034 item 3): a program ROM, a data RAM, a key read at 0xFF, the
 * I/O decoding of ADR 0022, the HEX register, a screen, a clock switch, and LEDs on the CPU's outputs.
 * `slot` is the part under test: with "cpu" the CPU is the user's; with "program" the ROM is their
 * component; with "display" their component drives the screen where the bench's own register would.
 */
function benchSheet(bench) {
  const own = (id, definition, x, y, props) => chip(id, BENCH + definition, x, y, props);
  // The cpu2 bench (ADR 0041) is the program bench round Reference CPU 2.
  const cpuId = bench === "cpu2" ? "cpu2" : "cpu";
  const slot = bench === "cpu2" ? "program" : bench;
  const mux = (id, x, label) => own(id, "mux8", x, 44, { label });
  const components = [
    part("clk", "switch", 0, 10, { label: "Clock" }),
    part("key", "switch", 0, 30, { label: "Key", width: 8 }),
    part("zero", "xor", 6, 44),
    part("zero8", "merge", 12, 44, { fields: ones(8) }),
    slot === "program" ? chip("program", "program", 10, 2, { label: "Program" }) : part("rom", "rom", 10, 2, { label: "Program", width: 16 }),
    slot === "cpu" ? chip("cpu", "cpu", 24, 4, { label: "CPU" }) : own("cpu", cpuId, 24, 4, { label: cpuId === "cpu2" ? "CPU 2" : "CPU" }),
    part("out", "led", 40, 0, { label: "Output", width: 8 }),
    part("fetch", "led", 40, 6, { label: "Fetch" }),
    part("halt", "led", 40, 10, { label: "Halted" }),
    part("ram", "ram", 40, 16, { label: "Data", width: 8 }),

    // I/O (ADR 0022): the address decoded, RAM writes gated off above 0xEF, and the read bus.
    part("iodec", "rom", 22, 30, { label: "I/O decoder", width: IO.length, addressWidth: 8, data: iodec }),
    part("ios", "split", 30, 30, { fields: ones(IO.length) }),
    part("nio", "not", 36, 30),
    part("ramwe", "and", 42, 30),
    part("hexen", "and", 54, 30),
    own("hex", "reg8", 60, 30, { label: "HEX" }),
    ...(slot === "display"
      ? [chip("display", "display", 54, 14, { label: "Display" })]
      : [part("sptren", "and", 48, 16), part("sdwe", "and", 48, 22), own("sptr", "reg8", 54, 14, { label: "SPTR" })]),
    part("screen", "screen", 64, 0, { label: "Screen", width: 8, addressWidth: 8, columns: 64 }),
    mux("rd0", 20, "Read I/O or RAM"),
    mux("rd1", 28, "Read KEY"),
    mux("rd2", 36, "Read SPTR"),
    mux("rd3", 44, "Read SDATA"),
    mux("rd4", 52, "Read HEX"),
  ];
  const program = slot === "program" ? ["program.addr", "program.word"] : ["rom.addr", "rom.out"];
  // The screen pointer and the screen's write enable: the bench's own, or the display's.
  const pointer = slot === "display" ? "display.sptr" : "sptr.q";
  const sheet = wires([
    ["clk.out", "zero.a"],
    ["clk.out", "zero.b"],
    ...Array.from({ length: 8 }, (_, i) => ["zero.out", `zero8.f${i}`]),
    ["clk.out", "cpu.clk"],
    ["clk.out", "ram.clk"],
    ["clk.out", "screen.clk"],
    ["clk.out", "hex.clk"],

    ["cpu.pc", program[0]],
    [program[1], "cpu.instr"],
    ["cpu.out", "out.in"],
    ["cpu.fetch", "fetch.in"],
    ["cpu.halt", "halt.in"],

    ["cpu.addr", "ram.addr"],
    ["cpu.dout", "ram.din"],
    ["cpu.addr", "iodec.addr"],
    ["iodec.out", "ios.in"],
    [io("io"), "nio.in"],
    ["cpu.we", "ramwe.a"],
    ["nio.out", "ramwe.b"],
    ["ramwe.out", "ram.we"],
    ["cpu.we", "hexen.a"],
    [io("hex"), "hexen.b"],
    ["cpu.dout", "hex.d"],
    ["hexen.out", "hex.en"],

    ...(slot === "display"
      ? [
          ["clk.out", "display.clk"],
          ["cpu.addr", "display.addr"],
          ["cpu.dout", "display.dout"],
          ["cpu.we", "display.we"],
          ["display.swe", "screen.we"],
        ]
      : [
          ["clk.out", "sptr.clk"],
          ["cpu.we", "sptren.a"],
          [io("sptr"), "sptren.b"],
          ["cpu.dout", "sptr.d"],
          ["sptren.out", "sptr.en"],
          ["cpu.we", "sdwe.a"],
          [io("sdata"), "sdwe.b"],
          ["sdwe.out", "screen.we"],
        ]),
    [pointer, "screen.addr"],
    ["cpu.dout", "screen.din"],

    ["ram.out", "rd0.a"],
    ["zero8.out", "rd0.b"],
    [io("io"), "rd0.s"],
    ["rd0.out", "rd1.a"],
    ["key.out", "rd1.b"],
    [io("key"), "rd1.s"],
    ["rd1.out", "rd2.a"],
    [pointer, "rd2.b"],
    [io("sptr"), "rd2.s"],
    ["rd2.out", "rd3.a"],
    ["screen.out", "rd3.b"],
    [io("sdata"), "rd3.s"],
    ["rd3.out", "rd4.a"],
    ["hex.q", "rd4.b"],
    [io("hex"), "rd4.s"],
    ["rd4.out", "cpu.din"],
  ]);
  // Laid out close above, then spread: instances are taller than their pins suggest, and wires need room.
  const spread = components.map((c) => ({ ...c, position: { x: Math.round(c.position.x * 1.6), y: Math.round(c.position.y * 1.8) } }));
  return { components: spread, junctions: [], wires: sheet };
}

// --- What the files hold -------------------------------------------------------------

const block = (id) => blocks.find((d) => d.id === id);
const benchBlocks = blocks.map((d) => plain(prefixed(BENCH, d)));
/** The CPU the bench provides, built from the bench's own blocks. */
const benchCpu = plain(cpuDefinition(`${BENCH}cpu`, BENCH));
/** Reference CPU 2 as the cpu2 bench provides it, and the 4-bit register its stack pointer is. */
const benchCpu2 = plain(cpu2Definition(`${BENCH}cpu2`, BENCH));
const benchReg4 = plain(prefixed(BENCH, register("reg4", "Register 4", 4)));
const cpu = cpuDefinition("cpu", "");
const display = displayDefinition("reg8");
const only = (...ids) => benchBlocks.filter((d) => ids.includes(d.id.slice(BENCH.length)));

/**
 * Each slot's bench: the sheet, the part under test (`reference` built, `empty` as a starter has it),
 * the parts the challenge provides to build with, and the definitions the bench owns.
 */
export const computers = {
  cpu: { sheet: benchSheet("cpu"), reference: plain(cpu), empty: plain(pinsOnly(cpu)), given: blocks, owned: only("mux8", "reg8") },
  program: { sheet: benchSheet("program"), reference: null, empty: plain(programDefinition()), given: [], owned: [benchCpu, ...benchBlocks] },
  display: { sheet: benchSheet("display"), reference: plain(display), empty: plain(pinsOnly(display)), given: [block("reg8")], owned: [benchCpu, ...benchBlocks] },
  cpu2: { sheet: benchSheet("cpu2"), reference: null, empty: plain(programDefinition()), given: [], owned: [benchCpu2, ...benchBlocks, benchReg4] },
};
/** The `program` component with `data` in its ROM, and `source` as the program editor shows it. */
export const program = (data, source) => plain(programDefinition(data, source));
