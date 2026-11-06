import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { CircuitComponent, CircuitDocument, ComponentKind, Wire } from "../editor/document";
import { parseDocument, serializeDocument } from "./file";

const document: CircuitDocument = {
  format: "clockyard",
  version: 1,
  metadata: { name: "AND demo", createdAt: "2026-11-06T12:00:00Z", modifiedAt: "2026-11-06T12:30:00Z" },
  circuit: {
    components: [
      { id: "a", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "A" } },
      { id: "g", kind: "and", position: { x: 6, y: -2 }, rotation: 0, props: {} },
    ],
    wires: [{ id: "w", from: { component: "a", port: "out" }, to: { component: "g", port: "a" } }],
  },
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
  });
  expect(result).toEqual({ ok: true, document });
});

test.each([
  ["not JSON", () => parseDocument("{"), "not valid JSON"],
  ["another format", () => broken((doc) => Object.assign(doc, { format: "other" })), "not a Clockyard file"],
  ["a newer version", () => broken((doc) => Object.assign(doc, { version: 2 })), "newer Clockyard"],
  ["an unknown kind", () => broken((_, c) => (c.kind = "flux" as ComponentKind)), 'unknown kind "flux"'],
  ["a fractional position", () => broken((_, c) => (c.position.x = 0.5)), "x must be a whole number"],
  ["a bad rotation", () => broken((_, c) => Object.assign(c, { rotation: 45 })), "rotation"],
  ["a duplicate ID", () => broken((_, _c, w) => (w.id = "a")), "ID a is used more than once"],
  ["a dangling wire", () => broken((_, _c, w) => (w.to.component = "gone")), "missing component gone"],
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
