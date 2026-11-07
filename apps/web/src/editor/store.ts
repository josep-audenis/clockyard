// The editor's document store (ADR 0007). The canvas reads it outside React
// through `useEditor.getState()` / `subscribe`.
import { create } from "zustand";
import type { PortRef } from "../simulation/protocol";
import { MAX_LABEL, normalizeLabel, type Circuit, type CircuitDocument, type ComponentKind } from "./document";

export type EditorState = {
  metadata: CircuitDocument["metadata"];
  circuit: Circuit;
  /** Selected component and wire IDs. */
  selection: string[];
  /** Switch positions set by the user. Transient: never saved with the document. */
  inputs: Record<string, 0 | 1>;
  /** Part waiting to be placed by the next canvas click. */
  armed: ComponentKind | null;
  add: (kind: ComponentKind, position: { x: number; y: number }) => string;
  /** Sets positions by component ID in one update; not recorded (see `record`). */
  move: (positions: Record<string, { x: number; y: number }>) => void;
  /** Adds a wire unless it joins a port to itself, duplicates a wire or names a missing part. */
  connect: (from: PortRef, to: PortRef) => string | null;
  /** Removes components (with their wires) and wires. */
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

const samePort = (a: PortRef, b: PortRef) => a.component === b.component && a.port === b.port;

const now = new Date().toISOString();
const HISTORY_LIMIT = 200;

/** Sets the circuit and drops selection and switch positions that point at items no longer in it. */
function withCircuit(state: EditorState, circuit: Circuit) {
  const kept = new Set([...circuit.components, ...circuit.wires].map((item) => item.id));
  return {
    circuit,
    selection: state.selection.filter((id) => kept.has(id)),
    inputs: Object.fromEntries(Object.entries(state.inputs).filter(([id]) => kept.has(id))),
  };
}

/** The chosen parts and the wires running between them; wires to other parts are left out. */
function fragment(circuit: Circuit, ids: string[]): Circuit {
  const chosen = new Set(ids);
  const components = circuit.components.filter((c) => chosen.has(c.id));
  const inside = new Set(components.map((c) => c.id));
  const wires = circuit.wires.filter((w) => inside.has(w.from.component) && inside.has(w.to.component));
  return { components, wires };
}

/** A copy of `part` with fresh IDs, shifted down-right by `offset` cells. */
function cloned(part: Circuit, offset: number): Circuit {
  const ids = new Map(part.components.map((c) => [c.id, crypto.randomUUID()]));
  const id = (old: string) => ids.get(old) ?? old;
  return {
    components: part.components.map((c) => ({
      ...c,
      id: id(c.id),
      position: { x: c.position.x + offset, y: c.position.y + offset },
      props: structuredClone(c.props),
    })),
    wires: part.wires.map((w) => ({
      id: crypto.randomUUID(),
      from: { ...w.from, component: id(w.from.component) },
      to: { ...w.to, component: id(w.to.component) },
    })),
  };
}

/** Adds `part` to the circuit as one edit and selects it. */
const insert = (state: EditorState, part: Circuit) => ({
  ...edit(state, {
    components: [...state.circuit.components, ...part.components],
    wires: [...state.circuit.wires, ...part.wires],
  }),
  selection: [...part.components, ...part.wires].map((item) => item.id),
});

const remember = (state: EditorState) => ({ past: [...state.past, state.circuit].slice(-HISTORY_LIMIT), future: [] });

/** A document edit: undoable, and it clears redo. */
const edit = (state: EditorState, circuit: Circuit) => ({ ...withCircuit(state, circuit), ...remember(state) });

export const useEditor = create<EditorState>()((set, get) => ({
  metadata: { name: "Untitled", createdAt: now, modifiedAt: now },
  circuit: { components: [], wires: [] },
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
      circuit: { ...circuit, components: circuit.components.map((c) => ({ ...c, position: positions[c.id] ?? c.position })) },
    })),

  connect: (from, to) => {
    const { components, wires } = get().circuit;
    const exists = wires.some(
      (w) => (samePort(w.from, from) && samePort(w.to, to)) || (samePort(w.from, to) && samePort(w.to, from)),
    );
    // A part can be deleted mid-drag; never leave a wire to nothing.
    const present = [from, to].every((end) => components.some((c) => c.id === end.component));
    if (samePort(from, to) || exists || !present) return null;
    const id = crypto.randomUUID();
    set((state) => ({ ...edit(state, { ...state.circuit, wires: [...state.circuit.wires, { id, from, to }] }), selection: [id] }));
    return id;
  },

  remove: (ids) => {
    const gone = new Set(ids);
    set((state) => {
      const { circuit } = state;
      const components = circuit.components.filter((c) => !gone.has(c.id));
      // Wires attached to removed parts go too.
      const wires = circuit.wires.filter((w) => !gone.has(w.id) && !gone.has(w.from.component) && !gone.has(w.to.component));
      // Nothing removed: not an edit, so history (and redo) stays as it is.
      if (components.length === circuit.components.length && wires.length === circuit.wires.length) return state;
      return edit(state, { components, wires });
    });
  },

  select: (ids) => set({ selection: ids }),
  selectAll: () => set(({ circuit }) => ({ selection: [...circuit.components, ...circuit.wires].map((item) => item.id) })),

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
