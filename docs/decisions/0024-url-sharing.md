# 0024. Sharing a circuit through a URL fragment

- Status: Accepted
- Date: 2026-11-14
- Depends on: ADR 0020 (Phase 5 plan, increment 4); the project file
  format (`apps/web/src/storage/file.ts`, format 9)

## Context

The brief lists "browser-based sharing through portable files or encoded
URLs" for Phase 5. Files already work: Export writes the whole document
and Import reads it back, validated by `parseDocument`. ADR 0020 makes
encoded URLs its fourth increment, with one rule: nothing leaves the
browser, so there is no server to store a circuit or shorten a link.

A URL can carry a whole document only if it is small enough. These are
the bundled examples as compact JSON, then compressed with the browser's
`CompressionStream` (`deflate-raw`) and written in URL-safe base64:

| Example | Pretty JSON | Compact JSON | Compressed, base64url |
|---------|------------:|-------------:|----------------------:|
| `and-gate` | 1,044 | 782 | 384 |
| `8-bit-counter` | 22,900 | 8,276 | 1,488 |
| `reference-cpu` | 96,408 | 38,527 | 6,088 |
| `catch` | 105,427 | 41,355 | 7,314 |

So the largest circuit Clockyard ships, a whole CPU with its program,
fits in about 7,300 characters. Browsers accept far longer URLs; some
chat tools and link previews cut long links, which is a reason to show
the length, not to refuse.

The part of a URL after `#` (the fragment) is not sent to the server that
serves the page. A circuit in the fragment therefore reaches no one but
the person who opens the link, whatever hosts the app.

## Decision

1. **A link carries the document, as Export writes it.**
   - The same document `serializeDocument` produces, as compact JSON: the
     main circuit, every definition and the metadata. Not the simulation
     state: no RAM or screen contents, no cycle count, no speed setting,
     as with a file.
   - It is compressed with the browser's own `CompressionStream`
     (`deflate-raw`) and written in base64url. No new dependency.
2. **In the fragment, with a version of its own:**
   `#circuit=1.<data>`.
   - `1` is the encoding (deflate-raw, base64url, JSON), separate from the
     file format's version, which the JSON already carries. A later
     encoding gets a new number; links made today keep opening.
   - The fragment, not the query string, so the circuit is never sent to a
     server or written in its logs.
3. **Opening a link goes through the same door as Import.**
   - The data is decoded, decompressed and handed to `parseDocument`, so
     a link is validated exactly as a file is, and older formats open as
     they do from a file.
   - Decompression stops at the size Import accepts (10 MiB), so a small
     link cannot expand into a huge document.
   - A link that cannot be read (cut short, edited, an unknown encoding)
     shows the reason, as Import does, and leaves the editor as it was.
   - Opened while a circuit is being edited (the fragment changed in the
     same tab), the editor asks before replacing it, as Import does.
   - Once loaded, the fragment is removed from the address bar
     (`history.replaceState`). The address then never claims to be a
     circuit that has since been edited, and Copy link is the one way to
     share the current one. A link that is refused is removed too, after
     its reason is shown, so a reload does not show the error again.
   - The data goes into decompression 1 KiB at a time. Each engine then
     hands back output in pieces small enough that the size limit is
     checked before much memory is used, whatever the engine's own
     buffering.
4. **Copy link**, next to Export:
   - It builds the link from the page's own address and the current
     document, whichever sheet is open, as Export does.
   - It copies it with the Clipboard API and says so with the link's
     length. Above 8,000 characters it adds that some apps cut long
     links, and a file is safer. If the clipboard is refused, the link is
     shown in a field to copy by hand.
5. **Privacy.** Anyone who has a link can read the whole circuit, and the
   link stays wherever it is pasted and in browser history. The help text
   next to Copy link says so. Clockyard itself sends nothing anywhere.
   *As built (step 2):* the help text is Copy link's tooltip, since the
   toolbar has no room for a sentence beside it, and the message after
   copying repeats it, so it reaches touch and keyboard users too.
6. **Where links point.** A link opens on the same address it was made
   on. Run locally, that is `localhost`, so it works only on that
   machine. A public address needs the app deployed, which is outside
   this ADR and needs explicit authorization (CLAUDE.md).
7. **Order of work.** Each step is one pull request:
   1. The encoding in `apps/web/src/storage/`: document → link data and
      back, with Vitest tests:
      - every bundled example round-trips to the same document;
      - a link cut short, with a bad character, with an unknown encoding
        version, or expanding past the size limit is refused with a
        reason.
   2. The editor: opening a link on load and on a fragment change, Copy
      link and its messages, Playwright and docs:
      - build a small circuit, Copy link, open the link in a new page: the
        same circuit, simulating the same way;
      - a broken link shows its reason and an empty editor;
      - the `catch` example's link opens and runs.

      This closes the increment. *As built:* the `catch` link is opened in
      the tab already showing the shared AND gate, so the same test checks
      that a fragment change asks before replacing a circuit. Errors that
      come from `parseDocument` read "Could not open the link: This file
      …", the file being what the link carries.

## Alternatives considered

- **The query string** (`?circuit=`). It works the same in the browser,
  but the server that serves the page receives it and may log it.
- **No compression.** Base64 of compact JSON makes the reference CPU about
  51,000 characters, eight times the compressed link.
- **A compression library** (lz-string, pako). It might save a few
  hundred characters, but `CompressionStream` is built into current
  browsers, and the codebase avoids dependencies for a few lines.
- **A short-link or paste service.** Short links need a server that
  stores circuits, which ADR 0020 and CLAUDE.md rule out.
- **Keeping the fragment after loading.** A reload would reopen the shared
  circuit, but the address bar would keep showing it after edits, and
  copying the address would share the old version. Without autosave a
  reload loses edits either way; autosave is a separate item.
- **Including the simulation state** (RAM, screen, cycle). It would make
  links larger and couple them to engine internals. A file does not carry
  it either; Reset gives the same start everywhere.

## Consequences

- A circuit can be shared by pasting a link, with no file and no server.
- Links and files are one format underneath, so every format change
  reaches both, and the file tests cover what a link carries.
- A link is a snapshot. Editing after sharing needs a new link.
- Links depend on where the app runs. Until it is deployed, they are
  useful mainly between tabs and browsers on one machine, and for tests.
- Very large circuits make long links; the length shown and the advice
  to export cover that without a hard limit.
