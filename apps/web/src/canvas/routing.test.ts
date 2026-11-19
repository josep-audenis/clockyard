import { readFileSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import type { Circuit, CircuitComponent, Wire } from "../editor/document";
import { DIRS, type Point } from "./geometry";
import { setDefinitionLayouts } from "./layout";
import { bendsLeft, boxOver, forgetRoutes, routes, routesKeeping, routeWithTiles } from "./routing";

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

test("after an edit, wires on a junction keep their routes while it stays, and are routed again once it moves", () => {
  const base: Circuit = {
    components: [part("s", "switch", 0, 0), part("l", "led", 20, 6)],
    junctions: [{ id: "j", position: { x: 10, y: 1 } }],
    wires: [
      { id: "a", from: { component: "s", port: "out" }, to: { junction: "j" } },
      { id: "b", from: { junction: "j" }, to: { component: "l", port: "in" } },
    ],
  };
  const before = routes(base);
  const far: Circuit = { ...base, components: [...base.components, part("x", "switch", 40, 40)] };
  const after = routes(far);
  expect(after.get("a")).toBe(before.get("a"));
  expect(after.get("b")).toBe(before.get("b"));
  const moved = routes({ ...far, junctions: [{ id: "j", position: { x: 10, y: 3 } }] });
  expect(moved.get("a")).not.toBe(before.get("a"));
  expect(moved.get("b")).not.toBe(before.get("b"));
});

test("after an edit, routes and shapes too long to file by tile are still checked against what changed", () => {
  const base: Circuit = {
    components: [part("s", "switch", 0, 0), part("l", "led", 3000, 0), part("s2", "switch", 0, 10), part("l2", "led", 20, 10)],
    junctions: [],
    wires: [wire("long", "s.out", "l.in"), wire("short", "s2.out", "l2.in")],
  };
  const before = routes(base);
  expect(before.get("long")).toBeDefined();
  const y = (before.get("long") ?? [])[0]?.y ?? 0;
  // A part dropped on the long route, far along it: only that route is routed again.
  const dropped = routes({ ...base, components: [...base.components, part("x", "not", 1500, y - 1)] });
  expect(dropped.get("long")).not.toBe(before.get("long"));
  expect(dropped.get("short")).toBe(before.get("short"));
  // A new shaped wire with a segment thousands of cells long, laid across the short route: that one moves. Routing
  // `base` again makes it the circuit the next edit is compared with.
  routes(base);
  const shaped = { ...wire("tall", "s3.out", "l3.in"), bends: [{ x: 8, y: -1500 }, { x: 8, y: 1500 }] };
  const crossed = routes({
    ...base,
    components: [...base.components, part("s3", "switch", 0, -1500), part("l3", "led", 20, 1500)],
    wires: [...base.wires, shaped],
  });
  expect(crossed.get("short")).not.toBe(before.get("short"));
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
}, 60_000);

test("parts a million cells apart route at once: a long route is not filed under every tile it crosses", () => {
  const components = Array.from({ length: 400 }, (_, i) => part(`n${i}`, "not", i % 2 ? 1_000_000 : -1_000_000, 4 * i));
  const wires = Array.from({ length: 200 }, (_, i) => wire(`w${i}`, `n${2 * i}.out`, `n${2 * i + 1}.in`));
  const start = performance.now();
  routes({ components, junctions: [], wires });
  // Filed tile by tile this took about ten seconds and two gigabytes; a scan takes milliseconds.
  expect(performance.now() - start).toBeLessThan(2000);
});

test("the bends the search counts on are never more than a route needs, nor than one step can pay for", () => {
  const R = 7;
  const key = (x: number, y: number, d: number) => (x + 2 * R) * 1000 + (y + 2 * R) * 10 + d;
  for (const arrive of [-1, 0, 1, 2, 3]) {
    // Fewest bends from each cell and heading to the goal at (0, 0), by walking backwards from it over an open grid.
    const fewest = new Map<number, number>();
    let level: [number, number, number][] = [];
    for (let d = 0; d < 4; d++) {
      if (arrive >= 0 && d !== arrive) continue;
      const dir = DIRS[d] as Point;
      fewest.set(key(-dir.x, -dir.y, d), 0);
      level.push([-dir.x, -dir.y, d]);
    }
    const reach = (x: number, y: number, d: number, bends: number, next: [number, number, number][]) => {
      if (Math.abs(x) > 2 * R || Math.abs(y) > 2 * R || (fewest.get(key(x, y, d)) ?? Infinity) <= bends) return;
      fewest.set(key(x, y, d), bends);
      next.push([x, y, d]);
    };
    for (let bends = 0; level.length > 0; bends++) {
      const turned: [number, number, number][] = [];
      while (level.length > 0) {
        const [x, y, d] = level.pop() as [number, number, number];
        // The state one step before (x, y, d) moved along d, then may have been heading d or, one bend more, across it.
        const dir = DIRS[d] as Point;
        reach(x - dir.x, y - dir.y, d, bends, level);
        for (const before of d < 2 ? [2, 3] : [0, 1]) reach(x, y, before, bends + 1, turned);
      }
      level = turned;
    }
    for (let x = -R; x <= R; x++) {
      for (let y = -R; y <= R; y++) {
        if (x === 0 && y === 0) continue;
        for (let d = 0; d < 4; d++) {
          const here = bendsLeft(d, arrive, -x, -y);
          expect(here).toBeLessThanOrEqual(fewest.get(key(x, y, d)) as number);
          for (let nd = 0; nd < 4; nd++) {
            const dir = DIRS[nd] as Point;
            const [qx, qy] = [x + dir.x, y + dir.y];
            if ((d ^ 1) === nd || (qx === 0 && qy === 0 && arrive >= 0 && nd !== arrive)) continue;
            // A straight step costs at least 1 and a bend 1 + BEND; the distance falls by 1 at most.
            expect(here).toBeLessThanOrEqual(bendsLeft(nd, arrive, -qx, -qy) + (nd === d ? 0 : 1));
          }
        }
      }
    }
  }
});

test("a search box holds, cell for cell, what a box over the whole sheet holds there", () => {
  let seed = 3;
  const random = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n);
  };
  const SIDE = 60;
  for (let round = 0; round < 40; round++) {
    const components = Array.from({ length: 6 }, (_, i) => part(`p${i}`, "and", random(SIDE) - 30, random(SIDE) - 30));
    const circuit: Circuit = { components, junctions: [], wires: [] };
    const laid = Array.from({ length: 30 }, (_, i) => {
      // Orthogonal routes of a few segments, some of them far longer than a tile, and of a few nets.
      let [x, y] = [random(SIDE) - 30, random(SIDE) - 30];
      const points: Point[] = [{ x, y }];
      for (let k = random(4); k >= 0; k--) {
        if (k % 2) x = random(SIDE) - 30;
        else y = random(SIDE) - 30;
        points.push({ x, y });
      }
      return { net: `n${i % 5}`, points };
    });
    const whole = boxOver(circuit, laid, "n0", -40, -40, 40, 40);
    const [x0, y0] = [random(50) - 30, random(50) - 30];
    const [x1, y1] = [x0 + random(12), y0 + random(12)];
    const inner = boxOver(circuit, laid, "n0", x0, y0, x1, y1);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const [c, w] = [inner.cell(x, y), whole.cell(x, y)];
        expect([inner.blocked[c], inner.others[c], inner.edges[2 * c], inner.edges[2 * c + 1]]).toEqual([
          whole.blocked[w],
          whole.others[w],
          whole.edges[2 * w],
          whole.edges[2 * w + 1],
        ]);
      }
    }
  }
});

test.each(Object.entries({"4-bit-adder":"c93c3c34","8-bit-adder":"b14d0bb0","8-bit-counter":"46649868","and-gate":"be6655bf","cascade-fanout":"9867cc08","catch":"70e065c3","devices":"bf396a0f","half-adder":"802fb42e","reference-cpu":"70e065c3"}))("the routes of example %s stay exactly as they are", (name, expected) => {
  const url = new URL(`../../../../examples/${name}.clockyard.json`, import.meta.url);
  const { circuit, definitions } = JSON.parse(readFileSync(url, "utf8")) as { circuit: Circuit; definitions: (Parameters<typeof setDefinitionLayouts>[0][number] & { circuit: Circuit })[] };
  setDefinitionLayouts(definitions);
  let hash = 0x811c9dc5;
  for (const sheet of [circuit, ...definitions.map((d) => d.circuit)]) {
    const text = JSON.stringify([...routeWithTiles(sheet, 16)]);
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  setDefinitionLayouts([]);
  expect((hash >>> 0).toString(16)).toBe(expected);
});

test("a sheet large enough for the bend count still keeps its nets apart", () => {
  const components = [part("s", "switch", 0, 0)];
  const wires: Wire[] = [];
  for (let i = 0; i < 2_000; i++) {
    components.push(part(`n${i}`, "not", 6 + (i % 50) * 5, Math.floor(i / 50) * 4));
    wires.push(wire(`w${i}`, i === 0 ? "s.out" : `n${i - 1}.out`, `n${i}.in`));
  }
  const all = routes({ components, junctions: [], wires });
  const owner = new Map<string, string>();
  for (const w of wires) {
    for (const e of unitEdges(all.get(w.id) ?? [])) {
      expect(owner.get(e), `${w.id} runs along another net at ${e}`).toBeUndefined();
      owner.set(e, w.id);
    }
  }
});
