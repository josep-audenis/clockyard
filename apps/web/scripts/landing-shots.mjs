// Screenshots of the real editor for the landing page (apps/web/about/).
// Every image is the app itself running the shipped examples: no mock-ups.
// Usage, with a dev server running: node scripts/landing-shots.mjs [baseURL]
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const out = (name) => fileURLToPath(new URL(`../about/shots/${name}.png`, import.meta.url));
const example = (name) => fileURLToPath(new URL(`../../../examples/${name}.clockyard.json`, import.meta.url)); // "../challenges/..." reaches a solution
// Must match the canvas defaults in src/canvas/scene.ts (as in e2e/editor.e2e.ts).
const ORIGIN = 48;
const CELL = 16;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const button = (name) => page.getByRole("button", { name, exact: true });
const inspector = () => page.getByRole("complementary", { name: "Inspector" });
const settle = () => page.waitForTimeout(400);

async function open(name) {
  await page.goto(base);
  await page.locator('[data-testid="import-file"]').setInputFiles(example(name));
  await page.getByRole("status").filter({ hasText: /^(?!No circuit)/ }).waitFor();
  await settle();
}
async function at(x, y) {
  const box = await page.getByRole("main", { name: "Circuit canvas" }).boundingBox();
  return { x: box.x + ORIGIN + x * CELL, y: box.y + ORIGIN + y * CELL };
}
async function click(x, y) {
  const p = await at(x, y);
  await page.mouse.click(p.x, p.y);
}
async function shot(name, clip) {
  await page.mouse.move(1, 1);
  await settle();
  await page.screenshot({ path: out(name), clip });
  console.log("wrote", out(name));
}

// 4-bit adder: 5 + 3 + 1 = 9, lit wires through four full-adder instances.
await open("4-bit-adder");
for (const [x, y] of [[1, 1], [1, 21], [5, 4], [5, 14], [1, 7]]) await click(x, y);
await click(30, 40); // empty canvas: clear the selection
await shot("adder");

// Waveforms: the 8-bit counter, clock and register watched, stepped.
await open("8-bit-counter");
await click(1, 7); // Count on
await click(18, 9);
await inspector().getByRole("button", { name: "Watch", exact: true }).click();
await click(28, 1);
await inspector().getByRole("button", { name: "Watch", exact: true }).click();
for (let i = 0; i < 20; i++) await button("Step").click();
await shot("waveforms-circuit", { x: 232, y: 45, width: 700, height: 250 });
const waves = page.getByRole("region", { name: "WAVEFORMS" });
await shot("waveforms", await waves.boundingBox());

// Program editor: the reference CPU's ROM selected, its assembly and disassembly.
await open("reference-cpu");
await click(24.5, 16);
await inspector().getByLabel("Assembly", { exact: true }).waitFor();
await shot("program");

// Catch running on the reference CPU: its screen, digits and keyboard at 100%.
await open("catch");
await page.getByLabel("Speed").selectOption("10000");
await button("Run").click();
await page.waitForTimeout(4500);
await shot("catch", { x: 248, y: 70, width: 760, height: 410 });
await button("Fit").click();
await shot("cpu");

// A challenge: the reference full adder, checked by the engine.
await page.goto(base);
await page.locator('[data-testid="import-file"]').setInputFiles(example("../challenges/solutions/04-full-adder"));
const challenge = page.getByRole("region", { name: "CHALLENGE", exact: true });
await challenge.getByRole("button", { name: "Open Full adder" }).click();
await challenge.getByRole("button", { name: "Check" }).click();
await page.getByText(/^Passed/).waitFor();
await shot("challenge-circuit", { x: 232, y: 45, width: 560, height: 260 });
await shot("challenge", await challenge.boundingBox());

await browser.close();
