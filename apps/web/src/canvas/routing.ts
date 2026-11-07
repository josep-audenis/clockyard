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
/** Largest search box, in grid cells; wires spanning more get the plain half-way route. */
const MAX_CELLS = 40_000;

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

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

/** Earlier routes, with their nets, for later routes to keep away from. */
type Laid = { net: string; points: Point[] }[];

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
      const { width, height } = LAYOUTS[c.kind];
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

/** Binary min-heap of [priority, state, cost]. */
class Heap {
  private items: [number, number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, number, number]) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if ((a[parent] as [number, number, number])[0] <= item[0]) break;
      [a[i], a[parent]] = [a[parent] as [number, number, number], item];
      i = parent;
    }
  }
  pop(): [number, number, number] {
    const a = this.items;
    const top = a[0] as [number, number, number];
    const last = a.pop() as [number, number, number];
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < a.length && (a[l] as [number, number, number])[0] < (a[m] as [number, number, number])[0]) m = l;
        if (r < a.length && (a[r] as [number, number, number])[0] < (a[m] as [number, number, number])[0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as [number, number, number], a[i] as [number, number, number]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Cheapest orthogonal route from `a` to `b`. `exitA`/`exitB` force the first
 * move out of `a` and the last move into `b` to be horizontal and away from
 * the part (+1 right, -1 left, 0 any). Null when nothing is found in bounds,
 * or when the bounds are too large to search.
 */
export function search(
  a: Point,
  b: Point,
  exitA: number,
  exitB: number,
  circuit: Circuit,
  laid: Laid,
  net: string,
): Point[] | null {
  if (a.x === b.x && a.y === b.y) return [a, b];
  const minX = Math.min(a.x, b.x) - MARGIN;
  const minY = Math.min(a.y, b.y) - MARGIN;
  const [maxX, maxY] = [Math.max(a.x, b.x) + MARGIN, Math.max(a.y, b.y) + MARGIN];
  // Checked before anything is allocated: the arrays are sized by the box.
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS) return null;
  const box = new Box(minX, minY, maxX, maxY);
  box.block(circuit);
  box.avoid(laid, net);
  const { w, h } = box;
  // State: cell * 5 + direction of the move into it (4: none yet).
  const cost = new Float64Array(w * h * 5).fill(Infinity);
  const from = new Int32Array(w * h * 5).fill(-1);
  const estimate = (x: number, y: number) => Math.abs(x - b.x) + Math.abs(y - b.y);
  // Equal totals are broken towards the goal, so the search does not fan out over every equal-cost cell.
  const priority = (total: number, x: number, y: number) => (total + estimate(x, y)) * 4096 + estimate(x, y);
  const start = box.cell(a.x, a.y) * 5 + 4;
  cost[start] = 0;
  const heap = new Heap();
  heap.push([priority(0, a.x, a.y), start, 0]);
  // Into `b` the last move must head away from its part's outside, i.e. opposite its exit.
  const arrive = exitB > 0 ? 1 : 0;
  while (heap.size > 0) {
    const [, state, here] = heap.pop();
    if (here > (cost[state] as number)) continue; // a cheaper way here was found after this was queued
    const c = Math.floor(state / 5);
    const d = state % 5;
    const px = (c % w) + minX;
    const py = Math.floor(c / w) + minY;
    if (px === b.x && py === b.y) return simplify(path(state));
    for (let nd = 0; nd < 4; nd++) {
      if (d === 4 && exitA !== 0 && nd !== (exitA > 0 ? 0 : 1)) continue;
      if (d !== 4 && (d ^ 1) === nd) continue; // no U-turns
      const dir = DIRS[nd] as Point;
      const qx = px + dir.x;
      const qy = py + dir.y;
      if (!box.has(qx, qy)) continue;
      const isGoal = qx === b.x && qy === b.y;
      if (isGoal && exitB !== 0 && nd !== arrive) continue;
      const qc = box.cell(qx, qy);
      if (!isGoal && box.blocked[qc]) continue;
      let step = 1;
      if (d !== 4 && d !== nd) step += BEND + (box.others[c] === 2 ? CLASH : 0);
      if (box.edges[2 * box.cell(Math.min(px, qx), Math.min(py, qy)) + (dir.y !== 0 ? 1 : 0)]) step += CLASH;
      if (box.others[qc] === 1) step += CLASH;
      else if (box.others[qc] === 2) step += CROSS;
      const next = qc * 5 + nd;
      const total = here + step;
      if (total < (cost[next] as number)) {
        cost[next] = total;
        from[next] = state;
        heap.push([priority(total, qx, qy), next, total]);
      }
    }
  }
  return null;

  function path(state: number): Point[] {
    const points: Point[] = [];
    for (let s = state; s !== -1; s = from[s] as number) {
      const c = Math.floor(s / 5);
      points.push({ x: (c % w) + minX, y: Math.floor(c / w) + minY });
    }
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
  const laid: Laid = [];
  const result = new Map<string, Point[]>();
  for (const wire of circuit.wires) {
    if (!wire.bends) continue;
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (!a || !b) continue;
    const points = orthogonal(a, wire.bends, b);
    result.set(wire.id, points);
    laid.push({ net: netOf.get(wire.id) as string, points });
  }
  for (const wire of circuit.wires) {
    if (wire.bends) continue;
    const [a, b] = [endAt(at, wire.from), endAt(at, wire.to)];
    if (!a || !b) continue;
    const net = netOf.get(wire.id) as string;
    const points = search(a, b, exitOf(at, wire.from), exitOf(at, wire.to), circuit, laid, net) ?? wirePoints(at, wire);
    if (!points) continue;
    result.set(wire.id, points);
    laid.push({ net, points });
  }
  cache.set(circuit, result);
  return result;
}
