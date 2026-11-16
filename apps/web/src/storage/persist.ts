// Autosave (ADR 0029): the open document is saved as a project in this browser after a second without changes, and at
// once when the page is hidden. A document opened from an example, a starter, a link or a file becomes a project at
// its first change. If another tab saved the project since this one read it, this tab's work is saved as a copy.
import { create } from "zustand";
import { normalizeNotes, type CircuitDocument } from "../editor/document";
import { withContents } from "../editor/blueprints";
import { liveDefinitions, mainCircuit, useEditor, type EditorState } from "../editor/store";
import { FORMAT_VERSION, parseDocument, serializeDocument } from "./file";
import { browserStorage, libraryKey, type LibraryEntry, type ProjectSummary, type Storage } from "./projects";

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
  /** The component library, by name (ADR 0029). */
  library: LibraryEntry[];
  /** Challenges passed in this browser, by file name, with when each was first passed. */
  progress: Record<string, string>;
};

export const useProjects = create<ProjectsState>()(() => ({
  available: null,
  reason: null,
  projectId: null,
  savedAt: null,
  copied: false,
  error: null,
  projects: [],
  library: [],
  progress: {},
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
/** Saves and deletes run one after another, so two never race for one revision. Never rejects. */
let queue: Promise<boolean> = Promise.resolve(true);
/** Counts documents opened, so an open that waited (the last project, on load) never replaces one opened since. */
let opens = 0;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Saves the open document if it changed. False when it could not be saved; true when saved, or nothing to save. */
async function save(): Promise<boolean> {
  // No storage: the question before replacing a circuit is asked instead (`replacingIsSafe`).
  if (!storage) return true;
  try {
    const document = currentDocument();
    const content = contentOf(document);
    if (content === baseline) return true;
    const { projectId } = useProjects.getState();
    const record = (doc: CircuitDocument, id: string, rev: number) => ({
      id,
      name: doc.metadata.name,
      modifiedAt: doc.metadata.modifiedAt,
      revision: rev,
      text: serializeDocument(doc),
    });
    let saved = record(document, projectId ?? crypto.randomUUID(), revision + 1);
    let copied = false;
    if (!(await storage.save(saved, projectId ? revision : 0))) {
      // Another tab saved or deleted this project since: this tab's work becomes a project of its own.
      const name = `${document.metadata.name} (copy)`;
      const copy = { ...document, metadata: { ...document.metadata, name } };
      saved = record(copy, crypto.randomUUID(), 1);
      if (!(await storage.save(saved, 0))) throw new Error("the copy could not be stored");
      copied = true;
      useEditor.setState(({ metadata }) => ({ metadata: { ...metadata, name } }));
      baseline = contentOf(copy);
    } else {
      baseline = content;
    }
    revision = saved.revision;
    await storage.setLast(saved.id);
    useProjects.setState({ projectId: saved.id, savedAt: saved.modifiedAt, copied, error: null, projects: await storage.projects() });
    return true;
  } catch (error) {
    // The document in memory is untouched: the next change, or the page being hidden, tries again.
    useProjects.setState({ error: `Not saved: ${message(error)}` });
    return false;
  }
}

/** Saves now if anything changed, after any save under way. False when it could not be saved. */
export function flush(): Promise<boolean> {
  clearTimeout(timer);
  timer = undefined;
  queue = queue.then(save);
  return queue;
}

/** Asks whether to replace a circuit whose last save failed, losing its changes. */
const askToDiscard = (error: string) =>
  typeof window !== "undefined" && window.confirm(`${error}. Replace this circuit anyway? Its changes since your last export will be lost.`);

/**
 * Opens `document` in the editor, after saving the one it replaces; if that save fails, only once `ask` says yes.
 * `project`: the saved project it is, with the revision read; without one it becomes a project at its first change.
 * `onlyIf`: checked last, after the save, so an open that waited can still give way. True when it opened.
 */
export async function openDocument(
  document: CircuitDocument,
  project?: { id: string; revision: number },
  { onlyIf, ask = askToDiscard }: { onlyIf?: () => boolean; ask?: (error: string) => boolean } = {},
): Promise<boolean> {
  if (!(await flush()) && !ask(useProjects.getState().error ?? "Not saved")) return false;
  if (onlyIf && !onlyIf()) return false;
  opens++;
  useEditor.getState().load(document);
  revision = project?.revision ?? 0;
  baseline = contentOf(currentDocument());
  useProjects.setState({ projectId: project?.id ?? null, savedAt: project ? document.metadata.modifiedAt : null, copied: false, error: null });
  if (project) await storage?.setLast(project.id).catch(() => undefined);
  return true;
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

/** Opens a saved project; one that no longer opens says why and stays stored, untouched. */
export async function openProject(id: string, onlyIf?: () => boolean) {
  const record = await storage?.project(id);
  if (!record) return useProjects.setState({ error: "That project is no longer here: another tab may have deleted it." });
  const result = parseDocument(record.text);
  if (!result.ok) return useProjects.setState({ error: `Could not open ${record.name}: ${result.error}` });
  await openDocument(result.document, { id, revision: record.revision }, { onlyIf });
}

/** Deletes a saved project; the circuit on screen, if it was that one, stays and is saved anew at its next change. */
export function deleteProject(id: string): Promise<boolean> {
  queue = queue.then(async () => {
    if (!storage) return true;
    try {
      await storage.remove(id);
      // Not reopened on the next load, and not reported missing either.
      if ((await storage.last()) === id) await storage.setLast("");
      if (useProjects.getState().projectId === id) {
        revision = 0;
        useProjects.setState({ projectId: null, savedAt: null });
      }
      useProjects.setState({ projects: await storage.projects(), error: null });
      return true;
    } catch (error) {
      useProjects.setState({ error: `Could not delete: ${message(error)}` });
      return false;
    }
  });
  return queue;
}

/**
 * Saves a component of the open document to the library, with every component it contains, as a small project file
 * named after it. An entry of the same name is replaced (the caller asks first). False when it could not be saved.
 */
export async function saveToLibrary(definition: string): Promise<boolean> {
  if (!storage) return false;
  const definitions = withContents(liveDefinitions(useEditor.getState()), [definition]);
  const component = definitions.at(-1);
  if (!component) return false;
  const now = new Date().toISOString();
  const text = serializeDocument({
    format: "clockyard",
    version: FORMAT_VERSION,
    metadata: { name: component.name, createdAt: now, modifiedAt: now },
    circuit: { components: [], junctions: [], wires: [] },
    definitions,
  });
  try {
    await storage.putLibrary({ id: libraryKey(component.name), name: component.name, savedAt: now, text });
    // The open project's save state (`error`) is not this operation's to clear.
    useProjects.setState({ library: await storage.library() });
    return true;
  } catch (error) {
    useProjects.setState({ error: `Not saved to the library: ${message(error)}` });
    return false;
  }
}

/** A library entry's components, read as a file is: the source *Add components* copies from. */
export function libraryDocument(entry: LibraryEntry): CircuitDocument {
  const result = parseDocument(entry.text);
  if (!result.ok) throw new Error(`Could not read ${entry.name} from the library: ${result.error}`);
  return result.document;
}

/** Removes a library entry; why it could not be removed, or null. */
export async function removeFromLibrary(id: string): Promise<string | null> {
  if (!storage) return "the browser keeps no storage for the page";
  try {
    await storage.removeLibrary(id);
    useProjects.setState({ library: await storage.library() });
    return null;
  } catch (error) {
    return message(error);
  }
}

/** Records that a challenge was passed (ADR 0029); the first pass's time is kept. */
export async function recordPass(challenge: string) {
  if (!storage) return;
  try {
    await storage.markPassed(challenge, new Date().toISOString());
    useProjects.setState({ progress: await storage.progress() });
  } catch {
    // Progress is a convenience: a check that passed still says so.
  }
}

/** Forgets every challenge passed; why it could not, or null. */
export async function clearProgress(): Promise<string | null> {
  if (!storage) return "the browser keeps no storage for the page";
  try {
    await storage.clearProgress();
    useProjects.setState({ progress: {} });
    return null;
  } catch (error) {
    return message(error);
  }
}

/** Reads the project list, the library and progress again: another tab may have changed them. */
async function refresh() {
  if (!storage) return;
  try {
    useProjects.setState({ projects: await storage.projects(), library: await storage.library(), progress: await storage.progress() });
  } catch {
    // What is shown stays as it was; the next save or reload reads them again.
  }
}

/** Whether replacing the circuit on screen loses nothing: it will be saved first (`openDocument` asks if that fails). */
export const replacingIsSafe = () => useProjects.getState().available === true;

/**
 * Opens storage, reopens the last project unless `reopen` is false (a link in the address opens instead), and saves
 * changes from then on. Returns a function that stops it.
 */
export async function connectStorage({ open = browserStorage, reopen = true }: { open?: () => Promise<Storage>; reopen?: boolean } = {}) {
  baseline = contentOf(currentDocument());
  const before = opens;
  // Changes are watched from the start, so one made while storage opens is saved once it has.
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
    // Back to this tab: what another tab saved, removed or cleared shows here too.
    else void refresh();
  };
  const leaving = () => void flush();
  // A page has a document; a unit test of this module does not.
  const page = typeof document === "undefined" ? undefined : document;
  page?.addEventListener("visibilitychange", hidden);
  if (typeof window !== "undefined") window.addEventListener("pagehide", leaving);
  let opened: Storage | null = null;
  const stop = () => {
    unsubscribe();
    page?.removeEventListener("visibilitychange", hidden);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", leaving);
    // A later connection (React runs effects twice in development) keeps its own storage.
    if (opened && storage === opened) storage = null;
  };

  try {
    opened = await open();
  } catch (error) {
    useProjects.setState({ available: false, reason: message(error) });
    return stop;
  }
  storage = opened;
  useProjects.setState({ available: true, reason: null, projects: await opened.projects(), library: await opened.library(), progress: await opened.progress() });
  const last = reopen ? await opened.last() : undefined;
  // Only onto the page as it loaded: nothing opened, nothing changed meanwhile, which would win.
  const untouched = () => opens === before && contentOf(currentDocument()) === baseline;
  if (last && untouched() && (await opened.project(last))) await openProject(last, untouched);
  else void flush();
  return stop;
}
