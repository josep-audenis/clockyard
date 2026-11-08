import { expect, test } from "vitest";
import { fieldRanges, fieldsProblem, hex, parseValue, project, showValue, type Circuit } from "./document";

test("projection keeps connectivity and widths, junctions included, and drops geometry and labels", () => {
  const circuit: Circuit = {
    components: [
      { id: "s", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "A" } },
      { id: "l", kind: "led", position: { x: 4, y: 0 }, rotation: 90, props: {} },
      { id: "b", kind: "switch", position: { x: 0, y: 4 }, rotation: 0, props: { label: "Bus", width: 8 } },
    ],
    junctions: [{ id: "j", position: { x: 3, y: 1 } }],
    wires: [
      { id: "w", from: { component: "s", port: "out" }, to: { junction: "j" } },
      { id: "v", from: { junction: "j" }, to: { component: "l", port: "in" } },
    ],
  };
  expect(project(circuit)).toEqual({
    components: [
      { id: "s", kind: "switch" },
      { id: "l", kind: "led" },
      { id: "b", kind: "switch", width: 8 },
    ],
    junctions: [{ id: "j" }],
    definitions: [],
    connections: [
      { id: "w", from: { component: "s", port: "out" }, to: { junction: "j" } },
      { id: "v", from: { junction: "j" }, to: { component: "l", port: "in" } },
    ],
  });
});

test("the readout shows 1 bit as on or off and wider values in decimal and hex", () => {
  expect([showValue(0, 1), showValue(1, 1)]).toEqual(["off", "on"]);
  expect(showValue(44, 8)).toBe("44 (0x2C)");
  expect(showValue(0xffffffff, 32)).toBe("4294967295 (0xFFFFFFFF)");
});

test("a definition's parts, its pins included, project their widths too", () => {
  const inner: Circuit = {
    components: [
      { id: "i", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "In", width: 8 } },
      { id: "o", kind: "led", position: { x: 4, y: 0 }, rotation: 0, props: { width: 8 } },
    ],
    junctions: [],
    wires: [{ id: "w", from: { component: "i", port: "out" }, to: { component: "o", port: "in" } }],
  };
  const projected = project({ components: [], junctions: [], wires: [] }, [{ id: "d", name: "Bus", circuit: inner }]);
  expect(projected.definitions[0]?.components).toEqual([
    { id: "i", kind: "switch", width: 8 },
    { id: "o", kind: "led", width: 8 },
  ]);
});

test("a typed value is decimal, 0x or 0b, and must fit the width", () => {
  expect(["44", "0x2C", "0X2c", "0b0010_1100", " 255 "].map((t) => parseValue(t, 8))).toEqual([44, 44, 44, 44, 255]);
  expect(["256", "-1", "2.5", "", "0x", "0b2", "1e3", "0x1FF"].map((t) => parseValue(t, 8))).toEqual(Array(8).fill(null));
  expect(parseValue("0xFFFFFFFF", 32)).toBe(0xffffffff);
  expect(parseValue("4294967296", 32)).toBeNull();
  expect([hex(44, 8), hex(5, 12), hex(0xffffffff, 32), hex(1, 2)]).toEqual(["0x2C", "0x005", "0xFFFFFFFF", "0x1"]);
});

test("fields are checked like the engine checks them, and each shows its bit range", () => {
  expect([[1, 1, 1, 1], [32], Array<number>(32).fill(1)].map(fieldsProblem)).toEqual([null, null, null]);
  expect([[], [0], [2.5], [16, 17], Array<number>(33).fill(1), "8", null].map((f) => fieldsProblem(f) !== null)).toEqual(Array(7).fill(true));
  expect(fieldRanges([1, 3, 4])).toEqual(["0", "3:1", "7:4"]);
  expect(fieldRanges([8, 8, 8, 8])).toEqual(["7:0", "15:8", "23:16", "31:24"]);
});

test("projection copies a splitter's fields", () => {
  const circuit: Circuit = {
    components: [{ id: "sp", kind: "split", position: { x: 0, y: 0 }, rotation: 0, props: { fields: [4, 4] } }],
    junctions: [],
    wires: [],
  };
  expect(project(circuit).components).toEqual([{ id: "sp", kind: "split", fields: [4, 4] }]);
});

test("projection copies a junction's name and leaves plain junctions as they were", () => {
  const circuit: Circuit = {
    components: [],
    junctions: [
      { id: "a", position: { x: 0, y: 0 }, name: "clk" },
      { id: "b", position: { x: 2, y: 0 } },
    ],
    wires: [],
  };
  expect(project(circuit).junctions).toEqual([{ id: "a", name: "clk" }, { id: "b" }]);
});

test("an empty name is projected as no name; a definition's labels are projected too", () => {
  const circuit: Circuit = { components: [], junctions: [{ id: "a", position: { x: 0, y: 0 }, name: "" }], wires: [] };
  const inner: Circuit = { components: [], junctions: [{ id: "b", position: { x: 0, y: 0 }, name: "clk" }], wires: [] };
  const projected = project(circuit, [{ id: "d", name: "D", circuit: inner }]);
  expect(projected.junctions).toEqual([{ id: "a" }]);
  expect(projected.definitions[0]?.junctions).toEqual([{ id: "b", name: "clk" }]);
});
