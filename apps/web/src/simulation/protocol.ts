// Messages between the main thread and the simulation worker (ADR 0005,
// docs/architecture.md#worker-protocol). Shapes mirror sim-core's
// `description` module.

export type PortRef = { component: string; port: string };
export type JunctionRef = { junction: string };
/** A wire end: a component port or a junction (ADR 0010). */
export type Endpoint = PortRef | JunctionRef;

/** A circuit's parts and wires without geometry, as the engine reads them. */
export type CircuitBody = {
  /** `definition`: for `custom` parts, the definition it is an instance of (ADR 0012). */
  components: { id: string; kind: string; definition?: string }[];
  junctions: { id: string }[];
  connections: { id: string; from: Endpoint; to: Endpoint }[];
};

/** A pin of a custom component: the port name instances show, and the switch or LED inside. */
export type PinDesc = { name: string; component: string };

/** Geometry-free engine input, projected from the circuit document. */
export type CircuitDescription = CircuitBody & {
  definitions: (CircuitBody & { id: string; inputs: PinDesc[]; outputs: PinDesc[] })[];
};

export type Diagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Document IDs (components, wires) involved. */
  ids: string[];
};

export type Command =
  | { type: "load"; circuit: CircuitDescription }
  | { type: "setInput"; component: string; value: 0 | 1 };

export type Result =
  | { type: "ready" }
  | {
      type: "loaded";
      netCount: number;
      /** Wire ID → net index. */
      wireNets: Record<string, number>;
      /** Component ID → port name → net index. */
      portNets: Record<string, Record<string, number>>;
      diagnostics: Diagnostic[];
    }
  | { type: "state"; nets: Uint8Array; diagnostics: Diagnostic[] }
  | { type: "error"; message: string };
