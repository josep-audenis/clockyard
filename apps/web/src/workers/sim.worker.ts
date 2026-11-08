import init, { Engine } from "../generated/sim-wasm/sim_wasm.js";
import type { Command, Diagnostic, Result } from "../simulation/protocol";

const reply = (result: Result) => postMessage(result);

// Every command awaits the same promise, so commands still run in arrival order.
let engine: Engine | null = null;
let hasCircuit = false;
const ready = init().then(
  () => {
    engine = new Engine();
    reply({ type: "ready" });
  },
  (error: unknown) => reply({ type: "error", message: `failed to load engine: ${String(error)}` }),
);

/** Wall time between slices of a run, and the share of it spent ticking (ADR 0017). */
const SLICE_MS = 16;
const BUDGET_MS = 8;
/** Ticks per engine call inside a slice, so the budget is checked often without a call per tick. */
const CHUNK = 64;

/** While running: the speed, when the last slice ran, and the part of a tick owed since. */
let run: { cyclesPerSecond: number; last: number; owed: number; timer: ReturnType<typeof setTimeout> } | null = null;

const state = (diagnostics: Diagnostic[]) =>
  reply({ type: "state", nets: engine?.nets() ?? new Uint32Array(), diagnostics, time: engine?.time() ?? 0, running: run !== null });

const pause = () => {
  if (run) clearTimeout(run.timer);
  run = null;
};

/**
 * One slice of a run: as many ticks as the speed calls for since the last slice, within the budget.
 * Wall time only decides how many ticks run, never what a tick does, so the state after n ticks is
 * the same at any speed or frame rate. Ticks the budget cannot fit are dropped, not caught up later.
 */
function slice() {
  if (!run || !engine) return;
  const now = performance.now();
  run.owed += ((now - run.last) / 1000) * run.cyclesPerSecond * 2;
  run.last = now;
  let ticks = Math.floor(run.owed);
  run.owed -= ticks;
  let diagnostics: Diagnostic[] = [];
  const ran = ticks > 0 && hasCircuit;
  try {
    while (hasCircuit && ticks > 0 && performance.now() - now < BUDGET_MS) {
      const count = Math.min(ticks, CHUNK);
      ticks -= count;
      diagnostics = JSON.parse(engine.tick(count)) as Diagnostic[];
      // A loop that does not settle pauses the run (ADR 0017).
      if (diagnostics.length > 0) pause();
      if (!run) break;
    }
  } catch (error) {
    pause();
    reply({ type: "error", message: String(error) });
    return;
  }
  if (ran) state(diagnostics);
  if (run) run.timer = setTimeout(slice, SLICE_MS);
}

onmessage = async (event: MessageEvent<Command>) => {
  await ready;
  // Load failure was already reported; calling into the uninitialised module would replace that message.
  if (!engine) return;
  const command = event.data;
  // Set once a load has been answered, so a later failure is not taken for the load's.
  let answered = false;
  try {
    switch (command.type) {
      case "load": {
        // The initial settle's result goes with the state, so the next settle (e.g. restored switch positions) replaces it.
        // A run keeps running, from time 0 (ADR 0017).
        hasCircuit = false;
        const { runtime, ...loaded } = JSON.parse(engine.load(JSON.stringify(command.circuit)));
        hasCircuit = loaded.netCount > 0;
        reply({ type: "loaded", ...loaded });
        answered = true;
        state(runtime);
        break;
      }
      case "setInputs":
        // After validation errors there is nothing to set; the client re-sends inputs with the next load.
        if (hasCircuit) state(JSON.parse(engine.set_inputs(JSON.stringify(command.values))));
        break;
      case "run":
        pause();
        run = { cyclesPerSecond: command.cyclesPerSecond, last: performance.now(), owed: 0, timer: setTimeout(slice, SLICE_MS) };
        state([]);
        break;
      case "pause":
        pause();
        state([]);
        break;
      case "step":
        pause();
        state(hasCircuit ? JSON.parse(engine.step_cycle()) : []);
        break;
      case "reset":
        pause();
        state(hasCircuit ? JSON.parse(engine.reset()) : []);
        break;
    }
  } catch (error) {
    reply({ type: "error", message: String(error), ...(command.type === "load" && !answered && { load: true as const }) });
  }
};
