import { expect, test } from "vitest";
import { project, type Circuit } from "./document";

test("projection keeps connectivity, junctions included, and drops geometry and props", () => {
  const circuit: Circuit = {
    components: [
      { id: "s", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: { label: "A" } },
      { id: "l", kind: "led", position: { x: 4, y: 0 }, rotation: 90, props: {} },
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
    ],
    junctions: [{ id: "j" }],
    connections: [
      { id: "w", from: { component: "s", port: "out" }, to: { junction: "j" } },
      { id: "v", from: { junction: "j" }, to: { component: "l", port: "in" } },
    ],
  });
});
