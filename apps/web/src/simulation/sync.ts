// Keeps the engine in step with the editor store and holds what it last
// reported. The UI renders only these engine values.
import { create } from "zustand";
import { project } from "../editor/document";
import { liveDefinitions, liveWatches, useEditor, type EditorState } from "../editor/store";
import { startSimulation } from "./client";
import { since, timed } from "../bench";
import type { AsmError, Challenge, CircuitDescription, Command, Diagnostic, Report, Result, Stopped } from "./protocol";

// When the oldest inputs still unanswered were sent (a `performance.now()`), or -1.
let inputsSent = -1;
/**
 * Whether the engine owes a state for inputs sent less than `ms` ago. The canvas waits that long for it, so a toggle is
 * drawn once, with its values (ADR 0030).
 */
export const awaitingInputs = (ms: number) => inputsSent >= 0 && performance.now() - inputsSent < ms;

export type Loaded = Extract<Result, { type: "loaded" }>;
export type Waves = Extract<Result, { type: "waves" }>;

export type SimState = {
  status: "loading" | "ready" | "error";
  error: string | null;
  loaded: Loaded | null;
  nets: Uint32Array | null;
  /**
   * Each net's unknown bits, beside `nets` (ADR 0035): where one is set, the bit is X if the value's bit is 1 and Z if
   * it is 0. Empty while no bit is unknown.
   */
  unknown: Uint32Array;
  /** Diagnostics from the latest settle (e.g. an unstable loop). */
  runtime: Diagnostic[];
  /** The document changed and the engine has not reported on it yet. */
  stale: boolean;
  /** Virtual time in ticks, as last reported; the cycle counter is `(time + 1) / 2` (ADR 0017). */
  time: number;
  /** Whether the worker is running the clock (it pauses itself on an unstable loop). */
  running: boolean;
  /** Why the last run ended by itself, as the worker last said; null when it was paused or since changed (ADR 0021). */
  stopped: Stopped | null;
  /** Run speed in cycles per second, the editor's choice. */
  speed: number;
  /** The LED a run stops at when it lights, or null to run until paused (ADR 0019). */
  until: string | null;
  /** Each memory's words last asked for with `readMemory`, by component ID, as the engine reported them (ADRs 0018, 0021). */
  memory: Record<string, Uint32Array>;
  /** Those words' unknown bits, by component ID; an empty array while every word is known (ADR 0035). */
  memoryUnknown: Record<string, Uint32Array>;
  /**
   * The watched wires' record, as last read (ADR 0026); null while nothing is watched, since an open's load was sent, or
   * since any load was answered, until it is read again (ADR 0033).
   */
  waves: Waves | null;
  /** Counts opens' loads and the times reported time went back (a reset), so a waveform cursor is not carried into a new record. */
  epoch: number;
};

/** Run speeds offered, in cycles per second (ADR 0017). */
export const SPEEDS = [1, 2, 5, 10, 100, 1000, 10000] as const;

export const useSim = create<SimState>()(() => ({
  status: "loading",
  error: null,
  loaded: null,
  nets: null,
  unknown: new Uint32Array(),
  runtime: [],
  stale: true,
  time: 0,
  running: false,
  stopped: null,
  speed: 2,
  until: null,
  memory: {},
  memoryUnknown: {},
  waves: null,
  epoch: 0,
}));

/** Sends a command to the worker, once `connectEngine` has started it. */
let send: ((command: Command) => void) | null = null;

/** Run, Pause, Step and Reset (ADR 0017). Run uses the chosen speed, and stops at the chosen LED (ADR 0019). */
export function control(type: "run" | "pause" | "step" | "reset") {
  const { speed, until } = useSim.getState();
  send?.(type === "run" ? { type, cyclesPerSecond: speed, ...(until && { until }) } : { type });
}

/** Picks the LED runs stop at, or none; a run under way continues with the new choice. */
export function setUntil(until: string | null) {
  useSim.setState({ until });
  if (useSim.getState().running) control("run");
}

/** Memories read after every state, by ID, with how many words of each (ADR 0021: the screens on the sheet). */
let watched = new Map<string, number>();
/** Wires whose record is read after every state (ADR 0026). */
let watchedWires: string[] = [];
let reading = 0;

/** Reads every watched memory and the waveforms once, on the next animation frame however many states arrive before it. */
function readWatched() {
  if (reading) return;
  const read = () => {
    reading = 0;
    for (const [component, count] of watched) readMemory(component, count);
    if (watchedWires.length > 0) send?.({ type: "readWaves" });
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

/**
 * Assembles reference-CPU source in the worker (ADRs 0019, 0036): the ROM words and how many of them only Reference
 * CPU 2 runs, or every error with its line.
 */
export async function assemble(source: string): Promise<{ words: number[]; errors: AsmError[]; second: number }> {
  const result = await ask((request) => ({ type: "assemble", request, source }));
  // A failure is an error with no line, so nothing is ever written from it.
  if (result.type === "assembled") return result;
  const message = result.type === "error" ? result.message : "no answer from the engine";
  return { words: [], errors: [{ line: 0, message: `Could not assemble: ${message}.` }], second: 0 };
}

/** ROM words as reference-CPU assembly, one line each; null if the engine cannot answer. */
export async function disassemble(words: number[]): Promise<string[] | null> {
  const result = await ask((request) => ({ type: "disassemble", request, words }));
  return result.type === "disassembled" ? result.lines : null;
}

/**
 * Checks a challenge against a circuit in the worker (ADR 0025), on `bench` if the challenge has one (ADR 0034); a
 * failure to run at all is a refusal saying why.
 */
export async function check(circuit: CircuitDescription, challenge: Challenge, bench?: CircuitDescription): Promise<Report> {
  const result = await ask((request) => ({ type: "check", request, circuit, challenge, ...(bench && { bench }) }));
  if (result.type === "checked") return result.report;
  const message = result.type === "error" ? result.message : "no answer from the engine";
  return { result: "refused", reason: `Could not check: ${message}.` };
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
  // When each of them was sent, oldest first, and when the latest answered one was (ADR 0030's timings). Per worker:
  // a worker stopped with loads unanswered (React's double mount in development) leaves none behind.
  const loadsSent: number[] = [];
  let answered: number | null = null;
  // Loads sent so far: a state describes the circuit of the load count it arrived under.
  let loads = 0;
  // The latest state not yet applied, and whether time went back (a reset) in any state it stands for (ADR 0030).
  let latest: { message: Extract<Result, { type: "state" }>; loads: number; current: boolean; rewound: boolean } | null = null;
  let arrived = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A state was shown in this burst of messages: the ones after it wait for the next task, and only the latest is shown.
  let holding = false;
  const release = () => {
    holding = false;
    applyState();
  };
  // The load the shown state belongs to, and the latest open's load: a state past an open starts a new epoch, whatever
  // its time; an edit's load keeps time, so it does not (ADR 0033).
  let shownLoads = -1;
  let openLoads = -1;
  /**
   * Applies the latest state only. States come about every 16 ms while running; when the page takes longer than that
   * to show one (a large circuit), the ones waiting behind it are skipped, not applied one by one, so the page keeps
   * up. Any other message applies a waiting state first, so messages still take effect in the order they came.
   */
  const applyState = () => {
    const state = latest;
    latest = null;
    if (!state) return;
    const { message } = state;
    // Running or not is the worker's, whatever circuit the state describes.
    useSim.setState({ running: message.running, stopped: message.stopped ?? null });
    // A state from before the latest load describes an older circuit.
    if (!state.current || state.loads !== loads) return;
    // The answer to the inputs last sent (the benchmarks' end of a toggle); while running, possibly a state the worker
    // sent before it took them, which the next one follows within a frame.
    if (inputsSent >= 0) {
      since("engine-input", inputsSent);
      inputsSent = -1;
    }
    const { nets, unknown, diagnostics: runtime, time } = message;
    useSim.setState(({ time: before, epoch }) => ({
      nets,
      unknown,
      runtime,
      time,
      stale: false,
      status: "ready",
      error: null,
      epoch: state.rewound || time < before || openLoads > shownLoads ? epoch + 1 : epoch,
    }));
    shownLoads = state.loads;
    readWatched();
    // The first state of the latest load: the engine has settled it (the benchmarks' end of an open).
    if (answered !== null) {
      since("engine-ready", answered);
      answered = null;
    }
  };
  const client = startSimulation((message) => {
    if (message.type !== "state") applyState();
    switch (message.type) {
      case "ready":
        useSim.setState({ status: "ready" });
        break;
      case "error":
        // A request's failure (assembler or check) answers that request only; the simulation is unaffected.
        if (message.request !== undefined) {
          awaiting.get(message.request)?.(message);
          awaiting.delete(message.request);
          break;
        }
        // A failed load answers that load: nothing describes the circuit now, and nothing is pending for it.
        if (message.load) {
          pending--;
          loadsSent.shift();
        }
        useSim.setState({
          status: "error",
          error: message.message,
          ...(message.running !== undefined && { running: message.running }),
          ...(message.load && { loaded: null, nets: null, unknown: new Uint32Array(), runtime: [], stale: pending > 0, waves: null }),
        });
        break;
      // A reply means the engine works again, so an earlier command error no longer applies.
      case "loaded": {
        pending--;
        // From sending the load to its answer: the worker's parse, elaboration, compile and first settle, the copies,
        // and any wait behind the main thread. Loads are answered in order.
        const sent = loadsSent.shift();
        if (sent !== undefined) {
          since("engine-load", sent);
          answered = sent;
        }
        // The record's nets are numbered as in the circuit before; it is read again once this load's state is shown.
        useSim.setState({ loaded: message, status: "ready", error: null, waves: null });
        break;
      }
      case "assembled":
      case "disassembled":
      case "checked":
        awaiting.get(message.request)?.(message);
        awaiting.delete(message.request);
        break;
      case "memory": {
        // Words as before keep their array, so nothing showing them redraws (a screen at top speed, ADR 0021).
        const { memory, memoryUnknown } = useSim.getState();
        const alike = (before: Uint32Array | undefined, now: Uint32Array) => before?.length === now.length && before.every((w, i) => w === now[i]);
        if (!alike(memory[message.component], message.words)) {
          useSim.setState(({ memory }) => ({ memory: { ...memory, [message.component]: message.words } }));
        }
        // The same for the unknown bits, which change apart from the words when a known 1 becomes X.
        if (!alike(memoryUnknown[message.component], message.unknown)) {
          useSim.setState(({ memoryUnknown }) => ({ memoryUnknown: { ...memoryUnknown, [message.component]: message.unknown } }));
        }
        break;
      }
      case "waves":
        // A record read before the latest load describes the circuit before it.
        if (pending === 0 && watchedWires.length > 0) useSim.setState({ waves: message });
        break;
      case "state": {
        // Loads still unanswered: this state describes the circuit before them.
        const current = pending === 0;
        // Time went back since the last state of this load seen, shown or held (a reset), or in one held before it.
        const rewound = current && (message.time < arrived || (latest?.current === true && latest.loads === loads && latest.rewound));
        if (current) arrived = message.time;
        latest = { message, loads, current, rewound };
        // The first state of a burst is shown at once (a toggle's answer waits for nothing); those after it wait for a
        // task queued after the messages already waiting (Chromium runs tasks of one priority in the order they were
        // queued), so a backlog is shown as its latest. A hidden tab's timers run about once a second.
        if (!holding) {
          holding = true;
          // Queued first, so a failure while showing this state cannot leave the next ones held for good.
          timer = setTimeout(release, 0);
          applyState();
        }
        break;
      }
    }
  });

  let description = "";
  // The editor's opens counter at the last sync: a change means a file, example, project, link or sheet was opened.
  let opened = -1;
  let sent: EditorState["inputs"] = {};
  const sync = (state: EditorState) => timed("sync", () => syncNow(state));
  const syncNow = (state: EditorState) => {
    const { circuit, inputs, opens } = state;
    const open = opens !== opened;
    opened = opens;
    // Moving a part changes only geometry, so the engine keeps its state. The open sheet (main or a
    // definition) is what is simulated, with every definition as it is now.
    const projected = project(circuit, liveDefinitions(state));
    const next = JSON.stringify(projected);
    // An edit's load keeps time, flip-flops, memories and the record; an open's starts at 0, so it is sent even when
    // the description did not change (ADR 0033).
    if (next !== description || open) {
      description = next;
      pending++;
      loads++;
      if (open) openLoads = loads;
      // An open's record describes another circuit; an edit's stays in the store until its load is answered (the panel
      // shows no lanes while stale, but keeps its axis and cursor).
      useSim.setState(open ? { stale: true, waves: null } : { stale: true });
      loadsSent.push(performance.now());
      // The load's answer covers inputs still unanswered.
      inputsSent = -1;
      client.send({ type: "load", circuit: projected, keep: !open });
      sent = {};
    }
    // One command, so switches restored after a load change together and a flip-flop clocked by one of
    // them cannot sample the others in the order they were first toggled (ADR 0017).
    const changed = Object.fromEntries(Object.entries(inputs).filter(([component, value]) => sent[component] !== value));
    if (Object.keys(changed).length > 0) {
      client.send({ type: "setInputs", values: changed });
      // Answered only by a state of the current circuit: with a load pending, the load's own wait covers them, and after
      // validation errors (no nets) the worker answers nothing. Timed from the first unanswered send, so the wait is capped.
      if (pending === 0 && (useSim.getState().loaded?.netCount ?? 0) > 0 && inputsSent < 0) inputsSent = performance.now();
    }
    sent = inputs;
    // After the load, so the worker resolves the wires in the circuit they belong to; it watches them again on every
    // later load by itself.
    const wires = liveWatches(state);
    if (wires.join() !== watchedWires.join()) {
      watchedWires = wires;
      client.send({ type: "watch", wires });
      if (wires.length === 0) useSim.setState({ waves: null });
      else readWatched();
    }
  };
  send = client.send;
  sync(useEditor.getState());
  const unsubscribe = useEditor.subscribe(sync);
  return () => {
    unsubscribe();
    // A state of this worker waiting to be shown is not: the next worker's describe its own circuit.
    clearTimeout(timer);
    latest = null;
    holding = false;
    send = null;
    inputsSent = -1;
    // A read waiting for the next frame would ask this worker; the next one is read after its own first state.
    if (reading) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(reading);
      else clearTimeout(reading);
      reading = 0;
    }
    // A new worker watches nothing until told.
    watchedWires = [];
    // Nothing will answer what is still awaited.
    for (const [request, resolve] of awaiting) resolve({ type: "error", message: "the engine stopped", request });
    awaiting.clear();
    client.dispose();
  };
}
