import { expect, test } from "vitest";
import type { Circuit, CircuitComponent, Wire } from "../editor/document";
import type { Point } from "./geometry";
import { routes, routesKeeping } from "./routing";

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

/** Unit edges of a route, as sortable keys. */
const unitEdges = (points: Point[]) => {
  const path = cells(points);
  return path.slice(1).map((p, i) => [path[i], p].map((q) => `${q?.x},${q?.y}`).sort().join("|"));
};

test("in a crowded grid, wires of different nets never share a grid edge", () => {
  const components: CircuitComponent[] = [];
  const wires: Wire[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) components.push(part(`g${r}${c}`, "and", c * 8, r * 7));
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      wires.push(wire(`a${r}${c}`, `g${r}${c}.out`, `g${(r + 1) % 4}${c + 1}.a`));
      wires.push(wire(`b${r}${c}`, `g${r}${c}.out`, `g${(r + 3) % 4}${c + 1}.b`));
    }
  }
  const all = routes({ components, junctions: [], wires });
  // Both wires from one output are one net; every other pair must keep apart.
  const owner = new Map<string, string>();
  for (const w of wires) {
    const net = "component" in w.from ? w.from.component : "";
    for (const e of unitEdges(all.get(w.id) ?? [])) {
      const other = owner.get(e);
      expect(other === undefined || other === net, `${w.id} runs along net ${other} at ${e}`).toBe(true);
      owner.set(e, net);
    }
  }
});

test("while dragging, frozen wires keep their routes exactly", () => {
  const all = routes(loop);
  const frozen = new Map([["fwd", all.get("fwd") ?? []]]);
  // The AND moves; only the feedback wire is routed again.
  const moved: Circuit = { ...loop, components: [not, { ...and, position: { x: 8, y: 9 } }] };
  const during = routesKeeping(moved, frozen);
  expect(during.get("fwd")).toBe(frozen.get("fwd"));
  expect(during.get("back")?.[0]).toEqual({ x: 12, y: 11 });
});

test("after an edit, wires it leaves alone keep their routes; wires it touches or crosses are routed again", () => {
  const before = routes(loop);
  // A new part far away: nothing changes.
  const far: Circuit = { ...loop, components: [...loop.components, part("x", "switch", 40, 40)] };
  const after = routes(far);
  expect(after.get("fwd")).toBe(before.get("fwd"));
  expect(after.get("back")).toBe(before.get("back"));
  // A junction dropped onto the feedback wire's route, clear of the forward wire: only the feedback wire moves.
  const fwdCells = new Set(cells(before.get("fwd") ?? []).map((p) => `${p.x},${p.y}`));
  const back = cells(before.get("back") ?? []).slice(1, -1);
  const onRoute = back.find((p) => !fwdCells.has(`${p.x},${p.y}`)) as Point;
  const blocking: Circuit = { ...far, junctions: [{ id: "y", position: onRoute }] };
  const rerouted = routes(blocking);
  expect(rerouted.get("fwd")).toBe(before.get("fwd"));
  expect(rerouted.get("back")).not.toBe(before.get("back"));
  expect(cells(rerouted.get("back") ?? []).some((p) => p.x === onRoute.x && p.y === onRoute.y)).toBe(false);
});
