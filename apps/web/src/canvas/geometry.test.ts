import { expect, test } from "vitest";
import type { Circuit, CircuitComponent } from "../editor/document";
import { hitTest, itemsInBox, nearestOnRoute, places, portAt, wirePoints } from "./geometry";

const part = (id: string, kind: CircuitComponent["kind"], x: number, y: number): CircuitComponent => ({
  id,
  kind,
  position: { x, y },
  rotation: 0,
  props: {},
});

const circuit: Circuit = {
  components: [part("s", "switch", 0, 0), part("g", "and", 6, 0), part("l", "led", 6, 8)],
  junctions: [{ id: "j", position: { x: 3, y: 9 } }],
  wires: [
    { id: "w", from: { component: "s", port: "out" }, to: { component: "g", port: "b" } },
    { id: "v", from: { junction: "j" }, to: { component: "l", port: "in" } },
  ],
};
const at = places(circuit);

test("ports sit at the layout offset from the component position", () => {
  expect(portAt(part("g", "and", 6, 0), "b")).toEqual({ x: 6, y: 3 });
  expect(portAt(part("g", "and", 6, 0), "nope")).toBeUndefined();
});

test("wires between ports route orthogonally with the bend on a grid column", () => {
  const [wire] = circuit.wires;
  expect(wire && wirePoints(at, wire)).toEqual([
    { x: 2, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
    { x: 6, y: 3 },
  ]);
  expect(wirePoints(at, { id: "x", from: { component: "gone", port: "out" }, to: { component: "g", port: "a" } })).toBeNull();
  expect(wirePoints(at, { id: "x", from: { junction: "gone" }, to: { component: "g", port: "a" } })).toBeNull();
});

test("a wire leaves its port horizontally and bends on the junction's column", () => {
  // Switch out (2,1) to junction (3,9): along row 1, then down column 3.
  expect(wirePoints(at, { id: "x", from: { component: "s", port: "out" }, to: { junction: "j" } })).toEqual([
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 9 },
  ]);
  // Junction (3,9) to LED in (6,9): same row, so a straight line.
  const [, toLed] = circuit.wires;
  expect(toLed && wirePoints(at, toLed)).toEqual([
    { x: 3, y: 9 },
    { x: 6, y: 9 },
  ]);
});

test("the nearest grid point on a route stays on it", () => {
  const route = [
    { x: 2, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
  ];
  expect(nearestOnRoute(route, { x: 3.3, y: 1.4 })).toEqual({ x: 3, y: 1 });
  expect(nearestOnRoute(route, { x: 4.2, y: 2.4 })).toEqual({ x: 4, y: 2 });
  expect(nearestOnRoute(route, { x: 9, y: 9 })).toEqual({ x: 4, y: 3 });
});

test("hit-testing prefers ports, then junctions, then bodies, then wires", () => {
  expect(hitTest(circuit, { x: 6.1, y: 1 }, 0.5)).toEqual({ type: "port", ref: { component: "g", port: "a" } });
  expect(hitTest(circuit, { x: 3.2, y: 9.1 }, 0.5)).toEqual({ type: "junction", id: "j" });
  expect(hitTest(circuit, { x: 7, y: 2 }, 0.5)).toEqual({ type: "component", id: "g" });
  expect(hitTest(circuit, { x: 4.1, y: 2 }, 0.5)).toEqual({ type: "wire", id: "w" });
  expect(hitTest(circuit, { x: 20, y: 20 }, 0.5)).toBeNull();
});

test("a box selects parts wholly inside it and the junctions inside it, dragged in any direction", () => {
  // Switch spans (0,0)-(2,2); AND spans (6,0)-(10,4); LED (6,8)-(8,10); junction at (3,9).
  expect(itemsInBox(circuit, { x: -1, y: -1 }, { x: 3, y: 3 })).toEqual(["s"]);
  expect(itemsInBox(circuit, { x: 11, y: 11 }, { x: -1, y: -1 })).toEqual(["s", "g", "l", "j"]);
  expect(itemsInBox(circuit, { x: -1, y: -1 }, { x: 9, y: 9 })).toEqual(["s", "j"]); // AND and LED only partly inside
  expect(itemsInBox(circuit, { x: 2, y: 8 }, { x: 4, y: 10 })).toEqual(["j"]);
});
