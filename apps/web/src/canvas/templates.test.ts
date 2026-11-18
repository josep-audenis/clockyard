import { expect, test } from "vitest";
import { dropUnused, MIN_TEMPLATE_LIMIT } from "./templates";

test("unused templates are dropped and destroyed; used ones stay", () => {
  const templates = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const destroyed: number[] = [];
  dropUnused(templates, (t) => t === 2, (t) => destroyed.push(t));
  expect([...templates.keys()]).toEqual(["b"]);
  expect(destroyed).toEqual([1, 3]);
});

test("the next limit is twice what is left, and never under the minimum", () => {
  const keep = (n: number) => new Map(Array.from({ length: n }, (_, i) => [String(i), i]));
  expect(dropUnused(keep(3), () => true, () => {})).toBe(MIN_TEMPLATE_LIMIT);
  expect(dropUnused(keep(MIN_TEMPLATE_LIMIT), () => true, () => {})).toBe(2 * MIN_TEMPLATE_LIMIT);
});
