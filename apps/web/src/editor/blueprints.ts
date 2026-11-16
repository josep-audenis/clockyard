// Components added from another document (ADR 0027): the picked definitions and those they contain, merged into
// this document's. A definition already here with the same contents under the same ID, or under one numbered from it
// by an earlier add (`id-2`), is reused, so adding twice adds nothing; contents alone never match, since two empty or
// pins-only components are different work in progress. Any other definition gets an ID of its own, and the added
// definitions that contain it are rewritten to it. A name already here is numbered.
import { MAX_LABEL, type Circuit, type Definition } from "./document";

/**
 * `picked` and every definition they contain, contained ones first, each once. Iterative, so a deep chain cannot
 * overflow the stack; a source that reached here has no definition containing itself (`parseDocument`).
 */
export function withContents(source: Definition[], picked: string[]): Definition[] {
  const byId = new Map(source.map((d) => [d.id, d]));
  const order: Definition[] = [];
  const seen = new Set<string>();
  for (const id of picked) {
    const start = byId.get(id);
    if (!start || seen.has(id)) continue;
    seen.add(id);
    const path = [{ definition: start, next: 0 }];
    for (let top = path.at(-1); top; top = path.at(-1)) {
      const inner = top.definition.circuit.components[top.next++];
      if (!inner) {
        order.push(top.definition);
        path.pop();
        continue;
      }
      const child = inner.kind === "custom" && inner.definition ? byId.get(inner.definition) : undefined;
      if (child && !seen.has(child.id)) {
        seen.add(child.id);
        path.push({ definition: child, next: 0 });
      }
    }
  }
  return order;
}

/** Instances in `circuit` of the definitions `ids` renames, pointing at their new IDs. */
const rewire = (circuit: Circuit, ids: Map<string, string>): Circuit => ({
  ...circuit,
  components: circuit.components.map((c) => {
    const id = c.definition && ids.get(c.definition);
    return id && id !== c.definition ? { ...c, definition: id } : c;
  }),
});

/** JSON with every object's keys sorted, so equal contents compare equal however they were built. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );

/** The first of `wanted`, `wanted-2`, `wanted-3`, … not taken. */
function freeId(wanted: string, taken: Set<string>) {
  for (let n = 1; ; n++) {
    const id = n === 1 ? wanted : `${wanted}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The first of `wanted`, `wanted 2`, `wanted 3`, … not taken, cut so that it fits `MAX_LABEL` characters. */
function freeName(wanted: string, taken: Set<string>) {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` ${n}`;
    const name = [...wanted].slice(0, MAX_LABEL - suffix.length).join("").trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}

/** What adding did: the definitions added, under their IDs and names here, and those already here that were reused. */
export type Added = { added: Definition[]; reused: Definition[] };

/** Adds `picked` from `source`, and the definitions they contain, to `target` (ADR 0027). `target` is not changed. */
export function addDefinitions(target: Definition[], source: Definition[], picked: string[]): Added {
  const ids = new Map<string, string>();
  const takenIds = new Set(target.map((d) => d.id));
  const takenNames = new Set(target.map((d) => d.name));
  const result: Added = { added: [], reused: [] };
  const contentsHere = new Map(target.map((d) => [d, canonical(d.circuit)]));
  for (const definition of withContents(source, picked)) {
    // Contained ones come first, so their IDs here are known.
    const circuit = rewire(definition.circuit, ids);
    const contents = canonical(circuit);
    // `id-2`, `id-3`, …: where an earlier add put it.
    const numbered = (d: Definition) => d.id.startsWith(`${definition.id}-`) && /^\d+$/.test(d.id.slice(definition.id.length + 1));
    const same = (d: Definition) => contentsHere.get(d) === contents;
    const here = target.find((d) => d.id === definition.id && same(d)) ?? target.find((d) => numbered(d) && same(d));
    if (here) {
      ids.set(definition.id, here.id);
      result.reused.push(here);
      continue;
    }
    const id = freeId(definition.id, takenIds);
    const name = freeName(definition.name, takenNames);
    takenIds.add(id);
    takenNames.add(name);
    ids.set(definition.id, id);
    result.added.push({ id, name, circuit });
  }
  return result;
}
