// Compares the last browser benchmark run (benchmarks/generated/browser-results.json, written by `pnpm bench`) with
// the recorded baseline (benchmarks/browser-baseline.json), and fails on a regression (ADR 0030 item 6):
//   - a measurement more than twice as bad, and worse by more than 5 ms (or 5 frames or cycles a second), since
//     timings vary by 10-30 % between runs and sub-millisecond ones by more;
//   - a measurement the baseline has that the run lost (a step that now fails or times out);
//   - a benchmark the baseline has that the run did not measure is reported, not failed: BENCH_SIZES may skip it.
// The baseline is from the machine named in docs/performance.md; comparing another machine's run means little.
//
//   node scripts/bench-check.mjs            compare
//   node scripts/bench-check.mjs --update   make the last run the baseline (one run's rows only)
import { copyFileSync, readFileSync } from "node:fs";

const root = (path) => new URL(`../${path}`, import.meta.url);
const run = root("benchmarks/generated/browser-results.json");
const baseline = root("benchmarks/browser-baseline.json");
const read = (url) => JSON.parse(readFileSync(url, "utf8"));
if (process.argv.includes("--update")) {
  const runs = new Set(read(run).map((row) => row.run));
  if (runs.size !== 1) {
    console.error(`The last results mix ${runs.size} runs; run \`pnpm bench\` again before making them the baseline.`);
    process.exit(1);
  }
  copyFileSync(run, baseline);
  console.log("benchmarks/browser-baseline.json updated from the last run.");
  process.exit(0);
}
const before = new Map(read(baseline).map((row) => [row.name, row]));
// Times: more is worse. Rates: less is worse.
const RATES = new Set(["panFps", "cyclesPerSecond"]);
const FLOOR = 5;
const failures = [];
const compared = new Set();
for (const row of read(run)) {
  const old = before.get(row.name);
  if (!old) continue;
  compared.add(row.name);
  for (const [key, was] of Object.entries(old)) {
    if (typeof was !== "number") continue;
    const value = row[key];
    if (typeof value !== "number") {
      failures.push(`${row.name} ${key}: measured ${was.toFixed(1)} before, nothing now (${row.notes?.join("; ") || "no note"}).`);
      continue;
    }
    const rate = RATES.has(key);
    const ratio = rate ? (value === 0 ? Infinity : was / value) : was === 0 ? (value === 0 ? 1 : Infinity) : value / was;
    if (ratio > 2 && Math.abs(value - was) > FLOOR) {
      failures.push(`${row.name} ${key}: ${value.toFixed(1)} against ${was.toFixed(1)}, ${ratio === Infinity ? "far" : `${ratio.toFixed(1)} times`} worse.`);
    }
  }
}
const skipped = [...before.keys()].filter((name) => !compared.has(name));
if (skipped.length) console.log(`Not measured in this run, so not compared: ${skipped.join(", ")}.`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
console.log(`${compared.size} benchmarks compared: none regressed.`);
