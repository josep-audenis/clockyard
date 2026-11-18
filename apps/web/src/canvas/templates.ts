// Keeping the canvas's shared part shapes (ADR 0030) from growing without bound.

/** Shapes kept at least before unused ones are dropped: enough that an ordinary sheet never pays for dropping them. */
export const MIN_TEMPLATE_LIMIT = 1024;

/**
 * Drops the templates `inUse` says no part shows, and returns the size at which to look again: twice what is left, so
 * the scan of every part that `inUse` rests on stays rare however many shapes a sheet really uses.
 */
export function dropUnused<T>(templates: Map<string, T>, inUse: (template: T) => boolean, destroy: (template: T) => void): number {
  for (const [key, template] of templates) {
    if (inUse(template)) continue;
    templates.delete(key);
    destroy(template);
  }
  return Math.max(MIN_TEMPLATE_LIMIT, 2 * templates.size);
}
