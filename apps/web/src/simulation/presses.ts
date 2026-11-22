// ADR 0038: when each push button held went to 1, so a release at that same tick while a run is going can be
// reported. No tick between press and release means no clock edge fell while it was held.

/** Notes the button values of one `setInputs`, at tick `now`; returns the buttons let go at the tick they went to 1. */
export function notePresses(
  pressedAt: Map<string, number>,
  buttons: ReadonlySet<string>,
  values: Record<string, number>,
  now: number,
  running: boolean,
): string[] {
  const short: string[] = [];
  for (const [id, value] of Object.entries(values)) {
    if (!buttons.has(id)) continue;
    if (value === 1 && !pressedAt.has(id)) pressedAt.set(id, now);
    if (value === 0 && pressedAt.has(id)) {
      if (running && pressedAt.get(id) === now) short.push(id);
      pressedAt.delete(id);
    }
  }
  return short;
}
