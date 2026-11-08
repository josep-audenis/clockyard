// Messages between the main thread and the simulation worker (ADR 0005,
// docs/architecture.md#worker-protocol). Shapes mirror sim-core's
// `description` module.

export type PortRef = { component: string; port: string };
export type JunctionRef = { junction: string };
/** A wire end: a component port or a junction (ADR 0010). */
export type Endpoint = PortRef | JunctionRef;

/** A circuit's parts and wires without geometry, as the engine reads them. */
export type CircuitBody = {
  /**
   * `definition`: for `custom` parts, the definition it is an instance of (ADR 0012).
   * `width` (switches, LEDs, gates) and `fields` (split, merge): ADR 0014; the engine validates them.
   */
  components: { id: string; kind: string; definition?: string; width?: number; fields?: number[] }[];
  /** `name`: a net label (ADR 0015); the engine joins same-named junctions on one sheet. */
  junctions: { id: string; name?: string }[];
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
  /** Switch values by ID, each a whole number from 0 to 2^width − 1, set in one settle (ADR 0017). */
  | { type: "setInputs"; values: Record<string, number> }
  /** The worker ticks the clock in slices of wall time until paused (ADR 0017). */
  | { type: "run"; cyclesPerSecond: number }
  | { type: "pause" }
  /** Pauses, then one clock cycle: until the clock has risen once and is low again. */
  | { type: "step" }
  /** Pauses, then flip-flops, the clock and time back to 0; switch values kept. */
  | { type: "reset" };

export type Result =
  | { type: "ready" }
  | {
      type: "loaded";
      netCount: number;
      /** Wire ID → net index. */
      wireNets: Record<string, number>;
      /** Wire ID → width of its net in bits (1 for a net of junctions only). */
      wireWidths: Record<string, number>;
      /** Component ID → port name → net index. */
      portNets: Record<string, Record<string, number>>;
      /** Net index → ID of the top-level part driving it, null for ground (ADR 0016). */
      netDrivers: (string | null)[];
      diagnostics: Diagnostic[];
    }
  /** `nets`: each net's value, cut to its width. */
  /** `time`: virtual time in ticks (cycle count `(time + 1) / 2`); `running`: whether a run is under way. */
  | { type: "state"; nets: Uint32Array; diagnostics: Diagnostic[]; time: number; running: boolean }
  /** `load`: the failing command was a load, which then gets no `loaded` reply. */
  /** `running`: whether a run is still under way after the failure (ADR 0017). */
  | { type: "error"; message: string; load?: true; running?: boolean };
