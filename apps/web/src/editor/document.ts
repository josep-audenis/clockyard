// The editable circuit document, format version 2 (docs/architecture.md#circuit-document, ADR 0010).
// Connectivity is explicit: wires reference ports and junctions by ID, never by geometry.
import type { CircuitDescription, Endpoint, JunctionRef } from "../simulation/protocol";

export const COMPONENT_KINDS = ["switch", "led", "not", "and", "nand", "or", "nor", "xor", "xnor"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

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

export type CircuitComponent = {
  id: string;
  kind: ComponentKind;
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

export type CircuitDocument = {
  format: "clockyard";
  version: 2;
  metadata: { name: string; createdAt: string; modifiedAt: string };
  circuit: Circuit;
};

/** Drops geometry and editor-only data; the engine sees only connectivity. */
export function project(circuit: Circuit): CircuitDescription {
  return {
    components: circuit.components.map(({ id, kind }) => ({ id, kind })),
    junctions: circuit.junctions.map(({ id }) => ({ id })),
    connections: circuit.wires.map(({ id, from, to }) => ({ id, from, to })),
  };
}
