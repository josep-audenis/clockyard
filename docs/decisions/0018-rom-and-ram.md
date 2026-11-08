# 0018. ROM and RAM parts

- Status: Accepted
- Date: 2026-11-08
- Depends on: ADRs 0012 (custom components), 0014 (widths), 0017 (edge
  sampling, reset)

## Context

Phase 4 builds a programmable 8-bit computer from Clockyard parts. It needs
memory: a ROM to hold the program and a RAM for data. The brief allows "high-
level RAM and ROM components" as abstractions, provided the processor's
behaviour still emerges from its connected datapath and control logic (§2.3).

Building memory from what exists is possible but impractical. 256 bytes of
RAM would take 2,048 flip-flops plus an address decoder and output
multiplexers, all drawn by hand. The engine's limit of 200,000 flattened
items would allow it, but nobody could build or read it.

What the engine has:

- Sized parts with `width` (ADR 0014). Every part compiles to primitives
  with one output each.
- Flip-flops that sample from the settle's starting snapshot on a rising
  `clk`, reset to 0, and count as part of a loop for the pre-settle
  (ADR 0017).
- Every connectivity edit reloads the circuit and resets sequential state
  (ADR 0017).

## Decision

1. **Two new kinds, `rom` and `ram`.** Each has a data width `width` (1 to
   32; absent means 1, as for every sized part, and the parts panel places
   8-bit memories) and a new prop `addressWidth` (1 to 16, default 8). A
   memory holds `2^addressWidth` words of `width` bits.
2. **ROM.**
   - Ports: input `addr` (`addressWidth` bits), output `out` (`width` bits).
   - Reading is combinational: `out` is the word at `addr`, like a gate's
     output. A ROM is pure, so it can be pre-settled.
   - Contents are the prop `data`: a list of up to `2^addressWidth` whole
     numbers, each below `2^width`. Missing words read 0.
   - Contents are part of the document and of the circuit description, so
     a program is saved with the circuit. Editing them is an ordinary
     edit: undoable, and it reloads the circuit like any other change
     (ADR 0017), which resets the CPU around the new program.
3. **RAM.**
   - Ports:
     - inputs `addr` (`addressWidth` bits), `din` (`width` bits), `we`
       (1 bit) and `clk` (1 bit);
     - output `out` (`width` bits).
   - Reading is combinational: `out` is the word at `addr`.
   - Writing is synchronous: on a rising `clk` with `we` at 1, the word at
     `addr` becomes `din`. The edge sampling rule of ADR 0017 applies:
     `addr`, `din` and `we` are taken from the settle's starting snapshot,
     so a RAM written in the same cycle that something reads it behaves as
     a register file does.
   - The write happens in the delta that sees `clk` rise, and `out` shows
     it at the end of that delta, as a flip-flop's `q` does.
   - Contents start at 0 on load and are set back to 0 by reset. A RAM has
     no `data` prop. Programs set up the data they need.
   - A RAM is stateful: like a flip-flop it counts as part of a loop for
     the pre-settle.
4. **Engine.** A ROM compiles to one primitive holding its words. A RAM
   compiles to one primitive holding its cells and the last value seen on
   `clk`. Both drive `out`.
5. **Validation.** These are new validation errors:
   - an `addressWidth` that is not a whole number from 1 to 16, or one on a
     part other than a memory (`invalidWidth`);
   - `data` on a part other than a ROM, a word out of range, or more words
     than the address space holds (new code `invalidContents`).

   Memory words count towards the engine's size limit, so a definition
   holding a large ROM, placed many times, cannot grow without bound. The
   engine tallies words as it tallies parts, against a separate limit of
   1,048,576 words after flattening, and checks the same limit on a
   circuit with nothing to flatten.
   - Only the words asked for cross from the worker: `readMemory` names a
     count, and the inspector asks for the 256 it shows.
6. **Inspection.** `sim-core` gains `memory(component) -> &[u32]`, the
   current words of a ROM or RAM. It takes the component's elaborated ID, so
   a RAM inside an instance is `instance/ram`. `sim-wasm` exposes it, and
   the protocol gains:
   - a command `readMemory { component, count }`, for the first `count`
     words;
   - a result `memory { component, words: Uint32Array }`.

   The worker answers it between ticks, like any command. The editor asks
   for the memory it is showing, so contents never travel with every
   `state`.
7. **Editor.**
   - The parts panel's Memory section gains ROM and RAM tiles (8-bit
     words, 8 address bits).
   - The inspector gains:
     - *Address bits* for both;
     - *Contents* for a ROM: whitespace-separated words in hex, decimal or
       binary, as wide switches take values (ADR 0014), applied as one
       edit;
     - for a RAM, a read-only hex dump of its contents, refreshed while the
       inspector shows it.
   - A memory is drawn as a box 5 cells wide with `addr` (and for a RAM
     `din`, `we` and the clock triangle) on the left and `out` on the right,
     labelled A, D, WE and Q. Its size, for example "256×8", is written
     inside it.
   - The RAM dump lists the first 256 words; a larger RAM says how many it
     leaves out.
8. **File format v8.** A component may carry `addressWidth` and, on a ROM,
   `data` and the editor-only `source` (ADR 0019 item 5). A v7 file opens
   unchanged. A ROM's `data` is checked on import as the engine checks it:
   whole numbers, in range, no more than fit.

## Alternatives considered

- **Memory from flip-flops only.** It is faithful, but impractical at any
  useful size, and the brief allows memory parts.
- **A synchronous-read ROM.** That is closer to some real block memories,
  but it costs the CPU an extra cycle per fetch. A combinational ROM keeps
  the reference CPU simple, and a user can still add a register after it.
- **RAM contents saved in the document.** That would be convenient for
  data tables. But RAM is state, and state resets on edits and on reset
  (ADR 0017). Saving it would make a document's meaning depend on when it
  was saved. Programs initialise their data instead. A ROM holds anything
  constant.
- **Contents in a side file or as a URL.** That needs a backend, or a second
  file to keep in step. Inline `data` keeps one document self-contained.

## Consequences

- A CPU's program is part of its circuit file, and loading a new program
  is an undoable edit that resets the machine.
- A large ROM makes every reload send its words to the worker, as JSON in
  the description: about 400 KB for a full 64K-word ROM. That is fine for
  Phase 4's 256 words. Measure before larger memories, and move the words
  to a typed array if needed. The limit in item 5 keeps flattened circuits
  bounded.
- Memory inspection costs a round trip per refresh, only while a memory is
  being shown.
- Tests:
  - `sim-core`:
    - a ROM reads each address;
    - RAM writes on a rising edge with `we`, and only then;
    - a RAM write and read in one cycle sample pre-edge values;
    - reset clears RAM and keeps ROM;
    - each validation error;
    - the word limit across instances;
    - `memory()` inside an instance.
  - Format: v7 migration, v8 round-trip, `data` refused when out of range.
  - Playwright: write a word to a RAM by hand (switches on `addr`, `din`,
    `we`, `clk`) and see it in the inspector's dump.
