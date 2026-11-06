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
  /** Adds a wire unless it joins a port to itself or duplicates an existing wire. */
  connect: (from: PortRef, to: PortRef) => string | null;
  /** Removes components (with their wires) and wires. */
  remove: (ids: string[]) => void;
  select: (ids: string[]) => void;
  toggle: (id: string) => void;
  arm: (kind: ComponentKind | null) => void;
  /** Replaces the whole document, e.g. from an imported file. */
  load: (document: CircuitDocument) => void;
};

const samePort = (a: PortRef, b: PortRef) => a.component === b.component && a.port === b.port;

const now = new Date().toISOString();

export const useEditor = create<EditorState>()((set, get) => ({
  metadata: { name: "Untitled", createdAt: now, modifiedAt: now },
  circuit: { components: [], wires: [] },
  selection: [],
  inputs: {},
  armed: null,

  add: (kind, position) => {
    const id = crypto.randomUUID();
    set(({ circuit }) => ({
      circuit: { ...circuit, components: [...circuit.components, { id, kind, position, rotation: 0, props: {} }] },
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
    const exists = get().circuit.wires.some(
      (w) => (samePort(w.from, from) && samePort(w.to, to)) || (samePort(w.from, to) && samePort(w.to, from)),
    );
    if (samePort(from, to) || exists) return null;
    const id = crypto.randomUUID();
    set(({ circuit }) => ({ circuit: { ...circuit, wires: [...circuit.wires, { id, from, to }] }, selection: [id] }));
    return id;
  },

  remove: (ids) => {
    const gone = new Set(ids);
    set(({ circuit, selection, inputs }) => {
      const components = circuit.components.filter((c) => !gone.has(c.id));
      const wires = circuit.wires.filter((w) => !gone.has(w.id) && !gone.has(w.from.component) && !gone.has(w.to.component));
      // Wires removed along with their parts leave the selection too.
      const kept = new Set([...components, ...wires].map((item) => item.id));
      return {
        circuit: { components, wires },
        selection: selection.filter((id) => kept.has(id)),
        inputs: Object.fromEntries(Object.entries(inputs).filter(([id]) => kept.has(id))),
      };
    });
  },

  select: (ids) => set({ selection: ids }),
  toggle: (id) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: inputs[id] === 1 ? 0 : 1 } })),
  arm: (kind) => set({ armed: kind }),
  load: ({ metadata, circuit }) => set({ metadata, circuit, selection: [], inputs: {}, armed: null }),
}));
