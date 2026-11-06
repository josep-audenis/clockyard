// Pure geometry in grid units: port positions, wire routes, hit-testing.
// Connectivity is never derived from here; only what the pointer is over.
import type { Circuit, CircuitComponent, Wire } from "../editor/document";
import type { PortRef } from "../simulation/protocol";
import { LAYOUTS, type Point } from "./layout";

export type { Point };

export function portAt(component: CircuitComponent, port: string): Point | undefined {
  const layout = LAYOUTS[component.kind];
  const offset = layout.inputs[port] ?? layout.outputs[port];
  return offset && { x: component.position.x + offset.x, y: component.position.y + offset.y };
}

/** Orthogonal route with its bends on a grid column between the two ports. */
export function wirePoints(components: Map<string, CircuitComponent>, wire: Wire): Point[] | null {
  const from = components.get(wire.from.component);
  const to = components.get(wire.to.component);
  const a = from && portAt(from, wire.from.port);
  const b = to && portAt(to, wire.to.port);
  if (!a || !b) return null;
  if (a.y === b.y) return [a, b];
  const mx = Math.round((a.x + b.x) / 2);
  return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
}

export type Hit = { type: "port"; ref: PortRef } | { type: "component"; id: string } | { type: "wire"; id: string } | null;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Ports win over bodies, bodies over wires; later components are on top. */
export function hitTest(circuit: Circuit, p: Point, pick: number): Hit {
  let port: Hit = null;
  let best = pick;
  for (const component of circuit.components) {
    const layout = LAYOUTS[component.kind];
    for (const name of [...Object.keys(layout.inputs), ...Object.keys(layout.outputs)]) {
      const at = portAt(component, name);
      const d = at ? distance(p, at) : Infinity;
      if (d <= best) {
        best = d;
        port = { type: "port", ref: { component: component.id, port: name } };
      }
    }
  }
  if (port) return port;

  for (const component of [...circuit.components].reverse()) {
    const { x, y } = component.position;
    const { width, height } = LAYOUTS[component.kind];
    if (p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height) return { type: "component", id: component.id };
  }

  const byId = new Map(circuit.components.map((c) => [c.id, c]));
  for (const wire of [...circuit.wires].reverse()) {
    const points = wirePoints(byId, wire) ?? [];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (a && b && segmentDistance(p, a, b) <= pick / 2) return { type: "wire", id: wire.id };
    }
  }
  return null;
}
