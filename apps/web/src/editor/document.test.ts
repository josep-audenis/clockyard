import { expect, test } from "vitest";
import { project, showValue, type Circuit } from "./document";

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
