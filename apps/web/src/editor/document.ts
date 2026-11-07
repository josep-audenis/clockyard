// The editable circuit document, format version 5 (docs/architecture.md#circuit-document, ADRs 0010, 0012, 0014).
// Connectivity is explicit: wires reference ports and junctions by ID, never by geometry.
import type { CircuitBody, CircuitDescription, Endpoint, JunctionRef, PinDesc } from "../simulation/protocol";

/** The built-in parts (the engine's catalog). */
export const COMPONENT_KINDS = ["switch", "led", "not", "and", "nand", "or", "nor", "xor", "xnor"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
/** A built-in part, or an instance of a custom component (ADR 0012). */
export type PartKind = ComponentKind | "custom";

export const ROTATIONS = [0, 90, 180, 270] as const;

/** Longest label a part can carry; longer ones crowd the canvas. */
export const MAX_LABEL = 32;

/** Widest signal, as sim-core's `MAX_WIDTH`; a test checks the two agree (ADR 0014). */
export const MAX_WIDTH = 32;

/**
 * `label` is editor-only: a switch's or LED's label names the circuit's input or
 * output pin. `width` (switches, LEDs and gates; absent means 1) is projected to
 * the engine, which owns what it means (ADR 0014).
 */
export type Props = { label?: string; width?: number };

/** A value in hex, one digit per started 4 bits: an 8-bit 44 is "0x2C". */
export const hex = (value: number, width: number) =>
  `0x${value.toString(16).toUpperCase().padStart(Math.ceil(width / 4), "0")}`;

/** How the readout shows a value: on or off for 1 bit, else decimal and hex ("44 (0x2C)"). */
export const showValue = (value: number, width: number) =>
  width > 1 ? `${value} (${hex(value, width)})` : value === 1 ? "on" : "off";

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
export type Junction = { id: string; position: { x: number; y: number } };

/** `bends`: interior route points (grid units) of a wire the user shaped; absent means routed automatically (ADR 0011). */
export type Wire = { id: string; from: Endpoint; to: Endpoint; bends?: { x: number; y: number }[] };

/** Most bends a shaped wire may carry. */
export const MAX_BENDS = 64;

export type Circuit = { components: CircuitComponent[]; junctions: Junction[]; wires: Wire[] };

export const isJunction = (end: Endpoint): end is JunctionRef => "junction" in end;
/** ID of the part or junction a wire end is attached to. */
export const endOwner = (end: Endpoint) => (isJunction(end) ? end.junction : end.component);
export const sameEnd = (a: Endpoint, b: Endpoint) =>
  isJunction(a) || isJunction(b)
    ? isJunction(a) && isJunction(b) && a.junction === b.junction
    : a.component === b.component && a.port === b.port;

/** A reusable component: a circuit whose switches and LEDs are its pins, shown by their labels (ADRs 0012, 0013). */
export type Definition = { id: string; name: string; circuit: Circuit };

export type CircuitDocument = {
  format: "clockyard";
  version: 5;
  metadata: { name: string; createdAt: string; modifiedAt: string };
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
  })),
  junctions: circuit.junctions.map(({ id }) => ({ id })),
  connections: circuit.wires.map(({ id, from, to }) => ({ id, from, to })),
});

/** Drops geometry and editor-only data (labels); the engine sees connectivity, widths and each definition's pins. */
export function project(circuit: Circuit, definitions: Definition[] = []): CircuitDescription {
  return {
    ...body(circuit),
    definitions: definitions.map((d) => ({ id: d.id, ...body(d.circuit), ...pinsOf(d.circuit) })),
  };
}
