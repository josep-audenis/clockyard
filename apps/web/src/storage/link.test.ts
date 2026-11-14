import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MAX_DOCUMENT_BYTES, parseDocument } from "./file";
import { linkFragment, readLinkFragment } from "./link";

const examples = new URL("../../../../examples/", import.meta.url);
const read = (name: string) => {
  const result = parseDocument(readFileSync(new URL(name, examples), "utf8"));
  if (!result.ok) throw new Error(result.error);
  return result.document;
};
const deflate = async (text: string) => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("base64url");
};

test.each(readdirSync(examples).filter((name) => name.endsWith(".clockyard.json")))("example %s round-trips through a link", async (name) => {
  const document = read(name);
  const fragment = await linkFragment(document);
  expect(fragment).toMatch(/^circuit=1\.[A-Za-z0-9_-]+$/); // nothing a URL would escape
  expect(await readLinkFragment(fragment)).toEqual({ ok: true, document });
  expect(await readLinkFragment(`#${fragment}`)).toEqual({ ok: true, document });
});

test("the largest example, the CPU with its game, makes a link of a few thousand characters", async () => {
  expect((await linkFragment(read("catch.clockyard.json"))).length).toBeLessThan(8000);
});

test("a fragment without a circuit is not a link", async () => {
  expect(await readLinkFragment("")).toBeNull();
  expect(await readLinkFragment("#section-2")).toBeNull();
});

test("a link that cannot be read is refused with the reason", async () => {
  const fragment = await linkFragment(read("and-gate.clockyard.json"));
  const refused = async (text: string) => {
    const result = await readLinkFragment(text);
    return result?.ok === false ? result.error : result;
  };
  expect(await refused(fragment.slice(0, fragment.length / 2))).toBe("This link is cut short or damaged.");
  expect(await refused(`${fragment.slice(0, 20)}!${fragment.slice(21)}`)).toMatch(/characters a Clockyard link never has/);
  expect(await refused(fragment.replace("circuit=1.", "circuit=2."))).toMatch(/cannot read/);
  expect(await refused("circuit=1")).toMatch(/cannot read/); // no version separator
  expect(await refused(`circuit=1.${await deflate("not a circuit")}`)).toBe("This file is not valid JSON.");
  expect(await refused(`circuit=1.${await deflate("{}")}`)).toBeTypeOf("string"); // parseDocument's own reason
});

test("a small link that would expand past the size Import accepts is refused", async () => {
  const bomb = await deflate(" ".repeat(MAX_DOCUMENT_BYTES + 1));
  expect(bomb.length).toBeLessThan(20_000);
  expect(await readLinkFragment(`circuit=1.${bomb}`)).toEqual({
    ok: false,
    error: "This link opens to more than 10 MiB, too large to be a Clockyard circuit.",
  });
});
