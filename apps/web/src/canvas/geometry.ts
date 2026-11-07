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

/** Every port position of a part. */
export function portsOf(component: CircuitComponent): Point[] {
  const { inputs, outputs } = LAYOUTS[component.kind];
  return [...Object.values(inputs), ...Object.values(outputs)].map((o) => ({
    x: component.position.x + o.x,
    y: component.position.y + o.y,
  }));
}

const key = (p: Point) => `${p.x},${p.y}`;

/** True when a port or junction sits at `p`. */
export const occupied = (circuit: Circuit, p: Point) =>
  circuit.junctions.some((j) => key(j.position) === key(p)) ||
  circuit.components.some((c) => portsOf(c).some((q) => key(q) === key(p)));

/**
 * True when moving items to `positions` would put a junction on a port or
 * another junction, or a port on a junction: dots on one spot look joined
 * when they are not.
 */
export function stacksJunction(circuit: Circuit, positions: Record<string, Point>): boolean {
  const ports = new Set<string>();
  const junctions = new Set<string>();
  const movedPorts: Point[] = [];
  const movedJunctions: Point[] = [];
  for (const c of circuit.components) {
    const to = positions[c.id];
    if (to) movedPorts.push(...portsOf({ ...c, position: to }));
    else portsOf(c).forEach((p) => ports.add(key(p)));
  }
  for (const j of circuit.junctions) {
    const to = positions[j.id];
    if (to) movedJunctions.push(to);
    else junctions.add(key(j.position));
  }
  return (
    movedJunctions.some((p) => ports.has(key(p)) || junctions.has(key(p))) || movedPorts.some((p) => junctions.has(key(p)))
  );
}

export function endAt(at: Places, end: Endpoint): Point | undefined {
  if (isJunction(end)) return at.junctions.get(end.junction)?.position;
  const component = at.components.get(end.component);
  return component && portAt(component, end.port);
}

/** Drops repeated points and points in the middle of a straight run (doubling back included). */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out.at(-2);
    if (before && last && (before.x === last.x) === (last.x === p.x) && (before.y === last.y) === (last.y === p.y)) out.pop();
    out.push(p);
  }
  return out;
}

/** Which way a wire leaves this end: a port heads away from its part (+1 right, -1 left); a junction any way (0). */
export function exitOf(at: Places, end: Endpoint): number {
  if (isJunction(end)) return 0;
  const component = at.components.get(end.component);
  if (!component) return 0;
  const layout = LAYOUTS[component.kind];
  const offset = layout.inputs[end.port] ?? layout.outputs[end.port];
  return offset?.x === 0 ? -1 : offset?.x === layout.width ? 1 : 0;
}

/**
 * A shaped wire's route: its ends and bends, with corners added where two
 * neighbours are not in line (an end has moved). Ends are left horizontally.
 */
export function orthogonal(a: Point, bends: Point[], b: Point): Point[] {
  const points = [a, ...bends, b];
  const out: Point[] = [a];
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1] as Point, points[i] as Point];
    if (p.x !== q.x && p.y !== q.y) out.push(i === points.length - 1 ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
    out.push(q);
  }
  return simplify(out);
}

/**
 * The route after dragging segment `i` sideways to pass through `to`. A
 * segment touching an end gains a stub (one cell out of a port, along `exits`)
 * so the end stays put. Returns the full route.
 */
export function dragSegment(points: Point[], i: number, to: Point, exits: [number, number]): Point[] {
  const p = points.map((q) => ({ ...q }));
  const [s, e] = [p[i] as Point, p[i + 1] as Point];
  const horizontal = s.y === e.y;
  for (const q of [s, e]) {
    if (horizontal) q.y = to.y;
    else q.x = to.x;
  }
  const last = points.length - 1;
  const route = p.slice(1, -1);
  const a = points[0] as Point;
  const b = points[last] as Point;
  const head = i === 0 ? stub(a, exits[0], s, horizontal) : [a, p[0] as Point];
  const tail = i + 1 === last ? stub(b, exits[1], e, horizontal).reverse() : [p[last] as Point, b];
  return simplify([...head, ...route, ...tail]);
}

/** From fixed end `end` to the moved segment end `moved`: out along the exit, then across. */
function stub(end: Point, exit: number, moved: Point, horizontal: boolean): Point[] {
  const out = { x: end.x + exit, y: end.y };
  return [end, out, horizontal ? { x: out.x, y: moved.y } : { x: moved.x, y: out.y }];
}

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
  if (aj && bj) return simplify([a, { x: b.x, y: a.y }, b]);
  const [port, junction] = aj ? [b, a] : [a, b];
  const route = [port, { x: junction.x, y: port.y }, junction];
  return simplify(aj ? route.reverse() : route);
}

export type Hit =
  | { type: "port"; ref: PortRef }
  | { type: "junction"; id: string }
  | { type: "component"; id: string }
  // `segment`: index of the route segment under the pointer.
  | { type: "wire"; id: string; segment: number }
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

/** Ports win over junctions, junctions over bodies, bodies over wires; later items are on top. `routes` by wire ID. */
export function hitTest(circuit: Circuit, p: Point, pick: number, routes: Map<string, Point[]>): Hit {
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

  for (const wire of [...circuit.wires].reverse()) {
    const points = routes.get(wire.id) ?? [];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (a && b && segmentDistance(p, a, b) <= pick / 2) return { type: "wire", id: wire.id, segment: i - 1 };
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
