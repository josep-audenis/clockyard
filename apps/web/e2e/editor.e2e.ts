import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Must match the canvas defaults in src/canvas/scene.ts: view offset and grid cell, in CSS px.
const ORIGIN = 48;
const CELL = 16;

type At = { x: number; y: number };

/** Screen position of a grid point at the default view. */
async function grid(page: Page): Promise<(x: number, y: number) => At> {
  const box = await page.getByRole("main", { name: "Circuit canvas" }).boundingBox();
  if (!box) throw new Error("canvas not visible");
  return (x, y) => ({ x: box.x + ORIGIN + x * CELL, y: box.y + ORIGIN + y * CELL });
}

const click = (page: Page, at: At) => page.mouse.click(at.x, at.y);

async function drag(page: Page, from: At, to: At) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

const status = (page: Page) => page.getByRole("status");
const readout = (page: Page, name: string) =>
  page.getByRole("list", { name: "Inputs and outputs" }).getByText(new RegExp(`^${name}:`));
const onOff = (bit: number) => (bit ? "on" : "off");

async function expectStates(page: Page, states: Record<string, number>) {
  for (const [name, bit] of Object.entries(states)) await expect(readout(page, name)).toHaveText(`${name}: ${onOff(bit)}`);
}

const example = (name: string) => fileURLToPath(new URL(`../../../examples/${name}.clockyard.json`, import.meta.url));

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

  // Save, reload the page, import the file: the circuit comes back; switch positions do not.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("untitled.clockyard.json");
  const file = await saved.path();
  await page.reload();
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
  await expect(status(page)).toContainText("A wire connects two outputs.");
  await page.keyboard.press("Delete");
  await expect(status(page)).toContainText("Settled");

  // o = NOR(s, o) oscillates while switch 1 is off and settles once it is on.
  await page.getByRole("button", { name: "NOR", exact: true }).click();
  await click(page, at(8, 4)); // NOR at (6,2): a (6,3), b (6,5), out (10,4)
  await drag(page, at(2, 1), at(6, 3));
  await drag(page, at(10, 4), at(6, 5));
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
  await expect(inspector).toContainText("Wires have no properties yet.");

  // Enter commits.
  await click(page, at(1, 1)); // selects the switch and turns it on
  await expect(label).toHaveAccessibleDescription("Names this input pin of the circuit.");
  await label.fill("A");
  await label.press("Enter");
  await expectStates(page, { "Switch A": 1, "LED 1": 1 });

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
  await page.locator('[data-testid="import-file"]').setInputFiles(file);
  await expectStates(page, { "Switch A": 0, "LED sum": 0 });
  await expect(status(page)).toContainText("(AND half)");
});
