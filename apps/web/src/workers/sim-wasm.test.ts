import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Engine, catalog, initSync, max_width } from "../generated/sim-wasm/sim_wasm.js";
import { MAX_WIDTH } from "../editor/document";
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
  const loaded = JSON.parse(engine.load(JSON.stringify(andDemo))) as Loaded;
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
  const loaded = JSON.parse(engine.load(JSON.stringify(loop))) as Loaded & { runtime: Diagnostic[] };
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.runtime.map((d) => d.code)).toEqual(["unstable"]);
  expect(JSON.parse(engine.set_input("s", 1))).toEqual([]);
});

test("validation errors come back as diagnostics, not exceptions", () => {
  const engine = new Engine();
  const bad = { components: [{ id: "x", kind: "flux" }], connections: [] };
  const loaded = JSON.parse(engine.load(JSON.stringify(bad))) as Loaded;
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
  const loaded = JSON.parse(engine.load(JSON.stringify(bus))) as Loaded;
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
  const loaded = JSON.parse(engine.load(JSON.stringify(circuit))) as Loaded;
  expect(loaded.wireNets.w1).toBe(0);
  expect(loaded.wireWidths).toEqual({ w1: 8, w2: 1 });
  expect(loaded.netDrivers).toEqual([null, "g"]);
});

test("the catalog marks sized kinds and gives split and merge their field-port rule", () => {
  type Part = { kind: string; sized?: true; fieldPorts?: { side: string; prefix: string } };
  const parts = JSON.parse(catalog()) as Part[];
  expect(max_width()).toBe(MAX_WIDTH);
  expect(parts.filter((p) => p.sized).map((p) => p.kind)).toEqual(["switch", "led", "not", "and", "nand", "or", "nor", "xor", "xnor"]);
  expect(parts.filter((p) => p.fieldPorts).map((p) => [p.kind, p.fieldPorts])).toEqual([
    ["split", { side: "outputs", prefix: "f" }],
    ["merge", { side: "inputs", prefix: "f" }],
  ]);
});
