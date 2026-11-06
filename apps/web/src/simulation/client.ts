import type { Command, Result } from "./protocol";

export type SimClient = { send: (command: Command) => void; dispose: () => void };

export function startSimulation(onResult: (result: Result) => void): SimClient {
  const worker = new Worker(new URL("../workers/sim.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<Result>) => onResult(event.data);
  worker.onerror = (event) => onResult({ type: "error", message: event.message || "worker failed to start" });
  return {
    send: (command) => worker.postMessage(command),
    dispose: () => worker.terminate(),
  };
}
