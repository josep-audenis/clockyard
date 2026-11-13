// A keyboard part's value (ADR 0021): the code of the key held down, or 0.

/** Keys with no printable character, by `KeyboardEvent.key`. */
const NAMED: Record<string, number> = {
  Enter: 13,
  Backspace: 8,
  Escape: 27,
  ArrowUp: 0x80,
  ArrowDown: 0x81,
  ArrowLeft: 0x82,
  ArrowRight: 0x83,
};

/** A key's code: printable ASCII as itself (Space is 32), the named keys above, or null for any other key. */
export function keyCode(key: string): number | null {
  const named = NAMED[key];
  if (named !== undefined) return named;
  const code = key.length === 1 ? key.charCodeAt(0) : -1;
  return code >= 32 && code <= 126 ? code : null;
}

/**
 * The keys held, in the order pressed, by physical key (`KeyboardEvent.code`), each
 * with the code it gave when pressed: Shift released before A still releases "A".
 */
export type Held = readonly { key: string; code: number }[];

/** Pressing a key: it goes last, so it wins (a repeat changes nothing). */
export const press = (held: Held, key: string, code: number): Held => [...held.filter((h) => h.key !== key), { key, code }];

/** Releasing a key: the one pressed before it wins again, if still held. */
export const release = (held: Held, key: string): Held => held.filter((h) => h.key !== key);

/** The value the keyboard drives: the last key still held, or 0. */
export const heldCode = (held: Held) => held.at(-1)?.code ?? 0;

/** What a key event needs from the browser: AltGr as its own flag (`getModifierState("AltGraph")`). */
export type KeyEvent = { type: string; key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; altGraph: boolean };

/**
 * One key event while a keyboard part has the keys: the keys held after it, whether the
 * editor still hears it (`pass`), whether the browser's own action is stopped (`prevent`),
 * and whether the keys go back to the editor (`release`).
 *
 * - Ctrl or Cmd without Alt or AltGr is the editor's (undo, copy). Keys held then are let go:
 *   macOS sends no keyup for a key released while Cmd is down.
 * - AltGr (Ctrl+Alt on Windows) and Option combinations type characters (`@` on many layouts): keys.
 * - Tab moves on and gives the keys back; Escape gives them back once released.
 * - Releasing Meta lets go of every key, for the same macOS reason.
 */
export function keyStep(held: Held, e: KeyEvent): { held: Held; pass: boolean; prevent: boolean; release: boolean } {
  const down = e.type === "keydown";
  // Some events carry no physical key; the character keeps them apart.
  const physical = e.code || e.key;
  if (down && (e.ctrlKey || e.metaKey) && !e.altKey && !e.altGraph) return { held: [], pass: true, prevent: false, release: false };
  if (down && e.key === "Tab") return { held: [], pass: true, prevent: false, release: true };
  if (!down && e.key === "Meta") return { held: [], pass: false, prevent: false, release: false };
  if (!down) return { held: release(held, physical), pass: false, prevent: false, release: e.key === "Escape" };
  const code = keyCode(e.key);
  return code === null
    ? { held, pass: false, prevent: false, release: false }
    : { held: press(held, physical, code), pass: false, prevent: true, release: false };
}
