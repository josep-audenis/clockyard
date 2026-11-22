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
   * `addressWidth` (ROM, RAM) and `data` (a ROM's words): ADR 0018.
   */
  components: { id: string; kind: string; definition?: string; width?: number; fields?: number[]; addressWidth?: number; data?: number[]; inputCount?: number }[];
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

/** How many numbers a waveform trace holds for each change: its tick, its value, its unknown bits (ADR 0035). */
export const WAVE_STRIDE = 3;

export type Command =
  /**
   * `keep`: an edit's load, which carries time and state from the circuit simulated before it, or from the last one
   * that compiled (ADR 0033); without it (an open) everything starts at 0.
   */
  | { type: "load"; circuit: CircuitDescription; keep?: boolean }
  /** Switch and keyboard values by ID, each a whole number from 0 to 2^width − 1, set in one settle (ADR 0017). */
  | { type: "setInputs"; values: Record<string, number> }
  /**
   * The worker ticks the clock in slices of wall time until paused (ADR 0017). `until`: an LED's ID;
   * the run also stops at the tick where it lights from dark (ADR 0019).
   */
  | { type: "run"; cyclesPerSecond: number; until?: string }
  | { type: "pause" }
  /** Pauses, then one clock cycle: until the clock has risen once and is low again. */
  | { type: "step" }
  /** Pauses, then flip-flops, the clock and time back to 0; switch values kept. */
  | { type: "reset" }
  /** The first `count` words of a ROM or RAM, by elaborated ID (`instance/ram` inside an instance), answered with `memory` (ADR 0018). */
  | { type: "readMemory"; component: string; count: number }
  /** Reference-CPU assembly (ADR 0019), answered with `assembled` carrying the same `request`. */
  | { type: "assemble"; request: number; source: string }
  /** ROM words as assembly, one line each, answered with `disassembled` carrying the same `request`. */
  | { type: "disassemble"; request: number; words: number[] }
  /**
   * Runs a challenge's steps on a bench of its own (ADR 0025), answered with `checked` carrying the same `request`.
   * With `bench`, a circuit with a slot for the definition, its runs are run there instead (ADR 0034).
   */
  | { type: "check"; request: number; circuit: CircuitDescription; challenge: Challenge; bench?: CircuitDescription }
  /**
   * Records these wires' nets from now on, and again from the start of every later load (ADR 0026). Wires
   * of one net record once; a wire the loaded circuit lacks records nothing.
   */
  | { type: "watch"; wires: string[] }
  /** What is recorded so far, answered with `waves`. */
  | { type: "readWaves" };

/** A challenge as `challenges/NN-name.json` holds it (ADR 0025); the engine reads all but the title and text. */
export type Challenge = {
  title: string;
  text: string;
  /** The ID of the definition to build. */
  definition: string;
  inputs: { name: string; width: number }[];
  outputs: { name: string; width: number }[];
  /** The primitive kinds allowed, flattened; absent allows any. */
  parts?: string[];
  steps: ChallengeStep[];
  /** For a challenge checked on a bench (ADR 0034): the bench's name, and its runs, each on a fresh bench. */
  bench?: string;
  runs?: { name: string; source?: string; words?: number[]; steps: ChallengeStep[] }[];
};

/**
 * Inputs set together, then outputs compared. On a bench also: `cycles` clock cycles, ended early once the LED
 * `until` names is lit, and `memory` bytes compared, by the bench part's ID and address.
 */
export type ChallengeStep = {
  set?: Record<string, number>;
  expect?: Record<string, number>;
  cycles?: number;
  until?: string;
  memory?: Record<string, Record<string, number>>;
};

/** What a check found: every step passed, the first that failed (0-based), or why the bench could not run. */
export type Report =
  | { result: "passed"; steps: number }
  | {
      result: "failed";
      /** On a bench: the run that failed. */
      run?: string;
      step: number;
      inputs: { name: string; value: number }[];
      /** `unknown`: the bits of `got` that are not known, X where `got` has a 1 and Z where it has a 0 (ADR 0035). */
      mismatches: { name: string; expected: number; got: number; unknown?: number }[];
    }
  | { result: "refused"; reason: string };

/** Why a run ended by itself: its LED lit (by ID), or a loop did not settle. */
export type Stopped = { reason: "lit"; led: string } | { reason: "unstable" };

/** An assembly error, on a 1-based line. */
export type AsmError = { line: number; message: string };

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
      /** The nets several tri-state buffers share, each resolved from its drivers (ADR 0035). */
      buses: number[];
      diagnostics: Diagnostic[];
    }
  /**
   * `nets`: each net's value, cut to its width. `unknown`: each net's unknown bits, X where the value has a 1 and Z
   * where it has a 0 (ADR 0035); empty while no bit is unknown.
   * `time`: virtual time in ticks (cycle count `(time + 1) / 2`); `running`: whether a run is under way.
   * `stopped`: why the last run ended by itself (ADR 0021), on every state until the next load, Run, Pause,
   * Step or Reset; never for a pause.
   */
  | { type: "state"; nets: Uint32Array; unknown: Uint32Array; diagnostics: Diagnostic[]; time: number; running: boolean; stopped?: Stopped }
  /**
   * `errors` empty: the source assembled to `words` (empty for an empty program). `second`: how many of them only
   * Reference CPU 2 runs, which the first reference CPU ignores (ADR 0036).
   */
  | { type: "assembled"; request: number; words: number[]; errors: AsmError[]; second: number }
  | { type: "disassembled"; request: number; lines: string[] }
  | { type: "checked"; request: number; report: Report }
  /**
   * `nets`: the watched nets, each once; `traces[i]`: net `nets[i]`'s changes as `[t0, v0, u0, t1, v1, u1, …]`
   * (time, value, unknown bits: `WAVE_STRIDE` numbers each, ADR 0035), oldest first, the first in force when the 4,096-tick window starts (ADR 0026). `time`: ticks, as in `state`.
   */
  | { type: "waves"; time: number; nets: number[]; traces: Float64Array[] }
  /** `words`: empty when the component is not a memory or nothing is loaded. `unknown`: their unknown bits, empty while every word is known (ADR 0035). */
  | { type: "memory"; component: string; words: Uint32Array; unknown: Uint32Array }
  /**
   * `load`: the failing command was a load, which then gets no `loaded` reply.
   * `running`: whether a run is still under way after the failure (ADR 0017).
   * `request`: the failing command was that request (assembler or check), which gets no other reply.
   */
  | { type: "error"; message: string; load?: true; running?: boolean; request?: number };
