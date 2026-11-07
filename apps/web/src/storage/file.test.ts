import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { CircuitComponent, CircuitDocument, ComponentKind, Definition, Wire } from "../editor/document";
import { parseDocument, serializeDocument } from "./file";

const document: CircuitDocument = {
  format: "clockyard",
  version: 3,
  metadata: { name: "AND demo", createdAt: "2026-11-06T12:00:00Z", modifiedAt: "2026-11-06T12:30:00Z" },
  circuit: {
    components: [
      { id: "a", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "A" } },
      { id: "g", kind: "and", position: { x: 6, y: -2 }, rotation: 0, props: {} },
      { id: "x", kind: "custom", definition: "inv", position: { x: 6, y: 8 }, rotation: 90, props: {} },
    ],
    junctions: [{ id: "j", position: { x: 3, y: 1 } }],
    wires: [
      { id: "w", from: { component: "a", port: "out" }, to: { component: "g", port: "a" } },
      { id: "v", from: { junction: "j" }, to: { component: "g", port: "b" }, bends: [{ x: 4, y: 1 }] },
    ],
  },
  definitions: [
    {
      id: "inv",
      name: "Inverter",
      circuit: {
        components: [
          { id: "i", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "In" } },
          { id: "n", kind: "not", position: { x: 4, y: 0 }, rotation: 0, props: {} },
          { id: "o", kind: "led", position: { x: 9, y: 0 }, rotation: 0, props: { label: "Out" } },
        ],
        junctions: [],
        wires: [
          { id: "w1", from: { component: "i", port: "out" }, to: { component: "n", port: "in" } },
          { id: "w2", from: { component: "n", port: "out" }, to: { component: "o", port: "in" } },
        ],
      },
    },
  ],
};

// Breaks a deep copy: `change` edits the copy, its first component and its first wire in place.
const broken = (change: (doc: CircuitDocument, component: CircuitComponent, wire: Wire) => void) => {
  const doc = JSON.parse(serializeDocument(document)) as CircuitDocument;
  change(doc, doc.circuit.components[0] as CircuitComponent, doc.circuit.wires[0] as Wire);
  return parseDocument(JSON.stringify(doc));
};

test("a saved document loads back unchanged", () => {
  expect(parseDocument(serializeDocument(document))).toEqual({ ok: true, document });
});

test("unknown fields are dropped", () => {
  const result = broken((doc, component) => {
    Object.assign(doc, { extra: 1 });
    Object.assign(component, { selected: true });
    Object.assign(component.props, { colour: "red" });
  });
  expect(result).toEqual({ ok: true, document });
});

test("labels are normalized like the editor does, and a blank one is dropped", () => {
  const result = broken((doc, component) => {
    component.props.label = "  A" + String.fromCodePoint(0x200b) + " ";
    Object.assign(doc.circuit.components[1] as CircuitComponent, { props: { label: "   " } });
  });
  expect(result).toEqual({ ok: true, document });
});

test.each([
  ["not JSON", () => parseDocument("{"), "not valid JSON"],
  ["another format", () => broken((doc) => Object.assign(doc, { format: "other" })), "not a Clockyard file"],
  ["a newer version", () => broken((doc) => Object.assign(doc, { version: 4 })), "newer Clockyard"],
  ["an instance of a missing definition", () => broken((doc) => Object.assign(doc.circuit.components[2] ?? {}, { definition: "gone" })), "missing definition gone"],
  ["an ID with a slash", () => broken((_, c) => (c.id = "a/b")), 'must not contain "/"'],
  ["a definition ID used twice", () => broken((doc) => doc.definitions.push({ ...(doc.definitions[0] as Definition) })), "ID inv is used more than once"],
  ["a definition with a broken wire", () => broken((doc) => Object.assign(doc.definitions[0]?.circuit.wires[0]?.to ?? {}, { component: "gone" })), "Definition 1: Wire 1 end refers to missing component gone"],
  ["definitions that are not a list", () => broken((doc) => Object.assign(doc, { definitions: {} })), "definitions must be a list"],
  ["a fractional junction", () => broken((doc) => Object.assign(doc.circuit.junctions[0] ?? {}, { position: { x: 1.5, y: 0 } })), "x must be a whole number"],
  ["a junction sharing an ID", () => broken((doc) => Object.assign(doc.circuit.junctions[0] ?? {}, { id: "g" })), "ID g is used more than once"],
  ["a wire to a missing junction", () => broken((_, _c, w) => (w.to = { junction: "gone" })), "missing junction gone"],
  ["a wire from a port to itself", () => broken((_, _c, w) => (w.to = { ...w.from })), "starts and ends at the same place"],
  ["too many bends", () => broken((_, _c, w) => (w.bends = Array.from({ length: 65 }, () => ({ x: 0, y: 0 })))), "more than 64 bends"],
  ["a fractional bend", () => broken((_, _c, w) => (w.bends = [{ x: 0.5, y: 0 }])), "bend 1 x must be a whole number"],
  ["missing junctions", () => broken((doc) => Reflect.deleteProperty(doc.circuit, "junctions")), "circuit.junctions must be a list"],
  ["an unknown kind", () => broken((_, c) => (c.kind = "flux" as ComponentKind)), 'unknown kind "flux"'],
  ["a fractional position", () => broken((_, c) => (c.position.x = 0.5)), "x must be a whole number"],
  ["a position too far out", () => broken((_, c) => (c.position.y = 1e300)), "y must be a whole number from -1000000"],
  ["a bad rotation", () => broken((_, c) => Object.assign(c, { rotation: 45 })), "rotation"],
  ["a duplicate ID", () => broken((_, _c, w) => (w.id = "a")), "ID a is used more than once"],
  ["a dangling wire", () => broken((_, _c, w) => (w.to = { component: "gone", port: "a" })), "missing component gone"],
  ["a label that is not text", () => broken((_, c) => Object.assign(c.props, { label: 7 })), "label must be text"],
  ["an over-long label", () => broken((_, c) => (c.props.label = "x".repeat(33))), "longer than 32"],
  ["missing wires", () => broken((doc) => Reflect.deleteProperty(doc.circuit, "wires")), "circuit.wires must be a list"],
])("rejects %s", (_name, parse, message) => {
  const result = parse();
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.error).toContain(message);
});

const examples = new URL("../../../../examples/", import.meta.url);
test.each(readdirSync(examples).filter((name) => name.endsWith(".clockyard.json")))("example %s is a valid project file", (name) => {
  const result = parseDocument(readFileSync(new URL(name, examples), "utf8"));
  expect(result.ok ? "ok" : result.error).toBe("ok");
});

test("a version 1 file is migrated: same parts and wires, no junctions", () => {
  const v1 = {
    format: "clockyard",
    version: 1,
    metadata: document.metadata,
    circuit: { components: document.circuit.components.slice(0, 2), wires: document.circuit.wires.slice(0, 1) },
  };
  expect(parseDocument(JSON.stringify(v1))).toEqual({
    ok: true,
    document: {
      ...document,
      circuit: { components: document.circuit.components.slice(0, 2), junctions: [], wires: document.circuit.wires.slice(0, 1) },
      definitions: [],
    },
  });
});

test("a version 2 file is migrated: the same circuit, no definitions", () => {
  const circuit = { ...document.circuit, components: document.circuit.components.slice(0, 2) };
  const v2 = { format: "clockyard", version: 2, metadata: document.metadata, circuit };
  expect(parseDocument(JSON.stringify(v2))).toEqual({ ok: true, document: { ...document, circuit, definitions: [] } });
});
