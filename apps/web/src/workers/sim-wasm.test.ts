import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Engine, initSync } from "../generated/sim-wasm/sim_wasm.js";
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
  connections: [wire("w1", "a.out", "g.a"), wire("w2", "b.out", "g.b"), wire("w3", "g.out", "l.in")],
};

test("engine settles switches → AND → LED through the boundary", () => {
  const engine = new Engine();
  const loaded = JSON.parse(engine.load(JSON.stringify(andDemo))) as Loaded;
  expect(loaded.diagnostics).toEqual([]);
  const led = loaded.portNets.l?.in ?? -1;
  const outputs = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ].map(([a = false, b = false]) => {
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
  expect(JSON.parse(engine.set_input("s", true))).toEqual([]);
});

test("validation errors come back as diagnostics, not exceptions", () => {
  const engine = new Engine();
  const bad = { components: [{ id: "x", kind: "flux" }], connections: [] };
  const loaded = JSON.parse(engine.load(JSON.stringify(bad))) as Loaded;
  expect(loaded.netCount).toBe(0);
  expect(loaded.diagnostics.map((d: Diagnostic) => [d.severity, d.code, d.ids])).toEqual([["error", "unknownKind", ["x"]]]);
  expect(() => engine.set_input("x", true)).toThrow("no circuit loaded");
});
