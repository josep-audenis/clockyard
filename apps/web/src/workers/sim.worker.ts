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

const state = (diagnostics: Diagnostic[]) => reply({ type: "state", nets: engine?.nets() ?? new Uint32Array(), diagnostics });

onmessage = async (event: MessageEvent<Command>) => {
  await ready;
  // Load failure was already reported; calling into the uninitialised module would replace that message.
  if (!engine) return;
  const command = event.data;
  try {
    switch (command.type) {
      case "load": {
        // The initial settle's result goes with the state, so the next settle (e.g. restored switch positions) replaces it.
        const { runtime, ...loaded } = JSON.parse(engine.load(JSON.stringify(command.circuit)));
        hasCircuit = loaded.netCount > 0;
        reply({ type: "loaded", ...loaded });
        state(runtime);
        break;
      }
      case "setInput":
        // After validation errors there is nothing to set; the client re-sends inputs with the next load.
        if (hasCircuit) state(JSON.parse(engine.set_input(command.component, command.value)));
        break;
    }
  } catch (error) {
    reply({ type: "error", message: String(error) });
  }
};
