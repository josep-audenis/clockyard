import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { catalog, initSync } from "../generated/sim-wasm/sim_wasm.js";
import { LAYOUTS, layoutOf } from "./layout";

type Part = { kind: string; inputs: string[]; outputs: string[]; fieldPorts?: { side: "inputs" | "outputs"; prefix: string } };

test("every engine catalog kind has a layout with the same ports", () => {
  initSync({ module: readFileSync(new URL("../generated/sim-wasm/sim_wasm_bg.wasm", import.meta.url)) });
  const all = JSON.parse(catalog()) as Part[];
  const parts = all.filter((p) => !p.fieldPorts).map(({ kind, inputs, outputs }) => ({ kind, inputs, outputs }));
  const fromLayouts = Object.entries(LAYOUTS).map(([kind, layout]) => ({
    kind,
    inputs: Object.keys(layout.inputs),
    outputs: Object.keys(layout.outputs),
  }));
  expect(fromLayouts).toEqual(parts);

  // Splitters and mergers: the fixed ports plus one per field, named by the catalog's rule (ADR 0014).
  const fielded = all.filter((p) => p.fieldPorts);
  expect(fielded.map((p) => p.kind)).toEqual(["split", "merge"]);
  for (const { kind, inputs, outputs, fieldPorts } of fielded) {
    for (const fields of [[1], [4, 4], Array<number>(8).fill(1), [32]]) {
      const layout = layoutOf({ kind: kind as "split", rotation: 0, props: { fields } });
      const named = fields.map((_, i) => `${fieldPorts?.prefix}${i}`);
      const expected = fieldPorts?.side === "inputs" ? { inputs: [...inputs, ...named], outputs } : { inputs, outputs: [...outputs, ...named] };
      expect({ inputs: Object.keys(layout.inputs), outputs: Object.keys(layout.outputs) }, `${kind} ${fields.join()}`).toEqual(expected);
    }
  }
});

test("a splitter or merger is a bar 3 wide and one taller than its fields; its layout follows their count", () => {
  const split = layoutOf({ kind: "split", rotation: 0, props: { fields: [4, 4] } });
  expect(split).toEqual({ width: 3, height: 3, inputs: { in: { x: 0, y: 1 } }, outputs: { f0: { x: 3, y: 1 }, f1: { x: 3, y: 2 } } });
  const merge = layoutOf({ kind: "merge", rotation: 0, props: { fields: Array<number>(8).fill(1) } });
  expect([merge.width, merge.height, merge.outputs.out, merge.inputs.f7]).toEqual([3, 9, { x: 3, y: 1 }, { x: 0, y: 8 }]);
  expect(layoutOf({ kind: "split", rotation: 0, props: { fields: [2, 6] } })).toBe(split);
  expect(layoutOf({ kind: "split", rotation: 0, props: {} }).height).toBe(5);
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

test("a screen grows to fit its picture, 4 pixels a cell, with a RAM's ports and `out` at its top right (ADR 0021)", () => {
  // The tile's screen: 128 words of 8 bits, 32 × 32 pixels.
  const tile = layoutOf({ kind: "screen", rotation: 0, props: { width: 8, addressWidth: 7 } });
  expect(tile).toMatchObject({ width: 11, height: 9, outputs: { out: { x: 11, y: 1 } } });
  expect(tile.inputs).toEqual(LAYOUTS.screen.inputs);
  // A small picture keeps a RAM's 5 × 8 body; a wide one grows sideways.
  expect(layoutOf({ kind: "screen", rotation: 0, props: { addressWidth: 2, columns: 4 } })).toMatchObject({ width: 5, height: 8 });
  expect(layoutOf({ kind: "screen", rotation: 0, props: { width: 8, addressWidth: 7, columns: 64 } })).toMatchObject({ width: 19, height: 8 });
  expect(layoutOf({ kind: "screen", rotation: 90, props: { width: 8, addressWidth: 7 } })).toMatchObject({ width: 9, height: 11 });
});
