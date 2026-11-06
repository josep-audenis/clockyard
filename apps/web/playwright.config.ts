import { defineConfig, devices } from "@playwright/test";

// Browser workflows (docs/architecture.md#testing). Needs the WASM module built
// first (`pnpm wasm`); `pnpm verify` does that before running these.
const port = 4317;

export default defineConfig({
  testDir: "e2e",
  // Not *.test.ts / *.spec.ts, so Vitest leaves these alone.
  testMatch: "*.e2e.ts",
  use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 800 } },
  webServer: { command: `pnpm exec vite --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: false },
});
