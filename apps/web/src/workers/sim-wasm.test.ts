import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { and_gate, initSync } from "../generated/sim-wasm/sim_wasm.js";

test("built sim-wasm module evaluates AND through the boundary", () => {
  initSync({ module: readFileSync(new URL("../generated/sim-wasm/sim_wasm_bg.wasm", import.meta.url)) });
  expect([and_gate(false, false), and_gate(false, true), and_gate(true, false), and_gate(true, true)]).toEqual([
    false,
    false,
    false,
    true,
  ]);
});
