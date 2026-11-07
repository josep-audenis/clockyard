// The editable circuit document, format version 3 (docs/architecture.md#circuit-document, ADRs 0010, 0012).
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

/**
 * Editor-only properties; the engine never sees them. A switch's or LED's label
 * names the circuit's input or output pin.
 */
export type Props = { label?: string };

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
  version: 4;
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
  components: circuit.components.map(({ id, kind, definition }) => (definition ? { id, kind, definition } : { id, kind })),
  junctions: circuit.junctions.map(({ id }) => ({ id })),
  connections: circuit.wires.map(({ id, from, to }) => ({ id, from, to })),
});

/** Drops geometry and editor-only data; the engine sees only connectivity and each definition's pins. */
export function project(circuit: Circuit, definitions: Definition[] = []): CircuitDescription {
  return {
    ...body(circuit),
    definitions: definitions.map((d) => ({ id: d.id, ...body(d.circuit), ...pinsOf(d.circuit) })),
  };
}
