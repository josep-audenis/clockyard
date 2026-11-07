import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { catalog, initSync } from "../generated/sim-wasm/sim_wasm.js";
import { LAYOUTS, layoutOf } from "./layout";

type Part = { kind: string; inputs: string[]; outputs: string[]; fieldPorts?: unknown };

test("every engine catalog kind has a layout with the same ports", () => {
  initSync({ module: readFileSync(new URL("../generated/sim-wasm/sim_wasm_bg.wasm", import.meta.url)) });
  const all = JSON.parse(catalog()) as Part[];
  // shortcut: split and merge get layouts with the editor work (ADR 0014 step 4); until then they are
  // the only kinds allowed to lack one. Step 4 also checks layout field-port names against `fieldPorts`.
  expect(all.filter((p) => p.fieldPorts).map((p) => p.kind)).toEqual(["split", "merge"]);
  const parts = all.filter((p) => !p.fieldPorts).map(({ kind, inputs, outputs }) => ({ kind, inputs, outputs }));
  const fromLayouts = Object.entries(LAYOUTS).map(([kind, layout]) => ({
    kind,
    inputs: Object.keys(layout.inputs),
    outputs: Object.keys(layout.outputs),
  }));
  expect(fromLayouts).toEqual(parts);
});

test("rotation turns a layout clockwise about its box, and four turns come back", () => {
  // AND 4x4: input a at (0,1) on the left goes to the top at (3,0); the output (4,2) to the bottom at (2,4).
  expect(layoutOf({ kind: "and", rotation: 90 })).toEqual({
    width: 4,
    height: 4,
    inputs: { a: { x: 3, y: 0 }, b: { x: 1, y: 0 } },
    outputs: { out: { x: 2, y: 4 } },
  });
  // NOT 3x2 stands up as 2x3.
  expect(layoutOf({ kind: "not", rotation: 270 })).toMatchObject({ width: 2, height: 3, inputs: { in: { x: 1, y: 3 } } });
  expect(layoutOf({ kind: "xor", rotation: 0 })).toBe(LAYOUTS.xor);
});

test("a wide switch or LED is a 5x2 body with its port where a 1-bit one has it; gates keep their shape", () => {
  const wide = { width: 8 };
  expect(layoutOf({ kind: "switch", rotation: 0, props: wide })).toEqual({ width: 5, height: 2, inputs: {}, outputs: { out: { x: 5, y: 1 } } });
  expect(layoutOf({ kind: "led", rotation: 0, props: wide })).toEqual({ width: 5, height: 2, inputs: { in: { x: 0, y: 1 } }, outputs: {} });
  expect(layoutOf({ kind: "switch", rotation: 0, props: { width: 1 } })).toBe(LAYOUTS.switch);
  expect(layoutOf({ kind: "switch", rotation: 90, props: wide })).toMatchObject({ width: 2, height: 5 });
  expect(layoutOf({ kind: "and", rotation: 0, props: wide })).toBe(LAYOUTS.and);
});
