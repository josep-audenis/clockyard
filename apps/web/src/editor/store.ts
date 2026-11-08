// The editor's document store (ADR 0007). The canvas reads it outside React
// through `useEditor.getState()` / `subscribe`.
import { create } from "zustand";
import { portAt, simplify, stacksJunction } from "../canvas/geometry";
import { layoutOf, setDefinitionLayouts } from "../canvas/layout";
import { forgetRoutes } from "../canvas/routing";
import type { Endpoint } from "../simulation/protocol";
import {
  contains,
  endOwner,
  fieldsProblem,
  isFielded,
  isJunction,
  MAX_BENDS,
  MAX_LABEL,
  MAX_WIDTH,
  newProps,
  normalizeLabel,
  normalizeName,
  normalizeNetName,
  sameEnd,
  withoutDeletedPins,
  type Circuit,
  type CircuitComponent,
  type CircuitDocument,
  type Definition,
  type PartKind,
  type Props,
  type Wire,
} from "./document";

type Point = { x: number; y: number };

export type EditorState = {
  metadata: CircuitDocument["metadata"];
  circuit: Circuit;
  /** Selected component, junction and wire IDs. */
  selection: string[];
  /** Switch values set by the user (0 or 1, or up to 2^width − 1 when wide). Transient: never saved with the document. */
  inputs: Record<string, number>;
  /** Part waiting to be placed by the next canvas click. */
  armed: PartKind | null;
  /** For an armed `custom` part: the definition it will be an instance of. */
  armedDefinition: string | null;
  /** A net label (ADR 0015) waits to be placed by the next canvas click. */
  armedLabel: boolean;
  add: (kind: PartKind, position: { x: number; y: number }) => string;
  /**
   * Places a net label: a junction named with the first unused `n1`, `n2`, … on the sheet, selected,
   * as one edit. Refused (null) on a port or another junction, as any junction is (ADR 0010).
   */
  addLabel: (position: { x: number; y: number }) => string | null;
  /**
   * Names a junction as one edit (ADR 0015), normalized as on import; blank clears the name, and
   * clearing it on a junction with no wires removes the junction.
   */
  setName: (id: string, name: string) => void;
  /**
   * Sets positions by component or junction ID in one update; not recorded (see `record`).
   * Bends of shaped wires whose two ends move by the same amount move with them.
   */
  move: (positions: Record<string, Point>) => void;
  /**
   * Sets a wire's bends while dragging its segment; not recorded (see `record`).
   * More than `MAX_BENDS` (after simplifying) is ignored, so every shape can be saved and opened again.
   */
  shape: (wire: string, bends: Point[]) => void;
  /** Drops a wire's bends so it is routed automatically again; one edit, none if it had none. */
  resetRoute: (wire: string) => void;
  /**
   * Turns the given parts and junctions 90° clockwise (1) or counter-clockwise
   * (-1) as a group, about the centre of their box, as one edit; bends of shaped
   * wires between them turn too. A turn and its reverse cancel exactly. Refused
   * when a port would land on a junction.
   */
  rotate: (ids: string[], turn: 1 | -1) => void;
  /** Rotation the armed part will be placed with; R and Shift R turn it before placing. */
  armedRotation: CircuitComponent["rotation"];
  turnArmed: (turn: 1 | -1) => void;
  /** Adds a wire unless it joins an end to itself, duplicates a wire or names a missing part or junction. */
  connect: (from: Endpoint, to: Endpoint) => string | null;
  /**
   * Splits `wire` with a new junction at `at` and wires `from` to it, as one edit.
   * Refused (null) when `from` is already an end of that wire.
   */
  connectToWire: (from: Endpoint, wire: string, at: Point) => string | null;
  /** Removes components and junctions (with their wires) and wires; junctions left without wires go too. */
  remove: (ids: string[]) => void;
  select: (ids: string[]) => void;
  selectAll: () => void;
  /** Parts copied by `copy`/`cut`, with the wires between them. */
  clipboard: Circuit | null;
  /** Steps of 2 cells the last paste went down-right (0 after a copy, -1 after a cut); the next goes one step further. */
  pastes: number;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  /** Copies the selected parts next to themselves, leaving the clipboard alone. */
  duplicate: () => void;
  /** Sets a part's label as one edit; blank removes it. Normalized and capped at `MAX_LABEL` characters. */
  setLabel: (id: string, label: string) => void;
  /** Sets a switch's, LED's or gate's width (1 to `MAX_WIDTH`) as one edit; 1 removes the prop. A switch keeps the bits that still fit. */
  setWidth: (id: string, width: number) => void;
  /**
   * Sets a splitter's or merger's field widths (lowest bits first) as one edit, which also
   * deletes the wires to field ports that no longer exist (ADR 0014). Invalid fields change nothing.
   */
  setFields: (id: string, fields: number[]) => void;
  toggle: (id: string) => void;
  /** Sets a wide switch's value, already checked against its width. Not an edit, like a toggle. */
  setInput: (id: string, value: number) => void;
  arm: (kind: PartKind | null) => void;
  /** Arms an instance of a definition (a chip from the parts panel). */
  armChip: (definition: string) => void;
  /** Arms a net label, or disarms it. */
  armLabel: (on: boolean) => void;
  /** Custom component definitions (ADR 0012); the one open on a sheet is `circuit`, see `liveDefinitions`. */
  definitions: Definition[];
  /**
   * Turns the selection into a new definition named `name` and puts one
   * instance in its place, as one edit. Wires crossing the selection's edge
   * become new pins, which needs the engine's current result (ADR 0016); with
   * none given, such a selection is refused. Returns why it cannot, or null.
   */
  makeComponent: (name: string, engine?: EngineView) => string | null;
  /** Renames a definition (`normalizeName`). Outside undo history, like every definition change (ADR 0012). */
  renameDefinition: (id: string, name: string) => void;
  /**
   * Deletes a definition unless `deleteRefusal` says why not; returns that reason, or null.
   * Not undoable: undo steps that hold an instance of it are dropped, so none can bring one back (ADR 0012).
   */
  deleteDefinition: (id: string) => string | null;
  /** The definition open for editing, or null for the main circuit. */
  sheet: string | null;
  /** The main circuit and its history, kept aside while a definition is open. */
  main: { circuit: Circuit; past: Circuit[]; future: Circuit[] } | null;
  /** Undo histories of definitions not open, by definition ID. */
  histories: Record<string, { past: Circuit[]; future: Circuit[] }>;
  /** Opens a definition on its own sheet. */
  openSheet: (definition: string) => void;
  /** Back to the main circuit. */
  closeSheet: () => void;
  /** Replaces the whole document, e.g. from an imported file. Clears history. */
  load: (document: CircuitDocument) => void;
  /** Earlier circuits, most recent last; `undo` restores them. */
  past: Circuit[];
  /** Circuits undone, next first; any new edit clears them. */
  future: Circuit[];
  /** Makes the current circuit an undo step before edits that skip history (`move` during a drag). */
  record: () => void;
  undo: () => void;
  redo: () => void;
  /** Like `undo`, but forgets the undone step: for a drag cancelled half-way. */
  revert: () => void;
};

/** What Make component needs from the engine's result for the circuit being edited (ADR 0016). */
export type NetView = {
  wireNets: Record<string, number>;
  wireWidths: Record<string, number>;
  wireGroups: Record<string, number>;
  netDrivers: (string | null)[];
};
/** The engine's state for Make component: `nets` is null when the circuit did not load (it has errors). */
export type EngineView = { stale: boolean; nets: NetView | null };

/** `base`, or `base-2`, `base-3`, … if taken, kept within `MAX_LABEL`; the name returned is added to `taken`. */
function freeName(base: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const name = [...base].slice(0, MAX_LABEL - suffix.length).join("").trim() + suffix;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
}

/**
 * New pins for the wires crossing a Make component selection (ADR 0016): one per crossing net, undriven
 * nets told apart by `wireGroups`. An LED when the net's driver is inside, a switch otherwise, as wide as the net, in a column 4 cells clear of the selection. `inner` wires the pins inside
 * the definition; `outer(instance)` wires the instance's ports to where the crossings went.
 */
function crossingPins(circuit: Circuit, inside: Set<string>, crossing: Wire[], nets: NetView | null, taken: Set<string>) {
  const pins: CircuitComponent[] = [];
  const inner: Wire[] = [];
  const reach: { pin: string; output: boolean; end: Endpoint }[] = [];
  const outer = (instance: string): Wire[] =>
    reach.map(({ pin, output, end }) => {
      const port = { component: instance, port: pin };
      return { id: crypto.randomUUID(), from: output ? port : end, to: output ? end : port };
    });
  if (!nets || crossing.length === 0) return { pins, inner, outer };
  const within = (end: Endpoint) => inside.has(endOwner(end));
  const groups = new Map<number, Wire[]>();
  for (const w of crossing) {
    const key = nets.wireGroups[w.id] ?? -1;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  const parts = new Map(circuit.components.map((c) => [c.id, c]));
  const components = circuit.components.filter((c) => inside.has(c.id));
  const junctions = circuit.junctions.filter((j) => inside.has(j.id));
  const left = Math.min(...[...components, ...junctions].map((item) => item.position.x));
  const right = Math.max(...components.map((c) => c.position.x + layoutOf(c).width), ...junctions.map((j) => j.position.x));
  const top = Math.min(...[...components, ...junctions].map((item) => item.position.y));
  const pointOf = (end: Endpoint) => {
    if (isJunction(end)) return junctions.find((j) => j.id === end.junction)?.position;
    const part = parts.get(end.component);
    return part && portAt(part, end.port);
  };
  const counts = { in: 0, out: 0 };
  for (const group of groups.values()) {
    const [first] = group;
    if (!first) continue;
    const near = (w: Wire) => (within(w.from) ? w.from : w.to);
    const far = (w: Wire) => (within(w.from) ? w.to : w.from);
    const driver = nets.netDrivers[nets.wireNets[first.id] ?? 0] ?? null;
    const output = driver !== null && inside.has(driver);
    // Named from where the first crossing went: a labelled switch or LED, or a net label; else in1, out1, …
    const end = far(first);
    const farPart = isJunction(end) ? undefined : parts.get(end.component);
    const given = isJunction(end)
      ? circuit.junctions.find((j) => j.id === end.junction)?.name
      : farPart?.kind === "switch" || farPart?.kind === "led"
        ? farPart.props.label
        : undefined;
    const prefix = output ? "out" : "in";
    let label = given ? normalizeLabel(given) : "";
    if (label) label = freeName(label, taken);
    else {
      do counts[prefix]++;
      while (taken.has(`${prefix}${counts[prefix]}`));
      label = `${prefix}${counts[prefix]}`;
      taken.add(label);
    }
    const width = nets.wireWidths[first.id] ?? 1;
    const kind = output ? "led" : "switch";
    const props: Props = { label, ...(width > 1 && { width }) };
    const size = layoutOf({ kind, rotation: 0, props });
    const x = output ? right + 4 : left - 4 - size.width;
    // On the row the first crossing came in on, its port level with it; moved down past other new pins.
    const pin: CircuitComponent = { id: crypto.randomUUID(), kind, rotation: 0, props, position: { x, y: Math.round(pointOf(near(first))?.y ?? top + 1) - 1 } };
    const blocked = (y: number) =>
      pins.some((p) => p.kind === kind && Math.abs(p.position.y - y) < 2) ||
      stacksJunction({ components: [...components, ...pins, pin], junctions, wires: [] }, { [pin.id]: { x, y } });
    while (blocked(pin.position.y)) pin.position = { x, y: pin.position.y + 2 };
    pins.push(pin);
    const own: Endpoint = { component: pin.id, port: output ? "in" : "out" };
    const nears: Endpoint[] = [];
    for (const w of group) {
      const a = near(w);
      if (!nears.some((e) => sameEnd(e, a))) {
        nears.push(a);
        inner.push({ id: crypto.randomUUID(), from: output ? a : own, to: output ? own : a });
      }
      const b = far(w);
      if (!reach.some((r) => r.pin === pin.id && sameEnd(r.end, b))) reach.push({ pin: pin.id, output, end: b });
    }
  }
  return { pins, inner, outer };
}

const now = new Date().toISOString();
const HISTORY_LIMIT = 200;

/**
 * Sets the circuit and drops selection and switch positions that point at items no longer in it.
 * A switch keeps the bits of its value that fit its width now, whether an edit, undo or redo changed it.
 */
function withCircuit(state: EditorState, circuit: Circuit) {
  const kept = new Set(items(circuit).map((item) => item.id));
  const width = new Map(circuit.components.map((c) => [c.id, c.props.width ?? 1]));
  return {
    circuit,
    selection: state.selection.filter((id) => kept.has(id)),
    inputs: Object.fromEntries(
      Object.entries(state.inputs).flatMap(([id, value]) => {
        const bits = width.get(id);
        return bits === undefined ? [] : [[id, value % 2 ** bits]];
      }),
    ),
  };
}

const items = (circuit: Circuit) => [...circuit.components, ...circuit.junctions, ...circuit.wires];

/** Nothing to copy: no parts and no labels. Plain junctions with only wires between them are not worth a copy. */
const isEmpty = (part: Circuit) => part.components.length === 0 && !part.junctions.some((j) => j.name);

/** The chosen parts and junctions and the wires running between them; wires to anything else are left out. */
function fragment(circuit: Circuit, ids: string[]): Circuit {
  const chosen = new Set(ids);
  const components = circuit.components.filter((c) => chosen.has(c.id));
  const junctions = circuit.junctions.filter((j) => chosen.has(j.id));
  const inside = new Set([...components, ...junctions].map((item) => item.id));
  const wires = circuit.wires.filter((w) => inside.has(endOwner(w.from)) && inside.has(endOwner(w.to)));
  // A plain junction only joins wires; one with none among them would arrive as a lone dot. A label is kept.
  const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
  return { components, junctions: junctions.filter((j) => used.has(j.id) || !!j.name), wires };
}

/** A copy of `part` with fresh IDs, shifted down-right by `offset` cells. */
function cloned(part: Circuit, offset: number): Circuit {
  const ids = new Map([...part.components, ...part.junctions].map((item) => [item.id, crypto.randomUUID()]));
  const id = (old: string) => ids.get(old) ?? old;
  const end = (e: Endpoint): Endpoint => (isJunction(e) ? { junction: id(e.junction) } : { ...e, component: id(e.component) });
  return {
    components: part.components.map((c) => ({
      ...c,
      id: id(c.id),
      position: { x: c.position.x + offset, y: c.position.y + offset },
      props: structuredClone(c.props),
    })),
    // A copied net label keeps its name, so it joins the original's net (ADR 0015).
    junctions: part.junctions.map((j) => ({ ...j, id: id(j.id), position: { x: j.position.x + offset, y: j.position.y + offset } })),
    wires: part.wires.map((w) => ({
      id: crypto.randomUUID(),
      from: end(w.from),
      to: end(w.to),
      ...(w.bends && { bends: w.bends.map((b) => ({ x: b.x + offset, y: b.y + offset })) }),
    })),
  };
}

/**
 * `part` cloned `offset` cells down-right, stepped 2 cells further while it
 * would stack a junction on a port or junction. Ends: past every item nothing
 * is stacked. Returns the copy and the offset used.
 */
function placed(circuit: Circuit, part: Circuit, offset: number): [Circuit, number] {
  for (;; offset += 2) {
    const copy = cloned(part, offset);
    const positions = Object.fromEntries([...copy.components, ...copy.junctions].map((item) => [item.id, item.position]));
    const together = {
      components: [...circuit.components, ...copy.components],
      junctions: [...circuit.junctions, ...copy.junctions],
      wires: [],
    };
    if (!stacksJunction(together, positions)) return [copy, offset];
  }
}

/** Adds `part` to the circuit as one edit and selects it. */
const insert = (state: EditorState, part: Circuit) => ({
  ...edit(state, {
    components: [...state.circuit.components, ...part.components],
    junctions: [...state.circuit.junctions, ...part.junctions],
    wires: [...state.circuit.wires, ...part.wires],
  }),
  selection: items(part).map((item) => item.id),
});

const present = (circuit: Circuit, end: Endpoint) =>
  isJunction(end)
    ? circuit.junctions.some((j) => j.id === end.junction)
    : circuit.components.some((c) => c.id === end.component);

/** False for a wire from an end to itself, a duplicate in either direction, or an end that is gone. */
function canConnect(circuit: Circuit, from: Endpoint, to: Endpoint) {
  const exists = circuit.wires.some(
    (w) => (sameEnd(w.from, from) && sameEnd(w.to, to)) || (sameEnd(w.from, to) && sameEnd(w.to, from)),
  );
  return !sameEnd(from, to) && !exists && present(circuit, from) && present(circuit, to);
}

/** What a sheet starts with: nothing selected, armed or switched on. */
const fresh = { selection: [], inputs: {}, armed: null, armedDefinition: null, armedLabel: false };

/** Every definition as it is now: the open one's circuit is the one being edited. */
export function liveDefinitions(state: Pick<EditorState, "definitions" | "sheet" | "circuit">): Definition[] {
  const { sheet, circuit } = state;
  return sheet ? state.definitions.map((d) => (d.id === sheet ? { ...d, circuit } : d)) : state.definitions;
}

/** The main circuit, wherever the editor is. */
export const mainCircuit = (state: Pick<EditorState, "main" | "circuit">) => state.main?.circuit ?? state.circuit;

const uses = (circuit: Circuit, definition: string) => circuit.components.some((c) => c.definition === definition);

/** Why a definition cannot be deleted: it is open, or an instance of it is on the main circuit or in another definition. */
export function deleteRefusal(state: Pick<EditorState, "definitions" | "sheet" | "circuit" | "main">, id: string): string | null {
  const definitions = liveDefinitions(state);
  const target = definitions.find((d) => d.id === id);
  if (!target) return null;
  if (state.sheet === id) return `${target.name} is open: go back to the main circuit to delete it.`;
  const users = [
    ...(uses(mainCircuit(state), id) ? ["the main circuit"] : []),
    ...definitions.filter((d) => d.id !== id && uses(d.circuit, id)).map((d) => d.name),
  ];
  if (users.length === 0) return null;
  return `${target.name} is still used in ${new Intl.ListFormat("en").format(users)}. Delete those instances first.`;
}

const remember = (state: EditorState) => ({ past: [...state.past, state.circuit].slice(-HISTORY_LIMIT), future: [] });

/** A document edit: undoable, and it clears redo. */
const edit = (state: EditorState, circuit: Circuit) => ({ ...withCircuit(state, circuit), ...remember(state) });

export const useEditor = create<EditorState>()((set, get) => ({
  metadata: { name: "Untitled", createdAt: now, modifiedAt: now },
  circuit: { components: [], junctions: [], wires: [] },
  selection: [],
  inputs: {},
  armed: null,
  armedDefinition: null,
  armedLabel: false,
  definitions: [],
  sheet: null,
  main: null,
  histories: {},
  past: [],
  future: [],
  clipboard: null,
  pastes: 0,

  add: (kind, position) => {
    const id = crypto.randomUUID();
    set((state) => {
      const part: CircuitComponent = { id, kind, position, rotation: state.armedRotation, props: newProps(kind) };
      if (kind === "custom" && state.armedDefinition) part.definition = state.armedDefinition;
      return {
        ...edit(state, { ...state.circuit, components: [...state.circuit.components, part] }),
        selection: [id],
        armed: null,
      };
    });
    return id;
  },

  makeComponent: (name, engine = { stale: true, nets: null }) => {
    const state = get();
    const { circuit } = state;
    const chosen = new Set(state.selection);
    const components = circuit.components.filter((c) => chosen.has(c.id));
    if (components.length === 0) return "Select the parts to make a component from.";
    const inside = new Set([...components, ...circuit.junctions.filter((j) => chosen.has(j.id))].map((item) => item.id));
    const within = (end: Endpoint) => inside.has(endOwner(end));
    // Wires to a deleted pin are not the engine's (ADR 0013): they go, like every wire touching the selection.
    const crossing = withoutDeletedPins(circuit, liveDefinitions(state)).wires.filter((w) => within(w.from) !== within(w.to));
    const pins = components.filter((c) => c.kind === "switch" || c.kind === "led");
    if (pins.length === 0 && crossing.length === 0) return "A component needs pins: labelled switches (inputs) and LEDs (outputs).";
    const names = pins.map((c) => c.props.label ?? "");
    if (names.some((n) => !n)) return "Label every switch and LED: their labels name the component's pins.";
    if (new Set(names).size !== names.length) return "Two pins share a name: give each switch and LED its own label.";
    if (crossing.length > 0 && engine.stale) return "Wait for the simulation to catch up, then try again.";
    if (crossing.length > 0 && !engine.nets) return "Fix the circuit's errors first: wires crossing the selection need a working circuit.";
    const added = crossingPins(circuit, inside, crossing, engine.nets, new Set(names));
    // The definition starts at its own origin, new pins included. The instance takes the selection's top-left
    // corner, so it lands where the selection was and not over parts left of it.
    const own = [...circuit.wires.filter((w) => within(w.from) && within(w.to)), ...added.inner];
    const used = new Set(own.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
    const junctions = circuit.junctions.filter((j) => inside.has(j.id) && (used.has(j.id) || !!j.name));
    const parts = [...components, ...added.pins];
    const at = [...parts, ...junctions].map((item) => item.position);
    const origin = { x: Math.min(...at.map((p) => p.x)), y: Math.min(...at.map((p) => p.y)) };
    const shift = (p: Point) => ({ x: p.x - origin.x, y: p.y - origin.y });
    const definition: Definition = {
      id: crypto.randomUUID(),
      name: normalizeName(name),
      circuit: {
        components: parts.map((c) => ({ ...c, position: shift(c.position) })),
        junctions: junctions.map((j) => ({ ...j, position: shift(j.position) })),
        wires: own.map((w) => (w.bends ? { ...w, bends: w.bends.map(shift) } : w)),
      },
    };
    const instance: CircuitComponent = {
      id: crypto.randomUUID(),
      kind: "custom",
      definition: definition.id,
      position: { x: Math.min(...[...components, ...junctions].map((item) => item.position.x)), y: Math.min(...[...components, ...junctions].map((item) => item.position.y)) },
      rotation: 0,
      props: {},
    };
    set((s) => {
      // Wires touching the selection go with it; crossings come back wired to the instance (ADR 0016).
      const outer = added.outer(instance.id);
      const wires = [...s.circuit.wires.filter((w) => !inside.has(endOwner(w.from)) && !inside.has(endOwner(w.to))), ...outer];
      const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const next = {
        components: [...s.circuit.components.filter((c) => !inside.has(c.id)), instance],
        junctions: s.circuit.junctions.filter((j) => !inside.has(j.id) && (used.has(j.id) || !!j.name)),
        wires,
      };
      return { ...edit(s, next), definitions: [...s.definitions, definition], selection: [instance.id] };
    });
    return null;
  },

  renameDefinition: (id, name) =>
    set((s) => {
      const text = normalizeName(name);
      if (!s.definitions.some((d) => d.id === id && d.name !== text)) return s;
      return { definitions: s.definitions.map((d) => (d.id === id ? { ...d, name: text } : d)) };
    }),

  deleteDefinition: (id) => {
    const refusal = deleteRefusal(get(), id);
    if (refusal) return refusal;
    set((s) => {
      // Each step is a whole circuit, so dropping one only merges it into its neighbour.
      const keep = (steps: Circuit[]) => steps.filter((c) => !uses(c, id));
      const histories = Object.fromEntries(
        Object.entries(s.histories)
          .filter(([sheet]) => sheet !== id)
          .map(([sheet, h]) => [sheet, { past: keep(h.past), future: keep(h.future) }]),
      );
      return {
        definitions: s.definitions.filter((d) => d.id !== id),
        past: keep(s.past),
        future: keep(s.future),
        main: s.main && { ...s.main, past: keep(s.main.past), future: keep(s.main.future) },
        histories,
        clipboard: s.clipboard && uses(s.clipboard, id) ? null : s.clipboard,
        ...(s.armedDefinition === id ? { armed: null, armedDefinition: null } : {}),
      };
    });
    return null;
  },

  openSheet: (id) =>
    set((s) => {
      const definitions = liveDefinitions(s);
      const target = definitions.find((d) => d.id === id);
      if (!target || s.sheet === id) return s;
      const histories = { ...s.histories };
      if (s.sheet) histories[s.sheet] = { past: s.past, future: s.future };
      const main = s.sheet ? s.main : { circuit: s.circuit, past: s.past, future: s.future };
      const { past, future } = histories[id] ?? { past: [], future: [] };
      return { definitions, sheet: id, main, histories, circuit: target.circuit, past, future, ...fresh };
    }),

  closeSheet: () =>
    set((s) => {
      if (!s.sheet || !s.main) return s;
      const histories = { ...s.histories, [s.sheet]: { past: s.past, future: s.future } };
      const { circuit, past, future } = s.main;
      return { definitions: liveDefinitions(s), sheet: null, main: null, histories, circuit, past, future, ...fresh };
    }),

  move: (positions) =>
    set(({ circuit }) => {
      const old = new Map([...circuit.components, ...circuit.junctions].map((item) => [item.id, item.position]));
      const shift = (id: string) => {
        const [from, to] = [old.get(id), positions[id]];
        return from && to && { x: to.x - from.x, y: to.y - from.y };
      };
      return {
        circuit: {
          components: circuit.components.map((c) => ({ ...c, position: positions[c.id] ?? c.position })),
          junctions: circuit.junctions.map((j) => ({ ...j, position: positions[j.id] ?? j.position })),
          wires: circuit.wires.map((w) => {
            const [a, b] = [shift(endOwner(w.from)), shift(endOwner(w.to))];
            // Carried along only when both ends move together; otherwise the ends' corners adapt (ADR 0011).
            if (!w.bends || !a || !b || a.x !== b.x || a.y !== b.y) return w;
            return { ...w, bends: w.bends.map((p) => ({ x: p.x + a.x, y: p.y + a.y })) };
          }),
        },
      };
    }),

  shape: (id, bends) =>
    set((state) => {
      const kept = simplify(bends);
      if (kept.length > MAX_BENDS) return state;
      const { circuit } = state;
      return { circuit: { ...circuit, wires: circuit.wires.map((w) => (w.id === id ? { ...w, bends: kept } : w)) } };
    }),

  resetRoute: (id) =>
    set((state) => {
      const wire = state.circuit.wires.find((w) => w.id === id);
      if (!wire?.bends) return state;
      const plain = { id: wire.id, from: wire.from, to: wire.to };
      return edit(state, { ...state.circuit, wires: state.circuit.wires.map((w) => (w === wire ? plain : w)) });
    }),

  connect: (from, to) => {
    const { circuit } = get();
    // A part can be deleted mid-drag; never leave a wire to nothing.
    if (!canConnect(circuit, from, to)) return null;
    const id = crypto.randomUUID();
    set((state) => ({ ...edit(state, { ...state.circuit, wires: [...state.circuit.wires, { id, from, to }] }), selection: [id] }));
    return id;
  },

  connectToWire: (from, wireId, at) => {
    const { circuit } = get();
    const wire = circuit.wires.find((w) => w.id === wireId);
    if (!wire || sameEnd(wire.from, from) || sameEnd(wire.to, from) || !present(circuit, from)) return null;
    const junction = { junction: crypto.randomUUID() };
    const id = crypto.randomUUID();
    set((state) => ({
      ...edit(state, {
        ...state.circuit,
        junctions: [...state.circuit.junctions, { id: junction.junction, position: at }],
        // The split wire keeps its ID on its first half.
        wires: [
          // Split at a new point, so the old shape no longer applies: both halves route automatically.
          ...state.circuit.wires.map((w) => (w === wire ? { id: w.id, from: w.from, to: junction } : w)),
          { id: crypto.randomUUID(), from: junction, to: wire.to },
          { id, from, to: junction },
        ],
      }),
      selection: [id],
    }));
    return id;
  },

  remove: (ids) => {
    const gone = new Set(ids);
    set((state) => {
      const { circuit } = state;
      const components = circuit.components.filter((c) => !gone.has(c.id));
      // Wires attached to removed parts and junctions go too.
      const wires = circuit.wires.filter((w) => !gone.has(w.id) && !gone.has(endOwner(w.from)) && !gone.has(endOwner(w.to)));
      // A plain junction joins wires; with none left it is gone as well. A label stays until deleted (ADR 0015).
      const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const junctions = circuit.junctions.filter((j) => !gone.has(j.id) && (used.has(j.id) || !!j.name));
      // Nothing removed: not an edit, so history (and redo) stays as it is.
      if (items({ components, junctions, wires }).length === items(circuit).length) return state;
      return edit(state, { components, junctions, wires });
    });
  },

  select: (ids) => set({ selection: ids }),
  selectAll: () => set(({ circuit }) => ({ selection: items(circuit).map((item) => item.id) })),

  copy: () =>
    set((state) => {
      const part = fragment(state.circuit, state.selection);
      return isEmpty(part) ? state : { clipboard: part, pastes: 0 };
    }),
  cut: () => {
    const { circuit, selection } = get();
    // Like copy, cut works on parts and labels; without any it does nothing.
    if (isEmpty(fragment(circuit, selection))) return;
    get().copy();
    get().remove(selection);
    // The first paste after a cut puts the parts back where they were.
    set({ pastes: -1 });
  },
  paste: () =>
    set((state) => {
      if (!state.clipboard || isEmpty(state.clipboard)) return state;
      // Instances must have their definition here, and a definition's sheet may not come to contain itself.
      const definitions = liveDefinitions(state);
      const placeable = (c: CircuitComponent) =>
        c.kind !== "custom" ||
        (definitions.some((d) => d.id === c.definition) && !(state.sheet && c.definition && contains(definitions, c.definition, state.sheet)));
      if (!state.clipboard.components.every(placeable)) return state;
      const [copy, offset] = placed(state.circuit, state.clipboard, 2 * (state.pastes + 1));
      // A skipped step counts as a paste, so the next one lands beyond this one.
      return { ...insert(state, copy), pastes: offset / 2 };
    }),
  duplicate: () =>
    set((state) => {
      const part = fragment(state.circuit, state.selection);
      return isEmpty(part) ? state : insert(state, placed(state.circuit, part, 2)[0]);
    }),
  setLabel: (id, label) =>
    set((state) => {
      // Cut by code point, so an emoji is never split in half.
      const text = [...normalizeLabel(label)].slice(0, MAX_LABEL).join("");
      const part = state.circuit.components.find((c) => c.id === id);
      if (!part || (part.props.label ?? "") === text) return state;
      const props = { ...part.props };
      if (text) props.label = text;
      else delete props.label;
      return edit(state, { ...state.circuit, components: state.circuit.components.map((c) => (c === part ? { ...c, props } : c)) });
    }),
  setWidth: (id, width) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      const valid = Number.isInteger(width) && width >= 1 && width <= MAX_WIDTH;
      if (!part || part.kind === "custom" || isFielded(part.kind) || !valid || (part.props.width ?? 1) === width) return state;
      const props = { ...part.props };
      if (width > 1) props.width = width;
      else delete props.width;
      return edit(state, { ...state.circuit, components: state.circuit.components.map((c) => (c === part ? { ...c, props } : c)) });
    }),
  addLabel: (position) => {
    const id = crypto.randomUUID();
    const { circuit } = get();
    if (stacksJunction({ ...circuit, junctions: [...circuit.junctions, { id, position }] }, { [id]: position })) return null;
    const taken = new Set(circuit.junctions.map((j) => j.name));
    let n = 1;
    while (taken.has(`n${n}`)) n++;
    set((state) => ({
      ...edit(state, { ...state.circuit, junctions: [...state.circuit.junctions, { id, position, name: `n${n}` }] }),
      selection: [id],
      armedLabel: false,
    }));
    return id;
  },
  setName: (id, name) =>
    set((state) => {
      // Cut by code point after NFC, the form import checks, so a stored name always reloads.
      const text = [...normalizeNetName(name)].slice(0, MAX_LABEL).join("").trim();
      const junction = state.circuit.junctions.find((j) => j.id === id);
      if (!junction || (junction.name ?? "") === text) return state;
      const wired = state.circuit.wires.some((w) => endOwner(w.from) === id || endOwner(w.to) === id);
      const named = { id: junction.id, position: junction.position, ...(text && { name: text }) };
      const junctions = !text && !wired
        ? state.circuit.junctions.filter((j) => j !== junction)
        : state.circuit.junctions.map((j) => (j === junction ? named : j));
      return edit(state, { ...state.circuit, junctions });
    }),
  setFields: (id, fields) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      if (!part || !isFielded(part.kind) || fieldsProblem(fields) || part.props.fields?.join() === fields.join()) return state;
      const gone = (end: Endpoint) => !isJunction(end) && end.component === id && /^f\d+$/.test(end.port) && Number(end.port.slice(1)) >= fields.length;
      const wires = state.circuit.wires.filter((w) => !gone(w.from) && !gone(w.to));
      // A junction left with no wires goes too, as when deleting.
      const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const dropped = new Set(state.circuit.wires.filter((w) => !wires.includes(w)).flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      return edit(state, {
        components: state.circuit.components.map((c) => (c === part ? { ...c, props: { ...c.props, fields: [...fields] } } : c)),
        junctions: state.circuit.junctions.filter((j) => used.has(j.id) || !!j.name || !dropped.has(j.id)),
        wires,
      });
    }),
  rotate: (ids, turn) =>
    set((state) => {
      const { circuit } = state;
      const chosen = new Set(ids);
      const parts = circuit.components.filter((c) => chosen.has(c.id));
      const dots = circuit.junctions.filter((j) => chosen.has(j.id));
      if (parts.length + dots.length === 0) return state;
      const corners = [
        ...parts.flatMap((c) => {
          const { width, height } = layoutOf(c);
          return [c.position, { x: c.position.x + width, y: c.position.y + height }];
        }),
        ...dots.map((j) => j.position),
      ];
      // Twice the centre of the selection's box.
      let sx = Math.min(...corners.map((p) => p.x)) + Math.max(...corners.map((p) => p.x));
      let sy = Math.min(...corners.map((p) => p.y)) + Math.max(...corners.map((p) => p.y));
      // Grid points stay grid points only if the centre's x and y are both whole or both halves.
      // Nudging x on a clockwise turn and y on a counter-clockwise one makes each the other's inverse.
      if ((sx - sy) % 2 !== 0) {
        if (turn > 0) sx++;
        else sy++;
      }
      const turnPoint = (p: Point): Point =>
        turn > 0 ? { x: (sx + sy) / 2 - p.y, y: (sy - sx) / 2 + p.x } : { x: (sx - sy) / 2 + p.y, y: (sx + sy) / 2 - p.x };
      const positions: Record<string, Point> = {};
      const components = circuit.components.map((c) => {
        if (!chosen.has(c.id)) return c;
        const { width, height } = layoutOf(c);
        const [a, b] = [turnPoint(c.position), turnPoint({ x: c.position.x + width, y: c.position.y + height })];
        const position = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
        positions[c.id] = position;
        return { ...c, rotation: ((c.rotation + 90 * turn + 360) % 360) as typeof c.rotation, position };
      });
      const junctions = circuit.junctions.map((j) => {
        if (!chosen.has(j.id)) return j;
        positions[j.id] = turnPoint(j.position);
        return { ...j, position: positions[j.id] as Point };
      });
      const wires = circuit.wires.map((w) => {
        if (!w.bends) return w;
        const inside = [chosen.has(endOwner(w.from)), chosen.has(endOwner(w.to))];
        if (inside[0] && inside[1]) return { ...w, bends: w.bends.map(turnPoint) };
        // Half inside, the old shape would cut back across the turned part: route it automatically again.
        if (inside[0] || inside[1]) return { id: w.id, from: w.from, to: w.to };
        return w;
      });
      const turned = { components, junctions, wires };
      if (stacksJunction(turned, positions)) return state;
      return edit(state, turned);
    }),
  armedRotation: 0,
  turnArmed: (turn) => set(({ armedRotation }) => ({ armedRotation: ((armedRotation + 90 * turn + 360) % 360) as typeof armedRotation })),
  toggle: (id) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: inputs[id] === 1 ? 0 : 1 } })),
  setInput: (id, value) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: value } })),
  arm: (kind) => set({ armed: kind, armedDefinition: null, armedRotation: 0, armedLabel: false }),
  armChip: (definition) => set({ armed: "custom", armedDefinition: definition, armedRotation: 0, armedLabel: false }),
  armLabel: (on) => set({ armed: null, armedDefinition: null, armedLabel: on }),
  load: ({ metadata, circuit, definitions }) => {
    // An opened file is routed afresh, never shaped by whatever was on screen before.
    forgetRoutes();
    // The clipboard may hold instances of the old document's definitions.
    set({ metadata, circuit, definitions, sheet: null, main: null, histories: {}, past: [], future: [], clipboard: null, pastes: 0, ...fresh });
  },

  record: () => set(remember),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...withCircuit(state, previous), past: state.past.slice(0, -1), future: [state.circuit, ...state.future] };
    }),
  revert: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...withCircuit(state, previous), past: state.past.slice(0, -1) };
    }),
  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...withCircuit(state, next), past: [...state.past, state.circuit], future: rest };
    }),
}));

// Instances are laid out from their definitions' pins, which change while a definition is edited.
let laidOut: [Definition[], Circuit | null] | null = null;
const layOut = (state: EditorState) => {
  const key: [Definition[], Circuit | null] = [state.definitions, state.sheet ? state.circuit : null];
  if (laidOut && laidOut[0] === key[0] && laidOut[1] === key[1]) return;
  laidOut = key;
  setDefinitionLayouts(liveDefinitions(state));
};
layOut(useEditor.getState());
useEditor.subscribe(layOut);
