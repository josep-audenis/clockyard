import { beforeEach, expect, test } from "vitest";
import { endOwner, sameEnd, type Circuit } from "./document";
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
  load({ format: "clockyard", version: 8, metadata, circuit, definitions: [] });
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
  load({ format: "clockyard", version: 8, metadata, circuit: { components: [], junctions: [], wires: [] }, definitions: [] });
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
  // Crosses the selection's edge; the engine says `n`, inside, drives its net (ADR 0016).
  const cross = useEditor.getState().connect(port(n, "out"), port(outside, "in")) ?? "";
  const nets = { wireNets: { [cross]: 2 }, wireWidths: { [cross]: 1 }, netDrivers: [null, i, n] };
  const { select, makeComponent, undo } = useEditor.getState();
  select([i, n, o]);
  expect(makeComponent("  Inverter ", { stale: false, nets })).toBeNull();
  const state = useEditor.getState();
  const [definition] = state.definitions;
  expect(definition?.name).toBe("Inverter");
  // Moved to its own origin, wires inside kept; the crossing became an LED 4 cells right, on its row.
  expect(definition?.circuit.components.map((c) => c.position)).toEqual([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 9, y: 0 },
    { x: 15, y: 0 },
  ]);
  const pin = definition?.circuit.components[3];
  expect(pin).toMatchObject({ kind: "led", props: { label: "out1" } });
  expect(definition?.circuit.wires).toHaveLength(3);
  expect(definition?.circuit.wires[2]).toMatchObject({ from: port(n, "out"), to: port(pin?.id ?? "", "in") });
  const instance = state.circuit.components.find((c) => c.kind === "custom");
  expect(instance).toMatchObject({ definition: definition?.id, position: { x: 2, y: 3 } });
  expect(state.circuit.components.map((c) => c.id)).toEqual([outside, instance?.id]);
  // The outside LED is wired to the instance's new port.
  expect(state.circuit.wires.map((w) => [w.from, w.to])).toEqual([[port(instance?.id ?? "", pin?.id ?? ""), port(outside, "in")]]);
  expect(state.selection).toEqual([instance?.id]);
  // Its layout comes from the pins, ports named by pin part ID: input In on the left, outputs Out and out1 on the right.
  expect(layoutOf(instance as never)).toEqual({
    width: 4,
    height: 4,
    inputs: { [i]: { x: 0, y: 1 } },
    outputs: { [o]: { x: 4, y: 1 }, [pin?.id ?? ""]: { x: 4, y: 3 } },
  });
  expect([pinLabel(definition?.id, i), pinLabel(definition?.id, o)]).toEqual(["In", "Out"]);
  // One undo step for the main circuit; the definition stays available.
  undo();
  expect(useEditor.getState().circuit.components.map((c) => c.id)).toEqual([i, n, o, outside]);
  expect(useEditor.getState().definitions).toHaveLength(1);
});

test("make component: crossings become input pins, one per net, named from outside and as wide as the net", () => {
  const { add, connect, setLabel, setWidth, select, makeComponent } = useEditor.getState();
  const a = add("switch", { x: 0, y: 0 });
  setLabel(a, "Y");
  setWidth(a, 8);
  const b = add("switch", { x: 0, y: 8 });
  const g = add("and", { x: 10, y: 0 });
  setWidth(g, 8);
  const n = add("not", { x: 10, y: 8 });
  const o = add("led", { x: 20, y: 1 });
  setLabel(o, "Y");
  setWidth(o, 8);
  const wa = connect(port(a, "out"), port(g, "a")) ?? "";
  const wb = connect(port(a, "out"), port(g, "b")) ?? "";
  const wn = connect(port(b, "out"), port(n, "in")) ?? "";
  connect(port(g, "out"), port(o, "in"));
  // a's two wires are one net; b's is another. Both are driven from outside.
  const nets = {
    wireNets: { [wa]: 1, [wb]: 1, [wn]: 2 },
    wireWidths: { [wa]: 8, [wb]: 8, [wn]: 1 },
    netDrivers: [null, a, b, g],
  };
  select([g, n, o]);
  // Crossings need the engine's view of the circuit as it is now.
  expect(makeComponent("x")).toMatch(/Wait for the simulation/);
  expect(makeComponent("x", { stale: true, nets })).toMatch(/Wait for the simulation/);
  expect(makeComponent("x", { stale: false, nets: null })).toMatch(/Fix the circuit's errors/);
  expect(useEditor.getState().definitions).toEqual([]);

  expect(makeComponent("x", { stale: false, nets })).toBeNull();
  const state = useEditor.getState();
  const definition = state.definitions[0];
  const added = definition?.circuit.components.filter((c) => c.kind === "switch") ?? [];
  // Y is taken by the LED inside, so a's pin is Y-2; b has no label, so in1.
  expect(added.map((c) => c.props)).toEqual([{ label: "Y-2", width: 8 }, { label: "in1" }]);
  // 4 cells left of the selection, each on its crossing's row (a wide switch is 5 cells), from the new origin.
  expect(added.map((c) => c.position)).toEqual([
    { x: 0, y: 0 },
    { x: 3, y: 8 },
  ]);
  const [y2, in1] = added.map((c) => c.id);
  const from = (pin: string | undefined) => definition?.circuit.wires.filter((w) => sameEnd(w.from, port(pin ?? "", "out"))).map((w) => w.to);
  expect(from(y2)).toEqual([port(g, "a"), port(g, "b")]);
  expect(from(in1)).toEqual([port(n, "in")]);
  const instance = state.circuit.components.find((c) => c.kind === "custom")?.id ?? "";
  expect(state.circuit.wires.map((w) => [w.from, w.to])).toEqual([
    [port(a, "out"), port(instance, y2 ?? "")],
    [port(b, "out"), port(instance, in1 ?? "")],
  ]);
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
  useEditor.getState().load({ format: "clockyard", version: 8, metadata, circuit: { components: [], junctions: [], wires: [] }, definitions: [] });
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

test("deleting from another sheet drops steps holding its instances from the main circuit's and every sheet's history", () => {
  const { i, n, o } = inverter();
  useEditor.getState().select([i, n, o]);
  useEditor.getState().makeComponent("Inverter");
  const inner = useEditor.getState().definitions[0]?.id ?? "";
  const x = useEditor.getState().selection[0] ?? "";
  // Outer holds the Inverter instance; Other is just somewhere else to stand.
  const p = useEditor.getState().add("switch", { x: 0, y: 20 });
  useEditor.getState().setLabel(p, "P");
  useEditor.getState().select([x, p]);
  useEditor.getState().makeComponent("Outer");
  const outer = useEditor.getState().definitions[1]?.id ?? "";
  const q = useEditor.getState().add("switch", { x: 0, y: 30 });
  useEditor.getState().setLabel(q, "Q");
  useEditor.getState().select([q]);
  useEditor.getState().makeComponent("Other");
  const other = useEditor.getState().definitions[2]?.id ?? "";
  // Remove the instance on Outer's sheet: now only undo steps hold one.
  useEditor.getState().openSheet(outer);
  useEditor.getState().remove([x]);
  useEditor.getState().closeSheet();
  useEditor.getState().openSheet(other);

  const holds = (c: Circuit) => c.components.some((part) => part.definition === inner);
  const before = useEditor.getState();
  expect(before.main?.past.some(holds)).toBe(true);
  expect(before.histories[outer]?.past.some(holds)).toBe(true);
  expect(useEditor.getState().deleteDefinition(inner)).toBeNull();

  // Every circuit undo or redo can reach, on the main circuit and on Outer's sheet.
  const reachable = (): Circuit[] => {
    const seen = [useEditor.getState().circuit];
    while (useEditor.getState().past.length > 0) seen.push((useEditor.getState().undo(), useEditor.getState().circuit));
    while (useEditor.getState().future.length > 0) seen.push((useEditor.getState().redo(), useEditor.getState().circuit));
    return seen;
  };
  useEditor.getState().closeSheet();
  expect(reachable().some(holds)).toBe(false);
  useEditor.getState().openSheet(outer);
  expect(reachable().some(holds)).toBe(false);
});

test("setWidth is one undo step, 1 removes the prop, bad widths and chips are refused, a switch keeps what fits", () => {
  const { add, setWidth, setInput, undo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const props = () => useEditor.getState().circuit.components.find((c) => c.id === s)?.props;
  setWidth(s, 8);
  expect(props()).toEqual({ width: 8 });
  setInput(s, 0b1010_1100);
  const { past } = useEditor.getState();
  for (const bad of [0, 33, 2.5, Number.NaN, 8]) setWidth(s, bad);
  expect(useEditor.getState().past).toBe(past);
  setWidth(s, 4);
  expect(useEditor.getState().inputs[s]).toBe(0b1100);
  setWidth(s, 1);
  expect(props()).toEqual({});
  expect(useEditor.getState().inputs[s]).toBe(0);
  undo();
  expect(props()).toEqual({ width: 4 });
  const chip = add("custom", { x: 9, y: 0 });
  setWidth(chip, 8);
  expect(useEditor.getState().circuit.components.find((c) => c.id === chip)?.props).toEqual({});
});

test("undo and redo keep a switch's value within the width it gets back", () => {
  const { add, setWidth, setInput, undo, redo } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  setWidth(s, 8);
  setInput(s, 200);
  undo();
  expect(useEditor.getState().inputs[s]).toBe(0);
  redo();
  setInput(s, 200);
  setWidth(s, 4);
  undo();
  setInput(s, 200);
  redo();
  expect(useEditor.getState().inputs[s]).toBe(200 % 16);
});

test("a splitter starts with four 1-bit fields; setFields is one undo step and drops wires to fields that go", () => {
  const { add, connect, setFields, setWidth, undo } = useEditor.getState();
  const sp = add("split", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const k = add("led", { x: 8, y: 4 });
  const part = () => useEditor.getState().circuit.components.find((c) => c.id === sp);
  expect(part()?.props).toEqual({ fields: [1, 1, 1, 1] });
  connect(port(sp, "f0"), port(l, "in"));
  const far = connect(port(sp, "f3"), port(k, "in"));
  const { past } = useEditor.getState();
  for (const bad of [[], [0, 4], [16, 17], [1, 1, 1, 1]]) setFields(sp, bad);
  setWidth(sp, 8);
  expect(useEditor.getState().past).toBe(past);
  setFields(sp, [4, 4]);
  expect(part()?.props).toEqual({ fields: [4, 4] });
  expect(useEditor.getState().circuit.wires.map((w) => w.id)).not.toContain(far);
  expect(useEditor.getState().circuit.wires).toHaveLength(1);
  undo();
  expect(part()?.props).toEqual({ fields: [1, 1, 1, 1] });
  expect(useEditor.getState().circuit.wires).toHaveLength(2);
  setFields(l, [4, 4]);
  expect(useEditor.getState().circuit.components.find((c) => c.id === l)?.props).toEqual({});
});

test("setFields takes up to 32 fields, keeps the bus wire, and drops a junction left with no wires", () => {
  const { add, connect, connectToWire, setFields } = useEditor.getState();
  const sp = add("split", { x: 0, y: 0 });
  const s = add("switch", { x: -6, y: 0 });
  const bus = connect(port(s, "out"), port(sp, "in"));
  // A junction whose three wires all reach fields f1 to f3.
  const between = connect(port(sp, "f1"), port(sp, "f2"));
  if (!between) throw new Error("no wire");
  connectToWire(port(sp, "f3"), between, { x: 5, y: 2 });
  expect(useEditor.getState().circuit.junctions).toHaveLength(1);
  setFields(sp, Array<number>(32).fill(1));
  expect(useEditor.getState().circuit.components.find((c) => c.id === sp)?.props.fields).toHaveLength(32);
  setFields(sp, [8]);
  const { wires, junctions } = useEditor.getState().circuit;
  expect(wires.map((w) => w.id)).toEqual([bus]);
  expect(junctions).toEqual([]);
});

test("a copied net label keeps its name", () => {
  const { add, connectToWire, connect, select, copy, paste } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 8, y: 0 });
  const w = connect(port(s, "out"), port(l, "in"));
  if (!w) throw new Error("no wire");
  const k = add("led", { x: 8, y: 6 });
  connectToWire(port(k, "in"), w, { x: 5, y: 1 });
  const [j] = useEditor.getState().circuit.junctions;
  if (!j) throw new Error("no junction");
  useEditor.setState((state) => ({
    circuit: { ...state.circuit, junctions: state.circuit.junctions.map((x) => ({ ...x, name: "clk" })) },
  }));
  select([s, l, k, j.id, ...useEditor.getState().circuit.wires.map((x) => x.id)]);
  copy();
  paste();
  expect(useEditor.getState().circuit.junctions.map((x) => x.name)).toEqual(["clk", "clk"]);
});

test("addLabel places a selected junction named n1, n2, … skipping names in use, one undo step; never on a port", () => {
  const { add, armLabel, addLabel, setName, undo } = useEditor.getState();
  armLabel(true);
  const a = addLabel({ x: 10, y: 10 });
  expect(useEditor.getState()).toMatchObject({ selection: [a], armedLabel: false });
  if (!a) throw new Error("not placed");
  setName(a, "n2");
  const b = addLabel({ x: 14, y: 10 });
  const names = () => useEditor.getState().circuit.junctions.map((j) => j.name);
  expect(names()).toEqual(["n2", "n1"]);
  const s = add("switch", { x: 0, y: 0 });
  expect(addLabel({ x: 2, y: 1 })).toBeNull(); // the switch's output port
  expect(useEditor.getState().circuit.components.map((c) => c.id)).toEqual([s]);
  undo(); // the switch
  undo(); // label b
  expect(useEditor.getState().circuit.junctions.map((j) => j.id)).toEqual([a]);
  expect(b).not.toBeNull();
});

test("setName normalizes like import, is one undo step, and clearing an unwired label removes it", () => {
  const { addLabel, setName, undo } = useEditor.getState();
  const a = addLabel({ x: 4, y: 4 });
  if (!a) throw new Error("not placed");
  const name = () => useEditor.getState().circuit.junctions.find((j) => j.id === a)?.name;
  setName(a, "  café ");
  expect(name()).toBe("café");
  const { past } = useEditor.getState();
  setName(a, "café");
  expect(useEditor.getState().past).toBe(past);
  setName(a, "x".repeat(40));
  expect(name()).toBe("x".repeat(32));
  setName(a, "   ");
  expect(useEditor.getState().circuit.junctions).toEqual([]);
  undo();
  expect(name()).toBe("x".repeat(32));
});

test("deleting the last wire of a named junction keeps it; of a plain one removes it; a copied unwired label survives", () => {
  const { add, connect, connectToWire, setName, remove, select, copy, paste } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const l = add("led", { x: 10, y: 0 });
  const k = add("led", { x: 10, y: 6 });
  const w = connect(port(s, "out"), port(l, "in"));
  if (!w) throw new Error("no wire");
  connectToWire(port(k, "in"), w, { x: 6, y: 1 });
  const [j] = useEditor.getState().circuit.junctions;
  if (!j) throw new Error("no junction");
  setName(j.id, "go");
  remove(useEditor.getState().circuit.wires.map((x) => x.id));
  expect(useEditor.getState().circuit.junctions.map((x) => x.name)).toEqual(["go"]);
  select([j.id]);
  copy();
  paste();
  expect(useEditor.getState().circuit.junctions.map((x) => x.name)).toEqual(["go", "go"]);

  // A plain junction left with no wires goes.
  const plain = connect(port(s, "out"), port(l, "in"));
  if (!plain) throw new Error("no wire");
  connectToWire(port(k, "in"), plain, { x: 6, y: 1 });
  const before = useEditor.getState().circuit.junctions.length;
  remove(useEditor.getState().circuit.wires.map((x) => x.id));
  expect(useEditor.getState().circuit.junctions).toHaveLength(before - 1);
});

test("labels: refused on a junction, kept by setFields, duplicated alone, and disarmed by arming a part or a sheet switch", () => {
  const { add, connect, connectToWire, addLabel, setName, setFields, select, duplicate, armLabel, arm } = useEditor.getState();
  const sp = add("split", { x: 0, y: 0 });
  const l = add("led", { x: 10, y: 0 });
  const k = add("led", { x: 10, y: 8 });
  const w = connect(port(sp, "f3"), port(l, "in"));
  if (!w) throw new Error("no wire");
  connectToWire(port(k, "in"), w, { x: 6, y: 4 });
  const [j] = useEditor.getState().circuit.junctions;
  if (!j) throw new Error("no junction");
  expect(addLabel(j.position)).toBeNull();
  setName(j.id, "bit3");
  // Fields shrink: f3 and its wire go, the label and its other wires stay.
  setFields(sp, [1, 1]);
  expect(useEditor.getState().circuit.junctions.map((x) => x.name)).toEqual(["bit3"]);
  select([j.id]);
  duplicate();
  expect(useEditor.getState().circuit.junctions.map((x) => x.name)).toEqual(["bit3", "bit3"]);
  armLabel(true);
  arm("and");
  expect(useEditor.getState()).toMatchObject({ armed: "and", armedLabel: false });
  armLabel(true);
  expect(useEditor.getState()).toMatchObject({ armed: null, armedLabel: true });
});

test("make component: pins follow the rows nets cross on, step past each other, take a net label's name, and skip undriven nets", () => {
  const { add, addLabel, setName, setLabel, connect, select, makeComponent } = useEditor.getState();
  const s = add("switch", { x: 0, y: 0 });
  const t = add("switch", { x: 0, y: 6 });
  const g = add("and", { x: 10, y: 0 }); // a (10,1), b (10,3), out (14,2)
  const y = add("led", { x: 24, y: 1 });
  setLabel(y, "Y");
  const u = add("led", { x: 20, y: 6 });
  const label = (at: { x: number; y: number }, name: string) => {
    const id = addLabel(at) ?? "";
    setName(id, name);
    return id;
  };
  const go = label({ x: 4, y: 4 }, "go"); // outside
  const mid = label({ x: 8, y: 2 }, "mid"); // inside
  const k = label({ x: 12, y: 6 }, "k"); // inside
  const j = (id: string) => ({ junction: id });
  const ws = connect(port(s, "out"), port(g, "a")) ?? "";
  const wt = connect(port(t, "out"), j(go)) ?? "";
  const wl = connect(j(go), j(mid)) ?? "";
  const wb = connect(j(mid), port(g, "b")) ?? "";
  const wy = connect(port(g, "out"), port(y, "in")) ?? "";
  const wu = connect(j(k), port(u, "in")) ?? ""; // undriven: a pin here would join readers with nothing driving
  const nets = {
    wireNets: { [ws]: 1, [wt]: 2, [wl]: 2, [wb]: 2, [wy]: 3, [wu]: 0 },
    wireWidths: { [ws]: 1, [wt]: 1, [wl]: 1, [wb]: 1, [wy]: 1, [wu]: 1 },
    netDrivers: [null, s, t, g],
  };
  select([g, mid, k]);
  expect(makeComponent("x", { stale: false, nets })).toBeNull();
  const state = useEditor.getState();
  const definition = state.definitions[0];
  const added = definition?.circuit.components.filter((c) => c.kind !== "and") ?? [];
  // in1 on row 1; go on row 2, stepped down past in1; Y on g.out's row, 4 cells right. Origin (2, 0).
  expect(added.map((c) => [c.kind, c.props.label, c.position])).toEqual([
    ["switch", "in1", { x: 0, y: 0 }],
    ["switch", "go", { x: 0, y: 3 }],
    ["led", "Y", { x: 16, y: 1 }],
  ]);
  const instance = state.circuit.components.find((c) => c.kind === "custom")?.id ?? "";
  const [in1, goPin, yPin] = added.map((c) => c.id);
  expect(state.circuit.wires.map((w) => [w.from, w.to])).toEqual([
    [port(t, "out"), j(go)],
    [port(s, "out"), port(instance, in1 ?? "")],
    [j(go), port(instance, goPin ?? "")],
    [port(instance, yPin ?? ""), port(y, "in")],
  ]);
  // The undriven crossing is dropped; its label stays inside, as labels do.
  expect(definition?.circuit.junctions.map((x) => x.name)).toEqual(["mid", "k"]);
});

test("make component refuses a selection whose only crossings are undriven: no pins", () => {
  const { add, connect, select, makeComponent } = useEditor.getState();
  const g = add("not", { x: 10, y: 0 });
  const u = add("led", { x: 20, y: 0 });
  const w = connect(port(g, "in"), port(u, "in")) ?? "";
  select([g]);
  const nets = { wireNets: { [w]: 0 }, wireWidths: { [w]: 1 }, netDrivers: [null, g] };
  expect(makeComponent("x", { stale: false, nets })).toMatch(/needs pins/);
});

test("make component leaves a junction a net only passes through on the sheet, and keeps the instance's ports off junctions", () => {
  const { add, connect, connectToWire, addLabel, setLabel, select, makeComponent } = useEditor.getState();
  const s = add("switch", { x: 0, y: 10 });
  const y = add("led", { x: 20, y: 10 });
  const z = add("led", { x: 20, y: 14 });
  const w = connect(port(s, "out"), port(y, "in")) ?? "";
  connectToWire(port(z, "in"), w, { x: 8, y: 11 });
  const [through] = useEditor.getState().circuit.junctions;
  const { i, n, o } = inverter(); // instance would sit at (2,3), its input port at (2,4)
  const label = addLabel({ x: 2, y: 4 }) ?? "";
  setLabel(i, "In");
  select([i, n, o, through?.id ?? ""]);
  // No wire crosses: the passing net stays outside, so no engine result is needed.
  expect(makeComponent("Inverter")).toBeNull();
  const state = useEditor.getState();
  expect(state.circuit.junctions.map((j) => j.id)).toEqual([through?.id, label]);
  expect(state.circuit.wires.filter((x) => endOwner(x.from) === through?.id || endOwner(x.to) === through?.id)).toHaveLength(3);
  expect(state.definitions[0]?.circuit.junctions).toEqual([]);
  // Stepped down 2 cells: (2,4) holds the label.
  expect(state.circuit.components.find((c) => c.kind === "custom")?.position).toEqual({ x: 2, y: 5 });
});

test("a ROM's address width and contents are edits: words that no longer fit go, and each keeps the bits its width holds", () => {
  const { add, setData, setAddressWidth, setWidth, undo } = useEditor.getState();
  const r = add("rom", { x: 0, y: 0 });
  const props = () => useEditor.getState().circuit.components.find((c) => c.id === r)?.props;
  setWidth(r, 8);
  setData(r, [1, 2, 300]); // 300 does not fit 8 bits: nothing changes
  expect(props()).toEqual({ width: 8 });
  setData(r, [1, 2, 0xff, 4]);
  expect(props()).toEqual({ width: 8, data: [1, 2, 0xff, 4] });
  setAddressWidth(r, 1);
  expect(props()).toEqual({ width: 8, addressWidth: 1, data: [1, 2] });
  setWidth(r, 1);
  expect(props()).toEqual({ addressWidth: 1, data: [1, 0] });
  undo();
  expect(props()).toEqual({ width: 8, addressWidth: 1, data: [1, 2] });
  setAddressWidth(r, 8); // the default is not stored
  expect(props()).toEqual({ width: 8, data: [1, 2] });
});

test("a ROM's program: an empty one clears words and source, and unchanged words and source are no edit whatever the key order", () => {
  const { add, setWidth, setData, setLabel } = useEditor.getState();
  const r = add("rom", { x: 0, y: 0 });
  setWidth(r, 16);
  setData(r, [0x1005, 0xc000], "LDI 5\nHLT");
  setLabel(r, "Program"); // the label now comes after data and source
  const steps = useEditor.getState().past.length;
  setData(r, [0x1005, 0xc000], "LDI 5\nHLT");
  expect(useEditor.getState().past.length).toBe(steps);
  setData(r, [], "");
  expect(useEditor.getState().circuit.components.find((c) => c.id === r)?.props).toEqual({ width: 16, label: "Program" });
});
