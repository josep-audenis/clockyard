// Screenshots of the real editor for the about page (apps/web/about/), in both
// themes, and the example links its figures open. Every image is the app itself
// running a shipped example: no mock-ups.
// Usage, with a dev server running: node scripts/landing-shots.mjs [baseURL]
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const example = (name) => here(`../../../examples/${name}.clockyard.json`);
const solution = (name) => here(`../../../challenges/solutions/${name}.clockyard.json`);
// Must match the canvas defaults in src/canvas/scene.ts (as in e2e/editor.e2e.ts).
const ORIGIN = 48;
const CELL = 16;

const browser = await chromium.launch();
const links = {};

async function session(theme, viewport = { width: 1440, height: 900 }, scale = 2) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: theme });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const button = (name) => page.getByRole("button", { name, exact: true });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const readout = (name) => page.getByRole("list", { name: "Inputs and outputs" }).getByText(new RegExp(`^${name}:`));
  const at = async (x, y) => {
    const box = await page.getByRole("main", { name: "Circuit canvas" }).boundingBox();
    return { x: box.x + ORIGIN + x * CELL, y: box.y + ORIGIN + y * CELL };
  };
  const click = async (x, y) => {
    const p = await at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const open = async (file) => {
    await page.goto(base);
    await page.locator('[data-testid="import-file"]').setInputFiles(file);
    await page.waitForFunction((file) => document.querySelector(".project-name")?.value === file, JSON.parse(readFileSync(file, "utf8")).metadata.name);
    await page.waitForTimeout(300);
  };
  const shot = async (name, clip) => {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(250);
    const path = here(`../about/shots/${name}-${theme}.png`);
    await page.screenshot({ path, clip });
    console.log("wrote", path);
  };
  const link = async (name) => {
    if (theme !== "dark") return;
    await button("Copy link").click();
    await page.waitForTimeout(200);
    links[name] = new URL(await page.evaluate(() => navigator.clipboard.readText())).hash.slice(1);
  };
  return { context, page, button, inspector, readout, click, open, shot, link };
}

for (const theme of ["dark", "light"]) {
  const s = await session(theme);
  const { page, button, inspector, click, open, shot, link } = s;

  // Half adder, as the live figure's poster: the frame is 1180 x 620.
  await page.setViewportSize({ width: 1180, height: 620 });
  await open(example("half-adder"));
  await button("Fit").click(); // as the page does once the live editor loads
  await shot("live");
  await link("half-adder"); // after the shot: Copy link shows a notice in the toolbar
  await page.setViewportSize({ width: 1440, height: 900 });

  // 4-bit adder: 5 + 3 + 1 = 9, lit wires through four full-adder instances.
  await open(example("4-bit-adder"));
  await link("4-bit-adder");
  for (const [x, y] of [[1, 1], [1, 21], [5, 4], [5, 14], [1, 7]]) await click(x, y);
  await click(30, 40); // empty canvas: clear the selection
  await shot("adder", { x: 248, y: 60, width: 520, height: 640 });

  // Waveforms: the 8-bit counter, clock and register watched, stepped twelve cycles.
  await open(example("8-bit-counter"));
  await link("8-bit-counter");
  await click(1, 7); // Count on
  await click(18, 9);
  await inspector.getByRole("button", { name: "Watch", exact: true }).click();
  await click(28, 1);
  await inspector.getByRole("button", { name: "Watch", exact: true }).click();
  for (let i = 0; i < 12; i++) await button("Step").click();
  await click(30, 30); // empty canvas: clear the selection
  await shot("waveforms-circuit", { x: 232, y: 45, width: 700, height: 250 });
  const waves = await page.getByRole("region", { name: "WAVEFORMS" }).boundingBox();
  await shot("waveforms", { ...waves, width: 520 });

  // The program editor: the count-down example from docs/reference-cpu.md, assembled.
  await open(example("reference-cpu"));
  await click(24.5, 16);
  const source = inspector.getByLabel("Assembly", { exact: true });
  await source.fill(
    ["; count down from 10", "        LDI 10", "loop:   OUT", "        SBI 1", "        JZ done", "        JMP loop", "done:   OUT", "        HLT"].join("\n"),
  );
  await page.setViewportSize({ width: 1440, height: 1300 }); // room for the whole listing
  await button("Assemble").click();
  await page.waitForTimeout(300);
  const label = await inspector.getByText("Assembly", { exact: true }).boundingBox();
  const listing = await inspector.getByRole("region", { name: "Disassembly" }).boundingBox();
  const side = await inspector.boundingBox();
  await shot("program", { x: side.x, y: label.y - 12, width: side.width, height: listing.y + listing.height + 12 - (label.y - 12) });
  await page.setViewportSize({ width: 1440, height: 900 });

  await open(example("catch"));
  await link("catch");

  // A challenge: the reference full adder, A and Cin on, checked by the engine.
  await open(solution("04-full-adder"));
  const challenge = page.getByRole("region", { name: "CHALLENGE", exact: true });
  await challenge.getByRole("button", { name: "Open Full adder" }).click();
  await page.waitForTimeout(300);
  await click(1, 1);
  await click(1, 9);
  await click(30, 30); // empty canvas: clear the selection
  await challenge.getByRole("button", { name: "Check" }).click();
  await page.getByText(/^Passed/).waitFor();
  await shot("challenge-circuit", { x: 232, y: 45, width: 560, height: 260 });
  const panel = await challenge.boundingBox();
  await shot("challenge", panel);
  await s.context.close();

  // The whole CPU, running, fitted to a wide canvas.
  const wide = await session(theme, { width: 2560, height: 1240 }, 1.5);
  await wide.open(example("catch"));
  await wide.page.getByLabel("Speed").selectOption("10000");
  await wide.button("Fit").click();
  await wide.button("Run").click();
  await wide.page.waitForTimeout(4000);
  await wide.button("Pause").click();
  await wide.page.addStyleTag({ content: ".zoom-controls { visibility: hidden; }" }); // view chrome, not circuit
  const canvas = await wide.page.getByRole("main", { name: "Circuit canvas" }).boundingBox();
  await wide.shot("cpu", canvas);
  await wide.context.close();
}
// The hero: Catch running, as a short VP9 loop at the page's 2x scale. Playwright's own video
// is 1x, so this samples frames instead: run in short slices at 1,000 Hz, pause, read the cycle
// counter and take a JPEG. The frames are then laid on a timeline of 10,000 cycles a second.
// shortcut: relies on Playwright's bundled ffmpeg (image2pipe, mjpeg, libvpx-vp9); swap in a system ffmpeg if it stops.
const root = dirname(dirname(dirname(chromium.executablePath())));
const ffmpegDir = readdirSync(root).filter((d) => d.startsWith("ffmpeg-")).sort().pop();
const ffmpeg = join(root, ffmpegDir, readdirSync(join(root, ffmpegDir)).find((f) => f.startsWith("ffmpeg")));
for (const theme of ["dark", "light"]) {
  const { context, page, button, readout, open } = await session(theme);
  await open(example("catch"));
  await page.getByLabel("Speed").selectOption("1000");
  const clip = { x: 270, y: 80, width: 730, height: 390 }; // the keyboard, the digits and the screen
  const frames = [];
  let caught = -1;
  while (frames.length < 900) {
    await button("Run").click();
    await button("Pause").click();
    // Every frame at the same phase, the start of a fetch with the clock low, so the wiring does not strobe.
    for (let i = 0; i < 4; i++) {
      const phase = `${await page.getByText(/^Cycle \d+,/).textContent()} ${await readout("LED Fetch").textContent()}`;
      if (phase.includes("clock low") && phase.endsWith("on")) break;
      await button("Step").click();
    }
    await page.mouse.move(1, 1);
    const cycle = Number((await page.getByText(/^Cycle \d+,/).textContent()).match(/\d+/)[0]);
    frames.push({ cycle, jpeg: await page.screenshot({ clip, type: "jpeg", quality: 94 }) });
    if (caught < 0 && (await readout("Seven-segment Low").textContent()).includes("(0x06)")) caught = frames.length;
    if (caught >= 0 && frames.length > caught + 2) break;
  }
  await context.close();
  const timeline = [];
  for (let t = frames[0].cycle, i = 0; t < frames.at(-1).cycle; t += 500) {
    while (i + 1 < frames.length && frames[i + 1].cycle <= t) i++;
    timeline.push(frames[i].jpeg);
  }
  for (let hold = 0; hold < 30; hold++) timeline.push(frames.at(-1).jpeg); // a beat and a half on the new score before the loop restarts
  const dir = mkdtempSync(join(tmpdir(), "clockyard-loop-"));
  const input = join(dir, "frames.mjpeg");
  writeFileSync(input, Buffer.concat(timeline));
  const out = here(`../about/shots/hero-loop-${theme}`);
  // 20 frames a second, 500 cycles apart: 10,000 cycles a second, the speed setting the game uses.
  execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "20", "-i", input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-pix_fmt", "yuv420p", "-an", `${out}.webm`]);
  writeFileSync(`${out}.jpg`, timeline[Math.floor(timeline.length * 0.4)]); // poster: the block mid-fall
  rmSync(dir, { recursive: true });
  console.log("wrote", `${out}.webm`, timeline.length, "frames");
}
await browser.close();

// Point each link to an example at it: <a data-example="name" href="...">.
const html = here("../about/index.html");
let page = readFileSync(html, "utf8");
for (const [name, fragment] of Object.entries(links)) {
  page = page.replace(new RegExp(`(data-example="${name}"[^>]*?(?:href|data-src)=")[^"]*`, "g"), (_, attr) => `${attr}../#${fragment}`);
}
writeFileSync(html, page);
console.log("links:", Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.length])));
