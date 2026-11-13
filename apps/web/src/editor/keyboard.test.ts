import { expect, test } from "vitest";
import { heldCode, keyCode, press, release, type Held } from "./keyboard";

test("key codes: printable ASCII as itself, Enter, Backspace, Escape and the arrows by name, other keys none (ADR 0021)", () => {
  expect(["A", "a", " ", "~", "0"].map(keyCode)).toEqual([65, 97, 32, 126, 48]);
  expect(["Enter", "Backspace", "Escape"].map(keyCode)).toEqual([13, 8, 27]);
  expect(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map(keyCode)).toEqual([0x80, 0x81, 0x82, 0x83]);
  expect(["Shift", "F1", "Tab", "é", "Dead"].map(keyCode)).toEqual([null, null, null, null, null]);
});

test("the last key pressed wins; releasing it gives the one before, if still held; a repeat changes nothing", () => {
  let held: Held = [];
  expect(heldCode(held)).toBe(0);
  held = press(held, "KeyA", 97);
  held = press(held, "ArrowUp", 0x80);
  expect(heldCode(held)).toBe(0x80);
  held = press(held, "ArrowUp", 0x80); // the key repeating while held
  expect(held).toHaveLength(2);
  held = release(held, "ArrowUp");
  expect(heldCode(held)).toBe(97);
  held = press(held, "ArrowUp", 0x80);
  // Released by physical key: Shift let go first still releases the "A" it typed.
  held = press(held, "KeyA", 65);
  held = release(held, "KeyA");
  held = release(held, "ArrowUp");
  expect(heldCode(held)).toBe(0);
});
