// Browser timings of the benchmark circuits (ADR 0030), on the production build: `pnpm bench` at the repository root.
// Each circuit is opened with Import in a fresh page, then a switch is toggled, a part dragged, the view panned, the
// clock run, and the autosave timed. Wall times are measured here; where the time goes comes from the app's own
// `clockyard:` User Timing measures, which it records only with `?bench`. Each circuit's row is written to
// benchmarks/generated/browser/<name>.json as soon as it is measured; `bench/summary.ts` gathers them into a Markdown
// table for docs/performance.md. BENCH_SIZES=1k,10k limits the sizes run.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const generated = fileURLToPath(new URL("../../../benchmarks/generated/", import.meta.url));
const ORIGIN = 48;
const CELL = 16;

/** Where to grab a part to drag, and a switch to click, by family: grid points inside a part's body. */
const PLACES: Record<string, { drag: [number, number]; toggle?: [number, number]; switch?: string }> = {
  chain: { drag: [7.5, 1], toggle: [1, 1], switch: "Switch 1" },
  fanout: { drag: [7.5, 1], toggle: [1, 1], switch: "Switch 1" },
  // The carry-in switch comes first, so the one clicked, A0, reads as Switch 2.
  adder: { drag: [1, 7], toggle: [1, 1], switch: "Switch 2" },
  counters: { drag: [8, 2] },
  cpu: { drag: [1, 1] },
};

export type Row = {
  name: string;
  /** The run it came from (`bench/setup.ts`): a table gathers one run only. */
  run: string;
  /** The WebGL renderer the page drew with. */
  renderer: string | null;
  openMs: number | null;
  /** Of the open: routing every wire, and drawing, both on the main thread. */
  openRouteMs: number | null;
  openDrawMs: number | null;
  toggleMs: number | null;
  dragDrawMs: number | null;
  dragSyncMs: number | null;
  panFps: number | null;
  cyclesPerSecond: number | null;
  saveMs: number | null;
  /** Steps that failed or were skipped, and why: a missing number is never silent. */
  notes: string[];
};
const rows = `${generated}browser/`;
const sizes = process.env.BENCH_SIZES?.split(",");

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

/** Durations of the app's `clockyard:<name>` measures, cleared after reading. */
const measures = (page: Page, name: string) =>
  page.evaluate((n) => {
    const durations = performance.getEntriesByName(`clockyard:${n}`).map((e) => e.duration);
    performance.clearMeasures(`clockyard:${n}`);
    return durations;
  }, name);

/** Waits, frame by frame, until the page shows `predicate`; how long that took, in ms. */
async function until(page: Page, predicate: () => boolean, timeout: number): Promise<number> {
  const start = Date.now();
  await page.waitForFunction(predicate, null, { polling: "raf", timeout });
  return Date.now() - start;
}

const files = (() => {
  try {
    return readdirSync(generated)
      .filter((f) => f.endsWith(".clockyard.json"))
      .map((f) => f.replace(".clockyard.json", ""))
      .filter((f) => !sizes || sizes.includes(f.split("-")[1] ?? ""))
      .sort((a, b) => {
        const [fa, sa] = a.split("-");
        const [fb, sb] = b.split("-");
        return (fa ?? "").localeCompare(fb ?? "") || parseInt(sa ?? "0") - parseInt(sb ?? "0");
      });
  } catch {
    throw new Error("No benchmark circuits: run `node scripts/benchmarks.mjs --all` first (pnpm bench does).");
  }
})();

/** The run this process belongs to, stamped on every row (`bench/setup.ts`), so a table never mixes runs. */
const RUN = process.env.BENCH_RUN ?? "unstamped";

/** The first line of a failure, for a row's notes. */
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "failed";

for (const name of files) {
  test(name, async ({ page }) => {
    test.setTimeout(2_400_000);
    const [family = "", size = ""] = name.split("-");
    const places = PLACES[family] ?? { drag: [1, 1] };
    const row: Row = {
      name,
      run: RUN,
      renderer: null,
      openMs: null,
      openRouteMs: null,
      openDrawMs: null,
      toggleMs: null,
      dragDrawMs: null,
      dragSyncMs: null,
      panFps: null,
      cyclesPerSecond: null,
      saveMs: null,
      notes: [],
    };
    // Written after every step, so a step that times out keeps what came before it.
    mkdirSync(rows, { recursive: true });
    const keep = () => writeFileSync(`${rows}${name}.json`, JSON.stringify(row));
    const sum = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) : null);
    /** A step whose failure is a note in the row, not a lost run: the steps after it still run. */
    const step = async (what: string, f: () => Promise<void>) => {
      try {
        await f();
      } catch (error) {
        row.notes.push(`${what}: ${firstLine(error)}`);
      }
      keep();
    };
    keep();
    await page.goto("/?bench");
    await expect(page.getByRole("status")).toContainText(/No circuit|Settled/);
    // The WebGL renderer: a software one (SwiftShader) makes every frame slower than a graphics card would.
    row.renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
    });
    const box = await page.getByRole("main", { name: "Circuit canvas" }).boundingBox();
    if (!box) throw new Error("canvas not visible");
    const at = (x: number, y: number) => ({ x: box.x + ORIGIN + x * CELL, y: box.y + ORIGIN + y * CELL });

    // Open: from choosing the file until the engine has answered the load and settled it (`clockyard:engine-ready`,
    // recorded when the first state after the load arrives), and two frames have been drawn since.
    await page.evaluate(() => performance.clearMeasures());
    const opening = Date.now();
    await page.locator('[data-testid="import-file"]').setInputFiles(`${generated}${name}.clockyard.json`);
    try {
      await until(page, () => performance.getEntriesByName("clockyard:engine-ready").length > 0, 900_000);
    } catch {
      row.notes.push("did not open within 15 minutes");
      return keep();
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    row.openMs = Date.now() - opening;
    row.openRouteMs = sum(await measures(page, "route"));
    row.openDrawMs = sum(await measures(page, "draw"));
    keep();
    if (await page.getByRole("status").getByText("Invalid").count()) {
      row.notes.push((await page.locator(".status-message").textContent()) ?? "invalid");
      return keep();
    }
    // Every later step took minutes at the largest size when this was written; opening is the measurement that matters there.
    if (size === "50k") {
      row.notes.push("opening only at this size");
      return keep();
    }

    // Toggle: a click on a switch until the readout says it is on, which follows the engine's settle (the readout is
    // React's, so the canvas's redraw is not included).
    if (places.toggle && places.switch) {
      const toggle = places.toggle;
      await step("toggle", async () => {
        // The readout is for screen readers, so hidden: attached is what counts.
        const on = page.getByRole("list", { name: "Inputs and outputs" }).locator("li", { hasText: `${places.switch}: on` });
        const t = at(...toggle);
        const start = Date.now();
        await page.mouse.click(t.x, t.y);
        await on.waitFor({ state: "attached", timeout: 300_000 });
        row.toggleMs = Date.now() - start;
      });
    }

    // Drag: a part moved by two cells in ten steps; each step costs a sync (geometry only) and a redraw. Then the
    // autosave the move causes: no save means the drag changed nothing, and its numbers would measure something else.
    await step("drag", async () => {
      await measures(page, "draw");
      await measures(page, "sync");
      await measures(page, "save");
      const grab = at(...places.drag);
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await page.mouse.move(grab.x, grab.y + 2 * CELL, { steps: 10 });
      await page.mouse.up();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      row.dragDrawMs = median(await measures(page, "draw"));
      row.dragSyncMs = median(await measures(page, "sync"));
      keep();
      // A save that changes nothing (the open's own) is recorded too; this waits for one that wrote the move.
      await expect(page.locator(".status-save")).toHaveText(/^Saved /, { timeout: 300_000 });
      row.saveMs = Math.max(...(await measures(page, "save")));
    });

    // Pan: a middle-button drag across the canvas; frames counted while it moves.
    await step("pan", async () => {
      const from = at(30, 20);
      await page.evaluate(() => {
        const w = window as unknown as { frames_: number[]; panning: boolean };
        w.frames_ = [];
        w.panning = true;
        const tick = (t: number) => {
          w.frames_.push(t);
          if (w.panning) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button: "middle" });
      for (let i = 1; i <= 30; i++) await page.mouse.move(from.x + i * 8, from.y + i * 4);
      await page.mouse.up({ button: "middle" });
      const frames = await page.evaluate(() => {
        const w = window as unknown as { frames_: number[]; panning: boolean };
        w.panning = false;
        return w.frames_;
      });
      const gap = median(frames.slice(1).map((t, i) => t - (frames[i] ?? t)));
      row.panFps = gap ? 1000 / gap : null;
    });

    // Run: at the top speed for two seconds, where the circuit has a clock. The elapsed time includes the clicks'
    // round trips, so the rate reads a few per cent low.
    const counter = page.getByText(/^Cycle \d+, clock (high|low)$/);
    if (await counter.count()) {
      await step("run", async () => {
        const cycle = async () => Number(/Cycle (\d+)/.exec(await counter.innerText())?.[1]);
        await page.getByLabel("Speed").selectOption("10000");
        const before = await cycle();
        const start = Date.now();
        await page.getByRole("button", { name: "Run", exact: true }).click({ timeout: 300_000 });
        await page.waitForTimeout(2000);
        await page.getByRole("button", { name: "Pause", exact: true }).click({ timeout: 300_000 });
        await expect(page.getByRole("status")).not.toContainText("Running", { timeout: 300_000 });
        const after = await cycle();
        row.cyclesPerSecond = (after - before) / ((Date.now() - start) / 1000);
      });
    }
  });
}
