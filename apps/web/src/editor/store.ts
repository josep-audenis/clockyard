// The editor's document store (ADR 0007). The canvas reads it outside React
// through `useEditor.getState()` / `subscribe`.
import { create } from "zustand";
import { simplify, stacksJunction } from "../canvas/geometry";
import { layoutOf } from "../canvas/layout";
import type { Endpoint } from "../simulation/protocol";
import {
  endOwner,
  isJunction,
  MAX_BENDS,
  MAX_LABEL,
  normalizeLabel,
  sameEnd,
  type Circuit,
  type CircuitComponent,
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
  /** Like `undo`, but forgets the undone step: for a drag cancelled half-way. */
  revert: () => void;
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
  // A junction only joins wires; one with none among them would arrive as a lone dot.
  const used = new Set(wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)]));
  return { components, junctions: junctions.filter((j) => used.has(j.id)), wires };
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
      ...edit(state, {
        ...state.circuit,
        components: [...state.circuit.components, { id, kind, position, rotation: state.armedRotation, props: {} }],
      }),
      selection: [id],
      armed: null,
    }));
    return id;
  },

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
      const [copy, offset] = placed(state.circuit, state.clipboard, 2 * (state.pastes + 1));
      // A skipped step counts as a paste, so the next one lands beyond this one.
      return { ...insert(state, copy), pastes: offset / 2 };
    }),
  duplicate: () =>
    set((state) => {
      const part = fragment(state.circuit, state.selection);
      return part.components.length > 0 ? insert(state, placed(state.circuit, part, 2)[0]) : state;
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
      const wires = circuit.wires.map((w) =>
        w.bends && chosen.has(endOwner(w.from)) && chosen.has(endOwner(w.to)) ? { ...w, bends: w.bends.map(turnPoint) } : w,
      );
      const turned = { components, junctions, wires };
      if (stacksJunction(turned, positions)) return state;
      return edit(state, turned);
    }),
  armedRotation: 0,
  turnArmed: (turn) => set(({ armedRotation }) => ({ armedRotation: ((armedRotation + 90 * turn + 360) % 360) as typeof armedRotation })),
  toggle: (id) => set(({ inputs }) => ({ inputs: { ...inputs, [id]: inputs[id] === 1 ? 0 : 1 } })),
  arm: (kind) => set({ armed: kind, armedRotation: 0 }),
  load: ({ metadata, circuit }) => set({ metadata, circuit, selection: [], inputs: {}, armed: null, past: [], future: [] }),

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
