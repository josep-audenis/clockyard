// Timings for the browser benchmarks (ADR 0030). Recorded only when the page's address has `?bench`, as User Timing
// measures named `clockyard:…` that `bench/browser.bench.ts` reads; otherwise each call costs one boolean check, and
// nothing accumulates in a long session.
export const benchmarking = typeof location !== "undefined" && new URLSearchParams(location.search).has("bench");

/** Runs `f`, recording how long it took as `clockyard:<name>` when benchmarking. */
export function timed<T>(name: string, f: () => T): T {
  if (!benchmarking) return f();
  const start = performance.now();
  try {
    return f();
  } finally {
    performance.measure(`clockyard:${name}`, { start, end: performance.now() });
  }
}

/** Records the time since `start` (a `performance.now()`) as `clockyard:<name>` when benchmarking. */
export function since(name: string, start: number) {
  if (benchmarking) performance.measure(`clockyard:${name}`, { start, end: performance.now() });
}
