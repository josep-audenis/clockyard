import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { catalog, initSync } from "../generated/sim-wasm/sim_wasm.js";
import { LAYOUTS } from "./layout";

type Part = { kind: string; inputs: string[]; outputs: string[] };

test("every engine catalog kind has a layout with the same ports", () => {
  initSync({ module: readFileSync(new URL("../generated/sim-wasm/sim_wasm_bg.wasm", import.meta.url)) });
  const parts = JSON.parse(catalog()) as Part[];
  const fromLayouts = Object.entries(LAYOUTS).map(([kind, layout]) => ({
    kind,
    inputs: Object.keys(layout.inputs),
    outputs: Object.keys(layout.outputs),
  }));
  expect(fromLayouts).toEqual(parts);
});
