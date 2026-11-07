// The editor's document store (ADR 0007). The canvas reads it outside React
// through `useEditor.getState()` / `subscribe`.
import { create } from "zustand";
import type { Endpoint } from "../simulation/protocol";
import {
  endOwner,
  isJunction,
  MAX_LABEL,
  normalizeLabel,
  sameEnd,
  type Circuit,
  type CircuitDocument,
  type ComponentKind,
} from "./document";

type Point = { x: number; y: number };

export type EditorState = {
  metadata: CircuitDocument["metadata"];
  circuit: Circuit;
  /** Selected component, junction and wire IDs. */
  selection: string[];
  /** Switch positions set by the user. Transient: never saved with the document. */
  inputs: Record<string, 0 | 1>;
  /** Part waiting to be placed by the next canvas click. */
  armed: ComponentKind | null;
  add: (kind: ComponentKind, position: { x: number; y: number }) => string;
  /** Sets positions by component or junction ID in one update; not recorded (see `record`). */
  move: (positions: Record<string, Point>) => void;
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
  /** Pastes since the last copy (-1 after a cut); each lands a little further down-right. */
  pastes: number;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  /** Copies the selected parts next to themselves, leaving the clipboard alone. */
  duplicate: () => void;
  /** Sets a part's label as one edit; blank removes it. Normalized and capped at `MAX_LABEL` characters. */
  setLabel: (id: string, label: string) => void;
  toggle: (id: string) => void;
  arm: (kind: ComponentKind | null) => void;
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
};

const now = new Date().toISOString();
const HISTORY_LIMIT = 200;

/** Sets the circuit and drops selection and switch positions that point at items no longer in it. */
function withCircuit(state: EditorState, circuit: Circuit) {
  const kept = new Set(items(circuit).map((item) => item.id));
  return {
    circuit,
    selection: state.selection.filter((id) => kept.has(id)),
    inputs: Object.fromEntries(Object.entries(state.inputs).filter(([id]) => kept.has(id))),
  };
}

const items = (circuit: Circuit) => [...circuit.components, ...circuit.junctions, ...circuit.wires];

/** The chosen parts and junctions and the wires running between them; wires to anything else are left out. */
function fragment(circuit: Circuit, ids: string[]): Circuit {
  const chosen = new Set(ids);
  const components = circuit.components.filter((c) => chosen.has(c.id));
  const junctions = circuit.junctions.filter((j) => chosen.has(j.id));
  const inside = new Set([...components, ...junctions].map((item) => item.id));
  const wires = circuit.wires.filter((w) => inside.has(endOwner(w.from)) && inside.has(endOwner(w.to)));
  return { components, junctions, wires };
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
    junctions: part.junctions.map((j) => ({ id: id(j.id), position: { x: j.position.x + offset, y: j.position.y + offset } })),
    wires: part.wires.map((w) => ({ id: crypto.randomUUID(), from: end(w.from), to: end(w.to) })),
  };
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

const remember = (state: EditorState) => ({ past: [...state.past, state.circuit].slice(-HISTORY_LIMIT), future: [] });

/** A document edit: undoable, and it clears redo. */
const edit = (state: EditorState, circuit: Circuit) => ({ ...withCircuit(state, circuit), ...remember(state) });

export const useEditor = create<EditorState>()((set, get) => ({
  metadata: { name: "Untitled", createdAt: now, modifiedAt: now },
  circuit: { components: [], junctions: [], wires: [] },
  selection: [],
  inputs: {},
  armed: null,
  past: [],
  future: [],
  clipboard: null,
  pastes: 0,

  add: (kind, position) => {
    const id = crypto.randomUUID();
    set((state) => ({
      ...edit(state, { ...state.circuit, components: [...state.circuit.components, { id, kind, position, rotation: 0, props: {} }] }),
      selection: [id],
      armed: null,
    }));
    return id;
  },

  move: (positions) =>
    set(({ circuit }) => ({
      circuit: {
        ...circuit,
        components: circuit.components.map((c) => ({ ...c, position: positions[c.id] ?? c.position })),
        junctions: circuit.junctions.map((j) => ({ ...j, position: positions[j.id] ?? j.position })),
      },
    })),

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
          ...state.circuit.wires.map((w) => (w === wire ? { ...w, to: junction } : w)),
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
      // A junction joins wires; with none left it is gone as well.
      const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
      const junctions = circuit.junctions.filter((j) => !gone.has(j.id) && used.has(j.id));
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
      return part.components.length > 0 ? { clipboard: part, pastes: 0 } : state;
    }),
  cut: () => {
    const { circuit, selection } = get();
    // Like copy, cut works on parts; without any it does nothing.
    if (fragment(circuit, selection).components.length === 0) return;
    get().copy();
    get().remove(selection);
    // The first paste after a cut puts the parts back where they were.
    set({ pastes: -1 });
  },
  paste: () =>
    set((state) => {
      if (!state.clipboard?.components.length) return state;
      const pastes = state.pastes + 1;
      return { ...insert(state, cloned(state.clipboard, 2 * pastes)), pastes };
    }),
  duplicate: () =>
    set((state) => {
      const part = fragment(state.circuit, state.selection);
      return part.components.length > 0 ? insert(state, cloned(part, 2)) : state;
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
  toggle: (id) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: inputs[id] === 1 ? 0 : 1 } })),
  arm: (kind) => set({ armed: kind }),
  load: ({ metadata, circuit }) => set({ metadata, circuit, selection: [], inputs: {}, armed: null, past: [], future: [] }),

  record: () => set(remember),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...withCircuit(state, previous), past: state.past.slice(0, -1), future: [state.circuit, ...state.future] };
    }),
  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...withCircuit(state, next), past: [...state.past, state.circuit], future: rest };
    }),
}));
