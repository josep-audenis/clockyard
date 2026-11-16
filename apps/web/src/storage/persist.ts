// Autosave (ADR 0029): the open document is saved as a project in this browser after a second without changes, and at
// once when the page is hidden. A document opened from an example, a starter, a link or a file becomes a project at
// its first change. If another tab saved the project since this one read it, this tab's work is saved as a copy.
import { create } from "zustand";
import { normalizeNotes, type CircuitDocument } from "../editor/document";
import { liveDefinitions, mainCircuit, useEditor, type EditorState } from "../editor/store";
import { FORMAT_VERSION, parseDocument, serializeDocument } from "./file";
import { browserStorage, type ProjectSummary, type Storage } from "./projects";

export type ProjectsState = {
  /** null while storage is opening; false when the browser refuses it, with `reason`. */
  available: boolean | null;
  reason: string | null;
  /** The saved project the editor shows, or null for a document not saved yet. */
  projectId: string | null;
  /** When the open project was last saved, or null. */
  savedAt: string | null;
  /** The last save had to make a copy: another tab had saved this project since. */
  copied: boolean;
  /** Why the last save, open or delete failed, or null. */
  error: string | null;
  projects: ProjectSummary[];
};

export const useProjects = create<ProjectsState>()(() => ({
  available: null,
  reason: null,
  projectId: null,
  savedAt: null,
  copied: false,
  error: null,
  projects: [],
}));

/** The whole document, whichever sheet is open: the main circuit and every definition as it is now. */
export function currentDocument(state: EditorState = useEditor.getState()): CircuitDocument {
  return {
    format: "clockyard",
    version: FORMAT_VERSION,
    // Notes are kept as typed while being edited; the file has them as Import would read them.
    metadata: { ...state.metadata, notes: normalizeNotes(state.metadata.notes ?? "") || undefined, modifiedAt: new Date().toISOString() },
    circuit: mainCircuit(state),
    definitions: liveDefinitions(state),
  };
}

/** What a save would write, without the time it was written: equal when nothing worth saving changed. */
const contentOf = (document: CircuitDocument) => serializeDocument({ ...document, metadata: { ...document.metadata, modifiedAt: "" } });

/** Waits this long after the last change before saving. */
export const SAVE_DELAY_MS = 1000;

let storage: Storage | null = null;
/** The revision of the open project last read or written here (0: not saved yet). */
let revision = 0;
/** The open document's content as last opened or saved: a change is anything else. */
let baseline = "";
let timer: ReturnType<typeof setTimeout> | undefined;
/** Saves run one after another, so two never race for one revision. */
let queue: Promise<void> = Promise.resolve();

async function save() {
  if (!storage) return;
  const document = currentDocument();
  const content = contentOf(document);
  if (content === baseline) return;
  const { projectId } = useProjects.getState();
  const id = projectId ?? crypto.randomUUID();
  const record = (doc: CircuitDocument, rev: number) => ({
    id: doc === document ? id : crypto.randomUUID(),
    name: doc.metadata.name,
    modifiedAt: doc.metadata.modifiedAt,
    revision: rev,
    text: serializeDocument(doc),
  });
  try {
    const mine = record(document, revision + 1);
    let saved = mine;
    let copied = false;
    if (!(await storage.save(mine, projectId ? revision : 0))) {
      // Another tab saved or deleted this project since: this tab's work becomes a project of its own.
      const name = `${document.metadata.name} (copy)`;
      const copy = { ...document, metadata: { ...document.metadata, name } };
      saved = record(copy, 1);
      await storage.save(saved, 0);
      copied = true;
      useEditor.setState(({ metadata }) => ({ metadata: { ...metadata, name } }));
      baseline = contentOf(copy);
    } else {
      baseline = content;
    }
    revision = saved.revision;
    await storage.setLast(saved.id);
    useProjects.setState({ projectId: saved.id, savedAt: saved.modifiedAt, copied, error: null, projects: await storage.projects() });
  } catch (error) {
    // The document in memory is untouched: the next change, or the page being hidden, tries again.
    useProjects.setState({ error: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/** Saves now if anything changed, after any save under way. */
export function flush(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  queue = queue.then(save);
  return queue;
}

/**
 * Opens `document` in the editor, after saving the one it replaces. `project`: the saved project it is, with the
 * revision read; without one it becomes a project at its first change.
 */
export async function openDocument(document: CircuitDocument, project?: { id: string; revision: number }) {
  await flush();
  useEditor.getState().load(document);
  revision = project?.revision ?? 0;
  baseline = contentOf(currentDocument());
  useProjects.setState({ projectId: project?.id ?? null, savedAt: project ? document.metadata.modifiedAt : null, copied: false, error: null });
  if (project) await storage?.setLast(project.id).catch(() => undefined);
}

/** An empty, unsaved circuit. */
export function newCircuit() {
  const now = new Date().toISOString();
  return openDocument({
    format: "clockyard",
    version: FORMAT_VERSION,
    metadata: { name: "Untitled", createdAt: now, modifiedAt: now },
    circuit: { components: [], junctions: [], wires: [] },
    definitions: [],
  });
}

/** Opens a saved project; a project that no longer opens says why and stays stored, untouched. */
export async function openProject(id: string) {
  const record = await storage?.project(id);
  if (!record) return useProjects.setState({ error: "That project is no longer here: another tab may have deleted it." });
  const result = parseDocument(record.text);
  if (!result.ok) return useProjects.setState({ error: `Could not open ${record.name}: ${result.error}` });
  await openDocument(result.document, { id, revision: record.revision });
}

/** Deletes a saved project; the circuit on screen, if it was that one, stays and is saved anew at its next change. */
export async function deleteProject(id: string) {
  if (!storage) return;
  await queue;
  try {
    await storage.remove(id);
    if (useProjects.getState().projectId === id) {
      revision = 0;
      useProjects.setState({ projectId: null, savedAt: null });
    }
    useProjects.setState({ projects: await storage.projects(), error: null });
  } catch (error) {
    useProjects.setState({ error: `Could not delete: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/** Whether replacing the circuit on screen loses nothing: it is saved, or will be before it goes. */
export const replacingIsSafe = () => useProjects.getState().available === true;

/**
 * Opens storage, reopens the last project unless `reopen` is false (a link in the address opens instead), and saves
 * changes from then on. Returns a function that stops it.
 */
export async function connectStorage({ open = browserStorage, reopen = true }: { open?: () => Promise<Storage>; reopen?: boolean } = {}) {
  baseline = contentOf(currentDocument());
  let opened: Storage;
  try {
    opened = await open();
  } catch (error) {
    useProjects.setState({ available: false, reason: error instanceof Error ? error.message : String(error) });
    return () => undefined;
  }
  storage = opened;
  useProjects.setState({ available: true, reason: null, projects: await storage.projects() });
  const last = reopen ? await storage.last() : undefined;
  // Unless something was opened meanwhile, which then wins.
  if (last && contentOf(currentDocument()) === baseline) await openProject(last);

  let seen = useEditor.getState();
  const unsubscribe = useEditor.subscribe((state) => {
    // Only what Export writes: switch positions, the selection or the view never save.
    const changed = state.circuit !== seen.circuit || state.definitions !== seen.definitions || state.main !== seen.main || state.metadata !== seen.metadata;
    seen = state;
    if (!changed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  });
  const hidden = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  // A page has a document; a unit test of this module does not.
  const page = typeof document === "undefined" ? undefined : document;
  page?.addEventListener("visibilitychange", hidden);
  return () => {
    unsubscribe();
    page?.removeEventListener("visibilitychange", hidden);
    clearTimeout(timer);
    // A later connection (React runs effects twice in development) keeps its own storage.
    if (storage === opened) storage = null;
  };
}
