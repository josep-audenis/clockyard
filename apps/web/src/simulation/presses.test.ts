import { expect, test } from "vitest";
import { notePresses } from "./presses";

test("a release at the tick of its press is short while running; later, paused, or a held 1 sent again is not (ADR 0038)", () => {
  const at = new Map<string, number>();
  const buttons = new Set(["p", "q"]);
  // A switch is not a button.
  expect(notePresses(at, buttons, { s: 1, p: 1 }, 10, true)).toEqual([]);
  expect(notePresses(at, buttons, { s: 0, p: 0 }, 10, true)).toEqual(["p"]);
  // Held across a tick.
  notePresses(at, buttons, { p: 1 }, 10, true);
  expect(notePresses(at, buttons, { p: 0 }, 11, true)).toEqual([]);
  // Paused: no tick could have fallen, so nothing is missed by running.
  notePresses(at, buttons, { q: 1 }, 20, false);
  expect(notePresses(at, buttons, { q: 0 }, 20, false)).toEqual([]);
  // A reload sending a held 1 again keeps the first tick.
  notePresses(at, buttons, { p: 1 }, 30, true);
  notePresses(at, buttons, { p: 1 }, 31, true);
  expect(notePresses(at, buttons, { p: 0 }, 31, true)).toEqual([]);
});
