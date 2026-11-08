// Keeps the engine in step with the editor store and holds what it last
// reported. The UI renders only these engine values.
import { create } from "zustand";
import { project } from "../editor/document";
import { liveDefinitions, useEditor, type EditorState } from "../editor/store";
import { startSimulation } from "./client";
import type { Diagnostic, Result } from "./protocol";

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
};

export const useSim = create<SimState>()(() => ({
  status: "loading",
  error: null,
  loaded: null,
  nets: null,
  runtime: [],
  stale: true,
}));

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
        if (message.load) {
          pending--;
          useSim.setState({ loaded: null, nets: null, stale: pending > 0 });
        }
        useSim.setState({ status: "error", error: message.message });
        break;
      // A reply means the engine works again, so an earlier command error no longer applies.
      case "loaded":
        pending--;
        useSim.setState({ loaded: message, status: "ready", error: null });
        break;
      case "state":
        if (pending === 0) {
          useSim.setState({ nets: message.nets, runtime: message.diagnostics, stale: false, status: "ready", error: null });
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
    for (const [component, value] of Object.entries(inputs)) {
      if (sent[component] !== value) client.send({ type: "setInput", component, value });
    }
    sent = inputs;
  };
  sync(useEditor.getState());
  const unsubscribe = useEditor.subscribe(sync);
  return () => {
    unsubscribe();
    client.dispose();
  };
}
