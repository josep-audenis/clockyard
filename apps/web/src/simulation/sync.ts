// Keeps the engine in step with the editor store and holds what it last
// reported. The UI renders only these engine values.
import { create } from "zustand";
import { project } from "../editor/document";
import { liveDefinitions, useEditor, type EditorState } from "../editor/store";
import { startSimulation } from "./client";
import type { AsmError, Command, Diagnostic, Result, Stopped } from "./protocol";

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
  /** Why the last run ended by itself, until the next Run, Pause, Step or Reset; null when it was paused (ADR 0021). */
  stopped: Stopped | null;
  /** Run speed in cycles per second, the editor's choice. */
  speed: number;
  /** The LED a run stops at when it lights, or null to run until paused (ADR 0019). */
  until: string | null;
  /** Each memory's words last asked for with `readMemory`, by component ID, as the engine reported them (ADRs 0018, 0021). */
  memory: Record<string, Uint32Array>;
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
  stopped: null,
  speed: 2,
  until: null,
  memory: {},
}));

/** Sends a command to the worker, once `connectEngine` has started it. */
let send: ((command: Command) => void) | null = null;

/** Run, Pause, Step and Reset (ADR 0017). Run uses the chosen speed, and stops at the chosen LED (ADR 0019). */
export function control(type: "run" | "pause" | "step" | "reset") {
  const { speed, until } = useSim.getState();
  useSim.setState({ stopped: null });
  send?.(type === "run" ? { type, cyclesPerSecond: speed, ...(until && { until }) } : { type });
}

/** Picks the LED runs stop at, or none; a run under way continues with the new choice. */
export function setUntil(until: string | null) {
  useSim.setState({ until });
  if (useSim.getState().running) control("run");
}

/** Memories read after every state, by ID, with how many words of each (ADR 0021: the screens on the sheet). */
let watched = new Map<string, number>();
let reading = 0;

/** Reads every watched memory once, on the next animation frame however many states arrive before it. */
function readWatched() {
  if (reading) return;
  const read = () => {
    reading = 0;
    for (const [component, count] of watched) readMemory(component, count);
  };
  // A frame where there are frames; a worker test or a server render has none.
  reading = typeof requestAnimationFrame === "function" ? requestAnimationFrame(read) : Number(setTimeout(read, 16));
}

/** Sets the memories read after every state; one newly watched is read at once. */
export function watchMemory(memories: Map<string, number>) {
  const changed = [...memories].some(([id, count]) => watched.get(id) !== count);
  watched = memories;
  if (changed) readWatched();
}

/** Asks for a ROM's or RAM's first `count` words; they arrive in `useSim`'s `memory`. */
export function readMemory(component: string, count: number) {
  send?.({ type: "readMemory", component, count });
}

/** Replies awaited by request number: the assembler's answers come back in any order with other results. */
let requests = 0;
const awaiting = new Map<number, (result: Result) => void>();

function ask(command: (request: number) => Command): Promise<Result> {
  const request = ++requests;
  if (!send) return Promise.resolve({ type: "error", message: "the engine is not running", request });
  const post = send;
  return new Promise((resolve) => {
    awaiting.set(request, resolve);
    post(command(request));
  });
}

/** Assembles reference-CPU source in the worker (ADR 0019): the ROM words, or every error with its line. */
export async function assemble(source: string): Promise<{ words: number[]; errors: AsmError[] }> {
  const result = await ask((request) => ({ type: "assemble", request, source }));
  // A failure is an error with no line, so nothing is ever written from it.
  if (result.type === "assembled") return result;
  const message = result.type === "error" ? result.message : "no answer from the engine";
  return { words: [], errors: [{ line: 0, message: `Could not assemble: ${message}.` }] };
}

/** ROM words as reference-CPU assembly, one line each; null if the engine cannot answer. */
export async function disassemble(words: number[]): Promise<string[] | null> {
  const result = await ask((request) => ({ type: "disassemble", request, words }));
  return result.type === "disassembled" ? result.lines : null;
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
        // An assembler request's failure answers that request only; the simulation is unaffected.
        if (message.request !== undefined) {
          awaiting.get(message.request)?.(message);
          awaiting.delete(message.request);
          break;
        }
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
      case "assembled":
      case "disassembled":
        awaiting.get(message.request)?.(message);
        awaiting.delete(message.request);
        break;
      case "memory": {
        // Words as before keep their array, so nothing showing them redraws (a screen at top speed, ADR 0021).
        const before = useSim.getState().memory[message.component];
        const same = before?.length === message.words.length && before.every((w, i) => w === message.words[i]);
        if (!same) useSim.setState(({ memory }) => ({ memory: { ...memory, [message.component]: message.words } }));
        break;
      }
      case "state":
        // Running or not is the worker's, whatever circuit the state describes.
        useSim.setState({ running: message.running, ...(message.stopped && { stopped: message.stopped }) });
        if (pending === 0) {
          const { nets, diagnostics: runtime, time } = message;
          useSim.setState({ nets, runtime, time, stale: false, status: "ready", error: null });
          readWatched();
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
    // Nothing will answer what is still awaited.
    for (const [request, resolve] of awaiting) resolve({ type: "error", message: "the engine stopped", request });
    awaiting.clear();
    client.dispose();
  };
}
