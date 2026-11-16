// Gathers the rows `browser.bench.ts` wrote into one table for docs/performance.md, and into
// benchmarks/generated/browser-results.json; run by Playwright once every benchmark has run, failed or not.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Row } from "./browser.bench";

export default function summary() {
  const generated = fileURLToPath(new URL("../../../benchmarks/generated/", import.meta.url));
  let names: string[];
  try {
    names = readdirSync(`${generated}browser/`).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  const order = (name: string) => {
    const [family = "", size = "0"] = name.split("-");
    return [family, parseInt(size)] as const;
  };
  const rows = names
    .map((f) => JSON.parse(readFileSync(`${generated}browser/${f}`, "utf8")) as Row)
    .filter((row) => row.run === process.env.BENCH_RUN)
    .sort((a, b) => order(a.name)[0].localeCompare(order(b.name)[0]) || order(a.name)[1] - order(b.name)[1]);
  writeFileSync(`${generated}browser-results.json`, `${JSON.stringify(rows, null, 2)}\n`);
  const n = (v: number | null, digits = 0) => (v === null ? "–" : v.toFixed(digits));
  const renderers = [...new Set(rows.map((r) => r.renderer ?? "unknown"))];
  const lines = [
    "| Benchmark | Open, ms | Of it: routing, ms | Of it: drawing, ms | Toggle, ms | Drag: draw, ms | Drag: sync, ms | Pan, fps | Cycles per second | Autosave, ms |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(
      (r) =>
        `| ${r.name}${r.notes.length ? ` (${r.notes.join("; ")})` : ""} | ${n(r.openMs)} | ${n(r.openRouteMs)} | ${n(r.openDrawMs)} | ${n(r.toggleMs)} | ${n(r.dragDrawMs, 1)} | ${n(r.dragSyncMs, 1)} | ${n(r.panFps, 1)} | ${n(r.cyclesPerSecond)} | ${n(r.saveMs)} |`,
    ),
    "",
    `Run ${process.env.BENCH_RUN ?? "unstamped"}; WebGL renderer: ${renderers.join(", ")}.`,
  ];
  console.log(`\n${lines.join("\n")}\n`);
}
