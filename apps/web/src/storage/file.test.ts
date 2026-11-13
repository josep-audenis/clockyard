import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { CircuitComponent, CircuitDocument, ComponentKind, Definition, Wire } from "../editor/document";
import { parseDocument, serializeDocument } from "./file";

const document: CircuitDocument = {
  format: "clockyard",
  version: 9,
  metadata: { name: "AND demo", createdAt: "2026-11-06T12:00:00Z", modifiedAt: "2026-11-06T12:30:00Z" },
  circuit: {
    components: [
      { id: "a", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "A" } },
      { id: "g", kind: "and", position: { x: 6, y: -2 }, rotation: 0, props: { width: 8 } },
      { id: "x", kind: "custom", definition: "inv", position: { x: 6, y: 8 }, rotation: 90, props: {} },
    ],
    junctions: [{ id: "j", position: { x: 3, y: 1 }, name: "clk" }],
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
    Object.assign((doc.circuit.components[1] as CircuitComponent).props, { label: "   " });
  });
  expect(result).toEqual({ ok: true, document });
});

test("definition names are normalized like the editor does, and a blank one becomes Component", () => {
  const named = (name: string) => broken((doc) => Object.assign(doc.definitions[0] ?? {}, { name }));
  const name = (result: ReturnType<typeof parseDocument>) => (result.ok ? result.document.definitions[0]?.name : result.error);
  expect(name(named(" Inverter\n" + String.fromCodePoint(0x202e)))).toBe("Inverter");
  expect(name(named("  "))).toBe("Component");
});

test.each([
  ["not JSON", () => parseDocument("{"), "not valid JSON"],
  ["another format", () => broken((doc) => Object.assign(doc, { format: "other" })), "not a Clockyard file"],
  ["a newer version", () => broken((doc) => Object.assign(doc, { version: 10 })), "newer Clockyard"],
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
  ["an over-long definition name", () => broken((doc) => Object.assign(doc.definitions[0] ?? {}, { name: "x".repeat(33) })), "Definition 1 name is longer than 32"],
  ["missing wires", () => broken((doc) => Reflect.deleteProperty(doc.circuit, "wires")), "circuit.wires must be a list"],
  ["width 0", () => broken((_, c) => Object.assign(c.props, { width: 0 })), "Component 1 width must be a whole number from 1 to 32"],
  ["width 33", () => broken((_, c) => Object.assign(c.props, { width: 33 })), "from 1 to 32"],
  ["width 2.5", () => broken((_, c) => Object.assign(c.props, { width: 2.5 })), "from 1 to 32"],
  ["a width that is not a number", () => broken((_, c) => Object.assign(c.props, { width: "8" })), "from 1 to 32"],
  ["a bad width inside a definition", () => broken((doc) => Object.assign(doc.definitions[0]?.circuit.components[0]?.props ?? {}, { width: 0 })), "Definition 1: Component 1 width must be a whole number from 1 to 32"],
  ["a width on a custom component", () => broken((doc) => Object.assign(doc.circuit.components[2]?.props ?? {}, { width: 8 })), "Component 3 is a custom component, which takes no width"],
  ["fields on a gate", () => broken((doc) => Object.assign(doc.circuit.components[1]?.props ?? {}, { fields: [4, 4] })), "Component 2 has fields"],
  ["a splitter without fields", () => broken((_, c) => Object.assign(c, { kind: "split", props: {} })), "Component 1 is a splitter or merger without fields"],
  ["empty fields", () => broken((_, c) => Object.assign(c, { kind: "merge", props: { fields: [] } })), "Component 1 fields must be a list of at least one field width"],
  ["a field of 0 bits", () => broken((_, c) => Object.assign(c, { kind: "split", props: { fields: [4, 0] } })), "fields must be whole numbers of at least 1"],
  ["a fractional field", () => broken((_, c) => Object.assign(c, { kind: "split", props: { fields: [2.5] } })), "fields must be whole numbers of at least 1"],
  ["fields over 32 bits", () => broken((_, c) => Object.assign(c, { kind: "split", props: { fields: [16, 17] } })), "fields add up to 33 bits, more than 32"],
  ["fields that are not a list", () => broken((_, c) => Object.assign(c, { kind: "split", props: { fields: 8 } })), "fields must be a list"],
  ["a width on a splitter", () => broken((_, c) => Object.assign(c, { kind: "split", props: { fields: [4, 4], width: 8 } })), "takes fields, not a width"],
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

test("a version 3 file is migrated: wires name an instance's pins by part ID, not label", () => {
  const byLabel = { id: "x-in", from: { component: "a", port: "out" }, to: { component: "x", port: "In" } };
  const v3 = { ...document, version: 3, circuit: { ...document.circuit, wires: [...document.circuit.wires, byLabel] } };
  const result = parseDocument(JSON.stringify(v3));
  expect(result.ok && result.document.circuit.wires.at(-1)).toEqual({ ...byLabel, to: { component: "x", port: "i" } });
});

test("a version 3 file is migrated inside definitions too: a wire to a nested instance by label", () => {
  const outer = {
    id: "outer",
    name: "Outer",
    circuit: {
      components: [
        { id: "s", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "A" } },
        { id: "y", kind: "custom", definition: "inv", position: { x: 4, y: 0 }, rotation: 0, props: {} },
      ],
      junctions: [],
      wires: [{ id: "w", from: { component: "s", port: "out" }, to: { component: "y", port: "In" } }],
    },
  };
  const v3 = { ...document, version: 3, definitions: [...document.definitions, outer] };
  const result = parseDocument(JSON.stringify(v3));
  expect(result.ok && result.document.definitions[1]?.circuit.wires[0]?.to).toEqual({ component: "y", port: "i" });
});

test("a version 4 file is migrated: only the version changes", () => {
  const v4 = { ...document, version: 4 };
  expect(parseDocument(JSON.stringify(v4))).toEqual({ ok: true, document });
});

test("width 1 is the default: dropped on import, so 1-bit circuits export as before", () => {
  const result = broken((_, c) => Object.assign(c.props, { width: 1 }));
  expect(result).toEqual({ ok: true, document });
});

test("a splitter's fields round-trip through export and import", () => {
  const result = broken((_, c) => Object.assign(c, { kind: "split", props: { label: "Bus", fields: [3, 5] } }));
  expect(result.ok && result.document.circuit.components[0]).toMatchObject({ kind: "split", props: { label: "Bus", fields: [3, 5] } });
});

test("a version 5 file is migrated: only the version changes", () => {
  const v5 = { ...document, version: 5 };
  expect(parseDocument(JSON.stringify(v5))).toEqual({ ok: true, document });
});

test("a version 6 file is migrated: only the version changes; clocks and registers round-trip in 7", () => {
  const v6 = { ...document, version: 6 };
  expect(parseDocument(JSON.stringify(v6))).toEqual({ ok: true, document });
  const result = broken((_, c) => Object.assign(c, { kind: "dff", props: { width: 8 } }));
  expect(result.ok && result.document.circuit.components[0]).toMatchObject({ kind: "dff", props: { width: 8 } });
  expect(broken((_, c) => Object.assign(c, { kind: "clock", props: { width: 8 } }))).toMatchObject({ ok: false, error: expect.stringMatching(/always 1 bit/) });
});

test("a net label's name is normalized like the editor's, NFC included; blank is dropped, too long refused", () => {
  const named = (name: unknown) => broken((doc) => Object.assign(doc.circuit.junctions[0] ?? {}, { name }));
  const name = (result: ReturnType<typeof parseDocument>) => (result.ok ? result.document.circuit.junctions[0]?.name : result.error);
  // "e" + combining acute becomes the precomposed "é", so both spellings name one net.
  expect(name(named("  café "))).toBe("café");
  expect(name(named("   "))).toBeUndefined();
  expect(name(named("x".repeat(33)))).toContain("Junction 1 name is longer than 32 characters");
  expect(name(named(7))).toContain("Junction 1 name must be text");
});

test("a net label's name inside a definition is normalized too, and one of only invisible characters is dropped", () => {
  const inDefinition = broken((doc) => doc.definitions[0]?.circuit.junctions.push({ id: "dj", position: { x: 2, y: 2 }, name: " cafe\u0301 " }));
  expect(inDefinition.ok && inDefinition.document.definitions[0]?.circuit.junctions[0]?.name).toBe("caf\u00e9");
  const invisible = broken((doc) => Object.assign(doc.circuit.junctions[0] ?? {}, { name: "\u200b\u202e" }));
  expect(invisible.ok && invisible.document.circuit.junctions[0]?.name).toBeUndefined();
});

test("an export leaves out wires to a deleted pin, on the main circuit and inside definitions", () => {
  const wire: Wire = { id: "dead", from: { component: "a", port: "out" }, to: { component: "x", port: "gone" } };
  const doc = { ...document, circuit: { ...document.circuit, wires: [...document.circuit.wires, wire] } };
  expect(parseDocument(serializeDocument(doc))).toEqual({ ok: true, document });
  // The same instance and wire inside a second definition.
  const outer: Definition = { id: "outer", name: "Outer", circuit: doc.circuit };
  const clean: Definition = { ...outer, circuit: document.circuit };
  const nested = { ...document, definitions: [...document.definitions, outer] };
  expect(parseDocument(serializeDocument(nested))).toEqual({ ok: true, document: { ...nested, definitions: [...document.definitions, clean] } });
});

test("a version 7 file is migrated: only the version changes; memories round-trip in 8 (ADR 0018)", () => {
  const v7 = { ...document, version: 7 };
  expect(parseDocument(JSON.stringify(v7))).toEqual({ ok: true, document });
  const rom = broken((_, c) => Object.assign(c, { kind: "rom", props: { width: 16, addressWidth: 4, data: [0x1005, 0xc000], source: "LDI 5\nHLT" } }));
  expect(rom.ok && rom.document.circuit.components[0]).toMatchObject({ kind: "rom", props: { width: 16, addressWidth: 4, data: [0x1005, 0xc000], source: "LDI 5\nHLT" } });
  // 8 address bits is the default, so it is not stored.
  const ram = broken((_, c) => Object.assign(c, { kind: "ram", props: { width: 8, addressWidth: 8 } }));
  expect(ram.ok && ram.document.circuit.components[0]?.props).toEqual({ width: 8 });
});

test("a version 8 file is migrated: only the version changes; devices round-trip in 9 (ADR 0021)", () => {
  const v8 = { ...document, version: 8 };
  expect(parseDocument(JSON.stringify(v8))).toEqual({ ok: true, document });
  const screen = broken((_, c) => Object.assign(c, { kind: "screen", props: { width: 8, addressWidth: 7 } }));
  expect(screen.ok && screen.document.circuit.components[0]?.props).toEqual({ width: 8, addressWidth: 7 });
  for (const kind of ["seg7", "keyboard"]) {
    const part = broken((_, c) => Object.assign(c, { kind, props: {} }));
    expect(part.ok && part.document.circuit.components[0]?.kind).toBe(kind);
    expect(broken((_, c) => Object.assign(c, { kind, props: { width: 8 } }))).toMatchObject({ ok: false, error: expect.stringMatching(/always 8 bits wide/) });
  }
});

test.each([
  ["an address width on a gate", { kind: "and", props: { addressWidth: 4 } }, "only ROMs, RAMs and screens"],
  ["an address width out of range", { kind: "rom", props: { addressWidth: 17 } }, "address width must be"],
  ["data on a RAM", { kind: "ram", props: { data: [1] } }, "only ROMs hold"],
  ["a word too wide", { kind: "rom", props: { width: 8, data: [256] } }, "from 0 to 255"],
  ["more words than addresses", { kind: "rom", props: { addressWidth: 1, data: [1, 2, 3] } }, "more than the 2 addresses"],
  ["source on a RAM", { kind: "ram", props: { source: "HLT" } }, "only ROMs keep"],
])("refuses %s", (_, part, message) => {
  expect(broken((__, c) => Object.assign(c, part))).toMatchObject({ ok: false, error: expect.stringContaining(message) });
});
