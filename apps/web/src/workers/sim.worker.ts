import init, { and_gate } from "../generated/sim-wasm/sim_wasm.js";
import type { Command, Result } from "../simulation/protocol";

const reply = (result: Result) => postMessage(result);

// Every command awaits the same promise, so commands still run in arrival order.
const ready = init().then(
  () => reply({ type: "ready" }),
  (error: unknown) => reply({ type: "error", message: `failed to load engine: ${String(error)}` }),
);

onmessage = async (event: MessageEvent<Command>) => {
  await ready;
  const command = event.data;
  try {
    switch (command.type) {
      case "evalAnd":
        reply({ type: "andResult", a: command.a, b: command.b, out: and_gate(command.a, command.b) });
        break;
    }
  } catch (error) {
    reply({ type: "error", message: String(error) });
  }
};
