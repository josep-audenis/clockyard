// Projects kept in this browser's IndexedDB (ADR 0029). Nothing leaves the browser. A project's `text` is exactly
// what Export writes, so opening one goes through `parseDocument` like any file. Tests use `memoryStorage`, the same
// interface without a browser.

export type ProjectRecord = { id: string; name: string; modifiedAt: string; revision: number; text: string };
export type ProjectSummary = Omit<ProjectRecord, "text">;
/** A component saved to the library: `text` is a project file whose definitions are it and those it contains. */
export type LibraryEntry = { id: string; name: string; savedAt: string; text: string };

/** What the app needs from storage. */
export interface Storage {
  /** Every project, newest change first, without its text. */
  projects(): Promise<ProjectSummary[]>;
  project(id: string): Promise<ProjectRecord | undefined>;
  /**
   * Stores `record` if the stored revision is still `base` (0: none stored), in one transaction; false, storing
   * nothing, if another tab saved or deleted it since.
   */
  save(record: ProjectRecord, base: number): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** The project used last in this browser, reopened on load. */
  last(): Promise<string | undefined>;
  setLast(id: string): Promise<void>;
  /** The component library (ADR 0029), by name. */
  library(): Promise<LibraryEntry[]>;
  putLibrary(entry: LibraryEntry): Promise<void>;
  removeLibrary(id: string): Promise<void>;
  /** Challenges passed, by file name, with when each was first passed. */
  progress(): Promise<Record<string, string>>;
  /** Records a pass, keeping the first one's time. */
  markPassed(challenge: string, at: string): Promise<void>;
  clearProgress(): Promise<void>;
}

const byName = (a: LibraryEntry, b: LibraryEntry) => a.name.localeCompare(b.name);

const newestFirst = (a: ProjectSummary, b: ProjectSummary) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0);
const summary = ({ id, name, modifiedAt, revision }: ProjectRecord): ProjectSummary => ({ id, name, modifiedAt, revision });

/** Storage in memory, for tests: the same rules as IndexedDB, lost with the page. */
export function memoryStorage(): Storage {
  const projects = new Map<string, ProjectRecord>();
  const library = new Map<string, LibraryEntry>();
  const progress = new Map<string, string>();
  let last: string | undefined;
  return {
    projects: async () => [...projects.values()].map(summary).sort(newestFirst),
    project: async (id) => projects.get(id),
    save: async (record, base) => {
      if ((projects.get(record.id)?.revision ?? 0) !== base) return false;
      projects.set(record.id, record);
      return true;
    },
    remove: async (id) => void projects.delete(id),
    last: async () => last,
    setLast: async (id) => void (last = id),
    library: async () => [...library.values()].sort(byName),
    putLibrary: async (entry) => void library.set(entry.id, entry),
    removeLibrary: async (id) => void library.delete(id),
    progress: async () => Object.fromEntries(progress),
    markPassed: async (challenge, at) => void (progress.has(challenge) || progress.set(challenge, at)),
    clearProgress: async () => progress.clear(),
  };
}

/** A request's result as a promise. */
const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The browser's storage failed."));
  });

/** Resolves when `transaction` has committed, so a save is only reported once it is stored. */
const committed = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("The browser's storage failed."));
  });

/**
 * Opens the database, creating its stores on first use. Rejects, with a reason to show, when the browser refuses
 * storage (blocked, or a private window that allows none).
 */
export async function browserStorage(): Promise<Storage> {
  if (typeof indexedDB === "undefined") throw new Error("this browser keeps no storage for the page");
  const request = indexedDB.open("clockyard", 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const name of ["projects", "library", "progress", "meta"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
  };
  const db = await done(request);
  const store = (name: string, mode: IDBTransactionMode = "readonly") => db.transaction(name, mode).objectStore(name);
  return {
    projects: async () => ((await done(store("projects").getAll())) as ProjectRecord[]).map(summary).sort(newestFirst),
    project: async (id) => (await done(store("projects").get(id))) as ProjectRecord | undefined,
    save: (record, base) => {
      // Read and write in one transaction, so no other tab's save can come between them.
      const transaction = db.transaction("projects", "readwrite");
      const projects = transaction.objectStore("projects");
      let stored = false;
      const read = projects.get(record.id);
      read.onsuccess = () => {
        if (((read.result as ProjectRecord | undefined)?.revision ?? 0) !== base) return;
        stored = true;
        projects.put(record);
      };
      return committed(transaction).then(() => stored);
    },
    remove: async (id) => {
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").delete(id);
      await committed(transaction);
    },
    last: async () => ((await done(store("meta").get("last"))) as { value: string } | undefined)?.value,
    setLast: async (id) => {
      const transaction = db.transaction("meta", "readwrite");
      transaction.objectStore("meta").put({ id: "last", value: id });
      await committed(transaction);
    },
    library: async () => ((await done(store("library").getAll())) as LibraryEntry[]).sort(byName),
    putLibrary: async (entry) => {
      const transaction = db.transaction("library", "readwrite");
      transaction.objectStore("library").put(entry);
      await committed(transaction);
    },
    removeLibrary: async (id) => {
      const transaction = db.transaction("library", "readwrite");
      transaction.objectStore("library").delete(id);
      await committed(transaction);
    },
    progress: async () =>
      Object.fromEntries(((await done(store("progress").getAll())) as { id: string; passedAt: string }[]).map((p) => [p.id, p.passedAt])),
    markPassed: async (challenge, at) => {
      const transaction = db.transaction("progress", "readwrite");
      const progress = transaction.objectStore("progress");
      // Kept if already there: the first pass's time stays.
      progress.add({ id: challenge, passedAt: at }).onerror = (e) => e.preventDefault();
      await committed(transaction);
    },
    clearProgress: async () => {
      const transaction = db.transaction("progress", "readwrite");
      transaction.objectStore("progress").clear();
      await committed(transaction);
    },
  };
}
