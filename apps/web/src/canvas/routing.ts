// Wire routes on the grid (ADR 0011): A* per wire, in document order, around
// part bodies and other nets. Geometry only; connectivity comes from wire ends.
import { isJunction, type Circuit } from "../editor/document";
import type { Endpoint } from "../simulation/protocol";
import { endAt, exitOf, orthogonal, places, simplify, wirePoints, type Point } from "./geometry";
import { LAYOUTS } from "./layout";

/** Extra cost of a bend, and of running along, turning on or ending on another net. */
const BEND = 3;
const CLASH = 25;
/** Cost of crossing another net straight through: allowed, crossings never connect. */
const CROSS = 1;
/** How far beyond the ends' box a route may wander. */
const MARGIN = 8;

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const key = (p: Point) => `${p.x},${p.y}`;
const endKey = (e: Endpoint) => (isJunction(e) ? `j:${e.junction}` : `p:${e.component}:${e.port}`);

/** Net of each wire: wires sharing a port or junction belong together. */
function nets(circuit: Circuit): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(k, root);
    return root;
  };
  for (const w of circuit.wires) parent.set(find(endKey(w.from)), find(endKey(w.to)));
  return new Map(circuit.wires.map((w) => [w.id, find(endKey(w.from))]));
}

/** What earlier routes occupy, by net. */
class Taken {
  /** Unit edges ("x,y>x,y", lower end first) by net. */
  readonly edges = new Map<string, Set<string>>();
  /** Points a route passes straight through, by net. */
  readonly through = new Map<string, Set<string>>();
  /** Points where a route ends or bends, by net. */
  readonly stops = new Map<string, Set<string>>();

  add(net: string, points: Point[]) {
    const put = (map: Map<string, Set<string>>, k: string) => map.set(k, (map.get(k) ?? new Set()).add(net));
    points.forEach((p) => put(this.stops, key(p)));
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as Point, points[i] as Point];
      const steps = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      for (let s = 0; s < steps; s++) {
        const p = { x: a.x + dx * s, y: a.y + dy * s };
        const q = { x: p.x + dx, y: p.y + dy };
        put(this.edges, edgeKey(p, q));
        if (s > 0) put(this.through, key(p));
      }
    }
  }

  /** True when a net other than `net` is in `map` at `k`. */
  other(map: Map<string, Set<string>>, k: string, net: string) {
    const at = map.get(k);
    return !!at && (at.size > 1 || !at.has(net));
  }
}

const edgeKey = (p: Point, q: Point) => (p.x < q.x || p.y < q.y ? `${key(p)}>${key(q)}` : `${key(q)}>${key(p)}`);

/** Grid points that no route may use: part bodies (ports included) and junctions; a route's own ends are let through. */
function blockedPoints(circuit: Circuit): Set<string> {
  const blocked = new Set<string>();
  for (const c of circuit.components) {
    const { width, height } = LAYOUTS[c.kind];
    for (let x = c.position.x; x <= c.position.x + width; x++) {
      for (let y = c.position.y; y <= c.position.y + height; y++) blocked.add(`${x},${y}`);
    }
  }
  circuit.junctions.forEach((j) => blocked.add(key(j.position)));
  return blocked;
}

/** Binary min-heap of [cost, state]. */
class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, number]) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if ((a[parent] as [number, number])[0] <= item[0]) break;
      [a[i], a[parent]] = [a[parent] as [number, number], item];
      i = parent;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0] as [number, number];
    const last = a.pop() as [number, number];
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < a.length && (a[l] as [number, number])[0] < (a[m] as [number, number])[0]) m = l;
        if (r < a.length && (a[r] as [number, number])[0] < (a[m] as [number, number])[0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as [number, number], a[i] as [number, number]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Cheapest orthogonal route from `a` to `b`. `exitA`/`exitB` force the first
 * move out of `a` and the last move into `b` to be horizontal and away from
 * the part (+1 right, -1 left, 0 any). Null when nothing is found in bounds.
 */
export function search(
  a: Point,
  b: Point,
  exitA: number,
  exitB: number,
  blocked: Set<string>,
  taken: Taken,
  net: string,
): Point[] | null {
  if (a.x === b.x && a.y === b.y) return [a, b];
  const minX = Math.min(a.x, b.x) - MARGIN;
  const minY = Math.min(a.y, b.y) - MARGIN;
  const w = Math.max(a.x, b.x) + MARGIN - minX + 1;
  const h = Math.max(a.y, b.y) + MARGIN - minY + 1;
  // State: cell * 5 + direction of the move into it (4: none yet).
  const cost = new Float64Array(w * h * 5).fill(Infinity);
  const from = new Int32Array(w * h * 5).fill(-1);
  const cell = (p: Point) => (p.y - minY) * w + (p.x - minX);
  const at = (c: number): Point => ({ x: (c % w) + minX, y: Math.floor(c / w) + minY });
  const start = cell(a) * 5 + 4;
  cost[start] = 0;
  const heap = new Heap();
  heap.push([Math.abs(a.x - b.x) + Math.abs(a.y - b.y), start]);
  // Into `b` the last move must head away from its part's outside, i.e. opposite its exit.
  const arrive = exitB === 0 ? -1 : exitB > 0 ? 1 : 0;
  while (heap.size > 0) {
    const [, state] = heap.pop();
    const c = Math.floor(state / 5);
    const d = state % 5;
    const p = at(c);
    if (p.x === b.x && p.y === b.y) return simplify(path(state));
    const here = cost[state] as number;
    for (let nd = 0; nd < 4; nd++) {
      if (d === 4 && exitA !== 0 && nd !== (exitA > 0 ? 0 : 1)) continue;
      if (d !== 4 && (d ^ 1) === nd) continue; // no U-turns
      const dir = DIRS[nd] as Point;
      const q = { x: p.x + dir.x, y: p.y + dir.y };
      if (q.x < minX || q.y < minY || q.x >= minX + w || q.y >= minY + h) continue;
      const isGoal = q.x === b.x && q.y === b.y;
      if (isGoal && exitB !== 0 && nd !== arrive) continue;
      if (!isGoal && blocked.has(key(q))) continue;
      let step = 1;
      const turning = d !== 4 && d !== nd;
      if (turning) step += BEND + (taken.other(taken.through, key(p), net) ? CLASH : 0);
      if (taken.other(taken.edges, edgeKey(p, q), net)) step += CLASH;
      if (taken.other(taken.stops, key(q), net)) step += CLASH;
      else if (taken.other(taken.through, key(q), net)) step += CROSS;
      const next = cell(q) * 5 + nd;
      if (here + step < (cost[next] as number)) {
        cost[next] = here + step;
        from[next] = state;
        heap.push([here + step + Math.abs(q.x - b.x) + Math.abs(q.y - b.y), next]);
      }
    }
  }
  return null;

  function path(state: number): Point[] {
    const points: Point[] = [];
    for (let s = state; s !== -1; s = from[s] as number) points.push(at(Math.floor(s / 5)));
    return points.reverse();
  }
}

const cache = new WeakMap<Circuit, Map<string, Point[]>>();

/**
 * Every wire's route, by wire ID. Shaped wires (with `bends`) are laid first,
 * then automatic ones in document order. Cached per circuit object; the store
 * replaces the object on every change.
 */
export function routes(circuit: Circuit): Map<string, Point[]> {
  const known = cache.get(circuit);
  if (known) return known;
  // shortcut: every change re-routes every automatic wire; route incrementally if large circuits get slow.
  const at = places(circuit);
  const netOf = nets(circuit);
  const blocked = blockedPoints(circuit);
  const taken = new Taken();
  const result = new Map<string, Point[]>();
  const shaped = circuit.wires.filter((w) => w.bends);
  for (const wire of shaped) {
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (!a || !b) continue;
    const points = orthogonal(a, wire.bends ?? [], b);
    result.set(wire.id, points);
    taken.add(netOf.get(wire.id) as string, points);
  }
  for (const wire of circuit.wires) {
    if (wire.bends) continue;
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (!a || !b) continue;
    const net = netOf.get(wire.id) as string;
    const points = search(a, b, exitOf(at, wire.from), exitOf(at, wire.to), blocked, taken, net) ?? wirePoints(at, wire);
    if (!points) continue;
    result.set(wire.id, points);
    taken.add(net, points);
  }
  cache.set(circuit, result);
  return result;
}
