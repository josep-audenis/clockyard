# 0029. Local persistence: projects, autosave and a component library in the browser

- Status: Accepted
- Date: 2026-11-16
- Depends on: ADR 0028 (Phase 6 plan, increment 1); ADR 0024 (links);
  ADR 0025 (challenges, whose progress waits for this); ADR 0027
  (notes, examples, and *Add components*, whose library waits for this);
  the project file format (`apps/web/src/storage/file.ts`, format 11)

## Context

Today a circuit lives only in the page:

- **Reload loses work.** A reload, a closed tab or a crash loses everything
  since the last Export. The only guard is the "Replace the current
  circuit?" question asked before an example, a starter, a link or an
  Import replaces it.
- **No project list.** There is a single, unnamed working document. Its
  name comes from the file it was opened from and cannot be edited. There
  is no "New circuit": starting afresh means reloading or deleting
  everything.
- **Promises waiting.** ADR 0025 left challenge progress for local storage,
  and ADR 0027 left a component library kept in the browser for the same
  reason.
- **Rules.** CLAUDE.md allows no backend and no user data leaving the
  browser. The browser has IndexedDB for this, and nothing in the app uses
  storage of any kind yet.
- **One format.** The file format is the one place where a document is
  validated and migrated (`parseDocument`, versions 1 to 11). It treats
  every input as untrusted.
- **Tabs.** The app can be open in several tabs at once.

## Decision

1. **Projects are kept in the browser's IndexedDB, as project files.**
   - **Stores.** One database, `clockyard`, with:
     - `projects`: `{ id, name, modifiedAt, revision, text }`;
     - `library`: one entry per saved component;
     - `progress`: one entry per challenge passed.
   - **Text.** `text` is exactly what Export writes. Opening a project
     parses it with `parseDocument`, so stored work gets the same
     validation and migrations as a file. Nothing in storage is trusted
     more than a file.
   - **No dependency.** A small wrapper over the IndexedDB API is enough
     (`storage/projects.ts`).
   - **Tests.** Logic is tested against an in-memory implementation of the
     same small interface, and the real IndexedDB in Playwright. No
     `fake-indexeddb` dependency.
2. **Autosave.**
   - **When.** A change to the document is saved after a second without
     further changes, and at once when the page is hidden. A change is
     anything Export would write differently, `modifiedAt` aside: parts,
     wires, definitions, name or notes. Switch positions, selection, view
     and watches are not saved, as they are not exported.
   - **When it becomes a project.** A document opened from an example, a
     starter, a link or Import becomes a project at its first change.
     Opening the nine examples to look adds nothing to the list.
   - **On load.** The page reopens the last project used in this browser,
     unless the address carries a link (ADR 0024). A link opens as a new,
     unsaved document, as it does today.
   - **Status.** The status bar shows when the project was last saved, and
     says so when it could not be saved.
   - *As built (step 1):* every way of opening a document (Import, a
     link, an example, a starter, a project, *New circuit*) goes through
     one `openDocument`, which saves the document it replaces before
     loading the next, so a change made less than a second earlier is not
     lost. The last project is remembered only once it has been saved. A
     project that no longer opens (a newer format) says why and stays
     stored, untouched.
3. **Projects panel.**
   - **New circuit** starts an empty, unsaved document.
   - **Recent projects** lists each saved project's name and when it was
     changed, newest first. Each can be opened or deleted. Deleting asks
     first and cannot be undone.
   - **The name** of the open project becomes editable where it is shown
     in the toolbar. It is `metadata.name`, so Export and links carry it.
   - *As built:* the name is normalized as a label, at most 64
     characters, and blank becomes "Untitled". The Projects panel sits at
     the top of the parts sidebar. Deleting the open project keeps its
     circuit on screen, saved anew at its next change.
   - **Fewer questions.** Since the current work is saved, opening another
     project, an example, a starter, a link or a file no longer asks before
     it replaces the circuit. The question stays when the work could not
     be saved.
4. **Two tabs.**
   - Each project carries a `revision`. A tab saves only over the revision
     it last read or wrote.
   - If another tab saved since, this tab's work is saved as a new project,
     "Name (copy)", and the status bar says so.
   - No work is lost, and no lock between tabs is needed.
   - *As built:* the copy becomes this tab's project from then on, and
     the editor shows its new name. A project another tab deleted is saved
     back the same way, as a copy.
5. **The component library.**
   - **Saving.** A chip's *Save to library* stores that component, with
     the components it contains, as a small project file whose definitions
     are those. Saving a component of the same name again replaces it,
     after asking.
   - **Using.** *Add components* gets a third source, "Your library", next
     to examples and files. Adding from it follows ADR 0027's rules.
   - **Managing.** Entries are deleted from the same dialog.
6. **Challenge progress.**
   - A check that passes records the challenge in `progress`.
   - The Challenges list marks passed ones, and the panel says when the
     challenge was first passed.
   - Nothing else depends on it, and *Clear progress* empties it.
7. **When storage is not available.** This covers storage blocked by the
   browser, a private window that refuses it, or a full quota.
   - The editor works as it does today: nothing is saved, the question
     before replacing a circuit stays, and the status bar says the work is
     not being saved and why.
   - A failed save never touches the document in memory.
8. **Privacy.**
   - Everything stays in this browser, under the app's origin.
   - Deleting a project or a library entry deletes it from storage.
   - The browser's own "clear site data" removes it all. The projects
     panel says that this is where the work lives, and that Export is the
     way to keep a copy elsewhere.
9. **Target.**
   - Build a circuit, reload the page: it is back, with its name and
     notes.
   - Start a second with *New circuit*, then reopen the first from the
     list.
   - Save its full adder to the library, then add it to the second
     project from "Your library".
   - Pass the inverter challenge, reload: it is marked passed.
   - Playwright tests do exactly this, in a fresh browser profile each
     time.
10. **Order of work.** Each step is one pull request:
    1. Projects:
       - storage and autosave;
       - reopening the last project;
       - the Projects panel with New, open, delete and rename;
       - the revision rule between tabs;
       - the unavailable-storage path;
       - Playwright: reload restores, two projects, delete, and a second
         tab's save becoming a copy.
    2. Library and progress:
       - *Save to library*;
       - "Your library" in *Add components*;
       - challenge progress;
       - Playwright: the rest of the target.

       This closes the increment.

## Alternatives considered

- **localStorage.** It is simpler, but synchronous and limited to a few
  megabytes per origin. The reference CPU alone is about 100 KB, so a
  handful of projects would fill it. IndexedDB has room and does not block
  the page.
- **Storing the editor's state, or a structured form of the document.**
  This avoids parsing on open. However, it would be a second format to
  migrate and validate. Storing the file format reuses both, and a stored
  project can be copied out with Export unchanged.
- **The `idb` library.** It is a thin, well-kept wrapper, but the app
  needs four operations on three stores. A wrapper of a few dozen lines
  avoids the dependency, as the brief prefers.
- **Saving on every change.** Simpler, but it writes up to 100 KB on every
  edit and every drag frame. A debounce, plus a save when the page is
  hidden, loses nothing a user would notice.
- **Locking a project to one tab** (Web Locks or BroadcastChannel). This
  prevents conflicts rather than resolving them. However, a closed or
  crashed tab can leave a lock to clean up, and the copy rule loses
  nothing either way.
- **Saving every opened document as a project.** It is simple, but it
  fills the list with untouched examples and starters. Saving at the
  first change keeps the list to work the user did.
- **Project previews (thumbnails).** The brief lists them. They need a
  rendering of each circuit off screen. They can come later without
  changing what is stored, so they stay on the roadmap (ADR 0028 item 4).

## Consequences

- Work survives reloads and crashes in the browser it was made in, and
  Export and links remain the way to move it.
- The "Replace the current circuit?" question mostly goes away, since
  replacing no longer loses anything.
- A project stored by an older Clockyard opens through the same migrations
  as an old file. A project stored by a newer one is refused, as a newer
  file is, with its text left in storage untouched.
- What a browser keeps can be cleared by the browser, which the panel
  says. Backing up every project at once (one file holding all of them) is
  not built, and stays on the roadmap.
- The library holds copies. Saving a component again replaces the entry,
  but projects that already added it keep their copy (ADR 0027).
