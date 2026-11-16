import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useEditor } from "../editor/store";
import { connectStorage, deleteProject, flush, newCircuit, openDocument, SAVE_DELAY_MS, useProjects } from "./persist";
import { memoryStorage, type Storage } from "./projects";
import { parseDocument } from "./file";
import type { CircuitDocument } from "../editor/document";

const editor = useEditor.getState();
const projects = useProjects.getState();
let stop: () => void = () => undefined;

beforeEach(() => {
  useEditor.setState(editor, true);
  useProjects.setState(projects, true);
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

const connect = async (storage: Storage, reopen = true) => {
  stop = await connectStorage({ open: async () => storage, reopen });
};
const addSwitch = () => useEditor.getState().add("switch", { x: 0, y: 0 });
const emptyDocument: CircuitDocument = {
  format: "clockyard",
  version: 11,
  metadata: { name: "Empty", createdAt: "x", modifiedAt: "x" },
  circuit: { components: [], junctions: [], wires: [] },
  definitions: [],
};
const stored = async (storage: Storage, id: string) => {
  const result = parseDocument((await storage.project(id))?.text ?? "");
  if (!result.ok) throw new Error(result.error);
  return result.document;
};

test("a change is saved a second after the last one, as a new project, and the page remembers it (ADR 0029)", async () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  await connect(storage);
  expect(useProjects.getState()).toMatchObject({ available: true, projectId: null, projects: [] });
  addSwitch();
  await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
  expect(await storage.projects()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  const { projectId, savedAt } = useProjects.getState();
  expect(projectId).not.toBeNull();
  expect(savedAt).not.toBeNull();
  expect(await storage.last()).toBe(projectId);
  expect((await stored(storage, projectId ?? "")).circuit.components).toHaveLength(1);
  // Selecting or switching saves nothing: only what Export writes counts.
  const revision = (await storage.projects())[0]?.revision;
  useEditor.getState().select([]);
  await flush();
  expect((await storage.projects())[0]?.revision).toBe(revision);
});

test("the last project reopens on load, unless a link opens instead", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  useEditor.getState().rename("Mine");
  await flush();
  const id = useProjects.getState().projectId;
  stop();

  useEditor.setState(editor, true);
  await connect(storage);
  expect(useEditor.getState().metadata.name).toBe("Mine");
  expect(useEditor.getState().circuit.components).toHaveLength(1);
  expect(useProjects.getState().projectId).toBe(id);
  stop();

  useEditor.setState(editor, true);
  await connect(storage, false);
  expect(useEditor.getState().circuit.components).toHaveLength(0);
});

test("an opened document becomes a project only at its first change; the one it replaces is saved first", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  const example: CircuitDocument = {
    format: "clockyard",
    version: 11,
    metadata: { name: "Example", createdAt: "x", modifiedAt: "x" },
    circuit: { components: [], junctions: [], wires: [] },
    definitions: [],
  };
  // Opened before the delay ran out: the work it replaces is saved anyway.
  await openDocument(example);
  expect(await storage.projects()).toHaveLength(1);
  expect(useProjects.getState().projectId).toBeNull();
  await flush();
  expect(await storage.projects()).toHaveLength(1);
  addSwitch();
  await flush();
  expect((await storage.projects()).map((p) => p.name).sort()).toEqual(["Example", "Untitled"]);
});

test("if another tab saved the project since, this tab's work is saved as a copy, and nothing is lost", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  await flush();
  const { projectId } = useProjects.getState();
  const theirs = await storage.project(projectId ?? "");
  if (!theirs) throw new Error("not saved");
  expect(await storage.save({ ...theirs, revision: theirs.revision + 1, text: theirs.text }, theirs.revision)).toBe(true);

  addSwitch();
  await flush();
  const state = useProjects.getState();
  expect(state.copied).toBe(true);
  expect(state.projectId).not.toBe(projectId);
  expect(useEditor.getState().metadata.name).toBe("Untitled (copy)");
  expect((await stored(storage, state.projectId ?? "")).circuit.components).toHaveLength(2);
  expect((await stored(storage, projectId ?? "")).circuit.components).toHaveLength(1);
  // The copy is this tab's project from now on.
  addSwitch();
  await flush();
  expect(useProjects.getState().copied).toBe(false);
  expect(await storage.projects()).toHaveLength(2);
});

test("deleting the open project keeps the circuit on screen, which is saved anew at its next change", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  await flush();
  await deleteProject(useProjects.getState().projectId ?? "");
  expect(await storage.projects()).toEqual([]);
  expect(useProjects.getState().projectId).toBeNull();
  expect(useEditor.getState().circuit.components).toHaveLength(1);
  addSwitch();
  await flush();
  expect(await storage.projects()).toHaveLength(1);
});

test("New circuit opens an empty one, unsaved until it changes", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  await newCircuit();
  expect(useEditor.getState().circuit.components).toEqual([]);
  expect(useProjects.getState().projectId).toBeNull();
  expect(await storage.projects()).toHaveLength(1);
});

test("storage the browser refuses leaves the editor working, saying why nothing is saved", async () => {
  stop = await connectStorage({ open: () => Promise.reject(new Error("blocked by the browser")) });
  expect(useProjects.getState()).toMatchObject({ available: false, reason: "blocked by the browser" });
  addSwitch();
  await flush();
  expect(useEditor.getState().circuit.components).toHaveLength(1);
});

test("a failed save says so and leaves the document as it is", async () => {
  const storage = memoryStorage();
  storage.save = () => Promise.reject(new Error("the quota is full"));
  await connect(storage);
  addSwitch();
  await flush();
  expect(useProjects.getState().error).toBe("Not saved: the quota is full");
  expect(useEditor.getState().circuit.components).toHaveLength(1);
});

test("a circuit whose save failed is replaced only if the user agrees, and stays otherwise (ADR 0029)", async () => {
  const storage = memoryStorage();
  storage.save = () => Promise.reject(new Error("the quota is full"));
  await connect(storage);
  addSwitch();
  const other: CircuitDocument = { ...emptyDocument, metadata: { ...emptyDocument.metadata, name: "Other" } };
  const asked: string[] = [];
  expect(await openDocument(other, undefined, { ask: (error) => (asked.push(error), false) })).toBe(false);
  expect(asked).toEqual(["Not saved: the quota is full"]);
  expect(useEditor.getState().circuit.components).toHaveLength(1);
  expect(useProjects.getState().error).toBe("Not saved: the quota is full");
  expect(await openDocument(other, undefined, { ask: () => true })).toBe(true);
  expect(useEditor.getState().metadata.name).toBe("Other");
});

test("the last project reopens only onto the page as it loaded: a document opened meanwhile wins", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  useEditor.getState().rename("Last");
  await flush();
  stop();

  useEditor.setState(editor, true);
  // Reading the project takes a while; a file is opened in the meantime.
  const read = storage.project.bind(storage);
  storage.project = async (id) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return read(id);
  };
  const connecting = connectStorage({ open: async () => storage });
  await openDocument({ ...emptyDocument, metadata: { ...emptyDocument.metadata, name: "Imported" } });
  stop = await connecting;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(useEditor.getState().metadata.name).toBe("Imported");
});

test("deleting the last project used means it is neither reopened nor reported missing on the next load", async () => {
  const storage = memoryStorage();
  await connect(storage);
  addSwitch();
  await flush();
  await deleteProject(useProjects.getState().projectId ?? "");
  stop();
  useEditor.setState(editor, true);
  useProjects.setState(projects, true);
  await connect(storage);
  expect(useProjects.getState().error).toBeNull();
  expect(useEditor.getState().circuit.components).toEqual([]);
});

test("a save that throws before reaching storage does not stop later saves", async () => {
  const storage = memoryStorage();
  const save = storage.save.bind(storage);
  let fail = true;
  storage.save = (record, base) => (fail ? Promise.reject(new Error("once")) : save(record, base));
  await connect(storage);
  addSwitch();
  expect(await flush()).toBe(false);
  fail = false;
  expect(await flush()).toBe(true);
  expect(await storage.projects()).toHaveLength(1);
});
