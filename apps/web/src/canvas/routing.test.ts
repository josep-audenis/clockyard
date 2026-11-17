import { beforeEach, expect, test } from "vitest";
import type { Circuit, CircuitComponent, Wire } from "../editor/document";
import type { Point } from "./geometry";
import { setDefinitionLayouts } from "./layout";
import { forgetRoutes, routes, routesKeeping, routeWithTiles } from "./routing";

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

// Also across the routing index's tiles at negative coordinates, where a tile is found by rounding down.
test.each([0, -37])("in a crowded grid at offset %i, wires of different nets never share a grid edge nor cross a body", (at) => {
  const components: CircuitComponent[] = [];
  const wires: Wire[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) components.push(part(`g${r}${c}`, "and", at + c * 8, at + r * 7));
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
    const through = cells(all.get(w.id) ?? []).slice(1, -1).filter((p) => components.some((c) => inside(p, c, 4, 4)));
    expect(through, `${w.id} crosses a body`).toEqual([]);
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

// The routing index (ADR 0030) must change nothing: against tiles wider than any sheet, which is a scan of every
// part and route, seeded random circuits route the same, parts turned, wires shaped, some ends far enough apart for
// the plain route and the list of long routes, at positive and negative positions.
test("routes with the tile index are the routes a scan of the whole sheet gives", () => {
  // mulberry32: a small seeded generator whose low bits do not repeat early.
  let seed = 7;
  const random = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n);
  };
  const kinds = [
    ["and", ["a", "b"]],
    ["or", ["a", "b"]],
    ["not", ["in"]],
  ] as const;
  for (let round = 0; round < 40; round++) {
    const at = [0, -37, -1000, 15][round % 4] as number;
    // Half the rounds spread wider, so segments cross tiles; a few parts far out are joined by plain routes.
    const [w, h] = round % 2 ? [80, 60] : [140, 90];
    const components: CircuitComponent[] = [];
    for (let i = 0; i < 24; i++) {
      const [kind] = kinds[random(3)] as (typeof kinds)[number];
      const rotation = ([0, 90, 180, 270] as const)[random(4)] as CircuitComponent["rotation"];
      const far = random(12) === 0 ? (random(2) ? 3000 : -3000) : 0;
      components.push({ ...part(`p${i}`, kind, at + far + random(w), at + random(h)), rotation });
    }
    const wires: Wire[] = [];
    for (let i = 0; i < 40; i++) {
      const from = components[random(components.length)] as CircuitComponent;
      const to = components[random(components.length)] as CircuitComponent;
      const inputs = (kinds.find(([k]) => k === to.kind) as (typeof kinds)[number])[1];
      const w = wire(`w${i}`, `${from.id}.out`, `${to.id}.${inputs[random(inputs.length)]}`);
      wires.push(random(10) === 0 ? { ...w, bends: [] } : w);
    }
    const circuit = { components, junctions: [], wires };
    // Two wires laid first as straight lines across the area, as a drag lays frozen routes: the middles of their
    // segments run through other wires' boxes, one filed by tiles, one long enough for the list.
    const frozen = new Map<string, Point[]>();
    for (let i = 0; i < 2; i++) {
      const reach = i < 1 ? 40 : 3000;
      const y = at + random(h);
      frozen.set(`w${i}`, [{ x: at - reach, y }, { x: at + w + reach, y }]);
    }
    // Tiles of one cell as well as the real 16: every body straddles tiles, and a box's edge often cuts one.
    for (const lines of [new Map<string, Point[]>(), frozen]) {
      const scan = Object.fromEntries(routeWithTiles(circuit, 1e9, lines));
      for (const size of [1, 16]) expect(Object.fromEntries(routeWithTiles(circuit, size, lines)), `round ${round}, tiles of ${size}`).toEqual(scan);
    }
  }
}, 30_000);

test("parts a million cells apart route at once: a long route is not filed under every tile it crosses", () => {
  const components = Array.from({ length: 400 }, (_, i) => part(`n${i}`, "not", i % 2 ? 1_000_000 : -1_000_000, 4 * i));
  const wires = Array.from({ length: 200 }, (_, i) => wire(`w${i}`, `n${2 * i}.out`, `n${2 * i + 1}.in`));
  const start = performance.now();
  routes({ components, junctions: [], wires });
  // Filed tile by tile this took about ten seconds and two gigabytes; a scan takes milliseconds.
  expect(performance.now() - start).toBeLessThan(2000);
});
