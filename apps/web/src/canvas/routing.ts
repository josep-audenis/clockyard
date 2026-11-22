// Wire routes on the grid (ADR 0011): A* per wire, in document order, around
// part bodies and other nets. Geometry only; connectivity comes from wire ends.
import { endOwner, isJunction, type Circuit } from "../editor/document";
import type { Endpoint } from "../simulation/protocol";
import { DIRS, endAt, exitOf, labelTags, orthogonal, places, simplify, wirePoints, type Point } from "./geometry";
import { layoutOf, layoutsVersion } from "./layout";

/** Extra cost of a bend. */
const BEND = 3;
/** Cost of crossing another net straight through: allowed, crossings never connect. */
const CROSS = 1;
/** How far beyond the ends' box a route may wander: tried in turn, wider when nothing fits. */
const MARGINS = [8, 24];
/** Largest search box, in grid cells; wires spanning more get the plain half-way route. */
const MAX_CELLS = 40_000;
/**
 * Wires from which a sheet's searches also count the bends still needed (`bendsLeft`). Below this, routes stay exactly
 * as they were: the count would change how ties fall, and with them where later wires fit (on the reference CPU, 37
 * wires left without a route instead of 34; ADR 0030). A fan-out just under the limit gives up its speed.
 */
const LARGE_SHEET = 2_000;

const endKey = (e: Endpoint) => (isJunction(e) ? `j:${e.junction}` : `p:${e.component}:${e.port}`);

/** Net of each wire: wires sharing a port or junction belong together. */
function nets(circuit: Circuit): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    // Everything on the way now points at the root: a chain of junctions tapped one after another made this quadratic.
    for (let at = k; at !== root; ) {
      const next = parent.get(at) as string;
      parent.set(at, root);
      at = next;
    }
    parent.set(k, root);
    return root;
  };
  for (const w of circuit.wires) parent.set(find(endKey(w.from)), find(endKey(w.to)));
  return new Map(circuit.wires.map((w) => [w.id, find(endKey(w.from))]));
}

/** Cells per side of a tile of the index below. */
const TILE = 16;
/** A route with a segment across more tiles than this is kept in a plain list: filing it would cost as much as it is long. */
const LONG = 64;
/**
 * A tile's key: unique while tile coordinates stay within ±2^19 (coordinates are at most ±10^6, ADR 0011); a collision
 * would only add visits, never miss an item.
 */
const tileKey = (tx: number, ty: number) => tx * 0x100000 + ty;

/**
 * Items by the tiles of the grid they touch, so a search visits only what lies near its box instead of every part and
 * every route laid so far, which made routing a whole sheet quadratic (ADR 0030).
 */
class Tiles<T> {
  private readonly map = new Map<number, T[]>();

  constructor(readonly size: number) {}

  /** Files `item` under every tile the cells (x0, y0) to (x1, y1) touch. */
  add(item: T, x0: number, y0: number, x1: number, y1: number) {
    const size = this.size;
    for (let tx = Math.floor(x0 / size); tx <= Math.floor(x1 / size); tx++) {
      for (let ty = Math.floor(y0 / size); ty <= Math.floor(y1 / size); ty++) {
        const key = tileKey(tx, ty);
        const list = this.map.get(key);
        if (list) list.push(item);
        else this.map.set(key, [item]);
      }
    }
  }

  /** Calls `f` for every item filed under a tile the cells (x0, y0) to (x1, y1) touch; an item may come more than once. */
  each(x0: number, y0: number, x1: number, y1: number, f: (item: T) => void) {
    const size = this.size;
    for (let tx = Math.floor(x0 / size); tx <= Math.floor(x1 / size); tx++) {
      for (let ty = Math.floor(y0 / size); ty <= Math.floor(y1 / size); ty++) {
        for (const item of this.map.get(tileKey(tx, ty)) ?? []) f(item);
      }
    }
  }
}

/**
 * A laid route and its bounding box: `seen` is the last search that marked it, so a route met in many tiles counts
 * once.
 */
type LaidRoute = { net: string; points: Point[]; seen: number; minX: number; minY: number; maxX: number; maxY: number };

/**
 * Laid routes by tile and, within a tile, by net: a search has no use for its own net's routes, and a net fanning out
 * across a sheet can have thousands in one tile.
 */
class RouteTiles {
  private readonly map = new Map<number, Map<string, LaidRoute[]>>();

  constructor(readonly size: number) {}

  /** Files `route` under every tile the cells (x0, y0) to (x1, y1) touch. */
  add(route: LaidRoute, x0: number, y0: number, x1: number, y1: number) {
    const size = this.size;
    for (let tx = Math.floor(x0 / size); tx <= Math.floor(x1 / size); tx++) {
      for (let ty = Math.floor(y0 / size); ty <= Math.floor(y1 / size); ty++) {
        const key = tileKey(tx, ty);
        let nets = this.map.get(key);
        if (!nets) this.map.set(key, (nets = new Map()));
        const list = nets.get(route.net);
        if (!list) nets.set(route.net, [route]);
        else if (list[list.length - 1] !== route) list.push(route);
      }
    }
  }

  /** Calls `f` for every route of a net other than `net` filed where the cells touch; a route may come more than once. */
  eachOther(net: string, x0: number, y0: number, x1: number, y1: number, f: (route: LaidRoute) => void) {
    const size = this.size;
    for (let tx = Math.floor(x0 / size); tx <= Math.floor(x1 / size); tx++) {
      for (let ty = Math.floor(y0 / size); ty <= Math.floor(y1 / size); ty++) {
        const nets = this.map.get(tileKey(tx, ty));
        if (!nets) continue;
        for (const [other, list] of nets) {
          if (other === net) continue;
          for (const route of list) f(route);
        }
      }
    }
  }
}

/** What routes keep away from: part bodies, junctions and label tags, the routes laid so far, and those too long to file. */
type Obstacles = { bodies: Tiles<{ x0: number; y0: number; x1: number; y1: number }>; routes: RouteTiles; long: LaidRoute[] };

/** Parts, junctions and label tags of `circuit`, indexed by tiles of `size` cells; routes are added as they are laid (`lay`). */
function obstaclesOf(circuit: Circuit, size: number): Obstacles {
  const bodies = new Tiles<{ x0: number; y0: number; x1: number; y1: number }>(size);
  for (const c of circuit.components) {
    const { width, height } = layoutOf(c);
    const body = { x0: c.position.x, y0: c.position.y, x1: c.position.x + width, y1: c.position.y + height };
    bodies.add(body, body.x0, body.y0, body.x1, body.y1);
  }
  for (const { position: p } of circuit.junctions) bodies.add({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, p.x, p.y, p.x, p.y);
  // ADR 0039: label tags too, for every net, so no wire hides a name.
  for (const { box } of labelTags(circuit).values()) if (box) bodies.add(box, box.x0, box.y0, box.x1, box.y1);
  return { bodies, routes: new RouteTiles(size), long: [] };
}

/**
 * Files a laid route under the tiles its segments run through (not its whole bounding box); one with a segment across
 * more than `LONG` tiles goes in the plain list instead, so a far-flung route costs what it did before the index
 * (ADR 0011: one wire never costs more than two bounded searches).
 */
function file(obstacles: Obstacles, net: string, points: Point[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const route = { net, points, seen: 0, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const { routes } = obstacles;
  const span = (a: number, b: number) => Math.abs(Math.floor(a / routes.size) - Math.floor(b / routes.size));
  if (points.some((p, i) => i > 0 && span(p.x, (points[i - 1] as Point).x) + span(p.y, (points[i - 1] as Point).y) > LONG)) {
    obstacles.long.push(route);
    return;
  }
  if (points.length === 1) {
    const p = points[0] as Point;
    routes.add(route, p.x, p.y, p.x, p.y);
  }
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point];
    routes.add(route, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  }
}

/** Numbers searches, for `LaidRoute.seen`. */
let searches = 0;

/** A search box: per-cell flags of what a route must avoid, so the search reads typed arrays only. */
class Box {
  readonly w: number;
  readonly h: number;
  /** Part bodies (ports included), junctions and label tags; a route's own ends are let through. */
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

  block(bodies: Obstacles["bodies"]) {
    const [maxX, maxY] = [this.minX + this.w - 1, this.minY + this.h - 1];
    bodies.each(this.minX, this.minY, maxX, maxY, (b) => {
      for (let x = Math.max(b.x0, this.minX); x <= Math.min(b.x1, maxX); x++) {
        for (let y = Math.max(b.y0, this.minY); y <= Math.min(b.y1, maxY); y++) {
          this.blocked[this.cell(x, y)] = 1;
        }
      }
    });
  }

  /** Marks the cells and edges that routes of nets other than `net` use inside the box. */
  avoid(obstacles: Obstacles, net: string) {
    const search = ++searches;
    const [maxX, maxY] = [this.minX + this.w - 1, this.minY + this.h - 1];
    for (const route of obstacles.long) {
      if (route.maxX >= this.minX && route.maxY >= this.minY && route.minX <= maxX && route.minY <= maxY) this.mark(route, net, search);
    }
    obstacles.routes.eachOther(net, this.minX, this.minY, maxX, maxY, (route) => this.mark(route, net, search));
  }

  private mark(route: LaidRoute, net: string, search: number) {
    if (route.net === net || route.seen === search) return;
    route.seen = search;
    const { points } = route;
    const { minX, minY, w, edges, others } = this;
    const [maxX, maxY] = [minX + w - 1, minY + this.h - 1];
    for (const p of points) if (this.has(p.x, p.y)) others[this.cell(p.x, p.y)] = 1;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as Point, points[i] as Point];
      const vertical = a.x === b.x;
      // A segment beside the box has no stretch inside it, however much of the box it runs along.
      if (vertical ? a.x < minX || a.x > maxX : a.y < minY || a.y > maxY) continue;
      const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      // Only the stretch inside the box matters, however long the segment is.
      const from = Math.max(lo, vertical ? minY : minX);
      const to = Math.min(hi, vertical ? maxY : maxX);
      const along = vertical ? w : 1;
      let c = vertical ? this.cell(a.x, from) : this.cell(from, a.y);
      for (let t = from; t <= to; t++, c += along) {
        if (t < hi) edges[2 * c + (vertical ? 1 : 0)] = 1;
        if (t > lo && t < hi && others[c] !== 1) others[c] = 2;
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
 * The fewest bends left for a route heading `heading` (an index into `DIRS`, 4: not moving yet) with (dx, dy) still to
 * go, ending with a move in direction `arrive` (-1: any), on an empty grid. Added to the distance it tells the search
 * which cells cannot lie on a cheapest route, and it never says more than a step can pay for, so the cost of the route
 * found does not change (ADR 0030).
 */
export function bendsLeft(heading: number, arrive: number, dx: number, dy: number) {
  const u = DIRS[heading];
  if (!u || (dx === 0 && dy === 0)) return 0;
  const along = dx * u.x + dy * u.y;
  const side = dx * u.y - dy * u.x;
  const w = DIRS[arrive];
  if (!w) return side === 0 ? (along > 0 ? 0 : 2) : along >= 0 ? 1 : 2;
  // Square to the last move, the number of bends is odd; along it, even.
  if (u.x * w.x + u.y * w.y === 0) return along >= 0 && dx * w.x + dy * w.y > 0 ? 1 : 3;
  return heading === arrive && side === 0 && along > 0 ? 0 : 2;
}

/**
 * False when the first cell outside a port is taken: no route can then leave or reach the port, in a box of any size,
 * so this looks at those two cells alone.
 */
function exitFree(end: Point, exit: number, obstacles: Obstacles, net: string) {
  const d = DIRS[exit];
  if (!d) return true;
  const [x, y] = [end.x + d.x, end.y + d.y];
  const [minX, minY] = [Math.min(x, end.x), Math.min(y, end.y)];
  const box = new Box(minX, minY, Math.max(x, end.x), Math.max(y, end.y));
  box.block(obstacles.bodies);
  box.avoid(obstacles, net);
  const c = box.cell(x, y);
  return !box.blocked[c] && box.others[c] !== 1 && !box.edges[2 * box.cell(minX, minY) + (d.y !== 0 ? 1 : 0)];
}

/**
 * Cheapest orthogonal route from `a` to `b` within `margin` cells of their
 * box. `exitA`/`exitB` (indexes into `DIRS`, -1 for any) force the first move
 * out of `a` and the last move into `b` (opposite `b`'s exit). A route never
 * runs along another net's wire, nor bends or ends on one: it may only cross
 * one straight through. Null when nothing fits, or the box is too large.
 * `countBends` makes a search visit far fewer cells for a route of the same cost, though perhaps another one.
 */
export function search(
  a: Point,
  b: Point,
  exitA: number,
  exitB: number,
  obstacles: Obstacles,
  net: string,
  margin: number,
  countBends: boolean,
): Point[] | null {
  if (a.x === b.x && a.y === b.y) return [a, b];
  const minX = Math.min(a.x, b.x) - margin;
  const minY = Math.min(a.y, b.y) - margin;
  const [maxX, maxY] = [Math.max(a.x, b.x) + margin, Math.max(a.y, b.y) + margin];
  // Checked before anything is allocated: the arrays are sized by the box.
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS) return null;
  // A port whose first cell outside is taken can never be reached: fail now rather than build and search the whole box.
  if (!exitFree(a, exitA, obstacles, net) || !exitFree(b, exitB, obstacles, net)) return null;
  const box = new Box(minX, minY, maxX, maxY);
  box.block(obstacles.bodies);
  box.avoid(obstacles, net);
  const { w, blocked, edges, others } = box;
  // State: cell * 5 + direction of the move into it (4: none yet).
  scratch(box.w * box.h * 5);
  // Written out in the loop below, which runs millions of times on a large sheet: equal totals are broken towards the
  // goal, so the search does not fan out over every equal-cost cell.
  const SCALE = 4096;
  const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const start = box.cell(a.x, a.y) * 5 + 4;
  costs[start] = 0;
  froms[start] = -1;
  stamps[start] = stamp;
  heap.clear();
  heap.push(distance * SCALE + distance, start);
  // DIRS pairs opposites (0/1, 2/3), so the move into `b` is its exit flipped.
  const arrive = exitB >= 0 ? exitB ^ 1 : -1;
  while (heap.size > 0) {
    heap.pop();
    const state = heap.topState;
    const c = (state / 5) | 0;
    const d = state - c * 5;
    const row = (c / w) | 0;
    const px = c - row * w + minX;
    const py = row + minY;
    const here = costs[state] as number;
    const left = Math.abs(px - b.x) + Math.abs(py - b.y);
    const bends = countBends ? BEND * bendsLeft(d, arrive, b.x - px, b.y - py) : 0;
    if (heap.top > (here + left + bends) * SCALE + left) continue; // a cheaper way here was found after this was queued
    if (left === 0) return simplify(path(state));
    for (let nd = 0; nd < 4; nd++) {
      if (d === 4 ? exitA >= 0 && nd !== exitA : (d ^ 1) === nd) continue; // the forced first move; no U-turns
      const turning = d !== 4 && d !== nd;
      // Bending where another net passes would look like a T: joined.
      if (turning && others[c] === 2) continue;
      const dir = DIRS[nd] as Point;
      const qx = px + dir.x;
      const qy = py + dir.y;
      if (qx < minX || qy < minY || qx > maxX || qy > maxY) continue;
      const isGoal = qx === b.x && qy === b.y;
      if (isGoal && arrive >= 0 && nd !== arrive) continue;
      const qc = c + dir.x + dir.y * w;
      if (!isGoal && blocked[qc]) continue;
      // Running along another net, or onto a point where one ends or bends, would look like a connection.
      if (edges[2 * (dir.x + dir.y > 0 ? c : qc) + (dir.y !== 0 ? 1 : 0)]) continue;
      const other = others[qc];
      if (other === 1) continue;
      const total = here + 1 + (turning ? BEND : 0) + (other === 2 ? CROSS : 0);
      const next = qc * 5 + nd;
      if (stamps[next] !== stamp || total < (costs[next] as number)) {
        costs[next] = total;
        froms[next] = state;
        stamps[next] = stamp;
        const rest = Math.abs(qx - b.x) + Math.abs(qy - b.y);
        const bends = countBends ? BEND * bendsLeft(nd, arrive, b.x - qx, b.y - qy) : 0;
        heap.push((total + rest + bends) * SCALE + rest, next);
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

// Keyed by circuit, but stale once instances' layouts change (a definition was edited).
type Cached = { layouts: number; routes: Map<string, Point[]> };
const cache = new WeakMap<Circuit, Cached>();
const kept = new WeakMap<Circuit, Cached>();
/** The routes cached for `circuit`, unless layouts have changed since. */
const fresh = (map: WeakMap<Circuit, Cached>, circuit: Circuit) => {
  const hit = map.get(circuit);
  return hit?.layouts === layoutsVersion() ? hit.routes : undefined;
};

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
  let result = fresh(cache, circuit);
  if (!result) {
    // Instances' ports move when their definitions' pins change: nothing on an instance is kept then.
    const sameLayouts = last?.layouts === layoutsVersion();
    result = route(circuit, last ? unaffected(last.circuit, last.routes, circuit, sameLayouts) : new Map());
    cache.set(circuit, { layouts: layoutsVersion(), routes: result });
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
  const nextParts = new Map(next.components.map((c) => [c.id, c]));
  const nextDots = new Map(next.junctions.map((j) => [j.id, j.position]));
  // A label whose tag moved, grew or changed side counts as moved (ADR 0039).
  const [tagsBefore, tagsNow] = [labelTags(prev), labelTags(next)];
  const sameTag = (id: string) => {
    const [a, b] = [tagsBefore.get(id)?.box, tagsNow.get(id)?.box];
    return a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
  };
  const stays = (id: string) => {
    const [old, now] = [parts.get(id), nextParts.get(id)];
    if (old || now) {
      return (
        !!old &&
        !!now &&
        old.kind === now.kind &&
        old.definition === now.definition &&
        (old.kind !== "custom" || sameLayouts) &&
        old.rotation === now.rotation &&
        // A width edit can resize a part (ADR 0014); layouts are cached, so the same one is the same object.
        layoutOf(old) === layoutOf(now) &&
        samePoint(old.position, now.position)
      );
    }
    const [was, is] = [dots.get(id), nextDots.get(id)];
    return !!was && !!is && samePoint(was, is) && sameTag(id);
  };
  // Boxes of parts, junctions and label tags that moved, turned or appeared: a kept route must not run into one.
  const obstacles = [
    ...next.components.filter((c) => !stays(c.id)).map((c) => ({ ...c.position, ...size(c) })),
    ...next.junctions.filter((j) => !stays(j.id)).map((j) => ({ ...j.position, width: 0, height: 0 })),
    ...next.junctions.flatMap((j) => {
      const box = stays(j.id) ? null : tagsNow.get(j.id)?.box;
      return box ? [{ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }] : [];
    }),
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
  // Names as numbers, so comparing two wires' nets does not compare every wire ID of a large net.
  const numbers = new Map<string, number>();
  const number = (name: string) => {
    let n = numbers.get(name);
    if (n === undefined) numbers.set(name, (n = numbers.size));
    return n;
  };
  /** Each wire's net, named by the sorted IDs of all its wires: equal names mean the net kept the same wires. */
  const members = (circuit: Circuit) => {
    const netOf = nets(circuit);
    const byNet = new Map<string, string[]>();
    for (const [wire, net] of netOf) {
      const list = byNet.get(net);
      if (list) list.push(wire);
      else byNet.set(net, [wire]);
    }
    const names = new Map([...byNet].map(([net, list]) => [net, number(list.sort().join())]));
    return new Map([...netOf].map(([wire, net]) => [wire, names.get(net)]));
  };
  const [netBefore, netNow] = [members(prev), members(next)];
  // Boxes by tile, so each route is checked against the boxes near it, not all of them (dropping a large selection moves
  // thousands); a box or segment across more than `LONG` tiles is checked plainly.
  // shortcut: many segments over 1,024 cells, or many such shaped wires changed at once, are still checked against every
  // box; file them by tile too if sheets with that many long wires appear.
  type Rect = (typeof obstacles)[number];
  const near = new Tiles<Rect>(TILE);
  const wide: Rect[] = [];
  const across = (a: number, b: number) => Math.floor(b / TILE) - Math.floor(a / TILE);
  for (const box of obstacles) {
    if (across(box.x, box.x + box.width) > LONG || across(box.y, box.y + box.height) > LONG) wide.push(box);
    else near.add(box, box.x, box.y, box.x + box.width, box.y + box.height);
  }
  const blocked = (points: Point[]) => {
    for (let i = 1; i < points.length; i++) {
      const segment = [points[i - 1] as Point, points[i] as Point];
      const [p, q] = segment as [Point, Point];
      const [x0, x1, y0, y1] = [Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.y, q.y), Math.max(p.y, q.y)];
      const hits = (box: Rect) => crosses(segment, box);
      if (across(x0, x1) > LONG || across(y0, y1) > LONG) {
        if (obstacles.some(hits)) return true;
        continue;
      }
      let hit = wide.some(hits);
      if (!hit) near.each(x0, y0, x1, y1, (box) => (hit ||= hits(box)));
      if (hit) return true;
    }
    return false;
  };
  const kept = new Map<string, Point[]>();
  for (const wire of next.wires) {
    const [old, points] = [wires.get(wire.id), before.get(wire.id)];
    if (!old || !points) continue;
    if (JSON.stringify([old.from, old.to, old.bends]) !== JSON.stringify([wire.from, wire.to, wire.bends])) continue;
    if (!stays(endOwner(wire.from)) || !stays(endOwner(wire.to))) continue;
    if (netBefore.get(wire.id) !== netNow.get(wire.id)) continue;
    if (obstacles.length > 0 && blocked(points)) continue;
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
  let result = fresh(kept, circuit);
  if (!result) kept.set(circuit, { layouts: layoutsVersion(), routes: (result = route(circuit, frozen)) });
  return result;
}

/**
 * Every wire routed with the index's tiles `size` cells wide, `frozen` ones laid as given: for tests, against tiles
 * wider than any sheet.
 */
export const routeWithTiles = (circuit: Circuit, size: number, frozen = new Map<string, Point[]>()) => route(circuit, frozen, size);

/** The search box from (x0, y0) to (x1, y1) for `net`, with `laid` routes filed first: for tests. */
export function boxOver(circuit: Circuit, laid: { net: string; points: Point[] }[], net: string, x0: number, y0: number, x1: number, y1: number) {
  const obstacles = obstaclesOf(circuit, TILE);
  for (const route of laid) file(obstacles, route.net, route.points);
  const box = new Box(x0, y0, x1, y1);
  box.block(obstacles.bodies);
  box.avoid(obstacles, net);
  return box;
}

/** Wires laid on the plain path because no search found a way: counted for the layout tests (ADR 0039). */
let fallbackCount = 0;
/** How many of `circuit`'s wires fall back to the plain path when routed afresh. */
export function fallbacks(circuit: Circuit) {
  const before = fallbackCount;
  route(circuit, new Map());
  return fallbackCount - before;
}

function route(circuit: Circuit, frozen: Map<string, Point[]>, size = TILE): Map<string, Point[]> {
  const at = places(circuit);
  const netOf = nets(circuit);
  const obstacles = obstaclesOf(circuit, size);
  const result = new Map<string, Point[]>();
  const lay = (id: string, points: Point[]) => {
    result.set(id, points);
    file(obstacles, netOf.get(id) as string, points);
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
      points = search(a, b, exitA, exitB, obstacles, net, margin, circuit.wires.length >= LARGE_SHEET);
      if (points) break;
    }
    // shortcut: when nothing fits even the wider box, the plain route may touch another net; widen further if that shows up.
    if (!points) fallbackCount++;
    points ??= wirePoints(at, wire);
    if (points) lay(wire.id, points);
  }
  return result;
}
