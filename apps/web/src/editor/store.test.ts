import { beforeEach, expect, test } from "vitest";
import { endOwner } from "./document";
import { contains } from "./document";
import { liveDefinitions, mainCircuit, useEditor } from "./store";
import { layoutOf, pinLabel } from "../canvas/layout";

const initial = useEditor.getState();
beforeEach(() => useEditor.setState(initial, true));

const port = (component: string, name: string) => ({ component, port: name });

test("add places a part, selects it and disarms", () => {
  const { arm, add } = useEditor.getState();
  arm("and");
  const id = add("and", { x: 3, y: 4 });
  const state = useEditor.getState();
  expect(state.circuit.components).toEqual([{ id, kind: "and", position: { x: 3, y: 4 }, rotation: 0, props: {} }]);
  expect(state.selection).toEqual([id]);
  expect(state.armed).toBeNull();
});

test("moving keeps wires attached by port ID", () => {
  const { add, connect, move } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  const w = connect(port(s, "out"), port(l, "in"));
  move({ [l]: { x: 9, y: 5 } });
  const { circuit } = useEditor.getState();
  expect(circuit.components.find((c) => c.id === l)?.position).toEqual({ x: 9, y: 5 });
  expect(circuit.wires).toEqual([{ id: w, from: port(s, "out"), to: port(l, "in") }]);
});

test("connect refuses one-port loops, duplicates in either direction and missing parts", () => {
  const { add, connect } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  expect(connect(port(s, "out"), port(s, "out"))).toBeNull();
  expect(connect(port(s, "out"), port(l, "in"))).not.toBeNull();
  expect(connect(port(l, "in"), port(s, "out"))).toBeNull();
  expect(connect(port("deleted", "out"), port(l, "in"))).toBeNull();
  expect(useEditor.getState().circuit.wires).toHaveLength(1);
});

test("removing a component removes its wires, selection and switch position", () => {
  const { add, connect, toggle, select, remove } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const g = add("not", { x: 4, y: 0 });
  const w = connect(port(s, "out"), port(g, "in")) ?? "";
  toggle(s);
  select([s, w]);
  remove([s]);
  const state = useEditor.getState();
  expect(state.circuit.components.map((c) => c.id)).toEqual([g]);
  expect(state.circuit.wires).toEqual([]);
  expect(state.selection).toEqual([]);
  expect(state.inputs).toEqual({});
});

test("toggle flips a switch position", () => {
  const { add, toggle } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  toggle(s);
  expect(useEditor.getState().inputs).toEqual({ [s]: 1 });
  toggle(s);
  expect(useEditor.getState().inputs).toEqual({ [s]: 0 });
});

test("load replaces the document and clears transient state", () => {
  const { add, toggle, load } = useEditor.getState();
  toggle(add("switch", { x: 0, y: 0 }));
  const metadata = { name: "Loaded", createdAt: "2026-01-01T00:00:00Z", modifiedAt: "2026-01-02T00:00:00Z" };
  const circuit = { components: [], junctions: [], wires: [] };
  load({ format: "clockyard", version: 4, metadata, circuit, definitions: [] });
  const state = useEditor.getState();
  expect([state.metadata, state.circuit, state.selection, state.inputs]).toEqual([metadata, circuit, [], {}]);
});

const ids = () => useEditor.getState().circuit.components.map((c) => c.id);

test("undo and redo step through edits; a new edit clears redo", () => {
  const { add, undo, redo } = useEditor.getState();
  const a = add("switch", { x: 0, y: 0 });
  const b = add("led", { x: 4, y: 0 });
  undo();
  expect(ids()).toEqual([a]);
  undo();
  expect(ids()).toEqual([]);
  undo(); // nothing left: no change
  expect(ids()).toEqual([]);
  redo();
  redo();
  expect(ids()).toEqual([a, b]);
  undo();
  const c = add("not", { x: 8, y: 0 });
  redo(); // cleared by the new edit
  expect(ids()).toEqual([a, c]);
});

test("a drag is one undo step: record once, then move without history", () => {
  const { add, record, move, undo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  record();
  move({ [s]: { x: 1, y: 0 } });
  move({ [s]: { x: 2, y: 0 } });
  move({ [s]: { x: 3, y: 1 } });
  undo();
  expect(useEditor.getState().circuit.components[0]?.position).toEqual({ x: 0, y: 0 });
});

test("undo restores a removed part with its wires, and drops state for parts it removes", () => {
  const { add, connect, toggle, select, remove, undo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  const w = connect(port(s, "out"), port(l, "in"));
  remove([s]);
  undo();
  expect(useEditor.getState().circuit.wires.map((wire) => wire.id)).toEqual([w]);
  // Undo past the switch's creation: its position and selection must not outlive it.
  toggle(s);
  select([s]);
  undo(); // the wire
  undo(); // the LED
  undo(); // the switch
  expect(useEditor.getState().inputs).toEqual({});
  expect(useEditor.getState().selection).toEqual([]);
});

test("loading a document clears history", () => {
  const { add, load, undo } = useEditor.getState();
  add("switch", { x: 0, y: 0 });
  const metadata = { name: "x", createdAt: "", modifiedAt: "" };
  load({ format: "clockyard", version: 4, metadata, circuit: { components: [], junctions: [], wires: [] }, definitions: [] });
  undo();
  expect(ids()).toEqual([]);
});

const wireEnds = () => useEditor.getState().circuit.wires.map((w) => [endOwner(w.from), endOwner(w.to)]);

test("move sets several positions in one update", () => {
  const { add, move } = useEditor.getState();
  const a = add("switch", { x: 0, y: 0 });
  const b = add("led", { x: 4, y: 0 });
  move({ [a]: { x: 1, y: 1 }, [b]: { x: 5, y: 1 } });
  expect(useEditor.getState().circuit.components.map((c) => c.position)).toEqual([
    { x: 1, y: 1 },
    { x: 5, y: 1 },
  ]);
});

test("copy and paste clone parts and the wires between them, with new IDs, as one undo step", () => {
  const { add, connect, select, copy, paste, undo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  const other = add("led", { x: 4, y: 4 });
  connect(port(s, "out"), port(l, "in"));
  connect(port(s, "out"), port(other, "in")); // leaves the copied group: not copied
  select([s, l]);
  copy();
  paste();
  const state = useEditor.getState();
  const pasted = state.circuit.components.slice(3);
  expect(pasted.map((c) => [c.kind, c.position])).toEqual([
    ["switch", { x: 2, y: 2 }],
    ["led", { x: 6, y: 2 }],
  ]);
  expect(pasted.map((c) => c.id)).not.toContain(s);
  const [newS, newL] = pasted.map((c) => c.id);
  expect(wireEnds().slice(2)).toEqual([[newS, newL]]);
  expect(state.selection).toHaveLength(3); // two parts and their wire
  paste(); // a second paste lands further on
  expect(useEditor.getState().circuit.components.at(-1)?.position).toEqual({ x: 8, y: 4 });
  undo();
  undo();
  expect(ids()).toEqual([s, l, other]);
});

test("cut removes the selection and the first paste puts it back in place", () => {
  const { add, select, cut, paste } = useEditor.getState();
  const s = add("switch", { x: 3, y: 4 });
  select([s]);
  cut();
  expect(ids()).toEqual([]);
  paste();
  expect(useEditor.getState().circuit.components.map((c) => [c.kind, c.position])).toEqual([["switch", { x: 3, y: 4 }]]);
  paste();
  expect(useEditor.getState().circuit.components[1]?.position).toEqual({ x: 5, y: 6 });
});

test("cut or remove with nothing to remove keeps history, so redo still works", () => {
  const { add, connect, select, undo, redo, cut, remove } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  const w = connect(port(s, "out"), port(l, "in"));
  undo(); // the wire is now a redo step
  const { past, future } = useEditor.getState();
  select([]);
  cut();
  remove([]);
  remove(["missing"]);
  expect(useEditor.getState().past).toBe(past);
  expect(useEditor.getState().future).toBe(future);
  redo();
  expect(useEditor.getState().circuit.wires.map((wire) => wire.id)).toEqual([w]);
});

test("cut works on parts: a lone selected wire is left in place", () => {
  const { add, connect, select, cut } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  select([w]);
  cut();
  expect(useEditor.getState().circuit.wires).toHaveLength(1);
});

test("duplicate copies the selection next to itself and keeps the clipboard", () => {
  const { add, select, copy, duplicate } = useEditor.getState();
  const a = add("and", { x: 0, y: 0 });
  const n = add("not", { x: 10, y: 0 });
  select([n]);
  copy();
  select([a]);
  duplicate();
  const state = useEditor.getState();
  expect(state.circuit.components.map((c) => c.kind)).toEqual(["and", "not", "and"]);
  expect(state.circuit.components[2]?.position).toEqual({ x: 2, y: 2 });
  expect(state.clipboard?.components.map((c) => c.id)).toEqual([n]);
});

test("copy, duplicate and paste do nothing without parts to work on", () => {
  const { copy, duplicate, paste } = useEditor.getState();
  copy();
  duplicate();
  paste();
  expect(useEditor.getState().past).toEqual([]);
});

test("select all selects every part and wire", () => {
  const { add, connect, select, selectAll } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 4, y: 0 });
  const w = connect(port(s, "out"), port(l, "in"));
  select([]);
  selectAll();
  expect(useEditor.getState().selection).toEqual([s, l, w]);
});

test("setLabel trims, caps, clears when blank and is one undo step; no change is not an edit", () => {
  const { add, setLabel, undo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const label = () => useEditor.getState().circuit.components[0]?.props.label;
  setLabel(s, "  carry in ");
  expect(label()).toBe("carry in");
  const { past } = useEditor.getState();
  setLabel(s, "carry in");
  setLabel("missing", "x");
  expect(useEditor.getState().past).toBe(past);
  setLabel(s, "x".repeat(40));
  expect(label()).toBe("x".repeat(32));
  setLabel(s, "   ");
  expect(useEditor.getState().circuit.components[0]?.props).toEqual({});
  undo();
  undo();
  expect(label()).toBe("carry in");
});

test("setLabel turns control characters into spaces, drops invisible ones and never splits an emoji", () => {
  const { add, setLabel } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const label = () => useEditor.getState().circuit.components[0]?.props.label;
  const zeroWidth = String.fromCodePoint(0x200b);
  const rtlOverride = String.fromCodePoint(0x202e);
  setLabel(s, "carry" + String.fromCodePoint(10) + "in" + rtlOverride);
  expect(label()).toBe("carry in");
  setLabel(s, zeroWidth);
  expect(label()).toBeUndefined();
  const smile = String.fromCodePoint(0x1f600);
  setLabel(s, "x".repeat(31) + smile + "y");
  expect(label()).toBe("x".repeat(31) + smile);
});

const junction = (id: string) => ({ junction: id });

test("dropping a wire on a wire splits it with a junction, as one undo step", () => {
  const { add, connect, connectToWire, undo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const m = add("led", { x: 8, y: 6 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  const branch = connectToWire(port(m, "in"), w, { x: 5, y: 1 });
  const { circuit, selection } = useEditor.getState();
  const [j] = circuit.junctions;
  expect(j?.position).toEqual({ x: 5, y: 1 });
  const id = j?.id ?? "";
  expect(circuit.wires.map((wire) => [wire.from, wire.to])).toEqual([
    [port(s, "out"), junction(id)], // the split wire keeps its ID on its first half
    [junction(id), port(l, "in")],
    [port(m, "in"), junction(id)],
  ]);
  expect(circuit.wires[0]?.id).toBe(w);
  expect(selection).toEqual([branch]);
  undo();
  expect(useEditor.getState().circuit.junctions).toEqual([]);
  expect(useEditor.getState().circuit.wires.map((wire) => wire.id)).toEqual([w]);
});

test("a wire is not split by one of its own ends, and wires can end on junctions", () => {
  const { add, connect, connectToWire } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  expect(connectToWire(port(l, "in"), w, { x: 4, y: 1 })).toBeNull();
  expect(connectToWire(port(s, "out"), "missing", { x: 4, y: 1 })).toBeNull();
  const m = add("led", { x: 8, y: 6 });
  connectToWire(port(m, "in"), w, { x: 4, y: 1 });
  const id = useEditor.getState().circuit.junctions[0]?.id ?? "";
  const n = add("led", { x: 8, y: 9 });
  expect(connect(port(n, "in"), junction(id))).not.toBeNull();
  expect(connect(junction(id), port(n, "in"))).toBeNull(); // duplicate, other way round
  expect(connect(junction(id), junction(id))).toBeNull();
  expect(connect(junction("gone"), port(n, "in"))).toBeNull();
});

test("removing a junction removes its wires; a junction left without wires goes too", () => {
  const { add, connect, connectToWire, remove } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const m = add("led", { x: 8, y: 6 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  connectToWire(port(m, "in"), w, { x: 4, y: 1 });
  const id = useEditor.getState().circuit.junctions[0]?.id ?? "";
  remove([id]);
  expect(useEditor.getState().circuit.wires).toEqual([]);
  useEditor.getState().undo();
  // Deleting the three parts leaves the junction with no wires.
  remove([s, l, m]);
  expect(useEditor.getState().circuit).toEqual({ components: [], junctions: [], wires: [] });
});

test("junctions move, copy and paste with the parts around them", () => {
  const { add, connect, connectToWire, select, selectAll, move, copy, paste } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const m = add("led", { x: 8, y: 6 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  connectToWire(port(m, "in"), w, { x: 4, y: 1 });
  const id = useEditor.getState().circuit.junctions[0]?.id ?? "";
  move({ [id]: { x: 5, y: 3 } });
  expect(useEditor.getState().circuit.junctions[0]?.position).toEqual({ x: 5, y: 3 });
  selectAll();
  expect(useEditor.getState().selection).toHaveLength(7); // 3 parts, 1 junction, 3 wires
  copy();
  paste();
  const { circuit } = useEditor.getState();
  const [, copyOf] = circuit.junctions;
  expect(copyOf?.position).toEqual({ x: 7, y: 5 });
  const pasted = circuit.wires.slice(3);
  expect(pasted).toHaveLength(3);
  expect(pasted.filter((wire) => "junction" in wire.to || "junction" in wire.from).length).toBe(3);
  expect(pasted.every((wire) => !("junction" in wire.to) || wire.to.junction === copyOf?.id)).toBe(true);
  select([id]);
  copy(); // a junction alone is not something to copy
  expect(useEditor.getState().clipboard?.components).toHaveLength(3);
});

test("copying a junction without any of its wires does not paste a lone junction", () => {
  const { add, connect, connectToWire, select, copy, paste, duplicate } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const m = add("led", { x: 8, y: 6 });
  const other = add("not", { x: 0, y: 10 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  connectToWire(port(m, "in"), w, { x: 4, y: 1 });
  const id = useEditor.getState().circuit.junctions[0]?.id ?? "";
  select([other, id]);
  copy();
  paste();
  duplicate();
  expect(useEditor.getState().circuit.junctions.map((j) => j.id)).toEqual([id]);
});

test("paste and duplicate step past any spot that would stack a port on a junction", () => {
  // Switch at (0,0) with its output (2,1) wired through a junction at (4,3) to an LED.
  useEditor.setState({
    circuit: {
      components: [
        { id: "s", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: {} },
        { id: "l", kind: "led", position: { x: 8, y: 2 }, rotation: 0, props: {} },
      ],
      junctions: [{ id: "j", position: { x: 4, y: 3 } }],
      wires: [
        { id: "w1", from: port("s", "out"), to: junction("j") },
        { id: "w2", from: junction("j"), to: port("l", "in") },
      ],
    },
  });
  const { select, copy, paste, duplicate, undo } = useEditor.getState();
  select(["s"]);
  copy();
  // Two cells on, the copy's output would sit on the junction at (4,3): it goes two further.
  paste();
  expect(useEditor.getState().circuit.components.at(-1)?.position).toEqual({ x: 4, y: 4 });
  paste(); // and the next paste continues from there
  expect(useEditor.getState().circuit.components.at(-1)?.position).toEqual({ x: 6, y: 6 });
  undo();
  undo();
  select(["s"]);
  duplicate();
  expect(useEditor.getState().circuit.components.at(-1)?.position).toEqual({ x: 4, y: 4 });
});

test("a pasted junction steps past a port it would land on", () => {
  // LED at (8,0) fed from a junction at (4,1); a NOT at (6,2) has its input at (6,3).
  useEditor.setState({
    circuit: {
      components: [
        { id: "l", kind: "led", position: { x: 8, y: 0 }, rotation: 0, props: {} },
        { id: "n", kind: "not", position: { x: 6, y: 2 }, rotation: 0, props: {} },
      ],
      junctions: [{ id: "j", position: { x: 4, y: 1 } }],
      wires: [{ id: "w", from: junction("j"), to: port("l", "in") }],
    },
  });
  const { select, copy, paste } = useEditor.getState();
  select(["l", "j", "w"]);
  copy();
  paste(); // two cells on, the junction would sit on the NOT's input at (6,3)
  expect(useEditor.getState().circuit.junctions.at(-1)?.position).toEqual({ x: 8, y: 5 });
  expect(useEditor.getState().pastes).toBe(2);
});

test("shaping a wire and resetting its route are undoable; bends ride along in group moves and pastes", () => {
  const { add, connect, record, shape, resetRoute, undo, move, select, copy, paste } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 4 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  const bends = () => useEditor.getState().circuit.wires.find((wire) => wire.id === w)?.bends;
  record();
  shape(w, [{ x: 5, y: 1 }, { x: 5, y: 5 }]);
  shape(w, [{ x: 6, y: 1 }, { x: 6, y: 5 }]); // the same drag: still one undo step
  expect(bends()).toEqual([{ x: 6, y: 1 }, { x: 6, y: 5 }]);
  resetRoute(w);
  expect(bends()).toBeUndefined();
  const { past } = useEditor.getState();
  resetRoute(w); // nothing to reset: not an edit
  expect(useEditor.getState().past).toBe(past);
  undo();
  expect(bends()).toEqual([{ x: 6, y: 1 }, { x: 6, y: 5 }]);
  undo();
  expect(bends()).toBeUndefined();
  // Both ends move together: the bends follow. One end alone: they stay.
  record();
  shape(w, [{ x: 5, y: 1 }, { x: 5, y: 5 }]);
  move({ [s]: { x: 1, y: 2 }, [l]: { x: 9, y: 6 } });
  expect(bends()).toEqual([{ x: 6, y: 3 }, { x: 6, y: 7 }]);
  move({ [l]: { x: 12, y: 6 } });
  expect(bends()).toEqual([{ x: 6, y: 3 }, { x: 6, y: 7 }]);
  select([s, l, w]);
  copy();
  paste();
  expect(useEditor.getState().circuit.wires.at(-1)?.bends).toEqual([{ x: 8, y: 5 }, { x: 8, y: 9 }]);
});

test("a shape is simplified, and one with more bends than a file may hold is not kept", () => {
  const { add, connect, shape } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 4 });
  const w = connect(port(s, "out"), port(l, "in")) ?? "";
  const bends = () => useEditor.getState().circuit.wires.find((wire) => wire.id === w)?.bends;
  shape(w, [{ x: 5, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 3 }, { x: 5, y: 5 }]);
  expect(bends()).toEqual([{ x: 5, y: 1 }, { x: 5, y: 5 }]);
  const zigzag = Array.from({ length: 70 }, (_, i) => ({ x: 3 + Math.floor((i + 1) / 2), y: i % 2 === 0 ? 1 : 5 }));
  shape(w, zigzag);
  expect(bends()).toEqual([{ x: 5, y: 1 }, { x: 5, y: 5 }]);
});

test("rotate turns the selection as a whole about its centre; a turn and its reverse cancel; one undo step", () => {
  const { add, rotate, undo } = useEditor.getState();
  // NOT (3x2) at (0,0) and AND (4x4) at (6,0): their box is (0,0)-(10,4), centre (5,2).
  const n = add("not", { x: 0, y: 0 });
  const g = add("and", { x: 6, y: 0 });
  const parts = () => useEditor.getState().circuit.components.map((c) => [c.rotation, c.position]);
  rotate([n, g], 1);
  // Clockwise: the AND, right of the NOT, ends up below it.
  expect(parts()).toEqual([
    [90, { x: 5, y: -3 }],
    [90, { x: 3, y: 3 }],
  ]);
  rotate([n, g], -1);
  expect(parts()).toEqual([
    [0, { x: 0, y: 0 }],
    [0, { x: 6, y: 0 }],
  ]);
  // A lone part whose centre is off the grid: the nudged centre still makes the two turns cancel, both ways.
  rotate([n], 1);
  expect(parts()[0]).toEqual([90, { x: 1, y: -1 }]);
  rotate([n], -1);
  expect(parts()[0]).toEqual([0, { x: 0, y: 0 }]);
  rotate([n], -1);
  rotate([n], 1);
  expect(parts()[0]).toEqual([0, { x: 0, y: 0 }]);
  undo();
  expect(parts()[0]?.[0]).toBe(270);
  const { past } = useEditor.getState();
  rotate([], 1);
  rotate(["missing"], 1);
  expect(useEditor.getState().past).toBe(past);
});

test("rotating a group turns its junctions and the bends of shaped wires inside it", () => {
  useEditor.setState({
    circuit: {
      components: [
        { id: "s", kind: "switch", position: { x: 0, y: 0 }, rotation: 0, props: {} },
        { id: "l", kind: "led", position: { x: 8, y: 0 }, rotation: 0, props: {} },
      ],
      junctions: [{ id: "j", position: { x: 4, y: 1 } }],
      wires: [
        { id: "w", from: { component: "s", port: "out" }, to: { junction: "j" } },
        { id: "v", from: { junction: "j" }, to: { component: "l", port: "in" }, bends: [{ x: 6, y: 1 }] },
      ],
    },
  });
  // Box (0,0)-(10,2), centre (5,1): clockwise, (x, y) goes to (6 - y, x - 4).
  useEditor.getState().rotate(["s", "l", "j"], 1);
  const { circuit } = useEditor.getState();
  expect(circuit.junctions[0]?.position).toEqual({ x: 5, y: 0 });
  expect(circuit.wires[1]?.bends).toEqual([{ x: 5, y: 2 }]);
  expect(circuit.components.map((c) => c.position)).toEqual([
    { x: 4, y: -4 },
    { x: 4, y: 4 },
  ]);
});

test("R while placing turns the part about to be placed; picking a part starts it upright", () => {
  const { arm, turnArmed, add } = useEditor.getState();
  arm("and");
  turnArmed(1);
  turnArmed(1);
  turnArmed(-1);
  expect(useEditor.getState().armedRotation).toBe(90);
  add("and", { x: 0, y: 0 });
  expect(useEditor.getState().circuit.components[0]?.rotation).toBe(90);
  arm("not");
  expect(useEditor.getState().armedRotation).toBe(0);
});

test("rotate is refused where a port would land on a junction", () => {
  // AND at (0,0): turned clockwise, input a moves to (3,0), where a junction sits.
  useEditor.setState({
    circuit: {
      components: [{ id: "g", kind: "and", position: { x: 0, y: 0 }, rotation: 0, props: {} }],
      junctions: [{ id: "j", position: { x: 3, y: 0 } }],
      wires: [],
    },
  });
  useEditor.getState().rotate(["g"], 1);
  expect(useEditor.getState().circuit.components[0]?.rotation).toBe(0);
});

test("revert takes back a recorded drag without leaving anything to redo", () => {
  const { add, record, move, revert, redo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  record();
  move({ [s]: { x: 5, y: 5 } });
  revert();
  expect(useEditor.getState().circuit.components[0]?.position).toEqual({ x: 0, y: 0 });
  redo();
  expect(useEditor.getState().circuit.components[0]?.position).toEqual({ x: 0, y: 0 });
});

test("turning a part on its own drops the shape of a wire that leaves the turned group", () => {
  useEditor.setState({
    circuit: {
      components: [
        { id: "g", kind: "and", position: { x: 0, y: 0 }, rotation: 0, props: {} },
        { id: "l", kind: "led", position: { x: 12, y: 8 }, rotation: 0, props: {} },
      ],
      junctions: [],
      wires: [{ id: "w", from: { component: "g", port: "out" }, to: { component: "l", port: "in" }, bends: [{ x: 8, y: 2 }, { x: 8, y: 9 }] }],
    },
  });
  useEditor.getState().rotate(["g"], 1);
  expect(useEditor.getState().circuit.wires[0]).toEqual({
    id: "w",
    from: { component: "g", port: "out" },
    to: { component: "l", port: "in" },
  });
});

/** A labelled inverter on the current sheet: switch In → NOT → LED Out. Returns their IDs. */
function inverter() {
  const { add, connect, setLabel } = useEditor.getState();
  const i = add("switch", { x: 2, y: 3 });
  const n = add("not", { x: 6, y: 3 });
  const o = add("led", { x: 11, y: 3 });
  setLabel(i, "In");
  setLabel(o, "Out");
  connect(port(i, "out"), port(n, "in"));
  connect(port(n, "out"), port(o, "in"));
  return { i, n, o };
}

test("make component turns the selection into a definition and puts one instance in its place", () => {
  const { i, n, o } = inverter();
  const outside = useEditor.getState().add("led", { x: 20, y: 3 });
  useEditor.getState().connect(port(n, "out"), port(outside, "in")); // crosses the selection's edge: dropped
  const { select, makeComponent, undo } = useEditor.getState();
  select([i, n, o]);
  expect(makeComponent("  Inverter ")).toBeNull();
  const state = useEditor.getState();
  const [definition] = state.definitions;
  expect(definition?.name).toBe("Inverter");
  // Moved to its own origin, wires inside kept.
  expect(definition?.circuit.components.map((c) => c.position)).toEqual([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 9, y: 0 },
  ]);
  expect(definition?.circuit.wires).toHaveLength(2);
  const instance = state.circuit.components.find((c) => c.kind === "custom");
  expect(instance).toMatchObject({ definition: definition?.id, position: { x: 2, y: 3 } });
  expect(state.circuit.components.map((c) => c.id)).toEqual([outside, instance?.id]);
  expect(state.circuit.wires).toEqual([]);
  expect(state.selection).toEqual([instance?.id]);
  // Its layout comes from the pins, ports named by pin part ID: input In on the left, output Out on the right.
  expect(layoutOf(instance as never)).toEqual({ width: 4, height: 2, inputs: { [i]: { x: 0, y: 1 } }, outputs: { [o]: { x: 4, y: 1 } } });
  expect([pinLabel(definition?.id, i), pinLabel(definition?.id, o)]).toEqual(["In", "Out"]);
  // One undo step for the main circuit; the definition stays available.
  undo();
  expect(useEditor.getState().circuit.components.map((c) => c.id)).toEqual([i, n, o, outside]);
  expect(useEditor.getState().definitions).toHaveLength(1);
});

test("make component refuses a selection without pins, with an unnamed pin or a repeated name", () => {
  const { add, select, makeComponent, setLabel } = useEditor.getState();
  const g = add("and", { x: 0, y: 0 });
  const s = add("switch", { x: 0, y: 6 });
  const t = add("switch", { x: 0, y: 9 });
  select([g]);
  expect(makeComponent("x")).toMatch(/needs pins/);
  select([g, s]);
  expect(makeComponent("x")).toMatch(/Label every switch and LED/);
  setLabel(s, "A");
  setLabel(t, "A");
  select([g, s, t]);
  expect(makeComponent("x")).toMatch(/share a name/);
  expect(useEditor.getState().definitions).toEqual([]);
});

test("a definition opens on its own sheet; edits apply to it, each sheet keeps its undo, and back restores the main", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const id = useEditor.getState().definitions[0]?.id ?? "";
  const mainBefore = useEditor.getState().circuit;
  useEditor.getState().openSheet(id);
  expect(useEditor.getState().sheet).toBe(id);
  expect(useEditor.getState().circuit.components).toHaveLength(3);
  expect(mainCircuit(useEditor.getState())).toBe(mainBefore);
  // An edit on the sheet is the live definition (what simulation and layout see), and undoable there.
  useEditor.getState().add("led", { x: 9, y: 4 });
  expect(liveDefinitions(useEditor.getState())[0]?.circuit.components).toHaveLength(4);
  useEditor.getState().undo();
  expect(useEditor.getState().circuit.components).toHaveLength(3);
  useEditor.getState().redo();
  useEditor.getState().closeSheet();
  const state = useEditor.getState();
  expect([state.sheet, state.circuit]).toEqual([null, mainBefore]);
  expect(state.definitions[0]?.circuit.components).toHaveLength(4);
  // The main circuit's own history is back: undo takes back the make component.
  useEditor.getState().undo();
  expect(useEditor.getState().circuit.components.map((c) => c.id)).toEqual([i, n, o]);
});

test("an armed chip places an instance of its definition; nesting is checked through definitions", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const inner = useEditor.getState().definitions[0]?.id ?? "";
  const { armChip, add } = useEditor.getState();
  armChip(inner);
  const placed = add("custom", { x: 0, y: 10 });
  expect(useEditor.getState().circuit.components.find((c) => c.id === placed)?.definition).toBe(inner);
  const definitions = [
    ...useEditor.getState().definitions,
    { id: "outer", name: "Outer", circuit: { components: useEditor.getState().circuit.components.slice(-1), junctions: [], wires: [] } },
  ];
  expect(contains(definitions, "outer", inner)).toBe(true);
  expect(contains(definitions, inner, "outer")).toBe(false);
});

test("paste refuses an instance that would make a definition contain itself; opening a file clears the clipboard", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const state = useEditor.getState();
  const id = state.definitions[0]?.id ?? "";
  // Copy the instance, then try to paste it into its own definition.
  state.copy();
  state.openSheet(id);
  const before = useEditor.getState().circuit;
  useEditor.getState().paste();
  expect(useEditor.getState().circuit).toBe(before);
  useEditor.getState().closeSheet();
  useEditor.getState().paste();
  expect(useEditor.getState().circuit.components.filter((c) => c.kind === "custom")).toHaveLength(2);
  // Another file has none of these definitions: nothing is left to paste.
  const metadata = { name: "Other", createdAt: "2026-11-07T00:00:00Z", modifiedAt: "2026-11-07T00:00:00Z" };
  useEditor.getState().load({ format: "clockyard", version: 4, metadata, circuit: { components: [], junctions: [], wires: [] }, definitions: [] });
  useEditor.getState().paste();
  expect(useEditor.getState().clipboard).toBeNull();
  expect(useEditor.getState().circuit.components).toEqual([]);
});

test("relabelling a pin inside a definition keeps the wires to it on every instance", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const id = useEditor.getState().definitions[0]?.id ?? "";
  const x = useEditor.getState().circuit.components.find((c) => c.kind === "custom")?.id ?? "";
  const s = useEditor.getState().add("switch", { x: -6, y: 3 });
  useEditor.getState().connect(port(s, "out"), port(x, i));
  useEditor.getState().openSheet(id);
  useEditor.getState().setLabel(i, "Data");
  useEditor.getState().closeSheet();
  const instance = useEditor.getState().circuit.components.find((c) => c.id === x);
  expect(useEditor.getState().circuit.wires.map((w) => w.to)).toEqual([port(x, i)]);
  expect(Object.keys(layoutOf(instance as never).inputs)).toEqual([i]);
  expect(pinLabel(id, i)).toBe("Data");
});

test("renaming a definition normalizes and caps the name like a label, also while its sheet is open", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const id = useEditor.getState().definitions[0]?.id ?? "";
  const name = () => useEditor.getState().definitions[0]?.name;
  useEditor.getState().renameDefinition(id, "  Not\ngate ");
  expect(name()).toBe("Not gate");
  useEditor.getState().renameDefinition(id, "x".repeat(40));
  expect(name()).toBe("x".repeat(32));
  useEditor.getState().renameDefinition(id, "   ");
  expect(name()).toBe("Component");
  // Not an undo step: undo still takes back the make component.
  const before = useEditor.getState().past.length;
  useEditor.getState().renameDefinition(id, "Inverter");
  expect(useEditor.getState().past).toHaveLength(before);
  // On its own sheet, a rename keeps the edits made there.
  useEditor.getState().openSheet(id);
  useEditor.getState().add("led", { x: 9, y: 4 });
  useEditor.getState().renameDefinition(id, "Buffer");
  expect(liveDefinitions(useEditor.getState())[0]).toMatchObject({ name: "Buffer", circuit: { components: { length: 4 } } });
});

test("a definition is deleted only when nothing uses it; undo steps holding its instances go with it", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const inner = useEditor.getState().definitions[0]?.id ?? "";
  const instance = useEditor.getState().selection[0] ?? "";
  // Placed on the main circuit: refused, and the reason names where.
  expect(useEditor.getState().deleteDefinition(inner)).toBe("Inverter is still used in the main circuit. Delete those instances first.");
  // Also placed inside another definition (with a pin of its own, which a component needs).
  const pin = useEditor.getState().add("switch", { x: 0, y: 20 });
  useEditor.getState().setLabel(pin, "P");
  useEditor.getState().select([instance, pin]);
  useEditor.getState().makeComponent("Outer");
  const outer = useEditor.getState().definitions[1]?.id ?? "";
  expect(useEditor.getState().deleteDefinition(inner)).toBe("Inverter is still used in Outer. Delete those instances first.");
  // Open on its sheet: refused too.
  useEditor.getState().openSheet(outer);
  expect(useEditor.getState().deleteDefinition(outer)).toMatch(/is open/);
  useEditor.getState().closeSheet();

  // Outer's instance is the only use of it; once removed, Outer can go.
  const outerInstance = useEditor.getState().circuit.components.find((c) => c.definition === outer)?.id ?? "";
  useEditor.getState().select([outerInstance]);
  useEditor.getState().copy();
  useEditor.getState().armChip(outer);
  useEditor.getState().remove([outerInstance]);
  expect(useEditor.getState().deleteDefinition(outer)).toBeNull();
  const state = useEditor.getState();
  expect(state.definitions.map((d) => d.id)).toEqual([inner]);
  expect([state.clipboard, state.armed, state.armedDefinition]).toEqual([null, null, null]);
  expect(state.histories[outer]).toBeUndefined();
  // No undo step can bring an instance of it back.
  const all = [...state.past, ...state.future];
  expect(all.some((c) => c.components.some((p) => p.definition === outer))).toBe(false);
  while (useEditor.getState().past.length > 0) useEditor.getState().undo();
  while (useEditor.getState().future.length > 0) useEditor.getState().redo();
  expect(useEditor.getState().circuit.components.some((p) => p.definition === outer)).toBe(false);
  // Inverter is free now too.
  expect(useEditor.getState().deleteDefinition(inner)).toBeNull();
  expect(useEditor.getState().definitions).toEqual([]);
});
