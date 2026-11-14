import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CircuitDocument } from "../src/editor/document";

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
/** The cycle counter: outside the status region, which it would flood while running (ADR 0017). */
const counter = (page: Page) => page.getByText(/^Cycle \d+, clock (high|low)$/);
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
  await expect(status(page)).toContainText("Outputs are wired together.");
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
  const name = page.getByLabel("Name");
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
  await click(page, at(15, 12)); // its tag, left of the dot, since the wire leaves right
  await expect(name).toHaveValue("go"); // the label is selected
  await name.fill("stop");
  await name.press("Enter");
  await expectStates(page, { "Switch 1": 1, "LED 1": 0 });
  const message = status(page).locator(".status-message");
  await expect(message).toHaveAttribute("title", /label `go` joins nothing/);
  await expect(message).toHaveAttribute("title", /label `stop` joins nothing/);
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
  // The devices open in view along the top of the sheet; the program waits on KEY until a key is held.
  await click(page, at(14, 2)); // the keyboard at (12,1)
  await expect(status(page)).toContainText("The keyboard has the keys");
  await page.keyboard.down("Shift");
  await page.keyboard.down("A");
  await expect(readout(page, "Keyboard Keyboard")).toHaveText("Keyboard Keyboard: 65 (0x41)");
  await expect(readout(page, "Seven-segment High")).toHaveText("Seven-segment High: 102 (0x66)"); // 4
  await expect(readout(page, "Seven-segment Low")).toHaveText("Seven-segment Low: 6 (0x06)"); // 1
  // HEX is stored first; SDATA three instructions later, so hold through a few more of them.
  const cycle = async () => Number(/\d+/.exec((await counter(page).textContent()) ?? "")?.[0]);
  const shown = await cycle();
  await expect.poll(cycle).toBeGreaterThanOrEqual(shown + 8);
  await page.keyboard.up("A");
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await button("Pause").click();
  // Released, the program waits again and the digits keep the last key.
  await expect(readout(page, "Seven-segment High")).toHaveText("Seven-segment High: 102 (0x66)");
  await click(page, at(35, 5)); // the screen at (26,0)
  const contents = page.getByRole("region", { name: "Screen contents" });
  await expect(contents).toContainText("0x00 0xFF 0x00 0x00 0x00 0x00 0x00 0x00");
});
