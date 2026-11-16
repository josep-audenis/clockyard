# 0027. Library and teaching: examples in the editor, notes, and components from other files

- Status: Accepted
- Date: 2026-11-16
- Depends on: ADR 0020 (Phase 5 plan, increment 7); ADR 0012 (custom
  components) and ADR 0013 (instance ports by pin); ADR 0025 (challenges,
  whose list this follows); the project file format
  (`apps/web/src/storage/file.ts`, format 10)

## Context

The brief's Phase 5 lists component blueprints, bundled computer designs,
example CPUs and "more educational material". ADR 0020 makes them its
seventh increment: "blueprints (components reused across documents),
bundled designs, and explanatory material".

What exists today:

- **Examples:** `examples/` holds nine designs, from an AND gate to Catch
  on the reference CPU. The editor cannot list them; they open only through
  Import, from a file the user must first get from the repository. Someone
  using the app as published never sees them.
- **Explanations:** each example's description, with what to try, is a row
  of the table in `examples/README.md`. Nothing in the app explains a
  design, apart from the challenge texts (ADR 0025) and the empty-sheet
  hint.
- **Components across documents:** a definition belongs to the document it
  was made in (ADR 0012). The only way to use a full adder from one file in
  another is to rebuild it. ADR 0025 had to put the full adder into the
  8-bit adder challenge's starter for this reason.
- **Definition IDs** are chosen by whoever wrote the file. The bundled
  examples reuse `full-adder` and `adder8` with different contents, so two
  files can hold different definitions under one ID.
- **No storage:** nothing is kept in the browser between visits. Autosave
  is still a rough edge on the roadmap. CLAUDE.md rules out a backend.
- **Size:** the examples together are about 260 KB, and Catch and the
  reference CPU are about 100 KB each.

## Decision

1. **A document can carry notes: `metadata.notes`, in format 11.**
   - Notes are plain text of at most 4,000 characters. Blank lines
     separate paragraphs.
   - The editor shows them as text in a Notes panel under the inspector's
     properties, and they can be edited there. Like the document's name,
     they are outside undo.
   - They are never read as markup and never contain links, so a file or a
     link from someone else cannot put anything but text on the page.
     React renders them as text.
   - An exported file or a shared link keeps its notes. A user's own
     designs can carry explanations too, not only the bundled ones.
   - Versions 6 to 10 still open, with no notes.
   - *As built (step 1):* the parser reads `notes` in a file of any
     version, as it reads `metadata.challenge`. Line endings become `\n`,
     and blank space around the notes and notes that are only blank are
     dropped. The panel is always a text area, readable as it stands, so
     notes are edited where they are read; the file is written with the
     notes normalized as Import reads them. Every example file is now
     format 11. The README keeps its table of descriptions for readers of
     the repository; the notes are the editor's version of them.
2. **Every example gets notes, and the editor lists the examples.**
   - Each example's notes say what it shows and what to try: the text now
     in `examples/README.md`, written for someone reading it next to the
     circuit. The README keeps a short table that points to the files.
   - The generated examples (`reference-cpu`, `catch`) get their notes from
     `scripts/reference-cpu.mjs`, and its `--check` holds them, as it holds
     the rest of the file.
   - An Examples list sits next to the Challenges list, ordered from the
     AND gate to Catch. Opening one asks before it replaces a circuit, as
     Import does.
   - The list is built from `examples/*.clockyard.json`, as the challenges
     list is from `challenges/`. Each file is loaded only when opened (a
     lazy `import.meta.glob`), so the editor's first load does not grow by
     260 KB.
   - *As built:* the order and titles are written in
     `apps/web/src/storage/examples.ts`, since a lazy file cannot be read
     for its name until it is opened. A test fails if a file is missing
     from the list or a title differs from the file's `metadata.name`.
     An example opens dated now, as a challenge's starter does.
3. **Components can be added from another file or an example.**
   - In the Chips panel, *Add components* opens a dialog. Its source is a
     project file the user picks, or one of the bundled examples. It lists
     that document's definitions. The user ticks the ones to add, and the
     definitions they contain come along.
   - **Same ID:** a definition whose ID is already here and whose contents
     are identical is reused, not copied. Otherwise it is added under a
     fresh ID, and the added definitions that use it are rewritten to the
     new ID.
   - **Same name:** a name already used here gets a number: "Full adder 2".
   - The source is read with the same parser as Import, so a file that
     would not open adds nothing.
   - Like every definition change (ADR 0012), adding is outside undo. A
     component added by mistake is deleted from Chips.
   - It is a document operation only: the engine sees the new definitions
     at the next load, as it does any definition.
4. **The library is files, for now.** A user's own collection of
   components is a document that holds them, exported as a file. *Add
   components* is how it is used. A library kept in the browser waits for
   local storage, which arrives with autosave and its own ADR.
5. **Target.**
   - Open the 4-bit adder from the Examples list, and read in its notes
     how the full adder is reused.
   - Start a new circuit. *Add components* from the 8-bit counter example
     adds its 8-bit adder, and with it the full adder it is built of.
   - Place the 8-bit adder, wire two 8-bit switches and an 8-bit LED to
     it, and it adds.
   - Add the 4-bit adder example's full adder too. It has the same ID as
     the one already here but different contents, so it arrives as
     "Full adder 2" under a new ID, and the 8-bit adder still uses the
     original.
   - Playwright tests do exactly this. A unit test covers the ID and name
     rules.
6. **Order of work.** Each step is one pull request:
   1. Notes:
      - `metadata.notes` and format 11, with a migration test;
      - the Notes panel;
      - notes in every example;
      - the Examples list.
   2. *Add components*:
      - the merge rules, with unit tests;
      - the dialog, for files and examples;
      - the Playwright target.

      This closes the increment, and Phase 5's plan.

## Alternatives considered

- **Descriptions in a separate `examples/index.json`.** This keeps the file
  format as it is. However, an example shared by link or exported would
  lose its text, and a user's own design could not carry any. The
  challenges solved the same problem with `metadata.challenge` (ADR 0025).
- **Markdown notes.** Headings, lists and links would read better. They
  need a renderer and a sanitizer, and anything a file or link supplies is
  untrusted. Plain paragraphs are enough to explain a circuit. Markdown can
  come later, behind a sanitizer, if the notes outgrow plain text.
- **A component library in IndexedDB now.** This is closer to "save it as
  a reusable component" in the brief. However, it needs the storage design
  that autosave needs: quota, migrations, and clearing. Doing it twice
  would be worse than waiting. Files cover reuse in the meantime.
- **Carrying the clipboard across documents.** Copy parts in one file,
  open another, paste, and their definitions come along. It is less code
  than a dialog. However, there is no autosave, so opening the source file
  replaces the user's own work unless they exported it first. The dialog
  reads the source without opening it.
- **Bundled components without a source document,** for example a
  standard library of adders and registers. These would sit next to the
  challenges, which ask the user to build exactly those parts. Taking them
  from the examples keeps them where they are explained.

## Consequences

- The app teaches with what it already ships. The examples, with their
  notes, run from a basic gate to a game on a CPU. The challenges ask for
  the same parts to be built.
- Format 11 adds one optional field. Every older file still opens.
- Definitions can now come from elsewhere, so a document may hold two
  components with the same name until one is renamed. Names stay labels,
  and IDs stay the identity (ADR 0013).
- A component added from a file is a copy. Editing the source file later
  changes nothing here, and nothing tracks where a component came from.
- Not yet:
  - a library kept in the browser;
  - linking a component to its source;
  - Markdown or images in notes;
  - guided tours that point at parts of a circuit.
