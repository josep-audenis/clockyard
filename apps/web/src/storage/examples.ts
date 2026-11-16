// The bundled examples (examples/, ADR 0027), in the order the Examples list shows them, from a gate to a game.
// Each file is loaded only when opened, so they add nothing to the editor's first load.
import type { CircuitDocument } from "../editor/document";
import { parseDocument } from "./file";

const files = import.meta.glob<string>("../../../../examples/*.clockyard.json", { query: "?raw", import: "default" });

/** `name`: the file name without `.clockyard.json`; `title`: the file's own name. examples.test.ts holds both to the files. */
export const EXAMPLES = [
  { name: "and-gate", title: "AND gate" },
  { name: "cascade-fanout", title: "Cascade with fan-out" },
  { name: "half-adder", title: "Half adder" },
  { name: "4-bit-adder", title: "4-bit adder" },
  { name: "8-bit-adder", title: "8-bit adder" },
  { name: "8-bit-counter", title: "8-bit counter" },
  { name: "devices", title: "Devices" },
  { name: "reference-cpu", title: "Reference CPU" },
  { name: "catch", title: "Catch" },
] as const;

/** Every bundled example's file name, as found, for the test that every one is listed. */
export const exampleFiles = () => Object.keys(files).map((path) => path.slice(path.lastIndexOf("/") + 1, -".clockyard.json".length));

/** An example, read as Import reads a file, dated now. */
export async function exampleDocument(name: string, now = new Date().toISOString()): Promise<CircuitDocument> {
  const load = Object.entries(files).find(([path]) => path.endsWith(`/${name}.clockyard.json`))?.[1];
  if (!load) throw new Error(`There is no example ${name}.`);
  const result = parseDocument(await load());
  if (!result.ok) throw new Error(`The example ${name} does not open: ${result.error}`);
  return { ...result.document, metadata: { ...result.document.metadata, createdAt: now, modifiedAt: now } };
}
