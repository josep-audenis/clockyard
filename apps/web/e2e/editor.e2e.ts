import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CircuitDocument } from "../src/editor/document";

// Must match the canvas defaults in src/canvas/scene.ts: view offset and grid cell, in CSS px.
const ORIGIN = 48;
const CELL = 16;

type At = { x: number; y: number };

/**
 * Screen position of a grid point at the view the canvas reports, once it is up to hear clicks there. A document that
 * does not fit the default view opens framed (ADR 0033), so call this after opening one, once it has settled.
 */
async function grid(page: Page): Promise<(x: number, y: number) => At> {
  const host = page.getByRole("main", { name: "Circuit canvas" });
  // Pixi starts asynchronously; its <canvas> goes in with its pointer handlers, so a click before it hits bare <main>.
  await host.locator("canvas").waitFor();
  // The canvas sets its view as a document opens, so it is current once the document shows anywhere.
  const box = await host.boundingBox();
  if (!box) throw new Error("canvas not visible");
  const [x0, y0, zoom] = ((await host.getAttribute("data-view")) ?? `${ORIGIN} ${ORIGIN} 1`).split(" ").map(Number);
  return (x, y) => ({ x: box.x + (x0 ?? ORIGIN) + x * CELL * (zoom ?? 1), y: box.y + (y0 ?? ORIGIN) + y * CELL * (zoom ?? 1) });
}

const click = (page: Page, at: At) => page.mouse.click(at.x, at.y);
/**
 * Under `?bench`: the canvas was not drawn between a load or inputs being sent and their state being shown, and was drawn
 * after it. `answer` is the measure spanning the two: `engine-ready` for a load, `engine-input` for inputs.
 */
async function drawnOnceWithState(page: Page, answer = "engine-ready") {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { sent, ready, draws } = await page.evaluate((answer) => {
    const state = performance.getEntriesByName(`clockyard:${answer}`).at(-1);
    return {
      sent: state?.startTime ?? NaN,
      ready: (state?.startTime ?? NaN) + (state?.duration ?? NaN),
      draws: performance.getEntriesByName("clockyard:draw").map((e) => e.startTime),
    };
  }, answer);
  // Drawn before the state, every wire would be drawn again when it came.
  expect(draws.filter((t) => t >= sent && t < ready)).toEqual([]);
  expect(draws.some((t) => t >= ready)).toBe(true);
}

async function drag(page: Page, from: At, to: At) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

const status = (page: Page) => page.getByRole("status");
/** Shows a tab of the left panel; opening something from it goes back to Parts. */
const openTab = (page: Page, name: "Parts" | "Projects" | "Learn") => page.getByRole("tab", { name }).click();
/** The cycle counter: outside the status region, which it would flood while running (ADR 0017). */
const counter = (page: Page) => page.getByText(/^Cycle \d+, clock (high|low)$/);
const readout = (page: Page, name: string) =>
  page.getByRole("list", { name: "Inputs and outputs" }).getByText(new RegExp(`^${name}:`));
const onOff = (bit: number) => (bit ? "on" : "off");

async function expectStates(page: Page, states: Record<string, number>) {
  for (const [name, bit] of Object.entries(states)) await expect(readout(page, name)).toHaveText(`${name}: ${onOff(bit)}`);
}

const example = (name: string) => fileURLToPath(new URL(`../../../examples/${name}.clockyard.json`, import.meta.url));
const solution = (name: string) => fileURLToPath(new URL(`../../../challenges/solutions/${name}.clockyard.json`, import.meta.url));

test("build two switches → AND → LED by hand, move a part, save and reload", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toContainText("No circuit");
  const at = await grid(page);

  // Place with the part shortcuts; a click places the part centred on the cursor.
  for (const [key, x, y] of [["s", 1, 1], ["s", 1, 6], ["a", 8, 4], ["l", 14, 4]] as const) {
    await page.keyboard.press(key);
    await click(page, at(x, y));
  }
  // Ports: switch out at (2,1) and (2,6); AND a (6,3), b (6,5), out (10,4); LED in (13,4).
  await drag(page, at(2, 1), at(6, 3));
  await drag(page, at(2, 6), at(6, 5));
  await drag(page, at(10, 4), at(13, 4));
  await expect(status(page)).toContainText("Settled");

  const switches = { a: 0, b: 0 };
  const set = async (a: number, b: number) => {
    if (switches.a !== a) await click(page, at(1, 1));
    if (switches.b !== b) await click(page, at(1, 6));
    Object.assign(switches, { a, b });
    await expectStates(page, { "Switch 1": a, "Switch 2": b });
  };
  for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
    await set(a, b);
    await expectStates(page, { "LED 1": a & b });
  }

  // Drag the AND body (clear of its ports) down four cells: wires stay attached by port ID.
  await drag(page, at(7, 4), at(7, 8));
  await expectStates(page, { "LED 1": 1 });
  await set(0, 1);
  await expectStates(page, { "LED 1": 0 });
  await set(1, 1);
  await expectStates(page, { "LED 1": 1 });

  // Export, start a new circuit, import the file: the circuit comes back; switch positions do not.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("untitled.clockyard.json");
  const file = await saved.path();
  await page.reload();
  await openTab(page, "Projects");
  await page.getByRole("button", { name: "New circuit" }).click();
  await expect(status(page)).toContainText("No circuit");
  await page.locator('[data-testid="import-file"]').setInputFiles(file);
  await expect(status(page)).toContainText("Settled");
  await expectStates(page, { "Switch 1": 0, "Switch 2": 0, "LED 1": 0 });
  await click(page, at(1, 1));
  await click(page, at(1, 6));
  await expectStates(page, { "Switch 1": 1, "Switch 2": 1, "LED 1": 1 });
});

test("a cascaded circuit with fan-out evaluates every input combination", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("cascade-fanout"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);

  // Switch a at (0,0), b at (0,6); LED 1 shows a (fan-out), LED 2 shows (a XOR b) AND a.
  const switches = { a: 0, b: 0 };
  for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
    if (switches.a !== a) await click(page, at(1, 1));
    if (switches.b !== b) await click(page, at(1, 7));
    Object.assign(switches, { a, b });
    await expectStates(page, { "Switch 1": a, "Switch 2": b, "LED 1": a, "LED 2": (a ^ b) & a });
  }
});

test("a circuit shared by link opens in another page and simulates the same way (ADR 0024)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const notice = (p: Page) => p.locator(".file-notice");
  const copied = async (p: Page) => {
    await p.getByRole("button", { name: "Copy link" }).click();
    await expect(notice(p)).toHaveText(/^Link copied, [\d,]+ characters\. Anyone with it can read the whole circuit\.$/);
    return p.evaluate(() => navigator.clipboard.readText());
  };
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("and-gate"));
  await expect(status(page)).toContainText("Settled");
  const link = await copied(page);
  expect(link).toMatch(/^http:\/\/localhost:\d+\/#circuit=1\.[A-Za-z0-9_-]+$/);

  // Opened in a new page: the same circuit, and the fragment leaves the address.
  const other = await context.newPage();
  await other.goto(link);
  await expect(status(other)).toContainText("Settled");
  expect(new URL(other.url()).hash).toBe("");
  const at = await grid(other);
  await expectStates(other, { "Switch 1": 0, "Switch 2": 0, "LED 1": 0 });
  await click(other, at(1, 1));
  await click(other, at(1, 6));
  await expectStates(other, { "Switch 1": 1, "Switch 2": 1, "LED 1": 1 });

  // A second link opened in the same tab replaces the circuit without asking, since work is saved in the browser
  // (ADR 0029), then opens and runs.
  await page.locator('[data-testid="import-file"]').setInputFiles(example("catch"));
  await expect(page.getByLabel("Project name")).toHaveValue("Catch");
  const game = await copied(page);
  let asked = "";
  other.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await other.goto(game);
  await expect(other.getByLabel("Project name")).toHaveValue("Catch");
  expect(asked).toBe("");
  expect(new URL(other.url()).hash).toBe("");
  await other.getByLabel("Speed").selectOption("1000");
  await other.getByRole("button", { name: "Run", exact: true }).click();
  await expect(counter(other)).toHaveText(/^Cycle \d{2,},/); // it runs
});

test("a link the clipboard refuses is shown to copy by hand (ADR 0024)", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("Refused", "NotAllowedError"));
  });
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("and-gate"));
  await expect(status(page)).toContainText("Settled");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator(".file-notice")).toHaveText(/^Copy this link by hand, [\d,]+ characters\./);
  await expect(page.getByLabel("Link to this circuit")).toHaveValue(/^http:\/\/localhost:\d+\/#circuit=1\.[A-Za-z0-9_-]+$/);
});

const challenges = (page: Page) => page.getByRole("region", { name: "CHALLENGES" });
const challenge = (page: Page) => page.getByRole("region", { name: "Challenge", exact: true });
const checked = (page: Page) => challenge(page).locator(".challenge-result");

test("start the inverter challenge, build it from a NAND gate, Check passes; a link reopens it with its panel (ADR 0025)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "Inverter" }).click();
  // The starter opens on the sheet of the component to build, its pins already placed.
  await expect(page.getByRole("navigation", { name: "Sheet" })).toContainText("Inverter");
  await expect(challenge(page)).toContainText("Build a NOT gate from NAND gates");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Step 1 of 2 failed. With A = 0: Y should be 1 but is 0.");

  // Pin A's out at (2,1), pin Y's in at (20,1); a NAND placed at (10,6) has a (8,5), b (8,7) and out (12,6).
  const at = await grid(page);
  await page.getByRole("complementary", { name: "Parts" }).getByRole("button", { name: "NAND", exact: true }).click();
  await click(page, at(10, 6));
  await drag(page, at(8, 5), at(2, 1));
  await drag(page, at(8, 7), at(2, 1));
  await drag(page, at(12, 6), at(20, 1));
  await expect(status(page)).toContainText("Settled");
  await expect(checked(page)).toHaveText(""); // an edit puts the last report out of date
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Passed, 2 of 2 steps.");

  // Shared by link: it opens on the main circuit with its panel, and still passes.
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator(".file-notice")).toHaveText(/^Link copied/);
  const other = await context.newPage();
  await other.goto(await page.evaluate(() => navigator.clipboard.readText()));
  await expect(challenge(other)).toContainText("Build a NOT gate from NAND gates");
  await challenge(other).getByRole("button", { name: "Check" }).click();
  await expect(checked(other)).toHaveText("Passed, 2 of 2 steps.");
  // Opening the component is not an edit: the report stays.
  await challenge(other).getByRole("button", { name: "Open Inverter" }).click();
  await expect(other.getByRole("navigation", { name: "Sheet" })).toContainText("Inverter");
  await expect(checked(other)).toHaveText("Passed, 2 of 2 steps.");
});

test("a wrong attempt names its first failing step; a part the challenge does not allow is named (ADR 0025)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "XOR from NAND gates" }).click();
  await expect(page.getByRole("navigation", { name: "Sheet" })).toContainText("XOR");
  const at = await grid(page);
  // Pin A's out at (2,1) straight to pin Y's in at (36,1): right until B is 1.
  await drag(page, at(2, 1), at(36, 1));
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Step 2 of 4 failed. With A = 0, B = 1: Y should be 1 but is 0.");

  // An XOR gate in the middle behaves right but is not a NAND.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.keyboard.press("x");
  await click(page, at(18, 3)); // a (16,2), b (16,4), out (20,3)
  await drag(page, at(16, 2), at(2, 1));
  await drag(page, at(16, 4), at(2, 5));
  await drag(page, at(20, 3), at(36, 1));
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("This challenge allows only these parts: nand. The component uses: xor.");
});

test("the one-bit register: the starter fails at the first edge that loads; the solution passes every step (ADR 0025)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "One-bit register" }).click();
  await expect(challenge(page)).toContainText("At each rising edge of clk");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  // Steps 1 to 4 expect Q to stay 0; step 5 is the first rising edge with load 1.
  await expect(checked(page)).toHaveText("Step 5 of 25 failed. With D = 1, load = 1, clk = 1: Q should be 1 but is 0.");

  // The reference solution, imported as a file: it names its challenge, so the panel stays.
  await page.locator('[data-testid="import-file"]').setInputFiles(solution("06-register"));
  await expect(page.getByLabel("Project name")).toHaveValue("One-bit register: solution");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Passed, 25 of 25 steps.");
});

test("the program challenge: a program written in the ROM's editor is checked on the CPU's gates (ADR 0034)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "11. Program" }).click();
  await expect(challenge(page)).toContainText("Write a program for the CPU");
  // An empty ROM is all NOPs: the CPU never halts.
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Run Sum to 1, step 2 of 3 failed. With key = 1: halt should be 1 but is 0; out should be 1 but is 0.");

  // On the Program sheet: its ROM selected, a program written and assembled into it.
  await expect(page.getByRole("navigation", { name: "Sheet" })).toContainText("Program");
  const at = await grid(page);
  await click(page, at(10, 2)); // the ROM at (8,0)
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const source = inspector.getByLabel("Assembly", { exact: true });
  // It shows the key, not the sum: right for 1 only.
  await source.fill("LDA 0xFF\nOUT\nHLT");
  await page.getByRole("button", { name: "Assemble", exact: true }).click();
  await expect(inspector.getByRole("status")).toHaveText("Assembled 3 words.");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Run Sum to 2, step 2 of 3 failed. With key = 2: out should be 3 but is 2.");
  // The sum, counting the key down.
  await source.fill("LDA 0xFF\nSTA 0\nloop: LDA 1\nADD 0\nSTA 1\nLDA 0\nSBI 1\nSTA 0\nJZ done\nJMP loop\ndone: LDA 1\nOUT\nHLT");
  await page.getByRole("button", { name: "Assemble", exact: true }).click();
  await expect(inspector.getByRole("status")).toHaveText("Assembled 13 words.");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Passed, 15 of 15 steps.");
});

test("the display challenge: its starter draws nothing, and the reference screen interface passes (ADR 0034)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "12. Display" }).click();
  await expect(challenge(page)).toContainText("Connect the screen to the CPU");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Run One byte, step 2 of 3 failed. screen byte 3 should be 129 but is 0.");

  await page.locator('[data-testid="import-file"]').setInputFiles(solution("12-display"));
  await expect(page.getByLabel("Project name")).toHaveValue("Display: solution");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Passed, 9 of 9 steps.");
});

test("the CPU challenge: its starter never halts, and the reference CPU passes every run on the bench (ADR 0034)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "10. CPU" }).click();
  await expect(challenge(page)).toContainText("Build a CPU that runs programs");
  // It opens on the CPU's own sheet, empty but for its pins; the main sheet is the computer round it.
  await expect(page.getByRole("navigation", { name: "Sheet" })).toContainText("CPU");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Run Load and show, step 1 of 3 failed. fetch should be 1 but is 0.");

  // The reference CPU, cut along its memory boundary, as the solution: every program runs on its gates.
  await page.locator('[data-testid="import-file"]').setInputFiles(solution("10-cpu"));
  await expect(page.getByLabel("Project name")).toHaveValue("CPU: solution");
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText("Passed, 30 of 30 steps.");
});

test("a broken link shows its reason and opens nothing (ADR 0024)", async ({ page }) => {
  await page.goto("/#circuit=1.A");
  await expect(page.getByRole("alert")).toHaveText("Could not open the link: This link is cut short or damaged.");
  await expect(status(page)).toContainText("No circuit");
  expect(new URL(page.url()).hash).toBe("");
});

test("a broken file is refused and the circuit is kept", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("and-gate"));
  await expect(status(page)).toContainText("Settled");
  await page.locator('[data-testid="import-file"]').setInputFiles({
    name: "broken.clockyard.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"clockyard","version":99}'),
  });
  await expect(page.getByRole("alert")).toContainText("newer Clockyard");
  await expect(readout(page, "LED 1")).toHaveText("LED 1: off");
});

test("tri-state buffers share a bus: it reads Z with none enabled, a value with one, and X when two disagree (ADR 0035)", async ({ page }) => {
  // Two one-bit sources A and B behind buffers enabled by EA and EB, on one wire to the LED Bus.
  const part = (id: string, kind: string, x: number, y: number, label?: string) => ({ id, kind, position: { x, y }, rotation: 0, props: label ? { label } : {} });
  const wire = (id: string, from: [string, string], to: [string, string]) => ({ id, from: { component: from[0], port: from[1] }, to: { component: to[0], port: to[1] } });
  const bus = {
    format: "clockyard",
    version: 12,
    metadata: { name: "A bus", createdAt: "2026-11-21T10:00:00Z", modifiedAt: "2026-11-21T10:00:00Z" },
    circuit: {
      components: [
        part("a", "switch", 0, 0, "A"),
        part("ea", "switch", 0, 4, "EA"),
        part("ta", "tri", 8, 0),
        part("b", "switch", 0, 10, "B"),
        part("eb", "switch", 0, 14, "EB"),
        part("tb", "tri", 8, 10),
        part("l", "led", 20, 4, "Bus"),
      ],
      junctions: [],
      wires: [
        wire("w1", ["a", "out"], ["ta", "in"]),
        wire("w2", ["ea", "out"], ["ta", "en"]),
        wire("w3", ["b", "out"], ["tb", "in"]),
        wire("w4", ["eb", "out"], ["tb", "en"]),
        wire("w5", ["ta", "out"], ["l", "in"]),
        wire("w6", ["tb", "out"], ["l", "in"]),
      ],
    },
    definitions: [],
  };
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Tri-state buffer", exact: true })).toBeVisible();
  await page.locator('[data-testid="import-file"]').setInputFiles({ name: "bus.clockyard.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bus)) });
  await expect(page.getByLabel("Project name")).toHaveValue("A bus");
  // Two outputs on one wire, and no error: they are tri-state buffers. Nothing drives the bus yet.
  await expect(status(page)).toContainText("Settled");
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: Z");
  const at = await grid(page);
  await click(page, at(1, 5)); // EA
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: off");
  await click(page, at(1, 1)); // A
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: on");
  // B's buffer too: 1 against 0.
  await click(page, at(1, 15)); // EB
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: X");
  await expect(status(page)).toContainText("Settled");
  // Two drivers that agree are no conflict.
  await click(page, at(1, 11)); // B
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: on");
  await click(page, at(1, 5));
  await click(page, at(1, 15));
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: Z");
});

test("the shared bus example: one source enabled shows its value, both show X where they differ, neither shows Z (ADR 0035)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await page.getByRole("region", { name: "EXAMPLES" }).getByRole("button", { name: "Shared bus" }).click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue(/^Two 8-bit sources, A and B, share one wire, the bus\./);
  await expect(status(page)).toContainText("Settled");
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 0xZZ");
  const at = await grid(page);
  const value = page.getByLabel("Value");
  // A at (0,0) is a 5x2 wide switch: a click selects it and focuses its Value field.
  await click(page, at(2.5, 1));
  await expect(value).toBeFocused();
  await value.fill("0x5A");
  await value.press("Enter");
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 0xZZ");
  await click(page, at(1, 5)); // Enable A
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 90 (0x5A)");
  // B is 0: with both enabled, the bits where they differ are X, and here that is a bit in each hex digit.
  await click(page, at(1, 15)); // Enable B
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 0xXX");
  await expect(status(page)).toContainText("Settled");
  // B's low digit made equal to A's: that digit is known again.
  await click(page, at(2.5, 11));
  await expect(value).toBeFocused();
  await value.fill("0x0A");
  await value.press("Enter");
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 0xXA");
  await click(page, at(1, 5));
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 10 (0x0A)");
  await click(page, at(1, 15));
  await expect(readout(page, "LED Bus")).toHaveText("LED Bus: 0xZZ");
});

test("invalid and unstable circuits are reported and recover", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  for (const [x, y] of [[1, 1], [1, 6]] as const) {
    await page.keyboard.press("s");
    await click(page, at(x, y));
  }

  // Two outputs wired together: invalid until the (selected) new wire is deleted.
  await drag(page, at(2, 1), at(2, 6));
  await expect(status(page)).toContainText("Invalid");
  await expect(status(page)).toContainText("Outputs are wired together.");
  await page.keyboard.press("Delete");
  await expect(status(page)).toContainText("Settled");

  // o = NOR(s, o) oscillates while switch 1 is off and settles once it is on.
  await page.getByRole("button", { name: "NOR", exact: true }).click();
  await click(page, at(8, 4)); // NOR at (6,2): a (6,3), b (6,5), out (10,4)
  await drag(page, at(2, 1), at(6, 3));
  await drag(page, at(10, 4), at(6, 5));
  await expect(status(page)).toContainText("Unstable");
  // The loop is left unknown (ADR 0035). A switch that has nothing to do with it settles the rest, and the loop is
  // still reported, now as what remains of it.
  await click(page, at(1, 6));
  await expect(status(page)).toContainText("Unstable");
  await expect(status(page)).toContainText("A loop did not settle: its outputs are unknown.");
  await click(page, at(1, 6));
  await expect(status(page)).toContainText("Unstable");
  await click(page, at(1, 1));
  await expect(status(page)).toContainText("Settled");

  // An unrelated edit reloads the engine from all-zero; the restored switch settles the loop again.
  await page.keyboard.press("l");
  await click(page, at(15, 10));
  await expectStates(page, { "Switch 1": 1, "LED 1": 0 });
  await expect(status(page)).toContainText("Settled");
});

test("undo and redo edits; a drag undoes in one step", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(6, 1)); // LED at (5,0), in (5,1)
  await drag(page, at(2, 1), at(5, 1));
  await click(page, at(1, 1));
  await expectStates(page, { "Switch 1": 1, "LED 1": 1 });

  // Switch positions are not edits, so undo takes back the wire.
  await page.keyboard.press("Control+z");
  await expectStates(page, { "Switch 1": 1, "LED 1": 0 });
  await page.keyboard.press("Control+Shift+z");
  await expectStates(page, { "LED 1": 1 });

  // Drag the LED through several cells; one undo puts it back where it started.
  await drag(page, at(6.5, 1), at(6.5, 7));
  await page.keyboard.press("Control+z");
  await click(page, at(6.5, 1)); // selects the LED only if it is back at (5,0)
  await page.keyboard.press("Delete");
  await expect(readout(page, "LED 1")).toHaveCount(0);
});

test("identical LEDs each show their own signal as switches change (ADR 0030)", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toContainText("No circuit");
  const at = await grid(page);
  for (const [key, x, y] of [["s", 1, 1], ["s", 1, 6], ["l", 8, 1], ["l", 8, 6]] as const) {
    await page.keyboard.press(key);
    await expect(status(page)).toContainText("Placing");
    await click(page, at(x, y));
  }
  await drag(page, at(2, 1), at(7, 1));
  await drag(page, at(2, 6), at(7, 6));
  await expect(status(page)).toContainText("Settled");
  const led = async (y: number) => {
    const { x, y: top } = at(8, y);
    return (await page.screenshot({ clip: { x: x - 14, y: top - 14, width: 28, height: 28 } })).toString("base64");
  };
  const same = async () => (await led(1)) === (await led(6));

  await click(page, at(1, 1));
  await expectStates(page, { "LED 1": 1, "LED 2": 0 });
  await expect.poll(same).toBe(false);
  await click(page, at(1, 6));
  await expectStates(page, { "LED 1": 1, "LED 2": 1 });
  await expect.poll(same).toBe(true);
  await click(page, at(1, 1));
  await expectStates(page, { "LED 1": 0, "LED 2": 1 });
  await expect.poll(same).toBe(false);
});

test("an opened file that does not fit the view is framed at most at 100%; one that fits opens at the start view (ADR 0033)", async ({ page }) => {
  await page.goto("/");
  const host = page.getByRole("main", { name: "Circuit canvas" });
  const view = async () => ((await host.getAttribute("data-view")) ?? "").split(" ").map(Number);
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(status(page)).toContainText("Settled");
  const [x0, y0, zoom] = await view();
  expect(zoom).toBeGreaterThanOrEqual(0.25);
  expect(zoom).toBeLessThan(1);
  // Framed: its ROM at (22, 14), say, is inside the canvas, as the start view's 1280 by 800 window could not show it all.
  const box = await host.boundingBox();
  const rom = { x: (x0 ?? 0) + 22 * 16 * (zoom ?? 1), y: (y0 ?? 0) + 14 * 16 * (zoom ?? 1) };
  expect(rom.x).toBeGreaterThan(0);
  expect(rom.y).toBeGreaterThan(0);
  expect(rom.x).toBeLessThan(box?.width ?? 0);
  expect(rom.y).toBeLessThan(box?.height ?? 0);
  // Small enough for the start view: back to it, whatever the view was.
  await page.locator('[data-testid="import-file"]').setInputFiles(example("and-gate"));
  // Its name, not "Settled", which the CPU's state may still show while the file is read.
  await expect(page.getByLabel("Project name")).toHaveValue("AND gate");
  expect(await view()).toEqual([48, 48, 1]);
});

test("a middle-button pan moves the view only: a part is clicked where it now shows (ADR 0030)", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toContainText("No circuit");
  const at = await grid(page);
  await page.keyboard.press("s");
  await expect(status(page)).toContainText("Placing Switch");
  await click(page, at(1, 1));
  await expect(status(page)).toContainText("Settled");
  // The grid is the host's background, moved with the view: it shows that a pan frame placed the view.
  const host = page.locator("main canvas").locator("..");
  const before = await host.evaluate((element) => element.style.backgroundPosition);
  // Five cells right, three down.
  const from = at(10, 10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + 5 * CELL, from.y + 3 * CELL, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => host.evaluate((element) => element.style.backgroundPosition)).not.toBe(before);
  // Where it moved to, a click toggles the switch, and selects it; where it was is empty sheet, and a click there
  // clears the selection (at once, unlike a toggle, which waits for the engine).
  const none = page.getByText("Select a component to edit its properties.");
  await click(page, at(6, 4));
  await expectStates(page, { "Switch 1": 1 });
  await expect(none).toHaveCount(0);
  await click(page, at(1, 1));
  await expect(none).toBeVisible();
  await click(page, at(6, 4));
  await expectStates(page, { "Switch 1": 0 });
});

test("an empty sheet says how to start; placing is explained; Fit frames the sheet; the Undo button undoes", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const hint = page.getByText("Empty sheet.");
  const undo = page.getByRole("button", { name: "Undo" });
  const zoom = page.getByRole("group", { name: "Zoom" });
  await expect(hint).toBeVisible();
  await expect(undo).toBeDisabled();

  await page.keyboard.press("s");
  await expect(status(page)).toContainText("Placing Switch");
  await expect(hint).toHaveCount(0);
  await click(page, at(1, 1));
  await expect(status(page)).not.toContainText("Placing");

  // One small part fits at the 2x cap, by key and by button.
  await expect(zoom).toContainText("100%");
  await page.keyboard.press("f");
  await expect(zoom).toContainText("200%");
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await expect(zoom).toContainText("160%");
  // The zoom buttons do not take the keyboard: F still fits after one.
  await page.keyboard.press("f");
  await expect(zoom).toContainText("200%");
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await zoom.getByRole("button", { name: "Fit" }).click();
  await expect(zoom).toContainText("200%");

  await undo.click();
  await expect(readout(page, "Switch 1")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
  await expect(hint).toBeVisible();

  // Fit on an empty sheet goes back to the start view: parts wired by the default grid work again.
  await click(page, at(20, 20)); // focus back on the canvas
  await page.keyboard.press("f");
  await expect(zoom).toContainText("100%");
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(6, 1)); // LED at (5,0), in (5,1)
  await drag(page, at(2, 1), at(5, 1));
  await click(page, at(1, 1));
  await expectStates(page, { "Switch 1": 1, "LED 1": 1 });

  // A field being typed in commits when a zoom button is clicked, and the keyboard goes to the canvas: F fits.
  const label = page.getByRole("complementary", { name: "Inspector" }).getByRole("textbox", { name: "Label" });
  await label.fill("A");
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await expect(zoom).toContainText("80%");
  await page.keyboard.press("f");
  await expect(zoom).toContainText("200%");
  await expect(label).toHaveValue("A");
  await expect(readout(page, "Switch A")).toHaveCount(1);
});

test("box-select, duplicate, drag the copy as a group, select all and delete", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(6, 1)); // LED at (5,0), in (5,1)
  await drag(page, at(2, 1), at(5, 1));

  // Box around both parts, then duplicate: the copy lands 2 cells down-right with its own wire.
  await drag(page, at(-1, -1), at(8, 3));
  await page.keyboard.press("Control+d");
  await expectStates(page, { "Switch 2": 0, "LED 2": 0 });

  // The copy is selected: dragging its LED moves the copied switch too.
  await drag(page, at(8.5, 3), at(8.5, 9)); // LED copy from (7,2) to (7,8)
  await click(page, at(3, 9)); // the switch copy, now at (2,8)
  await expectStates(page, { "Switch 1": 0, "LED 1": 0, "Switch 2": 1, "LED 2": 1 });

  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(readout(page, "Switch 1")).toHaveCount(0);
  await expect(status(page)).toContainText("No circuit");
});

test("copying selected page text does not stop the canvas copying afterwards", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(1, 1));

  // Select some page text (the parts hint), as when reading a message, then go back to the canvas.
  await page.getByText("Pick a part or press its key").click({ clickCount: 3 });
  await drag(page, at(-1, -1), at(3, 3));
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expectStates(page, { "Switch 2": 0 });
});

test("label parts in the inspector; labels name pins in the readout and status bar, undo, and survive a save", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const label = inspector.getByRole("textbox", { name: "Label" });
  await expect(inspector).toContainText("Select a component to edit its properties.");

  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(6, 1)); // LED at (5,0), in (5,1)
  await drag(page, at(2, 1), at(5, 1));
  await expect(inspector).toContainText("Routed automatically.");

  // Enter commits.
  await click(page, at(1, 1)); // selects the switch and turns it on
  await expect(label).toHaveAccessibleDescription("Names this input pin of the circuit.");
  await label.fill("A");
  await label.press("Enter");
  await expectStates(page, { "Switch A": 1, "LED 1": 1 });
  // The field shows what was stored, even when trimming leaves the label as it was.
  await label.fill("A  ");
  await label.press("Enter");
  await expect(label).toHaveValue("A");

  // Pressing the canvas commits to the part being edited, not the next selection.
  await click(page, at(6.5, 1));
  await label.fill("sum");
  await click(page, at(1, 1)); // and turns the switch off
  await expectStates(page, { "Switch A": 0, "LED sum": 0 });
  await expect(label).toHaveValue("A");

  // Escape cancels.
  await label.fill("B");
  await label.press("Escape");
  await expect(label).toHaveValue("A");
  // A second Escape hands the keyboard back to the canvas, where undo is the editor's.
  await label.press("Escape");
  await expect(readout(page, "Switch A")).toHaveCount(1);

  // Each label is one undo step.
  await page.keyboard.press("Control+z");
  await expect(readout(page, "LED 1")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(readout(page, "LED sum")).toHaveCount(1);

  // A diagnostic names the labelled part it is about.
  await page.keyboard.press("a");
  await click(page, at(12, 8)); // AND at (10,6), inputs unconnected
  await label.fill("half");
  await label.press("Enter");
  await expect(status(page)).toContainText("An input is unconnected and reads 0. (AND half)");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await (await download).path();
  await page.reload();
  await openTab(page, "Projects");
  await page.getByRole("button", { name: "New circuit" }).click();
  await expect(status(page)).toContainText("No circuit");
  await page.locator('[data-testid="import-file"]').setInputFiles(file);
  await expectStates(page, { "Switch A": 0, "LED sum": 0 });
  await expect(status(page)).toContainText("(AND half)");
});

test("the half-adder example fans its inputs out through junctions", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("half-adder"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);

  // Switch A at (0,0), B at (0,10); each feeds the XOR and the AND through one junction.
  const switches = { a: 0, b: 0 };
  for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
    if (switches.a !== a) await click(page, at(1, 1));
    if (switches.b !== b) await click(page, at(1, 11));
    Object.assign(switches, { a, b });
    await expectStates(page, { "Switch A": a, "Switch B": b, "LED Sum": a ^ b, "LED Carry": a & b });
  }
});

test("drop a wire on a wire to branch it at a junction; move and delete the junction", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(11, 1)); // LED 1 at (10,0), in (10,1)
  await page.keyboard.press("l");
  await click(page, at(11, 7)); // LED 2 at (10,6), in (10,7)
  await drag(page, at(2, 1), at(10, 1));

  // From LED 2's input onto the middle of the first wire: a junction at (6,1) joins them.
  await drag(page, at(10, 7), at(6, 1.2));
  await click(page, at(1, 1));
  await expectStates(page, { "Switch 1": 1, "LED 1": 1, "LED 2": 1 });
  await expect(status(page)).toContainText("Settled");

  // The branch is one undo step.
  await page.keyboard.press("Control+z");
  await expectStates(page, { "LED 1": 1, "LED 2": 0 });
  await page.keyboard.press("Control+Shift+z");
  await expectStates(page, { "LED 2": 1 });

  // Select the junction and drag it down: connections hold. Then delete it: its three wires go.
  await click(page, at(6, 1));
  await drag(page, at(6, 1), at(6, 4));
  await expectStates(page, { "LED 1": 1, "LED 2": 1 });
  await click(page, at(6, 4));
  await page.keyboard.press("Delete");
  await expectStates(page, { "Switch 1": 1, "LED 1": 0, "LED 2": 0 });
  await page.keyboard.press("Control+z");
  await expectStates(page, { "LED 1": 1, "LED 2": 1 });

  // Dragging from an unselected junction draws a wire from it.
  await page.keyboard.press("l");
  await click(page, at(11, 11)); // LED 3 at (10,10), in (10,11); now the selection
  await drag(page, at(6, 4), at(10, 11));
  await expectStates(page, { "LED 1": 1, "LED 2": 1, "LED 3": 1 });
});

test("drag a wire segment to reshape it; reset its route from the inspector; both undo", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(13, 1)); // LED at (12,0), in (12,1)
  await drag(page, at(2, 1), at(12, 1)); // a straight wire along row 1
  await expect(inspector).toContainText("Routed automatically.");

  // Pull its middle down four rows: it now runs along row 5, and is still the same connection.
  await drag(page, at(7, 1), at(7, 5));
  await expect(inspector).toContainText("Route shaped by hand.");
  await click(page, at(1, 1));
  await expectStates(page, { "Switch 1": 1, "LED 1": 1 });
  await click(page, at(7, 5)); // the moved segment is where the wire is now
  await expect(inspector).toContainText("Route shaped by hand.");

  await inspector.getByRole("button", { name: "Reset route" }).click();
  await expect(inspector).toContainText("Routed automatically.");
  await page.keyboard.press("Control+z");
  await expect(inspector).toContainText("Route shaped by hand.");
  await page.keyboard.press("Control+z");
  await click(page, at(7, 1)); // the drag undone: the wire is back on row 1
  await expect(inspector).toContainText("Routed automatically.");
});

test("R and Shift R rotate the selection; the circuit still works and both undo", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("n");
  await click(page, at(7.5, 6)); // NOT at (6,5): in (6,6), out (9,6)
  await page.keyboard.press("l");
  await click(page, at(15, 6)); // LED at (14,5), in (14,6)
  await drag(page, at(2, 1), at(6, 6));
  await drag(page, at(9, 6), at(14, 6));
  await expectStates(page, { "Switch 1": 0, "LED 1": 1 });

  await click(page, at(7, 6)); // select the NOT
  await page.keyboard.press("r"); // now 2 wide, 3 tall: input on top, output below
  await expectStates(page, { "LED 1": 1 });
  await click(page, at(1, 1));
  await expectStates(page, { "Switch 1": 1, "LED 1": 0 });
  await click(page, at(7, 6)); // still the NOT's body
  await page.keyboard.press("Shift+R");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  // Back to the start: the NOT's body is at (6..9, 5..7) again.
  await click(page, at(8.5, 6));
  await page.keyboard.press("Delete");
  await expectStates(page, { "LED 1": 0 });
  await expect(status(page)).toContainText("unconnected");
});

test("Escape during a drag puts the part back where the drag started", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("l");
  await click(page, at(3, 3)); // LED at (2,2)
  const [from, to] = [at(3, 3), at(10, 10)];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  // Nothing to redo, and the LED is still at (2,2): a click there selects it, so Delete removes it.
  await page.keyboard.press("Control+Shift+z");
  await click(page, at(3, 3));
  await page.keyboard.press("Delete");
  await expect(readout(page, "LED 1")).toHaveCount(0);
});

test("a part cannot be placed with a port on a junction; it stays armed for a better spot", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(11, 1)); // LED at (10,0), in (10,1)
  await page.keyboard.press("l");
  await click(page, at(11, 7)); // LED at (10,6), in (10,7)
  await drag(page, at(2, 1), at(10, 1));
  await drag(page, at(10, 7), at(6, 1.2)); // junction at (6,1)
  // Select all, then wait for the inspector to say so: it renders after the key, so a plain read can race it.
  const selected = async (items: number) => {
    await page.keyboard.press("Control+a");
    await expect(inspector).toContainText(`${items} items selected`);
  };
  await selected(7); // 3 parts, 1 junction, 3 wires

  // A NOT centred here would sit at (6,0) with its input on the junction: refused.
  await page.keyboard.press("n");
  await click(page, at(7.6, 1));
  await selected(7);
  // Still armed: a click on free ground places it.
  await click(page, at(7.6, 12));
  await selected(8);
});

test("R turns a part armed from the parts panel, before it is placed", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.getByRole("button", { name: /^NOT/ }).click(); // focus stays on the tile
  await page.keyboard.press("r");
  await click(page, at(6, 6));
  // Read back from the saved file: the NOT was placed turned.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const saved = JSON.parse(readFileSync((await (await download).path()) as string, "utf8")) as CircuitDocument;
  expect(saved.circuit.components[0]?.rotation).toBe(90);
});

test("the 4-bit adder example adds through four instances of one full adder", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("4-bit-adder"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  // Switch Ai at (0, 10i), Bi at (4, 10i + 3), Cin at (0, 6).
  const flip = async (name: string) => {
    const [kind, bit] = [name[0], Number(name[1])];
    if (name === "Cin") return click(page, at(1, 7));
    return kind === "A" ? click(page, at(1, 10 * bit + 1)) : click(page, at(5, 10 * bit + 4));
  };
  for (const name of ["A0", "A2", "B0", "B1"]) await flip(name); // 5 + 3
  await expectStates(page, { "LED S0": 0, "LED S1": 0, "LED S2": 0, "LED S3": 1, "LED Cout": 0 });
  await flip("Cin"); // 5 + 3 + 1
  await expectStates(page, { "LED S0": 1, "LED S3": 1, "LED Cout": 0 });
  for (const name of ["A1", "A3", "B2", "B3"]) await flip(name); // 15 + 15 + 1 = 31
  await expectStates(page, { "LED S0": 1, "LED S1": 1, "LED S2": 1, "LED S3": 1, "LED Cout": 1 });
});

test("make a component from a selection, place another from Chips, open it on its own sheet and come back", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const label = inspector.getByRole("textbox", { name: "Label" });
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0)
  await label.fill("In");
  await label.press("Enter");
  await page.keyboard.press("n");
  await click(page, at(7.5, 1)); // NOT at (6,0)
  await page.keyboard.press("l");
  await click(page, at(13, 1)); // LED at (12,0)
  await label.fill("Out");
  await label.press("Enter");
  await drag(page, at(2, 1), at(6, 1));
  await drag(page, at(9, 1), at(12, 1));

  await drag(page, at(-1, -1), at(15, 4)); // select it all
  await inspector.getByRole("textbox", { name: "Component name" }).fill("Inverter");
  await inspector.getByRole("button", { name: "Make component" }).click();
  await expect(inspector).toContainText("Inverter");
  await expect(readout(page, "Switch In")).toHaveCount(0); // the switch now lives inside the component

  // Place a second instance from the Chips section.
  await page.getByRole("complementary", { name: "Parts" }).getByRole("button", { name: "Inverter", exact: true }).click();
  await click(page, at(3, 10));
  await expect(inspector.getByRole("button", { name: "Edit component" })).toBeVisible();

  // Open its definition: it simulates on its own, with its own switch.
  await inspector.getByRole("button", { name: "Edit component" }).click();
  await expect(page.getByRole("navigation", { name: "Sheet" })).toContainText("Inverter");
  await expectStates(page, { "Switch In": 0, "LED Out": 1 });
  await page.getByRole("button", { name: "Main circuit" }).click();
  await expect(page.getByRole("navigation", { name: "Sheet" })).toHaveCount(0);
  await expect(readout(page, "Switch In")).toHaveCount(0);
});

test("make a component of the middle of a circuit: wires across the selection's edge become pins, still wired", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const label = inspector.getByRole("textbox", { name: "Label" });
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0)
  await label.fill("A");
  await label.press("Enter");
  for (const x of [7.5, 13.5]) {
    await page.keyboard.press("n");
    await click(page, at(x, 1)); // NOTs at (6,0) and (12,0)
  }
  await page.keyboard.press("l");
  await click(page, at(19, 1)); // LED at (18,0)
  await label.fill("Y");
  await label.press("Enter");
  await drag(page, at(2, 1), at(6, 1));
  await drag(page, at(9, 1), at(12, 1));
  await drag(page, at(15, 1), at(18, 1));
  await expectStates(page, { "Switch A": 0, "LED Y": 0 });

  // Only the two NOTs: the wires in and out cross the selection's edge (ADR 0016).
  await drag(page, at(5, -1), at(16, 3));
  await inspector.getByRole("textbox", { name: "Component name" }).fill("Buffer");
  await inspector.getByRole("button", { name: "Make component" }).click();
  await expect(inspector).toContainText("Buffer");
  await expect(status(page)).toContainText("Settled");
  await click(page, at(1, 1));
  await expectStates(page, { "Switch A": 1, "LED Y": 1 });
});

test("rename a component from an instance's inspector; delete it from Chips only once nothing uses it", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("4-bit-adder"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  const parts = page.getByRole("complementary", { name: "Parts" });
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  // In use on the main circuit: refused, with the reason.
  await parts.getByRole("button", { name: "Delete Full adder" }).click();
  await expect(parts.getByRole("alert")).toHaveText("Full adder is still used in the main circuit. Delete those instances first.");

  // Rename through an instance (the first full adder, at (12, 0)): every instance and the chip follow.
  await click(page, at(14, 3));
  const name = inspector.getByRole("textbox", { name: "Component name" });
  await name.fill("  Adder bit ");
  await name.press("Enter");
  await expect(name).toHaveValue("Adder bit");
  await expect(parts.getByRole("button", { name: "Adder bit", exact: true })).toBeVisible();
  await expect(inspector).toContainText("Adder bit");
  // The refusal follows the component: renamed with it, gone once nothing uses it (below).
  await expect(parts.getByRole("alert")).toHaveText("Adder bit is still used in the main circuit. Delete those instances first.");

  // Once nothing uses it, deleting asks first; cancelling keeps it.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await parts.getByRole("button", { name: "Delete Adder bit" }).click();
  await expect(parts.getByRole("alert")).toHaveCount(0);
  await expect(parts.getByRole("button", { name: "Adder bit", exact: true })).toBeVisible();
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await parts.getByRole("button", { name: "Delete Adder bit" }).click();
  await expect(parts.getByRole("button", { name: "Adder bit", exact: true })).toHaveCount(0);
  expect(asked).toBe("Delete the component Adder bit? This cannot be undone.");
  await expect(parts).toContainText("Make component in the inspector");
  // The only undo step held its instances, so it went with it: undo cannot bring back a missing component.
  await page.keyboard.press("Control+z");
  await expect(readout(page, "Switch A0")).toHaveCount(0);
  await expect(status(page)).toContainText("No circuit");
});

test("the 8-bit adder example adds two 8-bit values typed in the inspector", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("8-bit-adder"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  const value = page.getByLabel("Value");
  // A at (0,0) and B at (0,12) are 5x2 wide switches: a click selects one and focuses its Value field (ADR 0014).
  await click(page, at(2.5, 1));
  await expect(value).toBeFocused();
  await value.fill("200");
  await value.press("Enter");
  await click(page, at(2.5, 13));
  await expect(value).toBeFocused();
  await value.fill("0x64");
  await value.press("Enter");
  await expect(readout(page, "Switch A")).toHaveText("Switch A: 200 (0xC8)");
  await expect(readout(page, "LED Sum")).toHaveText("LED Sum: 44 (0x2C)");
  await expect(readout(page, "LED Cout")).toHaveText("LED Cout: on");
  // Up steps B to 101; Cin adds one more: 302 wraps to 46 and still carries out.
  await value.press("ArrowUp");
  await expect(readout(page, "Switch B")).toHaveText("Switch B: 101 (0x65)");
  await click(page, at(1, 25));
  await expect(readout(page, "LED Sum")).toHaveText("LED Sum: 46 (0x2E)");
  await expect(readout(page, "LED Cout")).toHaveText("LED Cout: on");
  await expect(status(page)).toContainText("Settled");
});

test("an 8-bit switch wired to a 1-bit LED is a width mismatch until the LED is 8 bits too", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const width = page.getByLabel("Width");
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0); at 8 bits it is 5x2 with out at (5,1)
  await width.fill("8");
  await width.press("Enter");
  await page.keyboard.press("l");
  await click(page, at(11, 1)); // LED at (10,0), in at (10,1)
  await drag(page, at(5, 1), at(10, 1));
  await expect(status(page)).toContainText("Invalid");
  await expect(status(page)).toContainText("Ports of different widths are wired together.");
  await expect(readout(page, "LED 1")).toHaveText("LED 1: unknown");

  await click(page, at(11, 1));
  await width.fill("8");
  await width.press("Enter");
  await expect(status(page)).toContainText("Settled");
  const value = page.getByLabel("Value");
  await click(page, at(2.5, 1));
  await expect(value).toBeFocused();
  await value.fill("0b1010_0101");
  await value.press("Enter");
  await expect(readout(page, "LED 1")).toHaveText("LED 1: 165 (0xA5)");
});

test("two labels named go join a far switch and LED; renaming one leaves both unmatched", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const name = page.getByLabel("Name", { exact: true });
  const label = page.getByRole("button", { name: "Label", exact: true });
  await page.keyboard.press("s");
  await click(page, at(1, 1)); // switch at (0,0), out (2,1)
  await page.keyboard.press("l");
  await click(page, at(21, 12)); // LED at (20,11), in (20,12)

  // Each label is placed from the parts panel and named in the inspector, which takes the keyboard.
  for (const spot of [at(5, 1), at(16, 12)]) {
    await label.click();
    await click(page, spot);
    await expect(name).toBeFocused();
    await name.fill("go");
    await name.press("Enter");
  }
  await drag(page, at(2, 1), at(5, 1));
  await drag(page, at(20, 12), at(16, 12));
  await click(page, at(1, 1));
  await expectStates(page, { "Switch 1": 1, "LED 1": 1 });
  await expect(status(page)).toContainText("Settled");

  // A typo cuts the net, and both halves say so.
  // Its tag, left of the dot, since the wire leaves right. The canvas hit-tests tags against the boxes of the last frame
  // drawn, and the readout above can show the state a frame before that redraw, so the click is retried until it selects
  // the label.
  await expect(async () => {
    await click(page, at(15, 12));
    await expect(name).toHaveValue("go", { timeout: 500 });
  }).toPass();
  await name.fill("stop");
  await name.press("Enter");
  await expectStates(page, { "Switch 1": 1, "LED 1": 0 });
  const message = status(page).locator(".status-message");
  await expect(message).toHaveAttribute("title", /label `go` joins nothing/);
  await expect(message).toHaveAttribute("title", /label `stop` joins nothing/);
});

test("the readout lists the clock, flip-flops and each component holding state by its outputs (ADR 0033)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("8-bit-counter"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  await click(page, at(1, 7)); // Count on
  await expectStates(page, { "Switch Count": 1 });
  await expect(readout(page, "Clock")).toHaveText("Clock: low");
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(readout(page, "Register Value")).toHaveText("Register Value: 1 (0x01)");
  await expect(readout(page, "Clock")).toHaveText("Clock: low");

  // The reference CPU's registers are all components holding a flip-flop: each is read by its output pin.
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(status(page)).toContainText("Settled");
  await expect(readout(page, "Register 8 PC q")).toHaveText("Register 8 PC q: 0 (0x00)");
  await expect(readout(page, "Register 1 H q")).toHaveText("Register 1 H q: off");
  // Parts without state inside (the ALU, the multiplexers) are not listed.
  await expect(page.getByRole("list", { name: "Inputs and outputs" }).getByText(/^8-bit adder|^Mux/)).toHaveCount(0);
});

test("an edit keeps the running state: the counter counts on after its wire is removed and put back (ADR 0033)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("8-bit-counter"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  const value = readout(page, "Register Value");
  const step = page.getByRole("button", { name: "Step", exact: true });
  await click(page, at(1, 7)); // Count on
  await expectStates(page, { "Switch Count": 1 });
  for (let i = 0; i < 3; i++) await step.click();
  await expect(value).toHaveText("Register Value: 3 (0x03)");
  await expect(counter(page)).toHaveText("Cycle 3, clock low");

  // Two connectivity edits: the register's wire to its LED deleted, then put back by Undo.
  await click(page, at(28, 1));
  await page.keyboard.press("Delete");
  await expect(readout(page, "LED Q")).toHaveText("LED Q: 0 (0x00)");
  await expect(value).toHaveText("Register Value: 3 (0x03)");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(readout(page, "LED Q")).toHaveText("LED Q: 3 (0x03)");
  // Neither time nor the count went back, and the next step adds one.
  await expect(counter(page)).toHaveText("Cycle 3, clock low");
  await step.click();
  await expect(value).toHaveText("Register Value: 4 (0x04)");
  await expect(counter(page)).toHaveText("Cycle 4, clock low");
  // Reset is still the way back to 0.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(value).toHaveText("Register Value: 0 (0x00)");
});

test("an LED added to a paused CPU leaves its registers and cycle where they were (ADR 0033)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.getByLabel("Speed").selectOption("1000");
  await button("Run").click();
  const cycle = async () => Number(/\d+/.exec((await counter(page).textContent()) ?? "")?.[0]);
  await expect.poll(cycle).toBeGreaterThan(50);
  await button("Pause").click();
  await expect(status(page)).not.toContainText("Running");
  const rows = page.getByRole("list", { name: "Inputs and outputs" }).locator("li");
  const registers = async () => (await rows.allTextContents()).filter((row) => row.startsWith("Register") || row.startsWith("Clock"));
  const before = await registers();
  const shown = await counter(page).textContent();
  // The program has run: the instruction register's high byte, an opcode, is never 0 once it has fetched (PC is, one
  // cycle in four, while the program waits for a key).
  expect(before.some((row) => /^Register 8 IR high q: (?!0 )/.test(row))).toBe(true);

  // A connectivity edit: an LED placed on empty sheet below the CPU.
  await page.keyboard.press("l");
  await expect(status(page)).toContainText("Placing");
  await click(page, at(10, 95));
  await expect(rows.filter({ hasText: /^LED \d+: off$/ })).toHaveCount(1);
  await expect(status(page)).toContainText("Settled");
  expect(await registers()).toEqual(before);
  await expect(counter(page)).toHaveText(shown ?? "");
});

test("the 8-bit counter steps, resets, and after a run holds exactly the cycles it ran (ADR 0017)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("8-bit-counter"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  const q = readout(page, "LED Q");
  const cycle = async () => Number(/Cycle (\d+)/.exec(await counter(page).innerText())?.[1]);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await expect(q).toHaveText("LED Q: 0 (0x00)");
  await click(page, at(1, 7)); // Count on: the switch at (0,6) is the adder's carry in
  await expectStates(page, { "Switch Count": 1 });

  for (let i = 0; i < 3; i++) await button("Step").click();
  await expect(q).toHaveText("LED Q: 3 (0x03)");
  await expect(counter(page)).toHaveText("Cycle 3, clock low");
  await button("Reset").click();
  await expect(q).toHaveText("LED Q: 0 (0x00)");
  await expect(counter(page)).toHaveText("Cycle 0, clock low");

  // Run, then pause: the value is the number of rising edges, however fast it ran or where it paused.
  await page.getByLabel("Speed").selectOption("100");
  await button("Run").click();
  await expect(status(page)).toContainText("Running");
  await expect.poll(cycle).toBeGreaterThan(5);
  await button("Pause").click();
  await expect(status(page)).toContainText("Settled");
  const ran = await cycle();
  await expect(q).toHaveText(new RegExp(`^LED Q: ${ran % 256} `));
  // Step finishes the cycle under way, if any, and runs one more: it always ends low.
  await button("Step").click();
  await expect(q).toHaveText(new RegExp(`^LED Q: ${(ran + 1) % 256} `));
  await expect(counter(page)).toHaveText(`Cycle ${ran + 1}, clock low`);
});

test("a loop that oscillates while the clock is high pauses the run (ADR 0017)", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await button("Clock").click();
  await click(page, at(1, 1)); // clock at (0,0), out (2,1)
  await button("NAND").click();
  await click(page, at(8, 2)); // NAND at (6,0): a (6,1), b (6,3), out (10,2)
  await drag(page, at(2, 1), at(6, 1));
  await drag(page, at(10, 2), at(6, 3)); // its output back to its own input: stable while the clock is low
  await expect(status(page)).toContainText("Settled");
  await button("Run").click();
  await expect(status(page)).toContainText("Unstable");
  await expect(button("Run")).toBeVisible(); // paused by the worker, not by a click
  await expect(counter(page)).toHaveText("Cycle 1, clock high");
  await expect(status(page)).toContainText("Stopped: The circuit did not settle"); // and says so (ADR 0021)
  // A step is the user's: the reason goes.
  await button("Step").click();
  await expect(status(page)).not.toContainText("Stopped:");
});

test("a word written to a RAM by hand shows in its inspector, and Reset clears it (ADR 0018)", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.getByRole("button", { name: "RAM", exact: true }).click();
  await click(page, at(12.5, 4)); // RAM at (10,0): addr (10,1), din (10,3), we (10,5), clk (10,7)
  await expect(page.getByText("256×8")).toHaveCount(0); // drawn on the canvas, not in the page
  // we and clk: 1-bit switches; din, placed last so it is the one selected: 8 bits, set to 42.
  for (const y of [5, 7, 3]) {
    await page.keyboard.press("s");
    await click(page, at(1, y)); // switches at (0,4), (0,6) and (0,2): out (2,5), (2,7), (2,3)
  }
  const width = inspector.getByRole("textbox", { name: "Width" });
  await width.fill("8");
  await width.press("Enter"); // now 5 wide: out (5,3)
  const value = inspector.getByLabel("Value");
  await value.fill("42");
  await value.press("Enter");
  await drag(page, at(5, 3), at(10, 3));
  await drag(page, at(2, 5), at(10, 5));
  await drag(page, at(2, 7), at(10, 7));
  await click(page, at(1, 5)); // we on
  await click(page, at(1, 7)); // a rising clk: 42 goes to address 0
  await click(page, at(12.5, 4)); // select the RAM
  const contents = inspector.getByLabel("RAM contents");
  await expect(contents).toContainText(/^0x2A 0x00/);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(contents).toContainText(/^0x00 0x00/);
});

test("Reference CPU 2 draws its line one pixel at a time, calling one routine 32 times (ADR 0036)", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "Learn");
  await page.getByRole("region", { name: "EXAMPLES" }).getByRole("button", { name: "Reference CPU 2" }).click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue(/^Reference CPU 2 \(docs\/reference-cpu-2\.md\)/);
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  // The stack pointer is on the sheet, with its LED.
  await expect(readout(page, "LED SP")).toHaveText("LED SP: 0 (0x0)");
  await page.getByLabel("Speed").selectOption("10000");
  await page.getByLabel("Run until").selectOption({ label: "Until LED Halted lights" });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(readout(page, "LED Halted")).toHaveText("LED Halted: on", { timeout: 30_000 });
  // 32 pixels, the count on OUT, every call returned.
  await expect(readout(page, "LED Output")).toHaveText("LED Output: 32 (0x20)");
  await expect(readout(page, "LED SP")).toHaveText("LED SP: 0 (0x0)");
  // Rows 0 and 1 of the screen: pixel 0 at byte 0, bit 7; pixel 1 at byte 8, bit 6.
  const at = await grid(page);
  await click(page, at(35, 5)); // the screen at (25,0), as on the first CPU's sheet
  const contents = page.getByRole("region", { name: "Screen contents" });
  await expect(contents).toContainText("0x80 0x00 0x00 0x00 0x00 0x00 0x00 0x00\n0x40 0x00");
});

test("run until an LED lights: an instruction step on the reference CPU, then run to halt (ADR 0019)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const until = page.getByLabel("Run until");
  await click(page, at(24.5, 16)); // the program ROM at (22,14)
  await page.getByLabel("Assembly", { exact: true }).fill("LDI 5\nADI 3\nOUT\nHLT");
  await button("Assemble").click();
  await page.getByLabel("Speed").selectOption("100");
  // Fetch is lit at reset: it goes dark and lights again as the next fetch begins, the clock high.
  await until.selectOption({ label: "Until LED Fetch lights" });
  await button("Run").click();
  await expect(counter(page)).toHaveText("Cycle 2, clock high");
  await expect(button("Run")).toBeVisible(); // stopped by the LED, not a click
  await button("Run").click();
  await expect(counter(page)).toHaveText("Cycle 4, clock high");
  // Run to the end of the program: LDI 5 / ADI 3 / OUT / HLT.
  await until.selectOption({ label: "Until LED Halted lights" });
  await button("Run").click();
  await expect(readout(page, "LED Halted")).toHaveText("LED Halted: on");
  await expect(readout(page, "LED Output")).toHaveText("LED Output: 8 (0x08)");
  await expect(counter(page)).toHaveText("Cycle 8, clock high");
  // The same file opened again: the LED is still there, so the choice stays, and so does the keyboard's place in the menu.
  await until.focus();
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  await expect(until.locator("option:checked")).toHaveText("Until LED Halted lights");
  await expect(until).toBeFocused();
  await expect(readout(page, "LED Halted")).toHaveText("LED Halted: off");
});

test("an opened sheet is drawn once the engine's first state is in, not before it (ADR 0030)", async ({ page }) => {
  await page.goto("/?bench");
  await expect(status(page)).toContainText(/No circuit|Settled/);
  await page.evaluate(() => performance.clearMeasures());
  // Large enough that drawing it before the answer is the norm: on a small sheet the answer often beats the first frame.
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(status(page)).toContainText("Settled");
  await drawnOnceWithState(page);
});

test("a connectivity edit is drawn once its state is in, not before it (ADR 0030)", async ({ page }) => {
  await page.goto("/?bench");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  await click(page, at(24.5, 16)); // the program ROM at (22,14)
  await page.evaluate(() => performance.clearMeasures());
  // Assumes the answer comes within routing and the scene's 150 ms wait, as it does on any ordinary machine; a much slower
  // one would draw first and fail here without anything being broken.
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => performance.getEntriesByName("clockyard:engine-ready").length > 0);
  await drawnOnceWithState(page);
});

test("a toggle is drawn once its state is in, not before it (ADR 0030)", async ({ page }) => {
  await page.goto("/?bench");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("8-bit-adder"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  // Cin at (0,24), toggled a few times: on a sheet this small the answer sometimes beats the next frame anyway.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => performance.clearMeasures());
    await click(page, at(1, 25));
    await page.waitForFunction(() => performance.getEntriesByName("clockyard:engine-input").length > 0);
    await drawnOnceWithState(page, "engine-input");
  }
});

test("every readout row reaches the browser's accessibility tree", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("4-bit-adder"));
  const rows = page.getByRole("list", { name: "Inputs and outputs" }).locator("li");
  await expect(rows.first()).toHaveText(/: (on|off)$/);
  const expected = await rows.allTextContents();
  expect(expected.length).toBeGreaterThan(0);
  // The browser's own tree: hiding rows from layout can remove them here while the page's DOM, and locators, still see them.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const spoken = nodes.filter((n) => n.role?.value === "StaticText" && !n.ignored).map((n) => String(n.name?.value));
  expect(spoken).toEqual(expect.arrayContaining(expected));
});

test("the program editor assembles into the ROM, lists errors by line, and the CPU runs the new program (ADR 0019)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await click(page, at(24.5, 16)); // the program ROM at (22,14)
  const source = inspector.getByLabel("Assembly", { exact: true });
  const listing = inspector.getByRole("region", { name: "Disassembly" });
  await expect(source).toHaveValue(/LDA 0xFF/); // the shipped program: draw the key held
  await expect(listing).toContainText("00  LDA 255");
  // An error is listed by line and changes nothing.
  await source.fill("LDX 1");
  await button("Assemble").click();
  await expect(inspector.getByRole("alert")).toHaveText("Line 1: unknown instruction LDX");
  // The Contents box changes in the same render as the ROM's words: the error wrote nothing.
  const contents = inspector.getByLabel("Contents", { exact: true });
  await expect(contents).toHaveValue(/^0x20FF 0x9000/);
  // A new program: 7 + 2.
  await source.fill("LDI 7\nADI 2\nOUT\nHLT");
  await button("Assemble").click();
  await expect(inspector.getByRole("status")).toHaveText("Assembled 4 words.");
  await expect(listing).toContainText("00  LDI 7");
  await expect(listing).toContainText("01  ADI 2");
  // Reference CPU 2's instructions assemble too (ADR 0036). This sheet's CPU would run them as NOP, so the status
  // says how many there are.
  await source.fill("LDI 5\nCALL f\nHLT\nf: SHL\nRET");
  await button("Assemble").click();
  await expect(inspector.getByRole("status")).toHaveText("Assembled 5 words; 3 are instructions only Reference CPU 2 runs.");
  await expect(listing).toContainText("01  CALL 3");
  await button("Undo").click();
  await expect(listing).toContainText("01  ADI 2");
  // Undo brings back the old program, in the box as well as in the ROM.
  await button("Undo").click();
  await expect(source).toHaveValue(/LDA 0xFF/);
  await expect(listing).toContainText("00  LDA 255");
  // Words edited directly no longer match the kept source, and the editor says so. 7 + 2 again, by hand.
  await contents.fill("0x1007 0x6002 0xB000 0xC000");
  await contents.blur();
  await expect(inspector.getByText(/no longer match this source/)).toBeVisible();
  await expect(listing).toContainText("00  LDI 7");
  await page.getByLabel("Speed").selectOption("100");
  await page.getByLabel("Run until").selectOption({ label: "Until LED Halted lights" });
  await button("Run").click();
  await expect(readout(page, "LED Output")).toHaveText("LED Output: 9 (0x09)");
});

test("a program longer than its ROM holds is refused with the reason (ADR 0019)", async ({ page }) => {
  await page.goto("/");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.getByRole("button", { name: "ROM", exact: true }).click();
  await click(page, at(4.5, 3)); // a ROM at (2,1), selected
  for (const [name, value] of [["Width", "16"], ["Address bits", "1"]] as const) {
    const field = inspector.getByRole("textbox", { name, exact: true });
    await field.fill(value);
    await field.press("Enter");
  }
  const source = inspector.getByLabel("Assembly", { exact: true });
  await source.fill("NOP\nNOP\nNOP");
  await page.getByRole("button", { name: "Assemble", exact: true }).click();
  await expect(inspector.getByRole("alert")).toHaveText("3 words do not fit in 2 addresses: give the ROM more address bits.");
  await expect(inspector.getByRole("region", { name: "Disassembly" })).toContainText("Empty");
});

test("Phase 4 demo: a program loops through RAM on the CPU built from parts and shows 15 on the output (ADR 0019)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const until = page.getByLabel("Run until");
  // 5 + 4 + 3 + 2 + 1, with the sum and the count in RAM and a loop that ends on Z.
  const program = [
    "        LDI 0",
    "        STA 0      ; sum",
    "        LDI 5",
    "        STA 1      ; n",
    "loop:   LDA 0",
    "        ADD 1",
    "        STA 0      ; sum += n",
    "        LDA 1",
    "        SBI 1",
    "        STA 1      ; n -= 1",
    "        JZ done",
    "        JMP loop",
    "done:   LDA 0",
    "        OUT",
    "        HLT",
  ].join("\n");
  await click(page, at(24.5, 16)); // the program ROM
  await inspector.getByLabel("Assembly", { exact: true }).fill(program);
  await button("Assemble").click();
  await expect(inspector.getByRole("status")).toHaveText("Assembled 15 words.");
  await page.getByLabel("Speed").selectOption("1000");
  // A clock cycle is not an instruction: one instruction step is two cycles, ending as the next fetch begins.
  await until.selectOption({ label: "Until LED Fetch lights" });
  await button("Run").click();
  await expect(counter(page)).toHaveText("Cycle 2, clock high");
  await expect(readout(page, "LED PC")).toHaveText("LED PC: 1 (0x01)");
  await expect(readout(page, "LED IR")).toHaveText("LED IR: 4096 (0x1000)"); // LDI 0, just executed
  await expect(button("Run")).toBeVisible(); // stopped by the LED, not a click
  await expect(page.locator(".status-live")).toContainText("Stopped: LED Fetch lit."); // and says so (ADR 0021)
  // Then to the end: the loop runs five times and the output device shows the sum.
  await until.selectOption({ label: "Until LED Halted lights" });
  await button("Run").click();
  await expect(readout(page, "LED Halted")).toHaveText("LED Halted: on");
  await expect(readout(page, "LED Output")).toHaveText("LED Output: 15 (0x0F)");
});

test("devices demo: a held key shows its code on two digits and is drawn on the screen (ADR 0021)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("devices"));
  await expect(status(page)).toContainText("Settled");
  const at = await grid(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.getByLabel("Speed").selectOption("1000");
  await button("Run").click();
  // The keyboard takes the keys on a click; Shift+A gives "A", 0x41.
  await click(page, at(2, 15));
  await expect(status(page)).toContainText("The keyboard has the keys");
  await page.keyboard.down("Shift");
  await page.keyboard.down("A");
  await expect(readout(page, "Keyboard Keys")).toHaveText("Keyboard Keys: 65 (0x41)");
  await expect(readout(page, "Seven-segment High")).toHaveText("Seven-segment High: 102 (0x66)"); // 4
  await expect(readout(page, "Seven-segment Low")).toHaveText("Seven-segment Low: 6 (0x06)"); // 1
  // Held through at least two clock rises: the screen's word 0x41 takes the code.
  const cycle = async () => Number(/\d+/.exec((await counter(page).textContent()) ?? "")?.[0]);
  const held = await cycle();
  await expect.poll(cycle).toBeGreaterThanOrEqual(held + 2);
  await page.keyboard.up("A");
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await expect(status(page)).not.toContainText("The keyboard has the keys");
  await button("Pause").click();
  await click(page, at(25.5, 21.5)); // the screen
  const contents = page.getByRole("region", { name: "Screen contents" });
  await expect(contents).toContainText("0x00 0x41 0x00 0x00 0x00 0x00 0x00 0x00");
  await expect(readout(page, "Keyboard Keys")).toHaveText("Keyboard Keys: 0 (0x00)");
});

test("memory-mapped I/O demo: the shipped CPU program shows the key held on the digits and draws it on the screen (ADR 0022)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("reference-cpu"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.getByLabel("Speed").selectOption("1000");
  await button("Run").click();
  // The devices open in view; the program waits on KEY until a key is held.
  await click(page, at(14, 10)); // the keyboard at (12,9)
  await expect(status(page)).toContainText("The keyboard has the keys");
  await page.keyboard.down("Shift");
  await page.keyboard.down("A");
  await expect(readout(page, "Keyboard")).toHaveText("Keyboard: 65 (0x41)");
  await expect(readout(page, "Seven-segment High")).toHaveText("Seven-segment High: 102 (0x66)"); // 4
  await expect(readout(page, "Seven-segment Low")).toHaveText("Seven-segment Low: 6 (0x06)"); // 1
  // HEX is stored first; SDATA three instructions later, so hold through a few more of them.
  const cycle = async () => Number(/\d+/.exec((await counter(page).textContent()) ?? "")?.[0]);
  const shown = await cycle();
  await expect.poll(cycle).toBeGreaterThanOrEqual(shown + 8);
  await page.keyboard.up("A");
  await page.keyboard.up("Shift");
  // Pause gives the keys back too; no Escape, which a running CPU would read as key 27.
  await button("Pause").click();
  await expect(status(page)).not.toContainText("The keyboard has the keys");
  await expect(readout(page, "Seven-segment High")).toHaveText("Seven-segment High: 102 (0x66)");
  await click(page, at(35, 5)); // the screen at (25,0)
  const contents = page.getByRole("region", { name: "Screen contents" });
  await expect(contents).toContainText("0x00 0xFF 0x00 0x00 0x00 0x00 0x00 0x00");
  await expect(contents).not.toContainText(/0xFF[\s\S]*0xFF/); // byte 0x41 only
});

test("game demo: in Catch the first block is caught, a miss halts the run, and an arrow held moves the paddle (ADR 0023)", async ({ page }) => {
  // The game runs in real time: about 3 s a block at full speed, three times that or more in a busy
  // headless browser. The checks are outcomes, not the moment a key lands, so only the budget is long.
  test.setTimeout(300_000);
  const game = { timeout: 120_000 };
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("catch"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const halted = readout(page, "LED Halted");
  const contents = page.getByRole("region", { name: "Screen contents" });
  await page.getByLabel("Speed").selectOption("10000");
  await page.getByLabel("Run until").selectOption({ label: "Until LED Halted lights" });
  // No keys: the first block falls in the paddle's lane 3 and scores; the second, in lane 0, is missed.
  await button("Run").click();
  await expect(readout(page, "Seven-segment Low")).toHaveText("Seven-segment Low: 6 (0x06)", game); // 1
  await expect(halted).toHaveText("LED Halted: on", game);
  await expect(page.locator(".status-live")).toContainText("Stopped: LED Halted lit.");
  await expect(readout(page, "Seven-segment High")).toHaveText("Seven-segment High: 63 (0x3F)"); // 0
  await click(page, at(35, 5)); // the screen at (25,0)
  await expect(contents).toContainText("0x3C 0x00 0x00 0xFF 0x00 0x00 0x00 0x00"); // row 31: block, paddle
  // Again, with Right held: the paddle moves to the right edge, so the first block is missed.
  await button("Reset").click();
  await expect(halted).toHaveText("LED Halted: off");
  await button("Run").click();
  await click(page, at(14, 10)); // the keyboard at (12,9)
  await expect(status(page)).toContainText("The keyboard has the keys");
  await page.keyboard.down("ArrowRight");
  await expect(halted).toHaveText("LED Halted: on", game);
  await page.keyboard.up("ArrowRight");
  await expect(readout(page, "Seven-segment Low")).toHaveText("Seven-segment Low: 63 (0x3F)"); // 0
  await click(page, at(35, 5));
  await expect(contents).toContainText("0x00 0x00 0x00 0x3C 0x00 0x00 0x00 0xFF"); // the block in lane 3, the paddle in lane 7
});

test("waveforms: the 8-bit counter stepped three times reads 0x00 to 0x03, and a cursor reads any tick (ADR 0026)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="import-file"]').setInputFiles(example("8-bit-counter"));
  await expect(counter(page)).toHaveText("Cycle 0, clock low");
  const at = await grid(page);
  await click(page, at(1, 7)); // Count on
  await expectStates(page, { "Switch Count": 1 });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const waves = page.getByRole("region", { name: "Waveforms" });
  await expect(waves).toHaveCount(0);

  // Watch the clock's wire and the register's output, both before any step.
  await click(page, at(18, 9));
  await inspector.getByRole("button", { name: "Watch", exact: true }).click();
  await click(page, at(28, 1));
  await inspector.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(inspector.getByRole("button", { name: "Stop watching" })).toBeVisible();
  const rows = waves.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Clockoff");
  await expect(rows.nth(1)).toContainText("Register Value q0 (0x00)");

  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(waves.getByText("Now: tick 6")).toBeVisible();
  await expect(rows.nth(1)).toContainText("3 (0x03)");
  // Each value the register held for a whole cycle is written in its band; 0x00 lasted one tick, too short for text.
  await expect(waves.locator(".wave-text")).toHaveText(["01", "02", "03"]);
  await expect(waves.locator(".wave-bit")).toHaveAttribute("d", /^M0 20H12V4H24V20H36V4H48V20H60V4H72V20H84$/);

  // A cursor at tick 2, in cycle 1: the register reads 1, the clock low. Left twice reaches tick 0.
  const lanes = waves.getByRole("slider", { name: "Waveform cursor" });
  await lanes.click({ position: { x: 2.5 * 12, y: 30 } });
  await expect(waves.getByText("Cursor: tick 2, cycle 1")).toBeVisible();
  await expect(lanes).toHaveAttribute("aria-valuetext", "tick 2, cycle 1");
  await expect(rows.nth(1)).toContainText("1 (0x01)");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(waves.getByText("Cursor: tick 0, cycle 0")).toBeVisible();
  await expect(rows.nth(1)).toContainText("0 (0x00)");
  await page.keyboard.press("Escape");
  await expect(waves.getByText("Now: tick 6")).toBeVisible();

  // Reset starts a new record: a cursor placed before it is gone.
  await lanes.click({ position: { x: 2.5 * 12, y: 30 } });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(waves.getByText("Now: tick 0")).toBeVisible();
  await expect(rows.nth(1)).toContainText("0 (0x00)");

  // Stopping the last watch hides the panel.
  await waves.getByRole("button", { name: "Stop watching Register Value q" }).click();
  await expect(rows).toHaveCount(1);
  await waves.getByRole("button", { name: "Stop watching Clock", exact: true }).click();
  await expect(waves).toHaveCount(0);
});

test("examples open from the list with their notes; notes edited here travel in a link (ADR 0027)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const examples = page.getByRole("region", { name: "EXAMPLES" });
  const notes = page.getByRole("textbox", { name: "Notes" });
  await expect(notes).toHaveValue("");
  await openTab(page, "Learn");
  await examples.getByRole("button", { name: "4-bit adder" }).click();
  await expect(notes).toHaveValue(/^Four full adders in a chain add two 4-bit numbers/);
  await expect(page.getByRole("list", { name: "Inputs and outputs" })).toContainText("LED Cout");

  // Another example replaces it without asking: the work on screen is saved in the browser (ADR 0029). Where it
  // cannot be, the question stays (the persistence tests).
  await openTab(page, "Learn");
  await examples.getByRole("button", { name: "AND gate" }).click();
  await expect(notes).toHaveValue(/^The simplest circuit/);
  await expect(status(page)).toContainText("Settled");

  await notes.fill("Mine now.\n\nSecond paragraph.");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator(".file-notice")).toHaveText(/^Link copied/);
  const other = await context.newPage();
  await other.goto(await page.evaluate(() => navigator.clipboard.readText()));
  await expect(other.getByRole("textbox", { name: "Notes" })).toHaveValue("Mine now.\n\nSecond paragraph.");
});

test("components come from an example: its 8-bit adder, with the full adder inside, adds in a new circuit (ADR 0027)", async ({ page }) => {
  await page.goto("/");
  const parts = page.getByRole("complementary", { name: "Parts" });
  await parts.getByRole("button", { name: "Add components…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add components" });
  await dialog.getByLabel("From an example").selectOption({ label: "8-bit counter" });
  const choices = dialog.getByRole("group", { name: "Components in 8-bit counter" });
  await expect(choices.getByRole("checkbox")).toHaveCount(2);
  await choices.getByRole("checkbox", { name: "8-bit adder with Full adder" }).check();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toContainText("Added Full adder and 8-bit adder.");
  // Focus moved to Close; a part's shortcut key does nothing behind the dialog.
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("n");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(parts.getByRole("button", { name: /^NOT/ })).toHaveAttribute("aria-pressed", "false");
  await expect(dialog).toBeHidden();

  // Placed, then opened on its own sheet, which simulates it: A at (0,0) and B at (0,12) as in the 8-bit adder example.
  const at = await grid(page);
  // A chip, not the example of the same name in the Examples list.
  await parts.locator(".chip-list").getByRole("button", { name: "8-bit adder", exact: true }).click();
  await click(page, at(10, 4));
  await page.getByRole("complementary", { name: "Inspector" }).getByRole("button", { name: "Edit component" }).click();
  const value = page.getByLabel("Value");
  await click(page, at(2.5, 1));
  await value.fill("200");
  await value.press("Enter");
  await click(page, at(2.5, 13));
  await value.fill("100");
  await value.press("Enter");
  await expect(readout(page, "LED Sum")).toHaveText("LED Sum: 44 (0x2C)");
  await expect(readout(page, "LED Cout")).toHaveText("LED Cout: on");
});

test("components whose IDs are taken by others arrive under new IDs and numbered names, and adding again adds nothing (ADR 0027)", async ({ page }) => {
  await page.goto("/");
  // Challenge 5's starter has its own 8-bit adder (pins only) and full adder, under the example's IDs.
  await openTab(page, "Learn");
  await challenges(page).getByRole("button", { name: "5. 8-bit adder" }).click();
  const parts = page.getByRole("complementary", { name: "Parts" });
  const dialog = page.getByRole("dialog", { name: "Add components" });
  const addAdder = async () => {
    await parts.getByRole("button", { name: "Add components…" }).click();
    await dialog.getByLabel("From an example").selectOption({ label: "8-bit counter" });
    await dialog.getByRole("checkbox", { name: "8-bit adder with Full adder" }).check();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
  };
  await addAdder();
  await expect(dialog).toContainText("Added Full adder 2 and 8-bit adder 2.");
  await dialog.getByRole("button", { name: "Close" }).click();
  const chips = parts.locator("[data-section=chips] .part-tile");
  // The open sheet is the starter's 8-bit adder, which is not offered as a chip on itself.
  await expect(chips).toHaveText(["Full adder", "Full adder 2", "8-bit adder 2"]);
  await addAdder();
  await expect(dialog).toContainText("Full adder 2 and 8-bit adder 2 were already here.");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(chips).toHaveCount(3);
  // The challenge still checks its own 8-bit adder, which is unchanged: its starter still fails.
  await challenge(page).getByRole("button", { name: "Check" }).click();
  await expect(checked(page)).toHaveText(/^Step \d+ of 32 failed\./);
});

test("work is kept in the browser: a reload brings it back, New starts another, and the list reopens the first (ADR 0029)", async ({ page }) => {
  await page.goto("/");
  const projects = page.getByRole("region", { name: "PROJECTS" });
  const name = page.getByLabel("Project name");
  const saved = page.locator(".status-save");
  await openTab(page, "Projects");
  await expect(projects).toContainText("Saved in this browser as you work.");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(2, 2));
  await name.fill("Bench");
  await name.press("Enter");
  await expect(saved).toHaveText(/^Saved /);
  await openTab(page, "Projects");
  await expect(projects.getByRole("button", { name: /^Bench/ })).toHaveAttribute("aria-current", "true");

  await page.reload();
  await expect(name).toHaveValue("Bench");
  await expect(page.getByRole("list", { name: "Inputs and outputs" })).toContainText("Switch 1");

  // A new circuit is not a project until it changes; the first is still listed and reopens.
  await openTab(page, "Projects");
  await projects.getByRole("button", { name: "New circuit" }).click();
  await expect(name).toHaveValue("Untitled");
  await expect(page.getByRole("list", { name: "Inputs and outputs" })).not.toContainText("Switch 1");
  await openTab(page, "Projects");
  await expect(projects.getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("l");
  await click(page, at(2, 2));
  await openTab(page, "Projects");
  await expect(projects.getByRole("listitem")).toHaveCount(2);
  await openTab(page, "Projects");
  await projects.getByRole("button", { name: /^Bench/ }).click();
  await expect(name).toHaveValue("Bench");
  await expect(page.getByRole("list", { name: "Inputs and outputs" })).toContainText("Switch 1");

  // Deleting asks first; the circuit on screen stays.
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await openTab(page, "Projects");
  await projects.getByRole("button", { name: "Delete project Untitled" }).click();
  await openTab(page, "Projects");
  await expect(projects.getByRole("listitem")).toHaveCount(1);
  expect(asked).toBe("Delete the project Untitled from this browser? This cannot be undone.");
});

/** The revision of every project the page's browser has stored, read straight from IndexedDB. */
const storedRevisions = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const request = indexedDB.open("clockyard");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction("projects").objectStore("projects").getAll();
          all.onsuccess = () => {
            request.result.close();
            resolve((all.result as { revision: number }[]).map((p) => p.revision));
          };
        };
      }),
  );

test("a project another tab saved first is not overwritten: this tab's work becomes a copy (ADR 0029)", async ({ page, context }) => {
  await page.goto("/");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(2, 2));
  await expect(page.locator(".status-save")).toHaveText(/^Saved /);

  // The same project, open in a second tab, changed there first.
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByLabel("Project name")).toHaveValue("Untitled");
  const there = await grid(other);
  await other.keyboard.press("l");
  await click(other, there(8, 2));
  // Stored by the other tab: its revision is 2 (the status says Saved as soon as a project opens).
  await expect.poll(() => storedRevisions(other)).toEqual([2]);

  await page.keyboard.press("n");
  await click(page, at(8, 8));
  await expect(page.locator(".status-save")).toHaveText("Another tab changed or deleted this project, so this work was saved as a copy.");
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled (copy)");
  await openTab(page, "Projects");
  await expect(page.getByRole("region", { name: "PROJECTS" }).getByRole("listitem")).toHaveCount(2);
});

test("where the browser keeps no storage, the editor still works, says so, and asks before replacing (ADR 0029)", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined }));
  await page.goto("/");
  await openTab(page, "Projects");
  await expect(page.getByRole("region", { name: "PROJECTS" })).toContainText("Not saved in this browser: this browser keeps no storage for the page.");
  await expect(page.locator(".status-save")).toHaveText("Not saved in this browser");
  const at = await grid(page);
  await page.keyboard.press("s");
  await click(page, at(2, 2));
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await openTab(page, "Learn");
  await page.getByRole("region", { name: "EXAMPLES" }).getByRole("button", { name: "AND gate" }).click();
  await expect.poll(() => asked).toBe("Replace the current circuit? Changes since your last export will be lost.");
  await expect(page.getByRole("list", { name: "Inputs and outputs" })).toContainText("Switch 1");
  // The wordmark's link to the about page asks too, and staying keeps the circuit.
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("link", { name: "Clockyard" }).click();
  await expect.poll(() => asked).toBe("Leave the editor? Unsaved changes will be lost.");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("list", { name: "Inputs and outputs" })).toContainText("Switch 1");
});

test("a component saved to the library is added to another project, and a passed challenge stays marked (ADR 0029)", async ({ page }) => {
  await page.goto("/");
  const parts = page.getByRole("complementary", { name: "Parts" });
  await openTab(page, "Learn");
  await page.getByRole("region", { name: "EXAMPLES" }).getByRole("button", { name: "4-bit adder" }).click();
  await parts.getByRole("button", { name: "Save Full adder to your library" }).click();
  await expect(parts).toContainText("Full adder saved in your library.");
  // Saving it again replaces it, after asking.
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await parts.getByRole("button", { name: "Save Full adder to your library" }).click();
  await expect(parts).toContainText("Full adder replaced in your library.");
  expect(asked).toBe("Replace Full adder in your library? Projects that already added it keep their copy.");

  await openTab(page, "Projects");
  await page.getByRole("button", { name: "New circuit" }).click();
  await parts.getByRole("button", { name: "Add components…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add components" });
  await dialog.getByLabel("From an example or your library").selectOption({ label: "Full adder" });
  await dialog.getByRole("checkbox", { name: "Full adder" }).check();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toContainText("Added Full adder.");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(parts.locator(".chip-list .part-tile", { hasText: "Full adder" })).toHaveCount(1);

  // The inverter, solved by its reference solution: checked, it is marked passed, and stays so after a reload.
  await page.locator('[data-testid="import-file"]').setInputFiles(solution("01-inverter"));
  await page.getByRole("region", { name: "Challenge", exact: true }).getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("region", { name: "Challenge", exact: true })).toContainText("First passed");
  await page.reload();
  await openTab(page, "Learn");
  await expect(challenges(page).getByRole("button", { name: "1. Inverter passed" })).toBeVisible();
  await openTab(page, "Learn");
  await expect(challenges(page).getByRole("button", { name: "2. XOR from NAND gates" })).not.toContainText("✓");
});

test("the chrome works from the keyboard: tabs, palette, placing a part, panes and a refused value (ADR 0032)", async ({ page }) => {
  await page.goto("/");
  const parts = page.getByRole("complementary", { name: "Parts" });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const canvas = page.getByRole("main", { name: "Circuit canvas" });

  // Arrow keys walk the tabs, and each shows its own panel.
  await page.getByRole("tab", { name: "Parts" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "New circuit" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("region", { name: "EXAMPLES" })).toBeVisible();
  await page.keyboard.press("Home");

  // Arrow keys walk the palette, and Enter puts the part on the sheet, selected.
  await parts.getByRole("button", { name: /^Switch/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(parts.getByRole("button", { name: "Clock" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(readout(page, "Switch 1")).toHaveCount(1);

  // A refused value stays with its reason; Escape restores the old one, and a second hands the keyboard to the canvas.
  const width = inspector.getByRole("textbox", { name: "Width" });
  await width.fill("99");
  await width.press("Enter");
  await expect(width).toBeFocused();
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await expect(inspector.getByRole("alert")).toHaveText("Enter a whole number from 1 to 32.");
  await width.press("Escape");
  await expect(width).toHaveValue("1");
  await expect(width).toBeFocused();
  await width.press("Escape");
  await expect(canvas).toBeFocused();

  // F6 moves between panes, and part keys belong to the canvas, not to a focused control.
  await page.keyboard.press("F6");
  await expect(inspector).toBeFocused();
  await page.keyboard.press("Shift+F6");
  await expect(canvas).toBeFocused();
  await page.getByRole("button", { name: "Step", exact: true }).focus();
  await page.keyboard.press("l");
  await expect(status(page)).not.toContainText("Placing");

  // A click on a button leaves the keys with the canvas, without its focus ring.
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(canvas).not.toBeFocused();
  await page.keyboard.press("l");
  await expect(status(page)).toContainText("Placing LED");
  await page.keyboard.press("Escape");

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Shortcuts and gestures" })).toBeVisible();
});

test("a narrow window folds history and files into More, and starts with the notes closed (ADR 0032)", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await page.goto("/");
  const exportButton = page.getByRole("button", { name: "Export" });
  await expect(exportButton).toBeHidden();
  await page.getByRole("button", { name: "More" }).click();
  await expect(exportButton).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exportButton).toBeHidden();

  const notes = page.getByRole("button", { name: "Notes" });
  await expect(notes).toHaveAttribute("aria-expanded", "false");
  await notes.click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toBeVisible();
});
