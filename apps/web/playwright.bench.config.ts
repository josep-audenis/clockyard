import { defineConfig, devices } from "@playwright/test";

// Browser benchmarks (ADR 0030): the production build, one page at a time so timings do not compete. Run with
// `pnpm bench` at the repository root, which builds and generates the circuits first. Not part of `pnpm verify`.
const port = 4318;

export default defineConfig({
  testDir: "bench",
  testMatch: "*.bench.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  // Every circuit's row is written as it is measured; this gathers them into one table at the end.
  globalTeardown: "./bench/summary.ts",
  use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 800 } },
  webServer: { command: `pnpm exec vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: false },
});
