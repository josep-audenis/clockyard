import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Engine, assemble, catalog, check, disassemble, initSync, max_width } from "../generated/sim-wasm/sim_wasm.js";
import { COMPONENT_KINDS, MAX_WIDTH, project, takesWidth } from "../editor/document";
import { parseDocument } from "../storage/file";
import type { CircuitDescription, Diagnostic, Result } from "../simulation/protocol";

type Loaded = Omit<Extract<Result, { type: "loaded" }>, "type">;

initSync({ module: readFileSync(new URL("../generated/sim-wasm/sim_wasm_bg.wasm", import.meta.url)) });

const wire = (id: string, from: string, to: string) => {
  const ref = (spec: string) => {
    const [component = "", port = ""] = spec.split(".");
    return { component, port };
  };
  return { id, from: ref(from), to: ref(to) };
};

const andDemo: CircuitDescription = {
  components: [
    { id: "a", kind: "switch" },
    { id: "b", kind: "switch" },
    { id: "g", kind: "and" },
    { id: "l", kind: "led" },
  ],
  junctions: [],
  definitions: [],
  connections: [wire("w1", "a.out", "g.a"), wire("w2", "b.out", "g.b"), wire("w3", "g.out", "l.in")],
};

test("engine settles switches → AND → LED through the boundary", () => {
  const engine = new Engine();
  const loaded = JSON.parse(engine.load(JSON.stringify(andDemo), false)) as Loaded;
  expect(loaded.diagnostics).toEqual([]);
  const led = loaded.portNets.l?.in ?? -1;
  const outputs = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ].map(([a = 0, b = 0]) => {
    engine.set_input("a", a);
    engine.set_input("b", b);
    return engine.nets()[led];
  });
  expect(outputs).toEqual([0, 0, 0, 1]);
  expect(engine.nets()[loaded.wireNets.w3 ?? -1]).toBe(1);
});

test("an unstable initial settle is reported apart from validation, so a later settle can replace it", () => {
  // o = NOR(s, o) oscillates from all-zero; switching s on settles it.
  const engine = new Engine();
  const loop = {
    components: [
      { id: "s", kind: "switch" },
      { id: "o", kind: "nor" },
    ],
    connections: [wire("w1", "s.out", "o.a"), wire("w2", "o.out", "o.b")],
  };
  const loaded = JSON.parse(engine.load(JSON.stringify(loop), false)) as Loaded & { runtime: Diagnostic[] };
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.runtime.map((d) => d.code)).toEqual(["unstable"]);
  expect(JSON.parse(engine.set_input("s", 1))).toEqual([]);
});

test("validation errors come back as diagnostics, not exceptions", () => {
  const engine = new Engine();
  const bad = { components: [{ id: "x", kind: "flux" }], connections: [] };
  const loaded = JSON.parse(engine.load(JSON.stringify(bad), false)) as Loaded;
  expect(loaded.netCount).toBe(0);
  expect(loaded.diagnostics.map((d: Diagnostic) => [d.severity, d.code, d.ids])).toEqual([["error", "unknownKind", ["x"]]]);
  expect(() => engine.set_input("x", 1)).toThrow("no circuit loaded");
});

test("bus values cross as a Uint32Array; switch values are checked, never wrapped (ADR 0014)", () => {
  const engine = new Engine();
  const bus = {
    components: [
      { id: "s", kind: "switch", width: 32 },
      { id: "n", kind: "not", width: 32 },
      { id: "b", kind: "switch", width: 8 },
    ],
    connections: [wire("w1", "s.out", "n.in")],
  };
  const loaded = JSON.parse(engine.load(JSON.stringify(bus), false)) as Loaded;
  expect(loaded.diagnostics).toEqual([]);
  const notOut = () => engine.nets()[loaded.portNets.n?.out ?? -1];
  engine.set_input("s", 0);
  expect(engine.nets()).toBeInstanceOf(Uint32Array);
  expect(notOut()).toBe(0xffffffff);
  engine.set_input("s", 2 ** 32 - 1);
  expect(notOut()).toBe(0);
  // From a value no wrapped or truncated refusal could land back on.
  engine.set_input("s", 0x12345678);
  for (const bad of [2 ** 32, -1, 2.5, Number.NaN, Infinity]) {
    expect(() => engine.set_input("s", bad), String(bad)).toThrow("not a whole number");
  }
  expect(() => engine.set_input("b", 256)).toThrow("8 bits wide");
  expect(notOut()).toBe(0xedcba987);
});

test("every wire reports its net's width, an undriven bus included", () => {
  const engine = new Engine();
  const circuit = {
    components: [{ id: "g", kind: "and", width: 8 }],
    junctions: [{ id: "j" }, { id: "k" }, { id: "m" }],
    connections: [
      { id: "w1", from: { component: "g", port: "a" }, to: { junction: "j" } },
      { id: "w2", from: { junction: "k" }, to: { junction: "m" } },
    ],
  };
  const loaded = JSON.parse(engine.load(JSON.stringify(circuit), false)) as Loaded;
  expect(loaded.wireNets.w1).toBe(0);
  expect(loaded.wireWidths).toEqual({ w1: 8, w2: 1 });
  expect(loaded.netDrivers).toEqual([null, "g"]);
});

test("the catalog marks sized kinds and gives split and merge their field-port rule", () => {
  type Part = { kind: string; sized?: true; fieldPorts?: { side: string; prefix: string } };
  const parts = JSON.parse(catalog()) as Part[];
  expect(max_width()).toBe(MAX_WIDTH);
  expect(parts.filter((p) => p.sized).map((p) => p.kind)).toEqual(["switch", "led", "not", "and", "nand", "or", "nor", "xor", "xnor", "dff", "rom", "ram", "screen", "tri"]);
  expect(parts.filter((p) => p.fieldPorts).map((p) => [p.kind, p.fieldPorts])).toEqual([
    ["split", { side: "outputs", prefix: "f" }],
    ["merge", { side: "inputs", prefix: "f" }],
  ]);
});

test("a description that does not parse is an error and leaves no circuit loaded, not the one before", () => {
  const engine = new Engine();
  engine.load(JSON.stringify({ components: [{ id: "s", kind: "switch" }], connections: [] }), false);
  expect(() => engine.load("{ not json", true)).toThrow();
  expect(engine.nets()).toHaveLength(0);
  expect(() => engine.set_input("s", 1)).toThrow("no circuit loaded");
});

test("ticks, cycles and reset cross the boundary; switches set together settle once (ADR 0017)", () => {
  const engine = new Engine();
  const circuit = {
    components: [
      { id: "k", kind: "clock" },
      { id: "d", kind: "switch" },
      { id: "f", kind: "dff" },
    ],
    connections: [
      { id: "w1", from: { component: "d", port: "out" }, to: { component: "f", port: "d" } },
      { id: "w2", from: { component: "k", port: "out" }, to: { component: "f", port: "clk" } },
    ],
  };
  const loaded = JSON.parse(engine.load(JSON.stringify(circuit), false)) as Loaded;
  const q = () => engine.nets()[loaded.portNets.f?.q ?? -1];
  expect(JSON.parse(engine.set_inputs(JSON.stringify({ d: 1 })))).toEqual([]);
  expect(JSON.parse(engine.step_cycle())).toEqual([]);
  expect([engine.time(), q()]).toEqual([2, 1]);
  expect(JSON.parse(engine.tick(1))).toEqual([]);
  expect(engine.time()).toBe(3);
  expect(JSON.parse(engine.reset())).toEqual([]);
  expect([engine.time(), q()]).toEqual([0, 0]);
  expect(() => engine.set_inputs(JSON.stringify({ d: 0.5 }))).toThrow("not a whole number");
  const empty = new Engine();
  expect(() => empty.tick(1)).toThrow("no circuit loaded");
  expect(empty.time()).toBe(0);
});

test("the editor offers a width exactly where the engine's catalog takes one", () => {
  const sized = (JSON.parse(catalog()) as { kind: string; sized?: true }[]).filter((p) => p.sized).map((p) => p.kind);
  expect(COMPONENT_KINDS.filter(takesWidth)).toEqual(sized);
});

test("a memory's words cross the boundary; anything else has none (ADR 0018)", () => {
  const engine = new Engine();
  const circuit = {
    components: [
      { id: "r", kind: "rom", width: 8, addressWidth: 2, data: [1, 2] },
      { id: "g", kind: "not" },
    ],
    connections: [],
  };
  engine.load(JSON.stringify(circuit), false);
  expect(engine.memory("r", 256)).toEqual(new Uint32Array([1, 2, 0, 0]));
  expect(engine.memory("r", 2)).toEqual(new Uint32Array([1, 2])); // only the words asked for cross
  expect(engine.memory("g", 256)).toBeUndefined();
});

test("the assembler crosses the boundary: words, or every error with its line (ADR 0019)", () => {
  expect(JSON.parse(assemble("LDI 5\nADI 3\nOUT\nHLT"))).toEqual({ words: [0x1005, 0x6003, 0xb000, 0xc000], errors: [] });
  expect(JSON.parse(assemble("LDI\nJMP away"))).toEqual({
    words: [],
    errors: [
      { line: 1, message: "LDI needs an operand" },
      { line: 2, message: "unknown label away" },
    ],
  });
  expect(disassemble(0x9005)).toBe("JZ 5");
  // Not a 16-bit word: refused rather than wrapped.
  for (const bad of [0x10005, -1, 1.5]) expect(() => disassemble(bad), String(bad)).toThrow("not a 16-bit ROM word");
});

test("run until an LED lights stops at that tick, through the boundary (ADR 0019)", () => {
  const engine = new Engine();
  // A flip-flop toggling on every rising edge, shown on an LED: it lights on the first edge.
  const circuit = {
    components: [
      { id: "k", kind: "clock" },
      { id: "f", kind: "dff" },
      { id: "n", kind: "not" },
      { id: "l", kind: "led" },
    ],
    connections: [
      { id: "w1", from: { component: "k", port: "out" }, to: { component: "f", port: "clk" } },
      { id: "w2", from: { component: "f", port: "q" }, to: { component: "n", port: "in" } },
      { id: "w3", from: { component: "n", port: "out" }, to: { component: "f", port: "d" } },
      { id: "w4", from: { component: "f", port: "q" }, to: { component: "l", port: "in" } },
    ],
  };
  engine.load(JSON.stringify(circuit), false);
  expect(JSON.parse(engine.tick_until(100, "l"))).toEqual({ ticks: 1, rose: true, diagnostics: [] });
  // Lit now: it must go dark (third tick) and light again (fifth).
  expect(JSON.parse(engine.tick_until(100, "l"))).toEqual({ ticks: 4, rose: true, diagnostics: [] });
  expect(JSON.parse(engine.tick_until(2, "l"))).toEqual({ ticks: 2, rose: false, diagnostics: [] });
  expect(() => engine.tick_until(1, "nothing")).toThrow("no `in` port");
});

test("a challenge is checked through the boundary: passed, the first failing step, or refused (ADR 0025)", () => {
  const inverter = (gate: string) => ({
    components: [],
    connections: [],
    definitions: [
      {
        id: "inverter",
        components: [
          { id: "A", kind: "switch" },
          { id: "g", kind: gate },
          { id: "Y", kind: "led" },
        ],
        connections: [wire("w1", "A.out", "g.a"), wire("w2", "A.out", "g.b"), wire("w3", "g.out", "Y.in")],
        inputs: [{ name: "A", component: "A" }],
        outputs: [{ name: "Y", component: "Y" }],
      },
    ],
  });
  const challenge = {
    definition: "inverter",
    inputs: [{ name: "A", width: 1 }],
    outputs: [{ name: "Y", width: 1 }],
    parts: ["nand", "and"],
    steps: [
      { set: { A: 0 }, expect: { Y: 1 } },
      { set: { A: 1 }, expect: { Y: 0 } },
    ],
  };
  expect(JSON.parse(check(JSON.stringify(inverter("nand")), JSON.stringify(challenge)))).toEqual({ result: "passed", steps: 2 });
  expect(JSON.parse(check(JSON.stringify(inverter("and")), JSON.stringify(challenge)))).toEqual({
    result: "failed",
    step: 0,
    inputs: [{ name: "A", value: 0 }],
    mismatches: [{ name: "Y", expected: 1, got: 0 }],
  });
  expect(JSON.parse(check(JSON.stringify(inverter("nor")), JSON.stringify(challenge)))).toEqual({
    result: "refused",
    reason: "This challenge allows only these parts: nand, and. The component uses: nor.",
  });
  expect(() => check("{}", JSON.stringify(challenge))).toThrow("invalid circuit description");
});

test("watched wires' records cross as interleaved times, values and unknown bits, by net; an unknown wire records nothing (ADR 0026)", () => {
  const engine = new Engine();
  const loaded = JSON.parse(engine.load(JSON.stringify(andDemo), false)) as Loaded;
  engine.watch(["w3", "w1", "missing"]);
  expect(Array.from(engine.recorded_nets())).toEqual([loaded.wireNets.w3, loaded.wireNets.w1]);
  engine.set_inputs(JSON.stringify({ a: 1, b: 1 }));
  engine.tick(3);
  engine.set_inputs(JSON.stringify({ b: 0 }));
  expect(Array.from(engine.wave(0) ?? [])).toEqual([0, 1, 0, 3, 0, 0]);
  expect(Array.from(engine.wave(1) ?? [])).toEqual([0, 1, 0]);
  expect(engine.wave(2)).toBeUndefined();
});

test("an edit's load keeps time and state across the boundary; an open's does not (ADR 0033)", () => {
  const engine = new Engine();
  engine.load(JSON.stringify(andDemo), false);
  engine.set_inputs(JSON.stringify({ a: 1, b: 1 }));
  engine.tick(3);
  engine.load(JSON.stringify(andDemo), true);
  expect(engine.time()).toBe(3);
  expect(Array.from(engine.nets())).toContain(1);
  engine.load(JSON.stringify(andDemo), false);
  expect(engine.time()).toBe(0);
});

test("a challenge with a bench is checked in the bench's slot, as the editor projects both (ADR 0034)", () => {
  const projected = (path: string) => {
    const parsed = parseDocument(readFileSync(new URL(`../../../../challenges/${path}.clockyard.json`, import.meta.url), "utf8"));
    if (!parsed.ok) throw new Error(`${path}: ${parsed.error}`);
    return JSON.stringify(project(parsed.document.circuit, parsed.document.definitions));
  };
  const challenge = JSON.stringify({
    definition: "cpu",
    inputs: [],
    outputs: [{ name: "out", width: 8 }],
    runs: [
      {
        name: "Add",
        // LDA 0xFF; ADI 7; STA 16; OUT; HLT
        words: [0x20ff, 0x6007, 0x3010, 0xb000, 0xc000],
        steps: [{ set: { key: 5 }, cycles: 100, until: "halt", expect: { out: 12 }, memory: { ram: { "16": 12 } } }],
      },
    ],
  });
  const bench = projected("benches/cpu");
  expect(JSON.parse(check(projected("solutions/10-cpu"), challenge, bench))).toEqual({ result: "passed", steps: 1 });
  // The bench's own document holds the slot empty: nothing halts.
  expect(JSON.parse(check(bench, challenge, bench))).toMatchObject({ result: "failed", run: "Add", step: 0, inputs: [{ name: "key", value: 5 }] });
  expect(() => check(bench, challenge, "{ not json")).toThrow("invalid bench");
});

test("a loop that does not settle crosses as unknown bits, and nothing unknown crosses as an empty array (ADR 0035)", () => {
  const engine = new Engine();
  const end = (component: string, port: string) => ({ component, port });
  const circuit = {
    components: [
      { id: "en", kind: "switch" },
      { id: "x", kind: "nand" },
    ],
    connections: [
      { id: "w0", from: end("en", "out"), to: end("x", "a") },
      { id: "w1", from: end("x", "out"), to: end("x", "b") },
    ],
  };
  const loaded = JSON.parse(engine.load(JSON.stringify(circuit), false)) as { wireNets: Record<string, number> };
  expect(Array.from(engine.unknown())).toEqual([]);
  const report = JSON.parse(engine.set_input("en", 1)) as { severity: string; code: string }[];
  expect(report.map((d) => [d.severity, d.code])).toEqual([["error", "unstable"]]);
  const net = loaded.wireNets.w1 ?? -1;
  expect([engine.nets()[net], engine.unknown()[net]]).toEqual([1, 1]);
  // The X remains: a warning, which a run does not stop for.
  const later = JSON.parse(engine.tick(4)) as { severity: string; code: string }[];
  expect(later.map((d) => [d.severity, d.code])).toEqual([["warning", "unsettled"]]);
  expect(engine.time()).toBe(4);
});

test("the engine names the nets that are buses, and only those (ADR 0035)", () => {
  const load = (circuit: object) => JSON.parse(new Engine().load(JSON.stringify(circuit), false)) as Loaded;
  // Two buffers on one wire: a bus, which both buffers and the LED report.
  const bus = load({
    components: [
      { id: "ta", kind: "tri" },
      { id: "tb", kind: "tri" },
      { id: "l", kind: "led" },
    ],
    connections: [wire("w1", "ta.out", "l.in"), wire("w2", "tb.out", "l.in")],
  });
  expect(bus.buses).toEqual([bus.portNets.l?.in]);
  expect([bus.portNets.ta?.out, bus.portNets.tb?.out]).toEqual([bus.buses[0], bus.buses[0]]);

  // Nets that only look shared from their port nets, and are not buses. `through` wires its input pin to its
  // output pin; `hollow` drives its output pin with nothing.
  const pin = (name: string, component: string) => ({ name, component });
  const through = {
    id: "through",
    components: [
      { id: "d", kind: "switch" },
      { id: "y", kind: "led" },
    ],
    connections: [wire("w", "d.out", "y.in")],
    inputs: [pin("d", "d")],
    outputs: [pin("y", "y")],
  };
  const hollow = { id: "hollow", components: [{ id: "y", kind: "led" }], connections: [], inputs: [], outputs: [pin("y", "y")] };
  const instance = (id: string, definition: string) => ({ id, kind: "custom", definition });
  // Two pass-throughs fed by one switch: both output pins are on the switch's net.
  const fanned = load({
    components: [{ id: "s", kind: "switch" }, instance("p1", "through"), instance("p2", "through"), { id: "l1", kind: "led" }, { id: "l2", kind: "led" }],
    connections: [wire("w1", "s.out", "p1.d"), wire("w2", "s.out", "p2.d"), wire("w3", "p1.y", "l1.in"), wire("w4", "p2.y", "l2.in")],
    definitions: [through],
  });
  expect(fanned.portNets.p1?.y).toBe(fanned.portNets.p2?.y);
  expect(fanned.buses).toEqual([]);
  // Two output pins nothing drives: both on ground.
  const undriven = load({
    components: [instance("h1", "hollow"), instance("h2", "hollow"), { id: "l1", kind: "led" }, { id: "l2", kind: "led" }],
    connections: [wire("w1", "h1.y", "l1.in"), wire("w2", "h2.y", "l2.in")],
    definitions: [hollow],
  });
  expect([undriven.portNets.h1?.y, undriven.portNets.h2?.y]).toEqual([0, 0]);
  expect(undriven.buses).toEqual([]);
  // One buffer alone, through a pass-through: one driver, no bus.
  const alone = load({
    components: [{ id: "t", kind: "tri" }, instance("p", "through"), { id: "l", kind: "led" }],
    connections: [wire("w1", "t.out", "p.d"), wire("w2", "p.y", "l.in")],
    definitions: [through],
  });
  expect(alone.buses).toEqual([]);
});
