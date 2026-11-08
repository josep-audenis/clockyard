// Keeps the engine in step with the editor store and holds what it last
// reported. The UI renders only these engine values.
import { create } from "zustand";
import { project } from "../editor/document";
import { liveDefinitions, useEditor, type EditorState } from "../editor/store";
import { startSimulation } from "./client";
import type { Command, Diagnostic, Result } from "./protocol";

export type Loaded = Extract<Result, { type: "loaded" }>;

export type SimState = {
  status: "loading" | "ready" | "error";
  error: string | null;
  loaded: Loaded | null;
  nets: Uint32Array | null;
  /** Diagnostics from the latest settle (e.g. an unstable loop). */
  runtime: Diagnostic[];
  /** The document changed and the engine has not reported on it yet. */
  stale: boolean;
  /** Virtual time in ticks, as last reported; the cycle counter is `(time + 1) / 2` (ADR 0017). */
  time: number;
  /** Whether the worker is running the clock (it pauses itself on an unstable loop). */
  running: boolean;
  /** Run speed in cycles per second, the editor's choice. */
  speed: number;
};

/** Run speeds offered, in cycles per second (ADR 0017). */
export const SPEEDS = [1, 2, 5, 10, 100, 1000, 10000] as const;

export const useSim = create<SimState>()(() => ({
  status: "loading",
  error: null,
  loaded: null,
  nets: null,
  runtime: [],
  stale: true,
  time: 0,
  running: false,
  speed: 2,
}));

/** Sends a command to the worker, once `connectEngine` has started it. */
let send: ((command: Command) => void) | null = null;

/** Run, Pause, Step and Reset (ADR 0017). Run uses the chosen speed. */
export function control(type: "run" | "pause" | "step" | "reset") {
  send?.(type === "run" ? { type, cyclesPerSecond: useSim.getState().speed } : { type });
}

/** Picks the run speed; a run under way continues at it. */
export function setSpeed(speed: number) {
  useSim.setState({ speed });
  if (useSim.getState().running) control("run");
}

/** Starts the worker and reloads it whenever the circuit's connectivity changes. */
export function connectEngine(): () => void {
  // Loads sent but not yet answered; states arriving meanwhile describe an older circuit.
  let pending = 0;
  const client = startSimulation((message) => {
    switch (message.type) {
      case "ready":
        useSim.setState({ status: "ready" });
        break;
      case "error":
        // A failed load answers that load: nothing describes the circuit now, and nothing is pending for it.
        if (message.load) pending--;
        useSim.setState({
          status: "error",
          error: message.message,
          ...(message.running !== undefined && { running: message.running }),
          ...(message.load && { loaded: null, nets: null, runtime: [], stale: pending > 0 }),
        });
        break;
      // A reply means the engine works again, so an earlier command error no longer applies.
      case "loaded":
        pending--;
        useSim.setState({ loaded: message, status: "ready", error: null });
        break;
      case "state":
        // Running or not is the worker's, whatever circuit the state describes.
        useSim.setState({ running: message.running });
        if (pending === 0) {
          const { nets, diagnostics: runtime, time } = message;
          useSim.setState({ nets, runtime, time, stale: false, status: "ready", error: null });
        }
        break;
    }
  });

  let description = "";
  let sent: EditorState["inputs"] = {};
  const sync = (state: EditorState) => {
    const { circuit, inputs } = state;
    // Moving a part changes only geometry, so the engine keeps its state. The open sheet (main or a
    // definition) is what is simulated, with every definition as it is now.
    const projected = project(circuit, liveDefinitions(state));
    const next = JSON.stringify(projected);
    if (next !== description) {
      description = next;
      pending++;
      useSim.setState({ stale: true });
      client.send({ type: "load", circuit: projected });
      sent = {};
    }
    // One command, so switches restored after a load change together and a flip-flop clocked by one of
    // them cannot sample the others in the order they were first toggled (ADR 0017).
    const changed = Object.fromEntries(Object.entries(inputs).filter(([component, value]) => sent[component] !== value));
    if (Object.keys(changed).length > 0) client.send({ type: "setInputs", values: changed });
    sent = inputs;
  };
  send = client.send;
  sync(useEditor.getState());
  const unsubscribe = useEditor.subscribe(sync);
  return () => {
    unsubscribe();
    send = null;
    client.dispose();
  };
}
