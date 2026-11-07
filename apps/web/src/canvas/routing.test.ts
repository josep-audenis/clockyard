import { expect, test } from "vitest";
import type { Circuit, CircuitComponent, Wire } from "../editor/document";
import type { Point } from "./geometry";
import { routes } from "./routing";

const part = (id: string, kind: CircuitComponent["kind"], x: number, y: number): CircuitComponent => ({
  id,
  kind,
  position: { x, y },
  rotation: 0,
  props: {},
});
const wire = (id: string, from: string, to: string): Wire => {
  const [fc = "", fp = ""] = from.split(".");
  const [tc = "", tp = ""] = to.split(".");
  return { id, from: { component: fc, port: fp }, to: { component: tc, port: tp } };
};

/** Every grid point a route passes, ends included. */
function cells(points: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point];
    const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let s = 0; s <= n; s++) out.push({ x: a.x + Math.sign(b.x - a.x) * s, y: a.y + Math.sign(b.y - a.y) * s });
  }
  return out;
}

const inside = (p: Point, c: CircuitComponent, w: number, h: number) =>
  p.x >= c.position.x && p.x <= c.position.x + w && p.y >= c.position.y && p.y <= c.position.y + h;

// The case from the screenshot: NOT (3x2) feeding an AND (4x4), and the AND's output fed back to the NOT.
const not = part("n", "not", 0, 0);
const and = part("g", "and", 8, 5);
const loop: Circuit = {
  components: [not, and],
  junctions: [],
  wires: [wire("fwd", "n.out", "g.a"), wire("back", "g.out", "n.in")],
};

test("a feedback wire goes around both parts, never through them", () => {
  const back = routes(loop).get("back") ?? [];
  const path = cells(back);
  expect(path[0]).toEqual({ x: 12, y: 7 }); // AND output
  expect(path.at(-1)).toEqual({ x: 0, y: 1 }); // NOT input
  // Only its own two ports touch a body.
  expect(path.slice(1, -1).filter((p) => inside(p, not, 3, 2) || inside(p, and, 4, 4))).toEqual([]);
  // It leaves the AND to the right and enters the NOT from the left.
  expect(path[1]).toEqual({ x: 13, y: 7 });
  expect(path.at(-2)).toEqual({ x: -1, y: 1 });
});

test("wires of different nets do not share a grid edge", () => {
  const all = routes(loop);
  const edges = (id: string) => {
    const path = cells(all.get(id) ?? []);
    return new Set(path.slice(1).map((p, i) => [path[i], p].map((q) => `${q?.x},${q?.y}`).sort().join("|")));
  };
  const fwd = edges("fwd");
  expect([...edges("back")].filter((e) => fwd.has(e))).toEqual([]);
});

test("routes are orthogonal, start and end at their ports, and are cached per circuit", () => {
  const all = routes(loop);
  for (const points of all.values()) {
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as Point, points[i] as Point];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  }
  expect(all.get("fwd")?.[0]).toEqual({ x: 3, y: 1 });
  expect(all.get("fwd")?.at(-1)).toEqual({ x: 8, y: 6 });
  expect(routes(loop)).toBe(all);
});

test("a shaped wire keeps its bends", () => {
  const shaped: Circuit = { ...loop, wires: [{ ...wire("fwd", "n.out", "g.a"), bends: [{ x: 5, y: 1 }, { x: 5, y: 6 }] }] };
  expect(routes(shaped).get("fwd")).toEqual([
    { x: 3, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 6 },
    { x: 8, y: 6 },
  ]);
});

test("ends a million cells apart get the plain route at once instead of a huge search", () => {
  const far: Circuit = {
    components: [part("s", "switch", 0, 0), part("l", "led", 999_990, 999_990)],
    junctions: [],
    wires: [
      wire("w", "s.out", "l.in"),
      // A shaped wire whose bends lie far from everything.
      { ...wire("v", "s.out", "l.in"), id: "v", bends: [{ x: 999_000, y: 1 }, { x: 999_000, y: 999_991 }] },
    ],
  };
  const started = performance.now();
  const all = routes(far);
  expect(performance.now() - started).toBeLessThan(500);
  expect(all.get("w")).toEqual([
    { x: 2, y: 1 },
    { x: 499_996, y: 1 },
    { x: 499_996, y: 999_991 },
    { x: 999_990, y: 999_991 },
  ]);
});
