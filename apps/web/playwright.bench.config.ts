import { defineConfig, devices } from "@playwright/test";

// Browser benchmarks (ADR 0030): the production build, one page at a time so timings do not compete. Run with
// `pnpm bench` at the repository root, which builds and generates the circuits first; run directly, this serves
// whatever `dist` holds, which may be an older build. Not part of `pnpm verify`.
const port = 4318;

export default defineConfig({
  testDir: "bench",
  testMatch: "*.bench.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  // A clean row directory and a run stamp first; every circuit's row is written as it is measured, and gathered into
  // one table at the end.
  globalSetup: "./bench/setup.ts",
  globalTeardown: "./bench/summary.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    // The graphics card, as a user's browser has it: headless Chromium otherwise draws with SwiftShader, a software
    // WebGL that makes every frame several times slower. The row records the renderer the page got.
    launchOptions: { args: ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])] },
  },
  webServer: { command: `pnpm exec vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: false },
});
