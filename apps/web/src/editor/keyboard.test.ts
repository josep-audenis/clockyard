import { expect, test } from "vitest";
import { heldCode, keyCode, keyStep, press, release, type Held, type KeyEvent } from "./keyboard";

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

test("a key event with the keys: editor combinations pass, AltGr and Option type, Tab and a released Escape give the keys back", () => {
  const event = (type: string, key: string, code: string, mods: Partial<KeyEvent> = {}): KeyEvent => ({
    type, key, code, ctrlKey: false, metaKey: false, altKey: false, altGraph: false, ...mods,
  });
  const a: Held = [{ key: "KeyA", code: 97 }];
  // Ctrl+Z is the editor's, and lets go of what was held (macOS sends no keyup under Cmd).
  expect(keyStep(a, event("keydown", "z", "KeyZ", { ctrlKey: true }))).toEqual({ held: [], pass: true, prevent: false, release: false });
  expect(keyStep(a, event("keydown", "c", "KeyC", { metaKey: true })).pass).toBe(true);
  // AltGr+2 on a Spanish layout on Windows (Ctrl and Alt both set), and Option+2 on a Spanish Mac: "@".
  for (const mods of [{ ctrlKey: true, altKey: true, altGraph: true }, { altKey: true }]) {
    const step = keyStep([], event("keydown", "@", "Digit2", mods));
    expect(step).toEqual({ held: [{ key: "Digit2", code: 64 }], pass: false, prevent: true, release: false });
  }
  expect(keyStep(a, event("keydown", "Tab", "Tab"))).toEqual({ held: [], pass: true, prevent: false, release: true });
  // Escape is a key while held; let go, it gives the keys back.
  const esc = keyStep([], event("keydown", "Escape", "Escape"));
  expect(heldCode(esc.held)).toBe(27);
  expect(keyStep(esc.held, event("keyup", "Escape", "Escape"))).toEqual({ held: [], pass: false, prevent: false, release: true });
  // Releasing Meta lets go of everything; a key with no code is told apart by its character.
  expect(keyStep(a, event("keyup", "Meta", "MetaLeft")).held).toEqual([]);
  expect(keyStep(a, event("keydown", "b", "")).held).toEqual([...a, { key: "b", code: 98 }]);
  // A key with no code (Shift, F1) is heard by nobody and changes nothing.
  expect(keyStep(a, event("keydown", "F1", "F1"))).toEqual({ held: a, pass: false, prevent: false, release: false });
});
