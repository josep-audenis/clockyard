// The editor's document store (ADR 0007). The canvas reads it outside React
// through `useEditor.getState()` / `subscribe`.
import { create } from "zustand";
import type { PortRef } from "../simulation/protocol";
import type { Circuit, CircuitDocument, ComponentKind } from "./document";

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
  move: (id: string, position: { x: number; y: number }) => void;
  /** Adds a wire unless it joins a port to itself, duplicates a wire or names a missing part. */
  connect: (from: PortRef, to: PortRef) => string | null;
  /** Removes components (with their wires) and wires. */
  remove: (ids: string[]) => void;
  select: (ids: string[]) => void;
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

  add: (kind, position) => {
    const id = crypto.randomUUID();
    set((state) => ({
      ...edit(state, { ...state.circuit, components: [...state.circuit.components, { id, kind, position, rotation: 0, props: {} }] }),
      selection: [id],
      armed: null,
    }));
    return id;
  },

  move: (id, position) =>
    set(({ circuit }) => ({
      circuit: { ...circuit, components: circuit.components.map((c) => (c.id === id ? { ...c, position } : c)) },
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
      return edit(state, { components, wires });
    });
  },

  select: (ids) => set({ selection: ids }),
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
