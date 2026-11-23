// The editor's document store (ADR 0007). The canvas reads it outside React
// through `useEditor.getState()` / `subscribe`.
import { create } from "zustand";
import { placementStacks, portAt, simplify, stacksJunction } from "../canvas/geometry";
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
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  widthOf,
  normalizeLabel,
  normalizeName,
  normalizeNetName,
  sameEnd,
  takesWidth,
  DEFAULT_ADDRESS,
  isMemory,
  DEFAULT_INPUTS,
  MAX_ADDRESS,
  MAX_INPUTS,
  MAX_NOTE,
  MAX_NOTES,
  MAX_SHEET_NOTES,
  MAX_SOURCE,
  normalizeNotes,
  noteSize,
  wordsProblem,
  withoutDeletedPins,
  takesInputs,
  type Circuit,
  type CircuitComponent,
  type CircuitDocument,
  type Definition,
  type PartKind,
  type Props,
  type Wire,
} from "./document";
import { BINDING } from "./buttons";
import { addDefinitions, type Added } from "./blueprints";

type Point = { x: number; y: number };

export type EditorState = {
  metadata: CircuitDocument["metadata"];
  circuit: Circuit;
  /** Selected component, junction and wire IDs. */
  selection: string[];
  /** Why the last change of a part's size changed nothing, until the next edit: said in the status bar. */
  refusal: string | null;
  /** Switch values set by the user (0 or 1, or up to 2^width − 1 when wide). Transient: never saved with the document. */
  inputs: Record<string, number>;
  /** Part waiting to be placed by the next canvas click. */
  armed: PartKind | null;
  /** The width the armed part will be placed with: 1, or 8 for a Register (ADR 0017). */
  armedWidth: number;
  /** For an armed `custom` part: the definition it will be an instance of. */
  armedDefinition: string | null;
  /** A net label (ADR 0015) waits to be placed by the next canvas click. */
  armedLabel: boolean;
  /** Whether a click places a note (ADR 0038). */
  armedNote: boolean;
  /** A note just placed and not yet written: written, its placing and text are one undo step; left empty, neither is. */
  draftNote: string | null;
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
  /** Sets a ROM's or RAM's address width (1 to `MAX_ADDRESS`) as one edit; a ROM keeps the words that still fit (ADR 0018). */
  setAddressWidth: (id: string, address: number) => void;
  /** Sets a screen's pixels per row as one edit (ADR 0021); anything but 1 to `MAX_COLUMNS` changes nothing. */
  setColumns: (id: string, columns: number) => void;
  /** Sets a ROM's words as one edit, and its assembly source if given (ADRs 0018, 0019). Invalid words change nothing. */
  setData: (id: string, words: number[], source?: string) => void;
  /**
   * Sets a splitter's or merger's field widths (lowest bits first) as one edit, which also
   * deletes the wires to field ports that no longer exist (ADR 0014). Invalid fields change nothing.
   */
  setFields: (id: string, fields: number[]) => void;
  /**
   * Sets a gate's input count (2 to `MAX_INPUTS`, ADR 0038) as one edit. The gate grows or shrinks away from its
   * unrotated top edge, so its inputs stay where they are and `out` moves; the wires to inputs that go are deleted,
   * and a wire to `out` loses its bends. Refused, with a reason, if a port would land on a junction.
   */
  setInputCount: (id: string, count: number) => void;
  /** Binds a push button to a letter or digit key by its physical code, or unbinds it with null, as one edit (ADR 0038). */
  setBinding: (id: string, code: string | null) => void;
  /** Sets several inputs at once, so buttons held together reach the engine together (ADR 0038). */
  setInputs: (values: Record<string, number>) => void;
  toggle: (id: string) => void;
  /** Names the document, as a label is normalized, at most 64 characters; blank is "Untitled". Outside undo. */
  rename: (name: string) => void;
  /** Sets the document's notes (ADR 0027), cut to `MAX_NOTES` characters; outside undo, like the name. */
  setNotes: (text: string) => void;
  /**
   * Wire IDs on this sheet whose nets the waveform panel shows, in the order watched (ADR 0026). View state:
   * never saved, and cleared with the switch positions when the sheet changes.
   */
  watches: string[];
  /** Watches a wire, at most `MAX_WATCHES` live ones (dropping watches of deleted wires), or stops watching it. */
  watch: (wire: string, on: boolean) => void;
  /** Sets a wide switch's value, already checked against its width. Not an edit, like a toggle. */
  setInput: (id: string, value: number) => void;
  /** Arms a part, width bits wide (1 unless given). */
  arm: (kind: PartKind | null, width?: number) => void;
  /** Arms an instance of a definition (a chip from the parts panel). */
  armChip: (definition: string) => void;
  /** Arms a net label, or disarms it. */
  armLabel: (on: boolean) => void;
  armNote: (on: boolean) => void;
  /** Places an empty note at a grid point, selected, as a draft (ADR 0038); returns its ID, or null on a full sheet. */
  addNote: (position: Point) => string | null;
  /**
   * Sets a note's text as one edit, normalized as the project's notes are and cut to `MAX_NOTE` characters; empty
   * deletes it. A draft's first text joins its placing in one undo step, and a draft left empty leaves no step at all.
   */
  setNoteText: (id: string, text: string) => void;
  /** Custom component definitions (ADR 0012); the one open on a sheet is `circuit`, see `liveDefinitions`. */
  definitions: Definition[];
  /**
   * Turns the selection into a new definition named `name` and puts one
   * instance in its place, as one edit. Wires crossing the selection's edge
   * become new pins, which needs the engine's current result (ADR 0016); with
   * none given, such a selection is refused. Returns why it cannot, or null.
   */
  makeComponent: (name: string, engine?: EngineView) => string | null;
  /**
   * Adds the definitions `picked` from another document's `source`, and those they contain (ADR 0027,
   * `addDefinitions`). Outside undo history, like every definition change (ADR 0012).
   */
  addComponents: (source: Definition[], picked: string[]) => Added;
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
  /** Counts the times another sheet or document took the canvas's place: what lists of its parts are rebuilt on. */
  opens: number;
  /** Counts documents loaded (a file, example, project or link): the canvas frames each one it opens (ADR 0033). */
  documents: number;
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
  netDrivers: (string | null)[];
  /** Each net several tri-state buffers share → the top-level parts that own its buffers (ADRs 0035, 0040). */
  busDrivers?: Record<number, string[]>;
};

/**
 * Whether making a component of `inside` would split a bus (ADR 0035 item 7): some of its drivers inside and some
 * left out. Such a bus would have to cross the component's edge in both directions, and pins have one. The engine
 * names each bus's drivers, the parts that own its buffers (ADR 0040): a component whose output only follows a bus
 * through its pins is not one.
 */
function splitsBus(inside: Set<string>, nets: NetView): boolean {
  return Object.values(nets.busDrivers ?? {}).some((parts) => parts.some((p) => inside.has(p)) && parts.some((p) => !inside.has(p)));
}
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
 * New pins for the wires crossing a Make component selection (ADR 0016): one per driven crossing net,
 * an LED when its driver is inside and a switch otherwise, as wide as the net, in a column 4 cells clear
 * of the selection, in the order of the rows the nets cross on. Undriven crossings (net 0) are dropped:
 * a pin there could join readers with nothing driving them. `inner` wires the pins inside the
 * definition; `outer(instance)` wires the instance's ports to where the crossings went.
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
  const parts = new Map(circuit.components.map((c) => [c.id, c]));
  // A crossing that leaves from an inside part's output on a net driven from outside is a pass-through: a
  // component's output pin wired straight to its input (ADR 0040). It gets an output pin of its own, apart from the
  // input pin the rest of its net takes, or one pin would join the inside output to the outside driver. Each such
  // output gets its own: two on one net would otherwise be joined through one pin.
  // shortcut: an output reaching the edge through an inside junction is not seen as one, and still shares the
  // input pin (multipleDrivers on load); follow the junction to its output port if that comes up.
  const groups = new Map<string, { output: boolean; wires: Wire[] }>();
  for (const w of crossing) {
    const net = nets.wireNets[w.id] ?? 0;
    if (net === 0) continue;
    const driver = nets.netDrivers[net] ?? null;
    const a = within(w.from) ? w.from : w.to;
    const part = isJunction(a) ? undefined : parts.get(a.component);
    const passes = !isJunction(a) && part !== undefined && !inside.has(driver ?? "") && a.port in layoutOf(part).outputs;
    const key = passes && !isJunction(a) ? `${net}+${a.component}.${a.port}` : `${net}`;
    const group = groups.get(key) ?? { output: passes || (driver !== null && inside.has(driver)), wires: [] };
    group.wires.push(w);
    groups.set(key, group);
  }
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
  const near = (w: Wire) => (within(w.from) ? w.from : w.to);
  const far = (w: Wire) => (within(w.from) ? w.to : w.from);
  const rowOf = (w: Wire) => Math.round(pointOf(near(w))?.y ?? top + 1);
  const counts = { in: 0, out: 0 };
  const sorted = [...groups.values()].sort((a, b) => rowOf(a.wires[0] as Wire) - rowOf(b.wires[0] as Wire));
  for (const { output, wires: group } of sorted) {
    const [first] = group;
    if (!first) continue;
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
    // The column is 4 cells clear of every selected item, so only other new pins can be in the way.
    const pin: CircuitComponent = { id: crypto.randomUUID(), kind, rotation: 0, props, position: { x, y: rowOf(first) - 1 } };
    while (pins.some((p) => p.kind === kind && Math.abs(p.position.y - pin.position.y) < 2)) pin.position = { x, y: pin.position.y + 2 };
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

/** A new part's props: its kind's defaults, and `width` where it is wider than 1. */
export const armedProps = (kind: PartKind, width: number): Props => ({ ...newProps(kind), ...(width > 1 && { width }) });

/**
 * A part's new props as one edit, unless the size they give it puts a port on a junction:
 * refused, as placing or turning it there is (a wide switch or LED, a screen, ADRs 0014, 0021).
 */
function withProps(state: EditorState, id: string, props: Props) {
  const circuit = { ...state.circuit, components: state.circuit.components.map((c) => (c.id === id ? { ...c, props } : c)) };
  const part = circuit.components.find((c) => c.id === id);
  if (part && stacksJunction(circuit, { [id]: part.position })) return { refusal: STACKED };
  return edit(state, circuit);
}

const STACKED = "Not changed: a port would land on a junction. Move the part or the junction first.";

const now = new Date().toISOString();
const HISTORY_LIMIT = 200;

/**
 * Sets the circuit and drops selection and switch positions that point at items no longer in it.
 * A switch keeps the bits of its value that fit its width now, whether an edit, undo or redo changed it.
 */
function withCircuit(state: EditorState, circuit: Circuit) {
  const kept = new Set(items(circuit).map((item) => item.id));
  const width = new Map(circuit.components.map((c) => [c.id, widthOf(c)]));
  return {
    circuit,
    // A refused size is about the circuit before this one, and a draft note is a draft only until the next change.
    refusal: null,
    draftNote: null,
    selection: state.selection.filter((id) => kept.has(id)),
    inputs: Object.fromEntries(
      Object.entries(state.inputs).flatMap(([id, value]) => {
        const bits = width.get(id);
        return bits === undefined ? [] : [[id, value % 2 ** bits]];
      }),
    ),
  };
}

const items = (circuit: Circuit) => [...circuit.components, ...circuit.junctions, ...circuit.wires, ...circuit.notes];

/** Nothing to copy: no parts and no labels. Plain junctions with only wires between them are not worth a copy. */
const isEmpty = (part: Circuit) => part.components.length === 0 && !part.junctions.some((j) => j.name) && part.notes.length === 0;

/** The chosen parts and junctions and the wires running between them; wires to anything else are left out. */
function fragment(circuit: Circuit, ids: string[]): Circuit {
  const chosen = new Set(ids);
  const components = circuit.components.filter((c) => chosen.has(c.id));
  const junctions = circuit.junctions.filter((j) => chosen.has(j.id));
  const inside = new Set([...components, ...junctions].map((item) => item.id));
  const wires = circuit.wires.filter((w) => inside.has(endOwner(w.from)) && inside.has(endOwner(w.to)));
  // A plain junction only joins wires; one with none among them would arrive as a lone dot. A label is kept.
  const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
  return { components, junctions: junctions.filter((j) => used.has(j.id) || !!j.name), wires, notes: circuit.notes.filter((n) => chosen.has(n.id)) };
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
    notes: part.notes.map((n) => ({ ...n, id: crypto.randomUUID(), position: { x: n.position.x + offset, y: n.position.y + offset } })),
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
      notes: [],
    };
    if (!stacksJunction(together, positions)) return [copy, offset];
  }
}

const FULL_OF_NOTES = `Not added: a sheet holds at most ${MAX_SHEET_NOTES} notes.`;

/** Adds `part` to the circuit as one edit and selects it; refused if the sheet would hold more notes than a file can. */
const insert = (state: EditorState, part: Circuit) =>
  state.circuit.notes.length + part.notes.length > MAX_SHEET_NOTES ? { refusal: FULL_OF_NOTES } : inserted(state, part);
const inserted = (state: EditorState, part: Circuit) => ({
  ...edit(state, {
    components: [...state.circuit.components, ...part.components],
    junctions: [...state.circuit.junctions, ...part.junctions],
    wires: [...state.circuit.wires, ...part.wires],
    notes: [...state.circuit.notes, ...part.notes],
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
const fresh = {
  selection: [],
  refusal: null,
  inputs: {},
  armed: null,
  armedDefinition: null,
  armedLabel: false,
  armedNote: false,
  draftNote: null,
  watches: [],
};

/** Traces the waveform panel shows at most (ADR 0026). */
export const MAX_WATCHES = 16;

/** Watched wires that are on the sheet now. A deleted wire's watch is kept, so undo brings its trace back, but it shows nothing and takes no place. */
export const liveWatches = (state: Pick<EditorState, "watches" | "circuit">) =>
  state.watches.filter((id) => state.circuit.wires.some((w) => w.id === id));

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
  circuit: { components: [], junctions: [], wires: [], notes: [] },
  selection: [],
  refusal: null,
  inputs: {},
  armed: null,
  armedWidth: 1,
  armedDefinition: null,
  armedLabel: false,
  armedNote: false,
  draftNote: null,
  definitions: [],
  sheet: null,
  main: null,
  histories: {},
  opens: 0,
  documents: 0,
  past: [],
  future: [],
  clipboard: null,
  pastes: 0,

  add: (kind, position) => {
    const id = crypto.randomUUID();
    set((state) => {
      const part: CircuitComponent = { id, kind, position, rotation: state.armedRotation, props: armedProps(kind, state.armedWidth) };
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
    // A selected plain junction goes inside only if it joins something that does. One a net only passes
    // through stays on the sheet, so its wires do not cross the edge and give the chip a port it does not need.
    // Wires to a deleted pin are not the engine's (ADR 0013): they neither cross nor pull a junction inside.
    const live = withoutDeletedPins(circuit, liveDefinitions(state)).wires;
    const inside = new Set(components.map((c) => c.id));
    const touches = (id: string) =>
      live.some((w) => (endOwner(w.from) === id && inside.has(endOwner(w.to))) || (endOwner(w.to) === id && inside.has(endOwner(w.from))));
    for (let grew = true; grew; ) {
      grew = false;
      for (const j of circuit.junctions) {
        if (!chosen.has(j.id) || inside.has(j.id) || !(j.name || touches(j.id))) continue;
        inside.add(j.id);
        grew = true;
      }
    }
    const within = (end: Endpoint) => inside.has(endOwner(end));
    const crossing = live.filter((w) => within(w.from) !== within(w.to));
    const pins = components.filter((c) => c.kind === "switch" || c.kind === "led");
    if (pins.length === 0 && crossing.length === 0) return "A component needs pins: labelled switches (inputs) and LEDs (outputs).";
    const names = pins.map((c) => c.props.label ?? "");
    if (names.some((n) => !n)) return "Label every switch and LED: their labels name the component's pins.";
    if (new Set(names).size !== names.length) return "Two pins share a name: give each switch and LED its own label.";
    if (crossing.length > 0 && engine.stale) return "Wait for the simulation to catch up, then try again.";
    if (crossing.length > 0 && !engine.nets) return "Fix the circuit's errors first: wires crossing the selection need a working circuit.";
    // A bus joined by labels crosses no wire, so the engine's word is waited for here too.
    if (engine.stale && circuit.components.some((c) => c.kind === "tri")) return "Wait for the simulation to catch up, then try again.";
    if (engine.nets && splitsBus(inside, engine.nets)) {
      return "A shared bus would be split: select every tri-state buffer on it, or none of them.";
    }
    const added = crossingPins(circuit, inside, crossing, engine.nets, new Set(names));
    if (pins.length === 0 && added.pins.length === 0) return "A component needs pins: labelled switches (inputs) and LEDs (outputs).";
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
        // Make component takes parts only: notes stay on the sheet they were on (ADR 0038).
        notes: [],
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
    // Stepped down 2 cells until no port of it is on a junction left on the sheet (ADR 0010), and its box keeps a
    // cell clear of every part, junction and note left there (ADR 0040). Its ports come from the new definition, so
    // its layout is set before the store's own pass does it.
    setDefinitionLayouts([...liveDefinitions(state), definition]);
    const rest = { components: [], junctions: circuit.junctions.filter((j) => !inside.has(j.id)), wires: [], notes: [] };
    const boxes = [
      ...circuit.components.filter((c) => !inside.has(c.id)).map((c) => ({ ...c.position, ...layoutOf(c) })),
      ...rest.junctions.map((j) => ({ ...j.position, width: 0, height: 0 })),
      ...circuit.notes.map((n) => ({ ...n.position, ...noteSize(n.text) })),
    ];
    const covers = () => {
      const { x, y } = instance.position;
      const { width, height } = layoutOf(instance);
      return boxes.some((b) => x < b.x + b.width + 1 && b.x < x + width + 1 && y < b.y + b.height + 1 && b.y < y + height + 1);
    };
    while (placementStacks(rest, instance) || covers()) instance.position = { ...instance.position, y: instance.position.y + 2 };
    set((s) => {
      // Wires touching the selection go with it; crossings come back wired to the instance (ADR 0016).
      const outer = added.outer(instance.id);
      const wires = [...s.circuit.wires.filter((w) => !inside.has(endOwner(w.from)) && !inside.has(endOwner(w.to))), ...outer];
      const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const next = {
        components: [...s.circuit.components.filter((c) => !inside.has(c.id)), instance],
        junctions: s.circuit.junctions.filter((j) => !inside.has(j.id) && (used.has(j.id) || !!j.name)),
        wires,
        notes: s.circuit.notes,
      };
      return { ...edit(s, next), definitions: [...s.definitions, definition], selection: [instance.id] };
    });
    return null;
  },

  addComponents: (source, picked) => {
    const result = addDefinitions(liveDefinitions(get()), source, picked);
    // The open sheet's definition stays as it is in `definitions`; added ones never replace one.
    if (result.added.length > 0) set(({ definitions }) => ({ definitions: [...definitions, ...result.added] }));
    return result;
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
      return { definitions, sheet: id, main, histories, opens: s.opens + 1, circuit: target.circuit, past, future, ...fresh };
    }),

  closeSheet: () =>
    set((s) => {
      if (!s.sheet || !s.main) return s;
      const histories = { ...s.histories, [s.sheet]: { past: s.past, future: s.future } };
      const { circuit, past, future } = s.main;
      return { definitions: liveDefinitions(s), sheet: null, main: null, histories, opens: s.opens + 1, circuit, past, future, ...fresh };
    }),

  move: (positions) =>
    set(({ circuit }) => {
      const old = new Map([...circuit.components, ...circuit.junctions, ...circuit.notes].map((item) => [item.id, item.position]));
      const shift = (id: string) => {
        const [from, to] = [old.get(id), positions[id]];
        return from && to && { x: to.x - from.x, y: to.y - from.y };
      };
      return {
        circuit: {
          components: circuit.components.map((c) => ({ ...c, position: positions[c.id] ?? c.position })),
          junctions: circuit.junctions.map((j) => ({ ...j, position: positions[j.id] ?? j.position })),
          notes: circuit.notes.map((n) => ({ ...n, position: positions[n.id] ?? n.position })),
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
      const notes = circuit.notes.filter((n) => !gone.has(n.id));
      if (items({ components, junctions, wires, notes }).length === items(circuit).length) return state;
      return edit(state, { components, junctions, wires, notes });
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
      if (!part || !takesWidth(part.kind) || !valid || (part.props.width ?? 1) === width) return state;
      const props = { ...part.props };
      if (width > 1) props.width = width;
      else delete props.width;
      // A ROM keeps the bits of each word that still fit, as a switch keeps its value's (ADR 0018).
      if (props.data) props.data = props.data.map((w) => w % 2 ** width);
      return withProps(state, id, props);
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
  setAddressWidth: (id, address) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      const valid = Number.isInteger(address) && address >= 1 && address <= MAX_ADDRESS;
      if (!part || !isMemory(part.kind) || !valid || (part.props.addressWidth ?? DEFAULT_ADDRESS) === address) return state;
      const rest = { ...part.props };
      delete rest.addressWidth;
      const props = {
        ...rest,
        ...(address !== DEFAULT_ADDRESS && { addressWidth: address }),
        ...(rest.data && { data: rest.data.slice(0, 2 ** address) }),
      };
      return withProps(state, id, props);
    }),

  setBinding: (id, code) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      if (part?.kind !== "button" || (code !== null && !BINDING.test(code)) || (part.props.binding ?? null) === code) return state;
      const props = { ...part.props };
      if (code) props.binding = code;
      else delete props.binding;
      return edit(state, { ...state.circuit, components: state.circuit.components.map((c) => (c === part ? { ...c, props } : c)) });
    }),
  setInputs: (values) => set(({ inputs }) => ({ inputs: { ...inputs, ...values } })),
  setColumns: (id, columns) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      const valid = Number.isInteger(columns) && columns >= 1 && columns <= MAX_COLUMNS;
      if (part?.kind !== "screen" || !valid || (part.props.columns ?? DEFAULT_COLUMNS) === columns) return state;
      const props = { ...part.props };
      // 32 is the default, so it is not stored.
      if (columns !== DEFAULT_COLUMNS) props.columns = columns;
      else delete props.columns;
      return withProps(state, id, props);
    }),

  setData: (id, words, source) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      if (!part || part.kind !== "rom") return state;
      if (wordsProblem(words, part.props.width ?? 1, part.props.addressWidth ?? DEFAULT_ADDRESS)) return state;
      const rest = { ...part.props };
      delete rest.data;
      delete rest.source;
      const kept = source ?? part.props.source;
      if (kept && kept.length > MAX_SOURCE) return state;
      const props = { ...rest, ...(words.length > 0 && { data: [...words] }), ...(kept && { source: kept }) };
      // Unchanged words and source are no edit (key order varies with the edits that made the props).
      if ((part.props.data ?? []).join() === words.join() && (part.props.source ?? "") === (kept ?? "")) return state;
      const components = state.circuit.components.map((c) => (c.id === id ? { ...c, props } : c));
      return edit(state, { ...state.circuit, components });
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
        ...state.circuit,
        components: state.circuit.components.map((c) => (c === part ? { ...c, props: { ...c.props, fields: [...fields] } } : c)),
        junctions: state.circuit.junctions.filter((j) => used.has(j.id) || !!j.name || !dropped.has(j.id)),
        wires,
      });
    }),
  setInputCount: (id, count) =>
    set((state) => {
      const part = state.circuit.components.find((c) => c.id === id);
      const valid = Number.isInteger(count) && count >= DEFAULT_INPUTS && count <= MAX_INPUTS;
      const was = part?.props.inputCount ?? DEFAULT_INPUTS;
      if (!part || !takesInputs(part.kind) || !valid || was === count) return state;
      const props = { ...part.props };
      if (count !== DEFAULT_INPUTS) props.inputCount = count;
      else delete props.inputCount;
      // The unrotated top edge stays: it is the right side at 90° and the bottom at 180°, which the growth pushes.
      const grow = 2 * (count - was);
      const { x, y } = part.position;
      const position = part.rotation === 90 ? { x: x - grow, y } : part.rotation === 180 ? { x, y: y - grow } : part.position;
      const gone = (end: Endpoint) =>
        !isJunction(end) && end.component === id && end.port.length === 1 && end.port.charCodeAt(0) - 97 >= count;
      const kept = state.circuit.wires.filter((w) => !gone(w.from) && !gone(w.to));
      // `out` moved, so a shape drawn to it no longer meets it.
      const toOut = (end: Endpoint) => !isJunction(end) && end.component === id && end.port === "out";
      const wires = kept.map((w) => (w.bends && (toOut(w.from) || toOut(w.to)) ? { id: w.id, from: w.from, to: w.to } : w));
      // A junction left with no wires goes too, as when deleting.
      const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const dropped = new Set(state.circuit.wires.filter((w) => !kept.includes(w)).flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const circuit = {
        ...state.circuit,
        components: state.circuit.components.map((c) => (c === part ? { ...c, props, position } : c)),
        junctions: state.circuit.junctions.filter((j) => used.has(j.id) || !!j.name || !dropped.has(j.id)),
        wires,
      };
      if (stacksJunction(circuit, { [id]: position })) return { refusal: STACKED };
      return edit(state, circuit);
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
      // A note's place turns with the selection; its text stays level (ADR 0038).
      const notes = circuit.notes.map((n) => (chosen.has(n.id) ? { ...n, position: turnPoint(n.position) } : n));
      const turned = { components, junctions, wires, notes };
      if (stacksJunction(turned, positions)) return state;
      return edit(state, turned);
    }),
  armedRotation: 0,
  turnArmed: (turn) => set(({ armedRotation }) => ({ armedRotation: ((armedRotation + 90 * turn + 360) % 360) as typeof armedRotation })),
  toggle: (id) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: inputs[id] === 1 ? 0 : 1 } })),
  rename: (name) => set(({ metadata }) => ({ metadata: { ...metadata, name: [...normalizeLabel(name)].slice(0, 64).join("").trim() || "Untitled" } })),
  setNotes: (text) => set(({ metadata }) => ({ metadata: { ...metadata, notes: [...text].slice(0, MAX_NOTES).join("") || undefined } })),
  watches: [],
  watch: (wire, on) =>
    set((state) => {
      if (!on) return { watches: state.watches.filter((w) => w !== wire) };
      const live = liveWatches(state);
      return live.includes(wire) || live.length >= MAX_WATCHES ? {} : { watches: [...live, wire] };
    }),
  setInput: (id, value) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: value } })),
  arm: (kind, width = 1) => set({ armed: kind, armedWidth: width, armedDefinition: null, armedRotation: 0, armedLabel: false, armedNote: false }),
  armChip: (definition) =>
    set({ armed: "custom", armedWidth: 1, armedDefinition: definition, armedRotation: 0, armedLabel: false, armedNote: false }),
  armLabel: (on) => set({ armed: null, armedDefinition: null, armedLabel: on, armedNote: false }),
  armNote: (on) => set({ armed: null, armedDefinition: null, armedLabel: false, armedNote: on }),
  addNote: (position) => {
    // Never more than a file can hold, so every sheet can be saved and opened again.
    if (get().circuit.notes.length >= MAX_SHEET_NOTES) {
      set({ refusal: FULL_OF_NOTES, armedNote: false });
      return null;
    }
    const id = crypto.randomUUID();
    set((state) => ({
      ...edit(state, { ...state.circuit, notes: [...state.circuit.notes, { id, position, text: "" }] }),
      selection: [id],
      armedNote: false,
      draftNote: id,
    }));
    return id;
  },
  setNoteText: (id, raw) =>
    set((state) => {
      const note = state.circuit.notes.find((n) => n.id === id);
      if (!note) return state;
      const text = [...normalizeNotes(raw)].slice(0, MAX_NOTE).join("").trim();
      const draft = state.draftNote === id;
      if (!text && draft) {
        // Left empty: as if never placed, with no step to undo.
        const previous = state.past.at(-1);
        return previous ? { ...withCircuit(state, previous), past: state.past.slice(0, -1), draftNote: null } : { draftNote: null };
      }
      if (text === note.text) return { draftNote: null };
      const notes = text ? state.circuit.notes.map((n) => (n === note ? { ...n, text } : n)) : state.circuit.notes.filter((n) => n !== note);
      const circuit = { ...state.circuit, notes };
      // A draft's text joins the step that placed it.
      return draft ? { ...withCircuit(state, circuit), draftNote: null } : { ...edit(state, circuit), draftNote: null };
    }),
  load: ({ metadata, circuit, definitions }) => {
    // An opened file is routed afresh, never shaped by whatever was on screen before.
    forgetRoutes();
    // The clipboard may hold instances of the old document's definitions.
    set((s) => ({
      metadata,
      circuit,
      definitions,
      sheet: null,
      main: null,
      histories: {},
      opens: s.opens + 1,
      documents: s.documents + 1,
      past: [],
      future: [],
      clipboard: null,
      pastes: 0,
      ...fresh,
    }));
  },

  // A drag starts here: whatever it moves, a refusal from before is no longer the news.
  record: () => set((state) => ({ ...remember(state), refusal: null, draftNote: null })),
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
