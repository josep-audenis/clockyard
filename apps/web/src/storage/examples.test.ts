import { expect, test } from "vitest";
import { MAX_NOTES } from "../editor/document";
import { EXAMPLES, exampleDocument, exampleFiles } from "./examples";

test("every bundled example is listed once, and the list names each by the file's own name (ADR 0027)", async () => {
  expect([...exampleFiles()].sort()).toEqual(EXAMPLES.map((e) => e.name).sort());
  for (const { name, title } of EXAMPLES) {
    const document = await exampleDocument(name, "2026-11-16T09:00:00.000Z");
    expect(document.metadata).toMatchObject({ name: title, createdAt: "2026-11-16T09:00:00.000Z", modifiedAt: "2026-11-16T09:00:00.000Z" });
  }
});

test("every example carries notes: what it shows and what to try, in paragraphs", async () => {
  for (const { name } of EXAMPLES) {
    const notes = (await exampleDocument(name)).metadata.notes ?? "";
    expect(notes.split("\n\n").length, name).toBeGreaterThanOrEqual(2);
    expect([...notes].length, name).toBeLessThanOrEqual(MAX_NOTES);
  }
});

test("an example that is not bundled is refused by name", async () => {
  await expect(exampleDocument("nothing")).rejects.toThrow("There is no example nothing.");
});
