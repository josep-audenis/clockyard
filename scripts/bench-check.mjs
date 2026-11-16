// Compares the last browser benchmark run (benchmarks/generated/browser-results.json, written by `pnpm bench`) with
// the recorded baseline (benchmarks/browser-baseline.json), and fails if any measurement is more than twice as bad
// (ADR 0030 item 6). Timings vary by 10-30 % between runs on one machine, so only large regressions count; the
// baseline is from the machine named in docs/performance.md, and comparing another machine's run means little.
//
//   node scripts/bench-check.mjs            compare
//   node scripts/bench-check.mjs --update   make the last run the baseline
import { copyFileSync, readFileSync } from "node:fs";

const root = (path) => new URL(`../${path}`, import.meta.url);
const run = root("benchmarks/generated/browser-results.json");
const baseline = root("benchmarks/browser-baseline.json");
if (process.argv.includes("--update")) {
  copyFileSync(run, baseline);
  console.log("benchmarks/browser-baseline.json updated from the last run.");
  process.exit(0);
}
const read = (url) => JSON.parse(readFileSync(url, "utf8"));
const before = new Map(read(baseline).map((row) => [row.name, row]));
// Times: more is worse. Rates: less is worse.
const RATES = new Set(["panFps", "cyclesPerSecond"]);
let worse = 0;
for (const row of read(run)) {
  const old = before.get(row.name);
  if (!old) continue;
  for (const [key, value] of Object.entries(row)) {
    const was = old[key];
    if (typeof value !== "number" || typeof was !== "number" || was === 0 || value === 0) continue;
    const ratio = RATES.has(key) ? was / value : value / was;
    if (ratio > 2) {
      console.error(`${row.name} ${key}: ${value.toFixed(1)} against ${was.toFixed(1)}, ${ratio.toFixed(1)} times worse.`);
      worse++;
    }
  }
}
if (worse > 0) process.exit(1);
console.log("No measurement is more than twice as bad as the baseline.");
