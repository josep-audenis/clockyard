// Push buttons (ADR 0038): what holds each one, by pointer or by its key, apart from the canvas's gestures.
import type { KeyEvent } from "./keyboard";

/** A key a button can be bound to, by its physical code: a letter or a digit. */
export const BINDING = /^(Key[A-Z]|Digit[0-9])$/;

/** How a binding is shown: its place on a US layout ("KeyA" is A, "Digit1" is 1). */
export const bindingName = (code: string) => code.replace(/^(Key|Digit)/, "");

/**
 * One key event while the circuit has the keys, for the buttons: the bound keys held after it, and whether the
 * event was theirs (then nothing else hears it).
 *
 * - A plain bound key holds its buttons while down; repeats change nothing.
 * - Ctrl or Cmd with any key is the editor's and lets go of every key-held button, as for the keyboard part:
 *   macOS sends no keyup for a key released while Cmd is down. So does releasing Meta.
 */
export function keyHolds(held: ReadonlySet<string>, bound: ReadonlySet<string>, e: KeyEvent): { held: ReadonlySet<string>; ours: boolean } {
  const down = e.type === "keydown";
  if (down && (e.ctrlKey || e.metaKey) && !e.altKey && !e.altGraph) return { held: new Set(), ours: false };
  if (!down && e.key === "Meta") return { held: new Set(), ours: false };
  // A held key's release lets go whatever is down with it, as for a keyboard part: Alt pressed meanwhile must not keep it.
  if (!down && held.has(e.code)) {
    const next = new Set(held);
    next.delete(e.code);
    return { held: next, ours: true };
  }
  if (!bound.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || e.altGraph) return { held, ours: false };
  const next = new Set(held);
  if (down) next.add(e.code);
  else next.delete(e.code);
  return { held: next, ours: true };
}

/** Each button's value: 1 while a pointer or its bound key holds it. */
export function buttonValues(
  buttons: readonly { id: string; binding?: string }[],
  pointers: Iterable<string>,
  keys: ReadonlySet<string>,
): Record<string, 0 | 1> {
  const pressed = new Set(pointers);
  return Object.fromEntries(buttons.map(({ id, binding }) => [id, pressed.has(id) || (binding !== undefined && keys.has(binding)) ? 1 : 0]));
}
