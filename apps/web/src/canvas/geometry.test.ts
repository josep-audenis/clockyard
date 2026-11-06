import { expect, test } from "vitest";
import type { Circuit, CircuitComponent } from "../editor/document";
import { hitTest, portAt, wirePoints } from "./geometry";

const part = (id: string, kind: CircuitComponent["kind"], x: number, y: number): CircuitComponent => ({
  id,
  kind,
  position: { x, y },
  rotation: 0,
  props: {},
});

const circuit: Circuit = {
  components: [part("s", "switch", 0, 0), part("g", "and", 6, 0)],
  wires: [{ id: "w", from: { component: "s", port: "out" }, to: { component: "g", port: "b" } }],
};
const byId = new Map(circuit.components.map((c) => [c.id, c]));

test("ports sit at the layout offset from the component position", () => {
  expect(portAt(part("g", "and", 6, 0), "b")).toEqual({ x: 6, y: 3 });
  expect(portAt(part("g", "and", 6, 0), "nope")).toBeUndefined();
});

test("wires route orthogonally with the bend on a grid column", () => {
  const [wire] = circuit.wires;
  expect(wire && wirePoints(byId, wire)).toEqual([
    { x: 2, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
    { x: 6, y: 3 },
  ]);
  expect(wirePoints(byId, { id: "x", from: { component: "gone", port: "out" }, to: { component: "g", port: "a" } })).toBeNull();
});

test("hit-testing prefers ports, then bodies, then wires", () => {
  expect(hitTest(circuit, { x: 6.1, y: 1 }, 0.5)).toEqual({ type: "port", ref: { component: "g", port: "a" } });
  expect(hitTest(circuit, { x: 7, y: 2 }, 0.5)).toEqual({ type: "component", id: "g" });
  expect(hitTest(circuit, { x: 4.1, y: 2 }, 0.5)).toEqual({ type: "wire", id: "w" });
  expect(hitTest(circuit, { x: 20, y: 20 }, 0.5)).toBeNull();
});
