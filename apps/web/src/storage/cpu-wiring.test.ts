// ADR 0039: laying the reference CPUs out in regions moves parts and wires, never connections. The fixture records,
// for each example, which ports the engine puts on one net, and what it reports, from before the relayout; the files
// now must give the same. CLOCKYARD_RECORD_WIRING=1 writes the fixture again, for a change that means to rewire.
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Engine, initSync } from "../generated/sim-wasm/sim_wasm.js";
import { project } from "../editor/document";
import { parseDocument } from "./file";

initSync({ module: readFileSync(new URL("../generated/sim-wasm/sim_wasm_bg.wasm", import.meta.url)) });

const EXAMPLES = ["reference-cpu", "catch", "reference-cpu-2", "catch-2"];
const FIXTURE = new URL("./fixtures/cpu-wiring.json", import.meta.url);

/** The example's ports grouped by the net the engine puts them on, each group and the list sorted; and its diagnostics. */
function wiring(name: string) {
  const parsed = parseDocument(readFileSync(new URL(`../../../../examples/${name}.clockyard.json`, import.meta.url), "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  const { circuit, definitions } = parsed.document;
  const loaded = JSON.parse(new Engine().load(JSON.stringify(project(circuit, definitions)), false)) as {
    portNets: Record<string, Record<string, number>>;
    diagnostics: { code: string }[];
  };
  const nets = new Map<number, string[]>();
  for (const [part, ports] of Object.entries(loaded.portNets)) {
    for (const [port, net] of Object.entries(ports)) nets.set(net, [...(nets.get(net) ?? []), `${part}.${port}`]);
  }
  const groups = [...nets.values()].map((g) => g.sort()).sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
  return { nets: groups, diagnostics: loaded.diagnostics.map((d) => d.code).sort() };
}

test("the reference CPUs' connections are what they were before the relayout (ADR 0039)", () => {
  const now = Object.fromEntries(EXAMPLES.map((name) => [name, wiring(name)]));
  if (process.env.CLOCKYARD_RECORD_WIRING) writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`);
  expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
});
