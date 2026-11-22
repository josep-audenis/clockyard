// The editable circuit document, format version 13 (docs/architecture.md#circuit-document, ADRs 0010, 0012, 0014, 0015, 0017, 0018, 0021, 0025, 0027, 0035, 0038).
// Connectivity is explicit: wires reference ports and junctions by ID, never by geometry.
import type { CircuitBody, CircuitDescription, Endpoint, JunctionRef, PinDesc } from "../simulation/protocol";

/** The built-in parts (the engine's catalog). */
export const COMPONENT_KINDS = ["switch", "led", "not", "and", "nand", "or", "nor", "xor", "xnor", "split", "merge", "clock", "dff", "rom", "ram", "seg7", "screen", "keyboard", "tri", "button"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
/** A splitter or merger: its `fields` prop adds a port per field (ADR 0014). Every other built-in part takes `width`. */
export type FieldedKind = "split" | "merge";
export const isFielded = (kind: PartKind): kind is FieldedKind => kind === "split" || kind === "merge";
/** Parts whose ports have one width whatever their props: a clock (ADR 0017), a seven-segment display and a keyboard (ADR 0021), a push button (ADR 0038). */
export const FIXED_WIDTH: Partial<Record<PartKind, number>> = { clock: 1, seg7: 8, keyboard: 8, button: 1 };
/** The width of a part's ports: fixed for its kind, else its `width` prop (custom parts and splitters: 1, unused). */
export const widthOf = (part: { kind: PartKind; props: { width?: number } }) => FIXED_WIDTH[part.kind] ?? part.props.width ?? 1;
/** Whether `width` sets the part's ports (ADR 0014): not a chip, splitter, merger, or a part of fixed width. */
export const takesWidth = (kind: PartKind) => kind !== "custom" && FIXED_WIDTH[kind] === undefined && !isFielded(kind);
/** A gate whose `inputCount` sets its inputs, `a` onwards (ADR 0038): every gate but NOT. The catalog says the same. */
export const takesInputs = (kind: PartKind) => kind === "and" || kind === "nand" || kind === "or" || kind === "nor" || kind === "xor" || kind === "xnor";
/** Most inputs a gate has, as sim-core's `MAX_INPUTS`, and how many it has unless set (ADR 0038). */
export const MAX_INPUTS = 8;
export const DEFAULT_INPUTS = 2;
/** A ROM, RAM or screen (ADRs 0018, 0021): `addressWidth` sets its `addr` port and how many words it holds. */
export const isMemory = (kind: PartKind) => kind === "rom" || kind === "ram" || kind === "screen";
/** A built-in part, or an instance of a custom component (ADR 0012). */
export type PartKind = ComponentKind | "custom";

export const ROTATIONS = [0, 90, 180, 270] as const;

/** Longest label a part can carry; longer ones crowd the canvas. */
export const MAX_LABEL = 32;

/** Widest signal, as sim-core's `MAX_WIDTH`; a test checks the two agree (ADR 0014). */
export const MAX_WIDTH = 32;

/** Widest memory address, as sim-core's `MAX_ADDRESS`, and the address width a memory has unless set (ADR 0018). */
export const MAX_ADDRESS = 16;
export const DEFAULT_ADDRESS = 8;

/** Longest assembly source a ROM keeps (ADR 0019); far more than 256 instructions need. */
export const MAX_SOURCE = 64 * 1024;

/**
 * `label` is editor-only: a switch's or LED's label names the circuit's input or
 * output pin. `width` (switches, LEDs and gates; absent means 1) and `fields`
 * (splitters and mergers: field widths, lowest bits first) are projected to the
 * engine, which owns what they mean (ADR 0014). `addressWidth` (ROM, RAM, screen; absent
 * means 8) and `data` (a ROM's words from address 0) are projected too; `source`, a
 * ROM's assembly, is editor-only (ADRs 0018, 0019), as is `columns`, a screen's
 * pixels per row (ADR 0021). `inputCount` (the six gates but NOT; absent means 2) is projected (ADR 0038);
 * `binding`, the physical key that holds a push button (`KeyA`, `Digit1`), is editor-only (ADR 0038).
 */
export type Props = {
  label?: string;
  width?: number;
  fields?: number[];
  addressWidth?: number;
  data?: number[];
  source?: string;
  columns?: number;
  inputCount?: number;
  binding?: string;
};

/** A screen's pixels per row (ADR 0021): 1 to `MAX_COLUMNS`, 32 unless set. Editor-only: the engine sees a RAM. */
export const MAX_COLUMNS = 256;
export const DEFAULT_COLUMNS = 32;
/** Most rows a screen shows; pixels past them are not drawn, so a picture is at most 256 × 256. */
export const MAX_ROWS = 256;

/**
 * A screen's picture: its columns, the rows it shows, and how many of its words those
 * rows hold, the only words read from the engine. Words fill rows left to right, top to
 * bottom, most significant bit leftmost; a last row the words do not fill is drawn short.
 */
export function screenSize(props: Props) {
  const columns = props.columns ?? DEFAULT_COLUMNS;
  const width = props.width ?? 1;
  const words = 2 ** (props.addressWidth ?? DEFAULT_ADDRESS);
  const rows = Math.min(MAX_ROWS, Math.ceil((words * width) / columns));
  return { columns, rows, words: Math.min(words, Math.ceil((rows * columns) / width)) };
}

/** The lit pixels of a screen's picture, as indexes `row × columns + column`, from the words read for it. */
export function litPixels(words: ArrayLike<number>, props: Props): number[] {
  const { columns, rows } = screenSize(props);
  const width = props.width ?? 1;
  const lit = [];
  for (let n = 0; n < Math.min(words.length * width, columns * rows); n++) {
    // Pixel n is bit (width - 1 - n % width) of word n / width: the most significant bit leftmost.
    if (((words[Math.floor(n / width)] ?? 0) >>> (width - 1 - (n % width))) & 1) lit.push(n);
  }
  return lit;
}

/** What is wrong with a ROM's words, or null: whole numbers that fit `width` bits, no more than `2^address` (ADR 0018). */
export function wordsProblem(words: unknown, width: number, address: number): string | null {
  if (!Array.isArray(words)) return "must be a list of words";
  if (words.length > 2 ** address) return `are ${words.length} words, more than the ${2 ** address} addresses hold`;
  const max = maxValue(width);
  return words.every((w) => Number.isInteger(w) && w >= 0 && w <= max) ? null : `must be whole numbers from 0 to ${max}`;
}

/** A new splitter or merger has four 1-bit fields (ADR 0014). */
export const DEFAULT_FIELDS: readonly number[] = [1, 1, 1, 1];

/** Props a newly placed part starts with. */
export const newProps = (kind: PartKind): Props =>
  isFielded(kind) ? { fields: [...DEFAULT_FIELDS] } : kind === "screen" ? { addressWidth: SCREEN_ADDRESS } : {};
/** A new screen's address width: with 8-bit words, 128 words are 32 × 32 pixels (ADR 0021). */
export const SCREEN_ADDRESS = 7;

/** What is wrong with a `fields` value, or null: a non-empty list of whole numbers of at least 1, at most `MAX_WIDTH` bits in all. */
export function fieldsProblem(fields: unknown): string | null {
  if (!Array.isArray(fields) || fields.length === 0) return "must be a list of at least one field width";
  if (!fields.every((f) => Number.isInteger(f) && (f as number) >= 1)) return "must be whole numbers of at least 1";
  const total = (fields as number[]).reduce((sum, f) => sum + f, 0);
  return total > MAX_WIDTH ? `add up to ${total} bits, more than ${MAX_WIDTH}` : null;
}

/** Each field's bits as drawn on its port: "3" for one bit, "7:4" for several. */
export function fieldRanges(fields: readonly number[]): string[] {
  let low = 0;
  return fields.map((width) => {
    const range = width === 1 ? `${low}` : `${low + width - 1}:${low}`;
    low += width;
    return range;
  });
}

/**
 * What a value's bits are, given its unknown bits (ADR 0035): `x` if any bit is X (unknown, and the value's bit is 1),
 * else `z` if any is Z (unknown, and the value's bit is 0), else known.
 */
export const signalState = (value: number, unknown: number): "known" | "x" | "z" => ((value & unknown) !== 0 ? "x" : unknown !== 0 ? "z" : "known");

/**
 * A value in hex, one digit per started 4 bits: an 8-bit 44 is "0x2C". With unknown bits (ADR 0035), a digit is `Z` if
 * all its bits are Z, and `X` if any other bit of it is unknown.
 */
export function hex(value: number, width: number, unknown = 0): string {
  const digits = Math.ceil(width / 4);
  if (unknown === 0) return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
  let text = "";
  for (let digit = 0; digit < digits; digit++) {
    // The top digit of a width that is not a multiple of 4 has fewer bits.
    const mask = 2 ** Math.min(4, width - 4 * digit) - 1;
    const [v, u] = [(value >>> (4 * digit)) & mask, (unknown >>> (4 * digit)) & mask];
    text = (u === 0 ? v.toString(16).toUpperCase() : u === mask && v === 0 ? "Z" : "X") + text;
  }
  return `0x${text}`;
}

/**
 * How the readout shows a value: on or off for 1 bit, else decimal and hex ("44 (0x2C)"). With unknown bits (ADR 0035):
 * X or Z for 1 bit, else its hex digits alone ("0xXZ").
 */
export const showValue = (value: number, width: number, unknown = 0) =>
  unknown !== 0 ? (width > 1 ? hex(value, width, unknown) : value === 1 ? "X" : "Z") : width > 1 ? `${value} (${hex(value, width)})` : value === 1 ? "on" : "off";

/** Largest value `width` bits hold. Not built with `<<`, which is 32-bit signed in JS. */
export const maxValue = (width: number) => 2 ** width - 1;

/** A switch value as typed: decimal, `0x…` or `0b…` (underscores allowed), from 0 to `maxValue(width)`; else null. */
export function parseValue(text: string, width: number): number | null {
  const match = /^(?:0x([0-9a-f]+)|0b([01]+)|([0-9]+))$/.exec(text.trim().replaceAll("_", "").toLowerCase());
  if (!match) return null;
  const [, hexDigits, binary, decimal] = match;
  const value = hexDigits ? parseInt(hexDigits, 16) : binary ? parseInt(binary, 2) : Number(decimal);
  return value <= maxValue(width) ? value : null;
}

/**
 * A label as stored: control characters (a newline, say) become spaces; bidi and
 * zero-width characters go, since they hide or reorder the text; then trimmed.
 * Length is checked by callers.
 */
export const normalizeLabel = (text: string) =>
  text.replace(/\p{Cc}/gu, " ").replace(/[\p{Bidi_Control}\u200B\uFEFF]/gu, "").trim();

/**
 * A net label's name as stored (ADR 0015): normalized like a label, then to Unicode NFC so a
 * combining accent matches the precomposed one. Matching is exact, so this is what makes two
 * names equal. Length is checked by callers.
 */
export const normalizeNetName = (text: string) => normalizeLabel(text).normalize("NFC");

/** A definition's name as stored: normalized like a label, cut (by code point) at `MAX_LABEL`; blank becomes "Component". */
export const normalizeName = (text: string) => [...(normalizeLabel(text) || "Component")].slice(0, MAX_LABEL).join("");

export type CircuitComponent = {
  id: string;
  kind: PartKind;
  /** For `custom` parts: the ID of the definition it is an instance of. */
  definition?: string;
  /** Grid units. */
  position: { x: number; y: number };
  rotation: (typeof ROTATIONS)[number];
  props: Props;
};

/** A point joining wires into one net. Grid units. */
/** `name`: a net label (ADR 0015); junctions with the same name on one sheet are one net. Projected to the engine. */
export type Junction = { id: string; position: { x: number; y: number }; name?: string };

/** `bends`: interior route points (grid units) of a wire the user shaped; absent means routed automatically (ADR 0011). */
export type Wire = { id: string; from: Endpoint; to: Endpoint; bends?: { x: number; y: number }[] };

/** Most bends a shaped wire may carry. */
export const MAX_BENDS = 64;

/**
 * Text placed on a sheet (ADR 0038): at a grid point, its lines as written, at most `MAX_NOTE` characters. Not a part:
 * the engine never receives it.
 */
export type SheetNote = { id: string; position: { x: number; y: number }; text: string };
/** The longest note on a sheet, in characters, and the most notes a sheet holds (ADR 0038). */
export const MAX_NOTE = 500;
export const MAX_SHEET_NOTES = 200;
/** A note's box in grid cells, for picking and boxing it: half a cell a character, a cell a line (ADR 0038). */
export function noteSize(text: string) {
  const lines = text.split("\n");
  return { width: Math.max(1, Math.ceil(Math.max(...lines.map((l) => [...l].length)) / 2)), height: lines.length };
}

export type Circuit = { components: CircuitComponent[]; junctions: Junction[]; wires: Wire[]; notes: SheetNote[] };

export const isJunction = (end: Endpoint): end is JunctionRef => "junction" in end;
/** ID of the part or junction a wire end is attached to. */
export const endOwner = (end: Endpoint) => (isJunction(end) ? end.junction : end.component);
export const sameEnd = (a: Endpoint, b: Endpoint) =>
  isJunction(a) || isJunction(b)
    ? isJunction(a) && isJunction(b) && a.junction === b.junction
    : a.component === b.component && a.port === b.port;

/** The longest notes a document carries, in characters (ADR 0027). */
export const MAX_NOTES = 4000;

/**
 * Notes as stored: line endings as `\n`, no blank space around them, and, as in labels, no control or bidi
 * characters but `\n` and tab, since those hide or reorder the text; empty means none.
 */
export const normalizeNotes = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]/gu, "")
    .replace(/[\p{Bidi_Control}\u200B\uFEFF]/gu, "")
    .trim();

/** A reusable component: a circuit whose switches and LEDs are its pins, shown by their labels (ADRs 0012, 0013). */
export type Definition = { id: string; name: string; circuit: Circuit };

export type CircuitDocument = {
  format: "clockyard";
  version: 13;
  /**
   * `challenge`: the challenge the document was started from, by its file name such as `01-inverter` (ADR 0025).
   * `notes`: plain text about the design, paragraphs separated by blank lines, at most `MAX_NOTES` characters (ADR 0027).
   */
  metadata: { name: string; createdAt: string; modifiedAt: string; challenge?: string; notes?: string };
  circuit: Circuit;
  definitions: Definition[];
};

/**
 * A definition's pins: switches are inputs and LEDs outputs, each in
 * top-to-bottom (then left-to-right) order. A pin is named by its part's ID,
 * which never changes, so relabelling a pin keeps every wire to it (ADR 0013);
 * the label is only shown.
 */
export function pinsOf(circuit: Circuit): { inputs: PinDesc[]; outputs: PinDesc[] } {
  const pins = (kind: ComponentKind) =>
    circuit.components
      .filter((c) => c.kind === kind)
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((c) => ({ name: c.id, component: c.id }));
  return { inputs: pins("switch"), outputs: pins("led") };
}

/** A definition the editor shows by `id` cannot be placed in a definition that it contains (directly or deeper). */
export function contains(definitions: Definition[], outer: string, inner: string): boolean {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === inner) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const parts = byId.get(id)?.circuit.components ?? [];
    return parts.some((c) => c.kind === "custom" && c.definition !== undefined && visit(c.definition));
  };
  return visit(outer);
}

const body = (circuit: Circuit): CircuitBody => ({
  components: circuit.components.map(({ id, kind, definition, props }) => ({
    id,
    kind,
    ...(definition && { definition }),
    ...(props.width !== undefined && { width: props.width }),
    ...(props.fields !== undefined && { fields: props.fields }),
    ...(props.addressWidth !== undefined && { addressWidth: props.addressWidth }),
    ...(props.data !== undefined && { data: props.data }),
    ...(props.inputCount !== undefined && { inputCount: props.inputCount }),
  })),
  junctions: circuit.junctions.map(({ id, name }) => (name ? { id, name } : { id })),
  connections: circuit.wires.map(({ id, from, to }) => ({ id, from, to })),
});

/**
 * `circuit` without its wires to pins deleted from their definitions (ADR 0013, amended). The editor keeps
 * such wires, so undo on the definition's sheet brings the pin and its wires back; the engine and files never
 * see them.
 */
export function withoutDeletedPins(circuit: Circuit, definitions: Definition[]): Circuit {
  const pins = new Map(
    definitions.map((d) => {
      const { inputs, outputs } = pinsOf(d.circuit);
      return [d.id, new Set([...inputs, ...outputs].map((pin) => pin.name))];
    }),
  );
  const parts = new Map(circuit.components.map((c) => [c.id, c]));
  const gone = (end: Endpoint) => {
    const part = isJunction(end) ? undefined : parts.get(end.component);
    const names = part?.kind === "custom" && part.definition ? pins.get(part.definition) : undefined;
    return !isJunction(end) && names !== undefined && !names.has(end.port);
  };
  const wires = circuit.wires.filter((w) => !gone(w.from) && !gone(w.to));
  return wires.length === circuit.wires.length ? circuit : { ...circuit, wires };
}

/** Drops geometry and editor-only data (labels); the engine sees connectivity, widths and each definition's pins. */
export function project(circuit: Circuit, definitions: Definition[] = []): CircuitDescription {
  const live = (c: Circuit) => body(withoutDeletedPins(c, definitions));
  return {
    ...live(circuit),
    definitions: definitions.map((d) => ({ id: d.id, ...live(d.circuit), ...pinsOf(d.circuit) })),
  };
}
