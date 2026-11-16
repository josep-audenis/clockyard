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
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: theme, locale: "en-GB" });
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
  const drag = async (from, to) => {
    const a = await at(...from);
    const b = await at(...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  page.on("dialog", (dialog) => void dialog.accept()); // "Replace the current circuit?" when an example or challenge opens
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
  return { context, page, button, inspector, readout, click, drag, open, shot, link };
}

for (const theme of ["dark", "light"]) {
  const s = await session(theme);
  const { page, button, inspector, click, drag, open, shot, link } = s;

  // Half adder, as the live figure's poster: the frame is 1180 x 620.
  await page.setViewportSize({ width: 1180, height: 620 });
  await open(example("half-adder"));
  await button("Fit").click(); // as the page does once the live editor loads
  await shot("live");
  await page.addStyleTag({ content: ".zoom-controls { visibility: hidden; }" }); // view chrome, unreadable at phone size
  await shot("live-narrow", { x: 232, y: 45, width: 668, height: 548 }); // the canvas alone, for phones
  await link("half-adder"); // after the shot: Copy link shows a notice in the toolbar
  await page.setViewportSize({ width: 1440, height: 900 });

  // 4-bit adder: 5 + 3 + 1 = 9, lit wires through four full-adder instances.
  await open(example("4-bit-adder"));
  await link("4-bit-adder");
  for (const [x, y] of [[1, 1], [1, 21], [5, 4], [5, 14], [1, 7]]) await click(x, y);
  await click(30, 40); // empty canvas: clear the selection
  await shot("adder", { x: 248, y: 60, width: 520, height: 770 }); // down to the Cout LED

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
  // Zoomed 1.6x about the counter's top-left corner, so its labels read at the size the page shows them.
  await page.mouse.move(256, 55);
  await page.mouse.wheel(0, -Math.log(1.6) / 0.0015);
  await page.waitForTimeout(300);
  await shot("waveforms-circuit", { x: 256, y: 55, width: Math.round(560 * 1.6), height: Math.round(200 * 1.6) });
  const waves = await page.getByRole("region", { name: "WAVEFORMS" }).boundingBox();
  await shot("waveforms", { ...waves, width: 560 }); // through the current cycle, 0C

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
  const assemble = await inspector.getByRole("button", { name: "Assemble", exact: true }).boundingBox();
  const side = await inspector.boundingBox();
  await shot("program", { x: side.x, y: label.y - 12, width: side.width, height: assemble.y + assemble.height + 14 - (label.y - 12) }); // the source and its result
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
  await shot("challenge-circuit", { x: 232, y: 45, width: 600, height: 260 }); // room past the LEDs for the page's edge fade
  const panel = await challenge.boundingBox();
  await shot("challenge", panel);

  // A failing Check: XOR from NAND gates with A wired straight to Y, so the bench names the step.
  await page.goto(base);
  await page.getByRole("region", { name: "CHALLENGES" }).getByRole("button", { name: "XOR from NAND gates" }).click();
  await page.getByRole("navigation", { name: "Sheet" }).filter({ hasText: "XOR" }).waitFor();
  await drag([2, 1], [36, 1]);
  await click(30, 30);
  await challenge.getByRole("button", { name: "Check" }).click();
  await challenge.locator(".challenge-result").filter({ hasText: /failed/ }).waitFor();
  await shot("check-failed", await challenge.boundingBox());
  await s.context.close();

  // A loop that never settles: a NOR fed back into itself while its other input is 0.
  const loop = await session(theme);
  await loop.page.goto(base);
  const parts = loop.page.getByRole("complementary", { name: "Parts" });
  await parts.getByRole("button", { name: /^Switch\b/ }).click(); // its name includes the shortcut key
  await loop.click(1, 1);
  await parts.getByRole("button", { name: "NOR", exact: true }).click();
  await loop.click(8, 4); // a NOR at (6,2): a (6,3), b (6,5), out (10,4)
  await loop.drag([2, 1], [6, 3]);
  await loop.drag([10, 4], [6, 5]);
  await loop.click(30, 30);
  await loop.page.getByRole("status").filter({ hasText: "Unstable" }).waitFor();
  await loop.shot("unstable-circuit", { x: 240, y: 66, width: 370, height: 160 }); // at the page's canvas scale beside its status line
  const bar = await loop.page.getByRole("status").boundingBox();
  await loop.shot("unstable-status", { x: 0, y: bar.y - 4, width: 490, height: bar.height + 8 }); // the message, not the whole bar
  await loop.context.close();

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
// The hero: Catch being played, as a short VP9 loop. Playwright's own video is at CSS pixels, too
// soft, so this samples frames instead: run in slices of about 500 cycles at 1,000 Hz, pause, step
// to the start of a fetch so every frame is at the same phase, read the cycle counter and crop the
// devices: the score digits, the keyboard and the screen. Between slices the script plays: it reads
// the screen's pixels, holds Left or Right on the keyboard part until the paddle is under the
// block, catches three, then lets one fall, which halts the CPU. The frames are laid on a timeline
// of 10,000 cycles a second.
// shortcut: relies on Playwright's bundled ffmpeg (image2pipe, mjpeg, libvpx-vp9); swap in a system ffmpeg if it stops.
const root = dirname(dirname(dirname(chromium.executablePath())));
const ffmpegDir = readdirSync(root).filter((d) => d.startsWith("ffmpeg-")).sort().pop();
const ffmpeg = join(root, ffmpegDir, readdirSync(join(root, ffmpegDir)).find((f) => f.startsWith("ffmpeg")));
// Reads a screenshot of the screen's pixels (64 x 32, 4 CSS pixels each): which of the 8 lanes holds
// the paddle (row 31) and the block (the first lit row above it), or -1. Lit means the theme's
// signal-high colour.
const sensor = await browser.newPage();
const sense = (png, high, grid) =>
  sensor.evaluate(
    async ([src, high, grid]) => {
      const img = await new Promise((done) => Object.assign(new Image(), { onload: (e) => done(e.target), src }));
      const g = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height }).getContext("2d", { willReadFrequently: true });
      g.fillStyle = high;
      g.fillRect(0, 0, 1, 1);
      const want = g.getImageData(0, 0, 1, 1).data;
      g.drawImage(img, 0, 0);
      const pixels = g.getImageData(0, 0, img.width, img.height).data;
      const lit = (x, y) => {
        const i = 4 * (Math.round(y) * img.width + Math.round(x));
        return Math.abs(pixels[i] - want[0]) + Math.abs(pixels[i + 1] - want[1]) + Math.abs(pixels[i + 2] - want[2]) < 90;
      };
      if (!grid) {
        // Calibration: the lowest lit pixels are the paddle's row, and their left end is lane 3.
        let bottom = -1;
        let left = img.width;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (lit(x, y)) bottom = y;
        for (let x = 0; x < img.width; x++) if (lit(x, bottom - 1)) left = Math.min(left, x);
        return { x: left - 96, y: bottom + 1 - 128 };
      }
      const lane = (row) => [...Array(8).keys()].find((l) => lit(grid.x + l * 32 + 16, grid.y + row * 4 + 2)) ?? -1;
      let block = -1;
      for (let row = 0; row < 31 && block < 0; row++) block = lane(row);
      return { paddle: lane(31), block };
    },
    [`data:image/png;base64,${png.toString("base64")}`, high, grid],
  );
for (const theme of ["dark", "light"]) {
  const { context, page, readout, open, click } = await session(theme, { width: 1440, height: 900 }, 3);
  await open(example("catch"));
  await page.getByLabel("Speed").selectOption("1000");
  // Buttons pressed with a click event alone: a pointer press outside the canvas takes the keys back.
  const press = (name) => page.getByRole("button", { name, exact: true }).dispatchEvent("click");
  const high = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--signal-high").trim());
  const clip = { x: 436, y: 56, width: 564, height: 240 }; // the digits, the keyboard and the screen
  const screenArea = { x: 680, y: 92, width: 305, height: 145 }; // the screen part, for reading its pixels
  await click(14, 10); // the keyboard at (12,9) takes the keys
  let grid = null;
  let held = null;
  const frames = [];
  let halted = -1;
  while (frames.length < 900) {
    await press("Run");
    await page.waitForTimeout(400);
    await press("Pause");
    // Every frame at the same phase, the start of a fetch with the clock low, so the wiring does not strobe.
    for (let i = 0; i < 4; i++) {
      const phase = `${await page.getByText(/^Cycle \d+,/).textContent()} ${await readout("LED Fetch").textContent()}`;
      if (phase.includes("clock low") && phase.endsWith("on")) break;
      await press("Step");
    }
    await page.mouse.move(1, 1);
    const cycle = Number((await page.getByText(/^Cycle \d+,/).textContent()).match(/\d+/)[0]);
    frames.push({ cycle, jpeg: await page.screenshot({ clip, type: "jpeg", quality: 92 }) });
    // Play: steer toward the block until three are caught, then let the next one fall.
    const pixels = await page.screenshot({ clip: screenArea, scale: "css" });
    grid ??= await sense(pixels, high, null);
    const { paddle, block } = await sense(pixels, high, grid);
    const three = (await readout("Seven-segment Low").textContent()).includes("(0x4F)");
    const want = three || block < 0 || paddle < 0 || block === paddle ? null : block < paddle ? "ArrowLeft" : "ArrowRight";
    if (want !== held) {
      if (held) await page.keyboard.up(held);
      if (want) await page.keyboard.down(want);
      held = want;
    }
    if (halted < 0 && (await readout("LED Halted").textContent()).endsWith("on")) halted = frames.length;
    if (halted >= 0) break;
  }
  if (halted < 0) throw new Error("Catch did not end: check the screen reading");
  await context.close();
  const timeline = [];
  for (let t = frames[0].cycle, i = 0; t < frames.at(-1).cycle; t += 500) {
    while (i + 1 < frames.length && frames[i + 1].cycle <= t) i++;
    timeline.push(frames[i].jpeg);
  }
  for (let hold = 0; hold < 40; hold++) timeline.push(frames.at(-1).jpeg); // two seconds on the miss before the loop restarts
  const dir = mkdtempSync(join(tmpdir(), "clockyard-loop-"));
  const input = join(dir, "frames.mjpeg");
  writeFileSync(input, Buffer.concat(timeline));
  const out = here(`../about/shots/hero-loop-${theme}`);
  // 20 frames a second, 500 cycles apart: 10,000 cycles a second, the speed setting the game uses.
  execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "20", "-i", input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-pix_fmt", "yuv420p", "-an", `${out}.webm`]);
  writeFileSync(`${out}.jpg`, timeline[Math.floor(timeline.length * 0.55)]); // poster: mid-game, a block falling
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
