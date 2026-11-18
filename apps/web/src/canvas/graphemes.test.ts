import { expect, test } from "vitest";
import { withAsciiShortcut } from "./graphemes";

const segmenter = new Intl.Segmenter();
const whole = (text: string) => Array.from(segmenter.segment(text), (s) => s.segment);

test("splits text exactly as the full segmenter does", () => {
  const every = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");
  for (const text of ["", "LED 12", every, "a\r\nb", "é", "\u{1f600}", "A\u{1f1ea}\u{1f1f8}"]) {
    expect(withAsciiShortcut(whole)(text)).toEqual(whole(text));
  }
});

test("leaves anything but printable ASCII to the full segmenter", () => {
  const asked: string[] = [];
  const split = withAsciiShortcut((text) => (asked.push(text), whole(text)));
  split("Clock 1");
  split("a\r\nb");
  split("café");
  expect(asked).toEqual(["a\r\nb", "café"]);
});
