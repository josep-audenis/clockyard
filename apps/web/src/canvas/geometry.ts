// Pure geometry in grid units: port positions, wire routes, hit-testing.
// Connectivity is never derived from here; only what the pointer is over.
import { isJunction, type Circuit, type CircuitComponent, type Junction, type Wire } from "../editor/document";
import type { Endpoint, PortRef } from "../simulation/protocol";
import { LAYOUTS, type Point } from "./layout";

export type { Point };

/** Parts and junctions by ID, for resolving wire ends. */
export type Places = { components: Map<string, CircuitComponent>; junctions: Map<string, Junction> };

export const places = (circuit: Circuit): Places => ({
  components: new Map(circuit.components.map((c) => [c.id, c])),
  junctions: new Map(circuit.junctions.map((j) => [j.id, j])),
});

export function portAt(component: CircuitComponent, port: string): Point | undefined {
  const layout = LAYOUTS[component.kind];
  const offset = layout.inputs[port] ?? layout.outputs[port];
  return offset && { x: component.position.x + offset.x, y: component.position.y + offset.y };
}

export function endAt(at: Places, end: Endpoint): Point | undefined {
  if (isJunction(end)) return at.junctions.get(end.junction)?.position;
  const component = at.components.get(end.component);
  return component && portAt(component, end.port);
}

const withoutRepeats = (points: Point[]) =>
  points.filter((p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y);

/**
 * Orthogonal route. Between two ports the bend sits on the column half-way
 * between them; a port is left horizontally and the bend sits on a junction's
 * column, so junctions double as waypoints (ADR 0010).
 */
export function wirePoints(at: Places, wire: Wire): Point[] | null {
  const a = endAt(at, wire.from);
  const b = endAt(at, wire.to);
  if (!a || !b) return null;
  const [aj, bj] = [isJunction(wire.from), isJunction(wire.to)];
  if (!aj && !bj) {
    if (a.y === b.y) return [a, b];
    const mx = Math.round((a.x + b.x) / 2);
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (aj && bj) return withoutRepeats([a, { x: b.x, y: a.y }, b]);
  const [port, junction] = aj ? [b, a] : [a, b];
  const route = [port, { x: junction.x, y: port.y }, junction];
  return withoutRepeats(aj ? route.reverse() : route);
}

export type Hit =
  | { type: "port"; ref: PortRef }
  | { type: "junction"; id: string }
  | { type: "component"; id: string }
  | { type: "wire"; id: string }
  | null;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function segmentDistance(p: Point, a: Point, b: Point): number {
  return distance(p, closestOnSegment(p, a, b));
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** The grid point on an orthogonal route nearest to `p`; segments run along grid lines, so it stays on the route. */
export function nearestOnRoute(points: Point[], p: Point): Point | undefined {
  let best: Point | undefined;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (!a || !b) continue;
    const c = closestOnSegment(p, a, b);
    const snapped = {
      x: Math.min(Math.max(Math.round(c.x), Math.min(a.x, b.x)), Math.max(a.x, b.x)),
      y: Math.min(Math.max(Math.round(c.y), Math.min(a.y, b.y)), Math.max(a.y, b.y)),
    };
    if (!best || distance(p, snapped) < distance(p, best)) best = snapped;
  }
  return best;
}

/** Ports win over junctions, junctions over bodies, bodies over wires; later items are on top. */
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

  for (const junction of [...circuit.junctions].reverse()) {
    if (distance(p, junction.position) <= pick) return { type: "junction", id: junction.id };
  }

  for (const component of [...circuit.components].reverse()) {
    const { x, y } = component.position;
    const { width, height } = LAYOUTS[component.kind];
    if (p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height) return { type: "component", id: component.id };
  }

  const at = places(circuit);
  for (const wire of [...circuit.wires].reverse()) {
    const points = wirePoints(at, wire) ?? [];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (a && b && segmentDistance(p, a, b) <= pick / 2) return { type: "wire", id: wire.id };
    }
  }
  return null;
}

/** IDs of parts lying wholly inside the box spanned by two corners (any order), then of junctions inside it. */
export function itemsInBox(circuit: Circuit, a: Point, b: Point): string[] {
  const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [top, bottom] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inside = ({ x, y }: Point) => x >= left && y >= top && x <= right && y <= bottom;
  const parts = circuit.components.filter(({ kind, position }) => {
    const { width, height } = LAYOUTS[kind];
    return inside(position) && inside({ x: position.x + width, y: position.y + height });
  });
  return [...parts, ...circuit.junctions.filter((j) => inside(j.position))].map((item) => item.id);
}
