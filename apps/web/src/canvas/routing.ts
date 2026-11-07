// Wire routes on the grid (ADR 0011): A* per wire, in document order, around
// part bodies and other nets. Geometry only; connectivity comes from wire ends.
import { endOwner, isJunction, type Circuit } from "../editor/document";
import type { Endpoint } from "../simulation/protocol";
import { DIRS, endAt, exitOf, orthogonal, places, simplify, wirePoints, type Point } from "./geometry";
import { layoutOf, layoutsVersion } from "./layout";

/** Extra cost of a bend. */
const BEND = 3;
/** Cost of crossing another net straight through: allowed, crossings never connect. */
const CROSS = 1;
/** How far beyond the ends' box a route may wander: tried in turn, wider when nothing fits. */
const MARGINS = [8, 24];
/** Largest search box, in grid cells; wires spanning more get the plain half-way route. */
const MAX_CELLS = 40_000;

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

/** Earlier routes, with their nets and bounding boxes, for later routes to keep away from. */
type Laid = { net: string; points: Point[]; minX: number; minY: number; maxX: number; maxY: number }[];

/** A search box: per-cell flags of what a route must avoid, so the search reads typed arrays only. */
class Box {
  readonly w: number;
  readonly h: number;
  /** Part bodies (ports included) and junctions; a route's own ends are let through. */
  readonly blocked: Uint8Array;
  /** Another net runs along the edge leaving this cell to the right (2c) or downwards (2c + 1). */
  readonly edges: Uint8Array;
  /** Another net ends or bends here (1), or passes straight through (2). */
  readonly others: Uint8Array;

  constructor(
    readonly minX: number,
    readonly minY: number,
    maxX: number,
    maxY: number,
  ) {
    this.w = maxX - minX + 1;
    this.h = maxY - minY + 1;
    this.blocked = new Uint8Array(this.w * this.h);
    this.edges = new Uint8Array(this.w * this.h * 2);
    this.others = new Uint8Array(this.w * this.h);
  }

  has(x: number, y: number) {
    return x >= this.minX && y >= this.minY && x < this.minX + this.w && y < this.minY + this.h;
  }

  cell(x: number, y: number) {
    return (y - this.minY) * this.w + (x - this.minX);
  }

  block(circuit: Circuit) {
    const [maxX, maxY] = [this.minX + this.w - 1, this.minY + this.h - 1];
    for (const c of circuit.components) {
      const { width, height } = layoutOf(c);
      for (let x = Math.max(c.position.x, this.minX); x <= Math.min(c.position.x + width, maxX); x++) {
        for (let y = Math.max(c.position.y, this.minY); y <= Math.min(c.position.y + height, maxY); y++) {
          this.blocked[this.cell(x, y)] = 1;
        }
      }
    }
    for (const { position: p } of circuit.junctions) if (this.has(p.x, p.y)) this.blocked[this.cell(p.x, p.y)] = 1;
  }

  /** Marks the cells and edges that routes of nets other than `net` use inside the box. */
  avoid(laid: Laid, net: string) {
    for (const route of laid) {
      if (route.net === net) continue;
      const outside =
        route.maxX < this.minX || route.maxY < this.minY || route.minX >= this.minX + this.w || route.minY >= this.minY + this.h;
      if (outside) continue;
      const { points } = route;
      for (const p of points) if (this.has(p.x, p.y)) this.others[this.cell(p.x, p.y)] = 1;
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1] as Point, points[i] as Point];
        const vertical = a.x === b.x;
        const [lo, hi] = vertical ? [Math.min(a.y, b.y), Math.max(a.y, b.y)] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        // Only the stretch inside the box matters, however long the segment is.
        const from = Math.max(lo, vertical ? this.minY : this.minX);
        const to = Math.min(hi, vertical ? this.minY + this.h - 1 : this.minX + this.w - 1);
        for (let t = from; t <= to; t++) {
          const [x, y] = vertical ? [a.x, t] : [t, a.y];
          if (!this.has(x, y)) continue;
          const c = this.cell(x, y);
          if (t < hi) this.edges[2 * c + (vertical ? 1 : 0)] = 1;
          if (t > lo && t < hi && this.others[c] !== 1) this.others[c] = 2;
        }
      }
    }
  }
}

/** Binary min-heap of (priority, state) in typed arrays: no allocation per entry. */
class Heap {
  private priority = new Float64Array(1024);
  private state = new Int32Array(1024);
  size = 0;
  /** Priority and state of the entry `pop` last removed. */
  top = 0;
  topState = 0;

  clear() {
    this.size = 0;
  }

  push(priority: number, state: number) {
    if (this.size === this.priority.length) {
      const [p, s] = [new Float64Array(this.size * 2), new Int32Array(this.size * 2)];
      p.set(this.priority);
      s.set(this.state);
      [this.priority, this.state] = [p, s];
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.priority[parent] as number) <= priority) break;
      this.priority[i] = this.priority[parent] as number;
      this.state[i] = this.state[parent] as number;
      i = parent;
    }
    this.priority[i] = priority;
    this.state[i] = state;
  }

  pop() {
    this.top = this.priority[0] as number;
    this.topState = this.state[0] as number;
    const n = --this.size;
    const [p, s] = [this.priority[n] as number, this.state[n] as number];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && (this.priority[r] as number) < (this.priority[l] as number) ? r : l;
      if ((this.priority[m] as number) >= p) break;
      this.priority[i] = this.priority[m] as number;
      this.state[i] = this.state[m] as number;
      i = m;
    }
    this.priority[i] = p;
    this.state[i] = s;
  }
}

// Scratch space shared by every search, grown as needed: a cell's cost counts only while
// its stamp is the current search's, so nothing is refilled between searches.
let costs = new Float64Array(0);
let froms = new Int32Array(0);
let stamps = new Uint32Array(0);
let stamp = 0;
const heap = new Heap();

function scratch(states: number) {
  if (costs.length < states) {
    costs = new Float64Array(states);
    froms = new Int32Array(states);
    stamps = new Uint32Array(states);
    stamp = 0;
  }
  if (++stamp === 2 ** 32) {
    stamps.fill(0);
    stamp = 1;
  }
}

/**
 * Cheapest orthogonal route from `a` to `b` within `margin` cells of their
 * box. `exitA`/`exitB` (indexes into `DIRS`, -1 for any) force the first move
 * out of `a` and the last move into `b` (opposite `b`'s exit). A route never
 * runs along another net's wire, nor bends or ends on one: it may only cross
 * one straight through. Null when nothing fits, or the box is too large.
 */
export function search(
  a: Point,
  b: Point,
  exitA: number,
  exitB: number,
  circuit: Circuit,
  laid: Laid,
  net: string,
  margin: number,
): Point[] | null {
  if (a.x === b.x && a.y === b.y) return [a, b];
  const minX = Math.min(a.x, b.x) - margin;
  const minY = Math.min(a.y, b.y) - margin;
  const [maxX, maxY] = [Math.max(a.x, b.x) + margin, Math.max(a.y, b.y) + margin];
  // Checked before anything is allocated: the arrays are sized by the box.
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS) return null;
  const box = new Box(minX, minY, maxX, maxY);
  box.block(circuit);
  box.avoid(laid, net);
  // A port whose first cell outside is taken can never be reached: fail now rather than search the whole box.
  for (const [end, exit] of [
    [a, exitA],
    [b, exitB],
  ] as const) {
    const d = DIRS[exit];
    if (!d) continue;
    const [x, y] = [end.x + d.x, end.y + d.y];
    const c = box.cell(x, y);
    if (!box.has(x, y) || box.blocked[c] || box.others[c] === 1) return null;
    if (box.edges[2 * box.cell(Math.min(x, end.x), Math.min(y, end.y)) + (d.y !== 0 ? 1 : 0)]) return null;
  }
  const { w } = box;
  // State: cell * 5 + direction of the move into it (4: none yet).
  scratch(box.w * box.h * 5);
  const cost = (state: number) => (stamps[state] === stamp ? (costs[state] as number) : Infinity);
  const estimate = (x: number, y: number) => Math.abs(x - b.x) + Math.abs(y - b.y);
  // Equal totals are broken towards the goal, so the search does not fan out over every equal-cost cell.
  const priority = (total: number, x: number, y: number) => (total + estimate(x, y)) * 4096 + estimate(x, y);
  const start = box.cell(a.x, a.y) * 5 + 4;
  costs[start] = 0;
  froms[start] = -1;
  stamps[start] = stamp;
  heap.clear();
  heap.push(priority(0, a.x, a.y), start);
  // DIRS pairs opposites (0/1, 2/3), so the move into `b` is its exit flipped.
  const arrive = exitB >= 0 ? exitB ^ 1 : -1;
  while (heap.size > 0) {
    heap.pop();
    const state = heap.topState;
    const c = Math.floor(state / 5);
    const d = state % 5;
    const px = (c % w) + minX;
    const py = Math.floor(c / w) + minY;
    const here = cost(state);
    if (heap.top > priority(here, px, py)) continue; // a cheaper way here was found after this was queued
    if (px === b.x && py === b.y) return simplify(path(state));
    for (let nd = 0; nd < 4; nd++) {
      if (d === 4 && exitA >= 0 && nd !== exitA) continue;
      if (d !== 4 && (d ^ 1) === nd) continue; // no U-turns
      const turning = d !== 4 && d !== nd;
      // Bending where another net passes would look like a T: joined.
      if (turning && box.others[c] === 2) continue;
      const dir = DIRS[nd] as Point;
      const qx = px + dir.x;
      const qy = py + dir.y;
      if (!box.has(qx, qy)) continue;
      const isGoal = qx === b.x && qy === b.y;
      if (isGoal && arrive >= 0 && nd !== arrive) continue;
      const qc = box.cell(qx, qy);
      if (!isGoal && box.blocked[qc]) continue;
      // Running along another net, or onto a point where one ends or bends, would look like a connection.
      if (box.edges[2 * box.cell(Math.min(px, qx), Math.min(py, qy)) + (dir.y !== 0 ? 1 : 0)]) continue;
      if (box.others[qc] === 1) continue;
      const step = 1 + (turning ? BEND : 0) + (box.others[qc] === 2 ? CROSS : 0);
      const next = qc * 5 + nd;
      const total = here + step;
      if (total < cost(next)) {
        costs[next] = total;
        froms[next] = state;
        stamps[next] = stamp;
        heap.push(priority(total, qx, qy), next);
      }
    }
  }
  return null;

  function path(state: number): Point[] {
    const points: Point[] = [];
    for (let s = state; s !== -1; s = froms[s] as number) {
      const c = Math.floor(s / 5);
      points.push({ x: (c % w) + minX, y: Math.floor(c / w) + minY });
    }
    return points.reverse();
  }
}

const cache = new WeakMap<Circuit, Map<string, Point[]>>();
const kept = new WeakMap<Circuit, Map<string, Point[]>>();

/** The circuit `routes` last worked out, so the next one only routes what changed. */
let last: { circuit: Circuit; routes: Map<string, Point[]>; layouts: number } | null = null;

/** Forgets the last routed circuit, so the next one is routed afresh (opening a file). */
export function forgetRoutes() {
  last = null;
}

/**
 * Every wire's route, by wire ID. Wires an edit leaves alone keep their routes
 * (see `unaffected`); the rest are routed, shaped wires first, then automatic
 * ones in document order. Cached per circuit object; the store replaces the
 * object on every change.
 */
export function routes(circuit: Circuit): Map<string, Point[]> {
  let result = cache.get(circuit);
  if (!result) {
    // Instances' ports move when their definitions' pins change: nothing on an instance is kept then.
    const sameLayouts = last?.layouts === layoutsVersion();
    result = route(circuit, last ? unaffected(last.circuit, last.routes, circuit, sameLayouts) : new Map());
    cache.set(circuit, result);
  }
  // Even a cached circuit becomes the one the next edit is compared with (undo returns to one).
  last = { circuit, routes: result, layouts: layoutsVersion() };
  return result;
}

/**
 * Routes from `before` (worked out for `prev`) still right for `next`: the
 * wire is unchanged, its parts and junctions have not moved, its net has the
 * same wires, and no part or junction that moved or appeared lies on it. Kept
 * routes may be longer than a fresh route would be (something that was in the
 * way may be gone); opening a file routes everything afresh.
 */
function unaffected(
  prev: Circuit,
  before: Map<string, Point[]>,
  next: Circuit,
  sameLayouts: boolean,
): Map<string, Point[]> {
  const parts = new Map(prev.components.map((c) => [c.id, c]));
  const dots = new Map(prev.junctions.map((j) => [j.id, j.position]));
  const wires = new Map(prev.wires.map((w) => [w.id, w]));
  const stays = (id: string) => {
    const [old, now] = [parts.get(id), next.components.find((c) => c.id === id)];
    if (old || now) {
      return (
        !!old &&
        !!now &&
        old.kind === now.kind &&
        old.definition === now.definition &&
        (old.kind !== "custom" || sameLayouts) &&
        old.rotation === now.rotation &&
        samePoint(old.position, now.position)
      );
    }
    const [was, is] = [dots.get(id), next.junctions.find((j) => j.id === id)?.position];
    return !!was && !!is && samePoint(was, is);
  };
  // Boxes of parts and junctions that moved, turned or appeared: a kept route must not run into one.
  const obstacles = [
    ...next.components.filter((c) => !stays(c.id)).map((c) => ({ ...c.position, ...size(c) })),
    ...next.junctions.filter((j) => !stays(j.id)).map((j) => ({ ...j.position, width: 0, height: 0 })),
  ];
  // A shaped wire whose route changed is laid as given, avoiding nothing, so kept routes must not touch it either.
  const at = places(next);
  for (const wire of next.wires) {
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (!wire.bends || !a || !b) continue;
    const points = orthogonal(a, wire.bends, b, [exitOf(at, wire.from), exitOf(at, wire.to)]);
    if (JSON.stringify(points) === JSON.stringify(before.get(wire.id))) continue;
    for (let i = 1; i < points.length; i++) {
      const [p, q] = [points[i - 1] as Point, points[i] as Point];
      obstacles.push({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) });
    }
  }
  /** Each wire's net, named by the sorted IDs of all its wires: equal names mean the net kept the same wires. */
  const members = (circuit: Circuit) => {
    const netOf = nets(circuit);
    const byNet = new Map<string, string[]>();
    for (const [wire, net] of netOf) {
      const list = byNet.get(net);
      if (list) list.push(wire);
      else byNet.set(net, [wire]);
    }
    const names = new Map([...byNet].map(([net, list]) => [net, list.sort().join()]));
    return new Map([...netOf].map(([wire, net]) => [wire, names.get(net)]));
  };
  const [netBefore, netNow] = [members(prev), members(next)];
  const kept = new Map<string, Point[]>();
  for (const wire of next.wires) {
    const [old, points] = [wires.get(wire.id), before.get(wire.id)];
    if (!old || !points) continue;
    if (JSON.stringify([old.from, old.to, old.bends]) !== JSON.stringify([wire.from, wire.to, wire.bends])) continue;
    if (!stays(endOwner(wire.from)) || !stays(endOwner(wire.to))) continue;
    if (netBefore.get(wire.id) !== netNow.get(wire.id)) continue;
    if (obstacles.some((box) => crosses(points, box))) continue;
    kept.set(wire.id, points);
  }
  return kept;
}

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const size = (c: Circuit["components"][number]) => {
  const { width, height } = layoutOf(c);
  return { width, height };
};

/** True when any segment of a route touches the box (grid units, edges included). */
function crosses(points: Point[], box: { x: number; y: number; width: number; height: number }) {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point];
    const inX = Math.max(a.x, b.x) >= box.x && Math.min(a.x, b.x) <= box.x + box.width;
    const inY = Math.max(a.y, b.y) >= box.y && Math.min(a.y, b.y) <= box.y + box.height;
    if (inX && inY) return true;
  }
  return false;
}

/**
 * Routes while a drag is under way: the wires in `frozen` keep the routes they
 * had when it started (laid first, as given), and only the others are routed
 * again. The full `routes` runs once the drag ends.
 */
export function routesKeeping(circuit: Circuit, frozen: Map<string, Point[]>): Map<string, Point[]> {
  let result = kept.get(circuit);
  if (!result) kept.set(circuit, (result = route(circuit, frozen)));
  return result;
}

function route(circuit: Circuit, frozen: Map<string, Point[]>): Map<string, Point[]> {
  const at = places(circuit);
  const netOf = nets(circuit);
  const laid: Laid = [];
  const result = new Map<string, Point[]>();
  const lay = (id: string, points: Point[]) => {
    result.set(id, points);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    laid.push({ net: netOf.get(id) as string, points, minX, minY, maxX, maxY });
  };
  for (const wire of circuit.wires) {
    const points = frozen.get(wire.id);
    if (points) lay(wire.id, points);
  }
  for (const wire of circuit.wires) {
    if (!wire.bends || frozen.has(wire.id)) continue;
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (a && b) lay(wire.id, orthogonal(a, wire.bends, b, [exitOf(at, wire.from), exitOf(at, wire.to)]));
  }
  for (const wire of circuit.wires) {
    if (wire.bends || frozen.has(wire.id)) continue;
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (!a || !b) continue;
    const [exitA, exitB] = [exitOf(at, wire.from), exitOf(at, wire.to)];
    const net = netOf.get(wire.id) as string;
    let points: Point[] | null = null;
    for (const margin of MARGINS) {
      points = search(a, b, exitA, exitB, circuit, laid, net, margin);
      if (points) break;
    }
    // shortcut: when nothing fits even the wider box, the plain route may touch another net; widen further if that shows up.
    points ??= wirePoints(at, wire);
    if (points) lay(wire.id, points);
  }
  return result;
}
