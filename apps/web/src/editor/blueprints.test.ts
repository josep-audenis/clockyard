import { expect, test } from "vitest";
import { addDefinitions } from "./blueprints";
import type { Circuit, Definition } from "./document";

const pin = (id: string, kind: "switch" | "led", y = 0) => ({ id, kind, position: { x: kind === "led" ? 9 : 0, y }, rotation: 0 as const, props: { label: id } });
const gate = (id: string) => ({ id, kind: "not" as const, position: { x: 4, y: 0 }, rotation: 0 as const, props: {} });
const instance = (id: string, definition: string) => ({ id, kind: "custom" as const, definition, position: { x: 4, y: 0 }, rotation: 0 as const, props: {} });
const circuit = (...components: Circuit["components"]): Circuit => ({ components, junctions: [], wires: [], notes: [] });

const inv: Definition = { id: "inv", name: "Inverter", circuit: circuit(pin("A", "switch"), gate("n"), pin("Y", "led")) };
const buf: Definition = { id: "buf", name: "Buffer", circuit: circuit(pin("A", "switch"), instance("i1", "inv"), instance("i2", "inv"), pin("Y", "led")) };
const top: Definition = { id: "top", name: "Top", circuit: circuit(instance("b", "buf"), instance("i", "inv")) };
const source = [inv, buf, top];

test("a picked component comes with the components it contains, contained ones first, each once (ADR 0027)", () => {
  const { added, reused } = addDefinitions([], source, ["top"]);
  expect(added.map((d) => d.id)).toEqual(["inv", "buf", "top"]);
  expect(added).toEqual([inv, buf, top]);
  expect(reused).toEqual([]);
  expect(addDefinitions([], source, ["inv", "inv"]).added).toEqual([inv]);
  expect(addDefinitions([], source, ["nothing"]).added).toEqual([]);
});

test("a component already here with the same ID and contents is reused, whatever its name or key order", () => {
  const here: Definition = { id: "inv", name: "My inverter", circuit: JSON.parse(JSON.stringify(inv.circuit)) as Circuit };
  // Keys in another order are the same contents.
  here.circuit.components = here.circuit.components.map(({ props, rotation, position, kind, id }) => ({ props, rotation, position, kind, id }));
  const { added, reused } = addDefinitions([here], source, ["buf"]);
  expect(reused).toEqual([here]);
  expect(added).toEqual([buf]);
});

test("same ID, other contents: a fresh ID and a numbered name, and what contains it is rewired to it", () => {
  const other: Definition = { id: "inv", name: "Inverter", circuit: circuit(pin("A", "switch"), pin("Y", "led")) };
  const taken: Definition = { id: "inv-2", name: "Inverter 2", circuit: circuit() };
  const { added, reused } = addDefinitions([other, taken], source, ["buf"]);
  expect(reused).toEqual([]);
  expect(added.map((d) => [d.id, d.name])).toEqual([
    ["inv-3", "Inverter 3"],
    ["buf", "Buffer"],
  ]);
  const instances = added[1]?.circuit.components.filter((c) => c.kind === "custom").map((c) => c.definition);
  expect(instances).toEqual(["inv-3", "inv-3"]);
  // The source is not changed.
  expect(buf.circuit.components[1]).toMatchObject({ definition: "inv" });
});

test("a container whose contents were renamed differs from the one here, so it is added too", () => {
  const otherInv: Definition = { id: "inv", name: "Inverter", circuit: circuit(pin("A", "switch")) };
  // The same buffer as the source's, but its inverter here is another one.
  const { added } = addDefinitions([otherInv, buf], source, ["buf"]);
  expect(added.map((d) => [d.id, d.name])).toEqual([
    ["inv-2", "Inverter 2"],
    ["buf-2", "Buffer 2"],
  ]);
});

test("a numbered name still fits the longest name a component may have", () => {
  const long = "x".repeat(32);
  const here: Definition = { id: "a", name: long, circuit: circuit() };
  const { added } = addDefinitions([here], [{ id: "b", name: long, circuit: circuit(gate("g")) }], ["b"]);
  expect(added[0]?.name).toBe(`${"x".repeat(30)} 2`);
});

test("contents alone never match: an empty component here is not taken for another empty one", () => {
  const todo: Definition = { id: "reg", name: "Register (todo)", circuit: circuit() };
  const cpu: Definition = { id: "cpu", name: "CPU", circuit: circuit(instance("u", "alu")) };
  const alu: Definition = { id: "alu", name: "ALU (todo)", circuit: circuit() };
  const { added, reused } = addDefinitions([todo], [alu, cpu], ["cpu"]);
  expect(reused).toEqual([]);
  expect(added.map((d) => d.id)).toEqual(["alu", "cpu"]);
  expect(added[1]?.circuit.components[0]).toMatchObject({ definition: "alu" });
});

test("a long chain of components is followed without running out of stack", () => {
  const chain: Definition[] = Array.from({ length: 20000 }, (_, i) => ({
    id: `d${i}`,
    name: `D${i}`,
    circuit: i === 0 ? circuit(gate("g")) : circuit(instance("x", `d${i - 1}`)),
  }));
  const { added } = addDefinitions([], chain, ["d19999"]);
  expect(added).toHaveLength(20000);
  expect(added[0]?.id).toBe("d0");
});

test("adding the same components again adds nothing: a copy here under another ID counts as the same", () => {
  const other: Definition = { id: "inv", name: "Inverter", circuit: circuit(pin("A", "switch"), pin("Y", "led")) };
  const first = addDefinitions([other], source, ["buf"]);
  const again = addDefinitions([other, ...first.added], source, ["buf"]);
  expect(again.added).toEqual([]);
  expect(again.reused.map((d) => d.id)).toEqual(["inv-2", "buf"]);
});
