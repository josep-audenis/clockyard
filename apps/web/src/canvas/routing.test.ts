import { beforeEach, expect, test } from "vitest";
import type { Circuit, CircuitComponent, Wire } from "../editor/document";
import type { Point } from "./geometry";
import { setDefinitionLayouts } from "./layout";
import { forgetRoutes, routes, routesKeeping } from "./routing";

// Each test starts as if a file had just been opened: no earlier circuit to compare with.
beforeEach(forgetRoutes);

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

test("a shaped wire moved onto an automatic one of another net makes that one move away", () => {
  const k = wire("k", "s1.out", "l1.in");
  const s = { ...wire("s", "s2.out", "l2.in"), bends: [{ x: 5, y: 11 }] };
  const base: Circuit = {
    components: [part("s1", "switch", 0, 0), part("l1", "led", 20, 0), part("s2", "switch", 0, 10), part("l2", "led", 20, 10)],
    junctions: [],
    wires: [k, s],
  };
  routes(base);
  // What dragging the shaped wire's middle up onto row 1 produces.
  const dragged: Circuit = { ...base, wires: [k, { ...s, bends: [{ x: 6, y: 11 }, { x: 6, y: 1 }, { x: 14, y: 1 }, { x: 14, y: 11 }] }] };
  const after = routes(dragged);
  const shared = unitEdges(after.get("k") ?? []).filter((e) => unitEdges(after.get("s") ?? []).includes(e));
  expect(shared).toEqual([]);
});

test("after forgetRoutes (opening a file) everything is routed afresh", () => {
  // A wire routed round a blocking LED keeps its detour after the LED is deleted...
  const blocked: Circuit = {
    components: [part("s", "switch", 0, 0), part("l", "led", 20, 0), part("x", "led", 9, 0)],
    junctions: [],
    wires: [wire("w", "s.out", "l.in")],
  };
  const detour = routes(blocked).get("w");
  const cleared: Circuit = { ...blocked, components: blocked.components.filter((c) => c.id !== "x") };
  expect(routes(cleared).get("w")).toBe(detour);
  // ...until the circuit is opened again.
  forgetRoutes();
  expect(routes(structuredClone(cleared)).get("w")).toEqual([
    { x: 2, y: 1 },
    { x: 20, y: 1 },
  ]);
});

test("a cached circuit is routed again once its instances' pins move", () => {
  const led = (id: string, y: number, label: string): CircuitComponent => ({ ...part(id, "led", 9, y), props: { label } });
  const definition = (extra: CircuitComponent[]) => ({
    id: "d",
    name: "D",
    circuit: { components: [...extra, led("o", 4, "Out")], junctions: [], wires: [] },
  });
  setDefinitionLayouts([definition([])]);
  const main: Circuit = {
    components: [{ ...part("x", "custom", 0, 0), definition: "d" }, part("l", "led", 12, 0)],
    junctions: [],
    wires: [wire("w", "x.o", "l.in")], // an instance's port is its pin part's ID
  };
  expect(routes(main).get("w")?.[0]).toEqual({ x: 4, y: 1 });
  // An LED above Out moves it down a pin; the same circuit object must not keep its old route.
  setDefinitionLayouts([definition([led("aux", 0, "Aux")])]);
  expect(routes(main).get("w")?.[0]).toEqual({ x: 4, y: 3 });
  setDefinitionLayouts([]);
});

test("a width edit that resizes a part routes its wires again; one that does not keeps them", () => {
  const before: Circuit = {
    components: [part("s", "switch", 0, 0), part("g", "not", 8, 0)],
    junctions: [],
    wires: [wire("w", "s.out", "g.in")],
  };
  expect(routes(before).get("w")?.[0]).toEqual({ x: 2, y: 1 });
  const widen = (c: CircuitComponent) => ({ ...c, props: { width: 8 } });
  const wide = { ...before, components: before.components.map((c) => (c.id === "s" ? widen(c) : c)) };
  const route = routes(wide).get("w");
  expect(route?.[0]).toEqual({ x: 5, y: 1 });
  // A gate keeps its shape at any width, so its wire keeps its route.
  const gate = { ...wide, components: wide.components.map((c) => (c.id === "g" ? widen(c) : c)) };
  expect(routes(gate).get("w")).toBe(route);
});

test("an 8-way splitter's field wires, one cell apart, route without touching each other", () => {
  const split: CircuitComponent = { ...part("sp", "split", 0, 0), props: { fields: Array<number>(8).fill(1) } };
  const leds = Array.from({ length: 8 }, (_, i) => part(`l${i}`, "led", 12, i * 3));
  const wires = leds.map((l, i) => wire(`w${i}`, `sp.f${i}`, `${l.id}.in`));
  const all = routes({ components: [split, ...leds], junctions: [], wires });
  const owner = new Map<string, string>();
  for (const w of wires) {
    const points = all.get(w.id) ?? [];
    expect(points.length, w.id).toBeGreaterThan(1);
    for (const e of unitEdges(points)) {
      expect(owner.get(e) ?? w.id, `${w.id} runs along ${owner.get(e)} at ${e}`).toBe(w.id);
      owner.set(e, w.id);
    }
  }
});
