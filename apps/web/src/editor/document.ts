// The editable circuit document, format version 1 (docs/architecture.md#circuit-document).
// Connectivity is explicit: wires reference ports by ID, never by geometry.
import type { CircuitDescription, PortRef } from "../simulation/protocol";

export type ComponentKind = "switch" | "led" | "not" | "and" | "nand" | "or" | "nor" | "xor" | "xnor";

export type CircuitComponent = {
  id: string;
  kind: ComponentKind;
  /** Grid units. */
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  props: Record<string, unknown>;
};

export type Wire = { id: string; from: PortRef; to: PortRef };

export type Circuit = { components: CircuitComponent[]; wires: Wire[] };

export type CircuitDocument = {
  format: "clockyard";
  version: 1;
  metadata: { name: string; createdAt: string; modifiedAt: string };
  circuit: Circuit;
};

/** Drops geometry and editor-only data; the engine sees only connectivity. */
export function project(circuit: Circuit): CircuitDescription {
  return {
    components: circuit.components.map(({ id, kind }) => ({ id, kind })),
    connections: circuit.wires.map(({ id, from, to }) => ({ id, from, to })),
  };
}
