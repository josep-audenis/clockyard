import { expect, test } from "vitest";
import type { Circuit, CircuitComponent } from "../editor/document";
import {
  dragSegment,
  exitOf,
  hitTest,
  itemsInBox,
  nearestOnRoute,
  occupied,
  orthogonal,
  placementStacks,
  places,
  portAt,
  simplify,
  stacksJunction,
  wirePoints,
} from "./geometry";

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
  const routes = new Map([["w", [{ x: 2, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }, { x: 6, y: 3 }]]]);
  expect(hitTest(circuit, { x: 6.1, y: 1 }, 0.5, routes)).toEqual({ type: "port", ref: { component: "g", port: "a" } });
  expect(hitTest(circuit, { x: 3.2, y: 9.1 }, 0.5, routes)).toEqual({ type: "junction", id: "j" });
  expect(hitTest(circuit, { x: 7, y: 2 }, 0.5, routes)).toEqual({ type: "component", id: "g" });
  expect(hitTest(circuit, { x: 4.1, y: 2 }, 0.5, routes)).toEqual({ type: "wire", id: "w", segment: 1 });
  expect(hitTest(circuit, { x: 20, y: 20 }, 0.5, routes)).toBeNull();
});

test("a box selects parts wholly inside it and the junctions inside it, dragged in any direction", () => {
  // Switch spans (0,0)-(2,2); AND spans (6,0)-(10,4); LED (6,8)-(8,10); junction at (3,9).
  expect(itemsInBox(circuit, { x: -1, y: -1 }, { x: 3, y: 3 })).toEqual(["s"]);
  expect(itemsInBox(circuit, { x: 11, y: 11 }, { x: -1, y: -1 })).toEqual(["s", "g", "l", "j"]);
  expect(itemsInBox(circuit, { x: -1, y: -1 }, { x: 9, y: 9 })).toEqual(["s", "j"]); // AND and LED only partly inside
  expect(itemsInBox(circuit, { x: 2, y: 8 }, { x: 4, y: 10 })).toEqual(["j"]);
});

test("a junction may not land on a port or another junction, nor a port on a junction", () => {
  // Ports: switch out (2,1); AND a (6,1), b (6,3), out (10,2); LED in (6,9). Junction at (3,9).
  expect(occupied(circuit, { x: 6, y: 3 })).toBe(true);
  expect(occupied(circuit, { x: 3, y: 9 })).toBe(true);
  expect(occupied(circuit, { x: 4, y: 4 })).toBe(false);
  expect(stacksJunction(circuit, { j: { x: 6, y: 3 } })).toBe(true); // onto the AND's input
  expect(stacksJunction(circuit, { j: { x: 4, y: 9 } })).toBe(false);
  expect(stacksJunction(circuit, { l: { x: 3, y: 8 } })).toBe(true); // the LED's input onto the junction
  // Moving the junction with the LED keeps them apart as they were.
  expect(stacksJunction(circuit, { j: { x: 3, y: 10 }, l: { x: 6, y: 9 } })).toBe(false);
});

test("simplify drops repeats and the middle of straight runs", () => {
  expect(
    simplify([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 5, y: 1 }, // doubles back: still one straight run
    ]),
  ).toEqual([
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 1 },
  ]);
});

test("a shaped route gets corners where an end has moved out of line", () => {
  // Bends (4,1) and (4,5); the start moved down to (2,2), the end to (8,6).
  expect(orthogonal({ x: 2, y: 2 }, [{ x: 4, y: 1 }, { x: 4, y: 5 }], { x: 8, y: 6 })).toEqual([
    { x: 2, y: 2 },
    { x: 4, y: 2 },
    { x: 4, y: 6 },
    { x: 8, y: 6 },
  ]);
});

test("dragging a middle segment moves it; dragging an end segment adds a stub so the end stays put", () => {
  const route = [
    { x: 2, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
    { x: 6, y: 3 },
  ];
  expect(dragSegment(route, 1, { x: 5, y: 2 }, [0, 1])).toEqual([
    { x: 2, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 3 },
    { x: 6, y: 3 },
  ]);
  // The first segment, from an output on the right of its part (exit 0, rightwards), moved down to row 2.
  expect(dragSegment(route, 0, { x: 3, y: 2 }, [0, 1])).toEqual([
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 4, y: 3 },
    { x: 6, y: 3 },
  ]);
  // A straight wire between two ports, pulled down: both ends keep their stubs.
  expect(dragSegment([{ x: 2, y: 1 }, { x: 8, y: 1 }], 0, { x: 5, y: 4 }, [0, 1])).toEqual([
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 4 },
    { x: 7, y: 4 },
    { x: 7, y: 1 },
    { x: 8, y: 1 },
  ]);
});

test("simplify keeps checking after a removal lines up earlier points", () => {
  // Removing the doubled-back (5,3) leaves (5,0) twice and then a straight run along row 0.
  expect(
    simplify([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 5, y: 0 },
      { x: 8, y: 0 },
    ]),
  ).toEqual([
    { x: 0, y: 0 },
    { x: 8, y: 0 },
  ]);
});

test("the segment next to a port's first run cannot be dragged back over that port", () => {
  // From an output at (2,1) heading right (exit 0, rightwards): its first vertical stays at x >= 3.
  const route = [
    { x: 2, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 4 },
    { x: 9, y: 4 },
  ];
  expect(dragSegment(route, 1, { x: 0, y: 2 }, [0, 1])).toEqual([
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 4 },
    { x: 9, y: 4 },
  ]);
  // An output at x 2 (exit 0, needs x >= 3) and an input at x 3 (exit 1, needs x <= 2): no room, so the drag is ignored.
  const tight = [
    { x: 2, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 4 },
    { x: 3, y: 4 },
  ];
  expect(dragSegment(tight, 1, { x: 4, y: 2 }, [0, 1])).toBe(tight);
});

test("a rotated port exits away from the side it now sits on", () => {
  const turned: Circuit = { components: [{ ...part("g", "and", 0, 0), rotation: 90 }], junctions: [], wires: [] };
  const at = places(turned);
  expect(portAt(turned.components[0] as CircuitComponent, "a")).toEqual({ x: 3, y: 0 });
  expect(exitOf(at, { component: "g", port: "a" })).toBe(3); // up
  expect(exitOf(at, { component: "g", port: "out" })).toBe(2); // down
  expect(exitOf(at, { junction: "j" })).toBe(-1);
});

test("shaped routes leave and enter vertical ports vertically", () => {
  // From a port facing down (exit 2) at (0,0) to a port facing left (exit 1) at (6,4), no bends.
  expect(orthogonal({ x: 0, y: 0 }, [], { x: 6, y: 4 }, [2, 1])).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 4 },
    { x: 6, y: 4 },
  ]);
  // Dragging the run next to a downward port keeps it below that port.
  const route = [
    { x: 0, y: 0 },
    { x: 0, y: 3 },
    { x: 6, y: 3 },
    { x: 6, y: 6 },
  ];
  expect(dragSegment(route, 1, { x: 3, y: -2 }, [2, -1])[1]).toEqual({ x: 0, y: 1 });
});

test("placing a part is refused where one of its ports would sit on a junction", () => {
  // The junction is at (3,9). A NOT's input is at (0,1) from its corner: at (3,8) it lands on the junction.
  expect(placementStacks(circuit, part("n", "not", 3, 8))).toBe(true);
  expect(placementStacks(circuit, part("n", "not", 3, 10))).toBe(false);
  // Turned upright (input on top at (1,0)), the same spot is fine, and (2,9) is not.
  expect(placementStacks(circuit, { ...part("n", "not", 3, 8), rotation: 90 })).toBe(false);
  expect(placementStacks(circuit, { ...part("n", "not", 2, 9), rotation: 90 })).toBe(true);
});
