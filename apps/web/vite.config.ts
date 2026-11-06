import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Module worker so it can import the wasm-bindgen ES module (ADR 0005).
  worker: { format: "es" },
  test: { environment: "node" },
});
