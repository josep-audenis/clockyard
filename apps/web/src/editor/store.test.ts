import { beforeEach, expect, test } from "vitest";
import { useEditor } from "./store";

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
  move(l, { x: 9, y: 5 });
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
  const circuit = { components: [], wires: [] };
  load({ format: "clockyard", version: 1, metadata, circuit });
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
  move(s, { x: 1, y: 0 });
  move(s, { x: 2, y: 0 });
  move(s, { x: 3, y: 1 });
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
  load({ format: "clockyard", version: 1, metadata, circuit: { components: [], wires: [] } });
  undo();
  expect(ids()).toEqual([]);
});
