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
