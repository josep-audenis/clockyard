import { expect, test } from "vitest";
import { bindingName, BINDING, buttonValues, keyHolds } from "./buttons";
import type { KeyEvent } from "./keyboard";

const key = (type: "keydown" | "keyup", code: string, extra: Partial<KeyEvent> = {}): KeyEvent => ({
  type,
  key: code.replace(/^(Key|Digit)/, "").toLowerCase(),
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  altGraph: false,
  ...extra,
});

test("a binding is a letter or digit key by its physical code, shown by its place on a US layout", () => {
  for (const ok of ["KeyA", "KeyZ", "Digit0", "Digit9"]) expect(BINDING.test(ok)).toBe(true);
  for (const bad of ["Keya", "Key1", "Digit", "Space", "Numpad1", "a", "ArrowLeft"]) expect(BINDING.test(bad)).toBe(false);
  expect([bindingName("KeyQ"), bindingName("Digit1")]).toEqual(["Q", "1"]);
});

test("a bound key holds its buttons and is theirs; others are not; Ctrl, Cmd or a Meta release let go of all", () => {
  const bound = new Set(["Digit1", "Digit2"]);
  let held: ReadonlySet<string> = new Set();
  const step = (e: KeyEvent) => {
    const next = keyHolds(held, bound, e);
    held = next.held;
    return next.ours;
  };
  expect(step(key("keydown", "Digit1"))).toBe(true);
  expect(step(key("keydown", "Digit1"))).toBe(true); // a repeat
  expect(step(key("keydown", "Digit2"))).toBe(true);
  expect([...held]).toEqual(["Digit1", "Digit2"]);
  expect(step(key("keydown", "KeyR"))).toBe(false);
  expect(step(key("keyup", "Digit1"))).toBe(true);
  expect([...held]).toEqual(["Digit2"]);
  // Ctrl+Z is the editor's, even with a bound key down, and lets go.
  expect(step(key("keydown", "KeyZ", { ctrlKey: true }))).toBe(false);
  expect(held.size).toBe(0);
  step(key("keydown", "Digit2"));
  expect(step({ ...key("keyup", "MetaLeft"), key: "Meta" })).toBe(false);
  expect(held.size).toBe(0);
  // Shift with a bound digit is its own key there, so still the button's; Alt with it is not.
  expect(step(key("keydown", "Digit1", { altKey: true }))).toBe(false);
});

test("a button is held while any pointer or its key holds it, so two pointers hold two buttons", () => {
  const buttons = [{ id: "p", binding: "Digit1" }, { id: "q" }, { id: "r", binding: "Digit1" }];
  // Pointers 1 and 2 on p and q; a third pointer dragging holds nothing and is not in the map.
  const pointers = new Map([
    [1, "p"],
    [2, "q"],
  ]);
  expect(buttonValues(buttons, pointers.values(), new Set())).toEqual({ p: 1, q: 1, r: 0 });
  pointers.delete(1);
  expect(buttonValues(buttons, pointers.values(), new Set(["Digit1"]))).toEqual({ p: 1, q: 1, r: 1 });
  expect(buttonValues(buttons, [], new Set())).toEqual({ p: 0, q: 0, r: 0 });
});
