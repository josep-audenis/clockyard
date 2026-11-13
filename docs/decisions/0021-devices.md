# 0021. Devices: seven-segment display, pixel screen, keyboard

- Status: Accepted
- Date: 2026-11-13
- Depends on: ADRs 0014 (widths), 0017 (switch inputs, run controls), 0018
  (RAM and memory inspection), 0020 (Phase 5 plan, increment 1)

## Context

ADR 0020 makes devices the first Phase 5 increment. The brief lists
seven-segment displays, LED matrices, keyboard input and character or pixel
displays (§8, Phase 5), and the aspirational game needs a screen to draw on
and a key to press.

What the engine and editor already have:

- An LED is an input-only part with no primitive. Its value is its net's,
  drawn by the editor.
- A switch is a primitive whose value the editor sets through `setInputs`;
  that value is transient and never saved.
- A RAM holds words, writes them on a clock edge, resets to 0, and can be
  read back with `readMemory` (ADR 0018).
- Every key on the canvas is a shortcut today (S, L, N, R …).

## Decision

1. **Three new kinds.** Each reuses engine behaviour that already exists,
   so `sim-core` gains catalog entries but no new kind of primitive.

   | Kind | Ports | Engine behaviour |
   |------|-------|------------------|
   | `seg7` | input `seg` (8 bits) | none, like an LED |
   | `screen` | inputs `addr`, `din`, `we`, `clk`; output `out` | a RAM (ADR 0018) |
   | `keyboard` | output `out` (8 bits) | a switch: its value is set through `setInputs` |

2. **Seven-segment display (`seg7`).**
   - `seg` is always 8 bits wide and takes no `width`.
   - Bit 0 is segment a, then b, c, d, e, f, g, and bit 7 is the decimal
     point, in the usual order: a at the top, then clockwise, g in the
     middle.
   - It shows exactly the segments it is given. Decoding a digit into
     segments is circuit work, for example a 16-word ROM, and that makes a
     good challenge later.
3. **Pixel screen (`screen`).**
   - It is a RAM, with the same ports, `width`, `addressWidth`, reset and
     limits. Its memory is the picture.
   - A word's bits are pixels, most significant bit leftmost. The words
     fill rows left to right, top to bottom.
   - An editor-only prop `columns` (1 to 256, 32 unless set) sets the
     pixels per row. The tile places a 32 × 32 screen: 8-bit words, 7
     address bits, 32 columns.
   - *Amended in step 2:* `columns` need not divide the number of pixels,
     `2^addressWidth × width`; a last row the words do not fill is drawn
     short. A screen shows at most 256 rows, so a picture is at most
     256 × 256 pixels, and only the words those rows hold are read. Every
     shape of memory is then a valid screen, and no width or address edit
     has to be refused for the picture's sake.
   - Monochrome: a pixel is on or off. Grey levels or colour are left for
     later.
   - The editor draws each pixel as a 4 px square (a quarter of a grid
     cell) in the signal-high colour, on the bench colour, and the body
     grows to fit: the picture right of the port names, `out` at the top
     right.
4. **Reading the picture.**
   - The editor asks for each screen's words as it asks for a RAM's dump:
     `readMemory`, after each `state`, while the screen is on the sheet.
   - The reply is kept per component, so several screens and an open RAM
     dump do not overwrite each other. `useSim.memory` becomes a map from
     component ID to words.
   - It is throttled to one request per screen per animation frame, so a
     run at 10,000 cycles per second does not flood the worker. The canvas
     tells the simulation client which screens are on the sheet
     (`watchMemory`); the client reads them on the frame after a `state`,
     and at once when a screen is newly watched.
5. **Keyboard (`keyboard`).**
   - Its `out` is the code of the key held down, or 0 when none is.
   - Printable ASCII keys give their code. Enter is 13, Backspace 8, Escape
     27 and Space 32. The arrows are 0x80 up, 0x81 down, 0x82 left and 0x83
     right.
   - When several keys are held, the last one pressed wins. Releasing it
     gives the one before, if that is still held.
   - **Focus.** Clicking a keyboard part gives it the keys, and its body is
     drawn highlighted. While it has them, canvas shortcuts are off. Escape
     or a click elsewhere gives them back. Escape is itself a key, so it
     reaches the circuit with code 27 before the focus is released.
   - *As built (step 3):* the focus is released when Escape is let go, so
     the circuit sees 27 for as long as it is held. Tab and leaving the
     window give the keys back too, so the keyboard never traps them; Ctrl,
     ⌘ and Alt combinations stay the editor's (undo, copy). Keys are
     tracked by physical key, so letting go of Shift before A still
     releases the "A". The status bar says the keyboard has the keys, and
     the body shows the code it drives.
   - The value is an editor input like a switch's: transient, never saved,
     and restored after a load with the other inputs (ADR 0017).
6. **Why a run stopped.** Games and programs often run until an LED
   lights, so the status bar now says why a run ended:
   - "Stopped: LED X lit" for *Run until*;
   - "Stopped: unstable" when a loop does not settle;
   - nothing when the user pauses.

   This fixes a Phase 4 rough edge, as ADR 0020 item 4 intends.
7. **File format v9.** It adds the three kinds and the editor-only
   `columns`. A v8 file opens unchanged. `columns` joins v9 in step 2
   without a new version: nothing between the steps is released, so no
   v9 file lacks it in the wild.
8. **Order of work.** Each step is one pull request:
   1. Engine and catalog entries, format v9, tiles, and the bodies for
      `seg7` and `keyboard`.
   2. The screen: per-component memory in `useSim`, throttled reading,
      pixel drawing, and `columns` in the inspector.
   3. Keyboard focus and key mapping.
   4. "Why a run stopped", an example `devices.clockyard.json`, Playwright,
      and docs.

   Target (ADR 0020): the example shows a key's code on two seven-segment
   digits through a ROM decoder, and a pressed key draws on the screen.
   Playwright checks both.

## Alternatives considered

- **An LED-matrix part with row and column inputs.** It mirrors real
  multiplexed matrices, but a game would have to keep refreshing it. A
  screen backed by memory keeps its picture, which suits a slow simulated
  CPU, and a matrix can still be built from LEDs.
- **A character display.** It needs a font ROM and a glyph format, and a
  pixel screen can draw characters from a ROM the user writes. It is left
  for later.
- **A keyboard that queues key presses, with a "ready" flag the circuit
  clears.** It is closer to real hardware, but it needs a new stateful
  primitive and a clear handshake. A level ("the key held now") is enough
  for games that poll, and a latch can be built around it.
- **Decoding hex in the seven-segment part.** It is convenient, but it hides
  exactly the logic the sandbox is about. Raw segments, with decoders built
  in the circuit, keep the part honest.

## Consequences

- Devices are ordinary parts, so they can sit inside custom components. A
  screen inside a chip is read by its elaborated ID (`chip/screen`). The
  editor draws only the screens on the open sheet.
- The keyboard takes over the keys while it has focus, so it must always
  show that it has them.
- Memory reading grows from one dump to every visible screen. It is
  throttled and measured in step 2.
- Memory-mapped I/O on the reference CPU (ADR 0020 increment 2) can decode
  these parts into the data address space with no new instructions.
