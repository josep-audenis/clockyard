// Before a benchmark run: an empty row directory, and a stamp every row carries, so the table and the results gather
// this run only, never rows left by an earlier or narrower one.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function setup() {
  rmSync(fileURLToPath(new URL("../../../benchmarks/generated/browser/", import.meta.url)), { recursive: true, force: true });
  // Set here, it reaches the test workers.
  process.env.BENCH_RUN = new Date().toISOString();
}
