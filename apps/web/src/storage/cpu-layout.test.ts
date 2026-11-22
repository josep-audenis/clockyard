// ADR 0039: the reference CPUs are laid out in regions, each a rectangle of at most 44 × 40 cells with its title note at
// its top left corner, at most three across. Checked here on the sheets as the editor routes them.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { labelTags, type Point } from "../canvas/geometry";
import { layoutOf, setDefinitionLayouts } from "../canvas/layout";
import { fallbacks, routeWithTiles } from "../canvas/routing";
import { noteSize } from "../editor/document";
import { parseDocument } from "./file";

const REGION = { width: 44, height: 40 };
/** The canvas at 1280×800 with both panels open, in cells at 100% (ADR 0039), and the least zoom a sheet opens at. */
const CANVAS = { width: 768 / 16, height: 728 / 16 };
const MIN_ZOOM = 0.25;

type Box = { x0: number; y0: number; x1: number; y1: number };
const within = (b: Box, r: Box) => b.x0 >= r.x0 && b.y0 >= r.y0 && b.x1 <= r.x1 && b.y1 <= r.y1;

test.each(["reference-cpu", "catch", "reference-cpu-2", "catch-2"])("%s is laid out in regions that hold everything", (name) => {
  const parsed = parseDocument(readFileSync(new URL(`../../../../examples/${name}.clockyard.json`, import.meta.url), "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  const { circuit, definitions } = parsed.document;
  setDefinitionLayouts(definitions);
  const regions = circuit.notes.map((n) => ({
    title: n.text.split("\n")[0],
    box: { x0: n.position.x, y0: n.position.y, x1: n.position.x + REGION.width, y1: n.position.y + REGION.height },
  }));
  expect(regions.length).toBeGreaterThanOrEqual(6);
  // No two overlap, and at most three stand side by side.
  for (const [i, a] of regions.entries()) {
    for (const b of regions.slice(i + 1)) {
      const apart = a.box.x1 < b.box.x0 || b.box.x1 < a.box.x0 || a.box.y1 < b.box.y0 || b.box.y1 < a.box.y0;
      expect(apart, `${a.title} and ${b.title}`).toBe(true);
    }
  }
  expect(new Set(regions.map((r) => r.box.x0)).size).toBeLessThanOrEqual(3);
  const home = (b: Box, what: string) => {
    const found = regions.find((r) => within(b, r.box));
    expect(found, `${what} lies wholly inside a region`).toBeDefined();
    return found;
  };
  for (const c of circuit.components) {
    const { width, height } = layoutOf(c);
    home({ x0: c.position.x, y0: c.position.y, x1: c.position.x + width, y1: c.position.y + height }, c.id);
  }
  for (const [id, { box }] of labelTags(circuit)) if (box) home(box, `the tag of ${id}`);
  // Routes stay in their region, and never cross a note's text.
  const notes = circuit.notes.map((n) => {
    const { width, height } = noteSize(n.text);
    return { x0: n.position.x, y0: n.position.y, x1: n.position.x + width, y1: n.position.y + height };
  });
  for (const [wire, points] of routeWithTiles(circuit, 16)) {
    const xs = points.map((p: Point) => p.x);
    const ys = points.map((p: Point) => p.y);
    home({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, `wire ${wire}`);
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as Point, points[i] as Point];
      const seg = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      for (const n of notes) {
        const apart = seg.x1 < n.x0 || n.x1 < seg.x0 || seg.y1 < n.y0 || n.y1 < seg.y0;
        expect(apart, `wire ${wire} crosses a note`).toBe(true);
      }
    }
  }
  expect(fallbacks(circuit)).toBe(0);
  // The whole sheet opens framed at 25% or more.
  const x0 = Math.min(...regions.map((r) => r.box.x0));
  const y0 = Math.min(...regions.map((r) => r.box.y0));
  const x1 = Math.max(...regions.map((r) => r.box.x1));
  const y1 = Math.max(...regions.map((r) => r.box.y1));
  expect(Math.min(CANVAS.width / (x1 - x0 + 4), CANVAS.height / (y1 - y0 + 5))).toBeGreaterThanOrEqual(MIN_ZOOM);
});
