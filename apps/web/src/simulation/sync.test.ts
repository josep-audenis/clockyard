import { expect, test, vi } from "vitest";
import type { Command, Result } from "./protocol";

// The worker stands in as a callback: the test plays its replies.
const worker = vi.hoisted(() => ({ reply: (_: Result) => {}, sent: [] as Command[] }));
vi.mock("./client", () => ({
  startSimulation: (onResult: (result: Result) => void) => {
    worker.reply = onResult;
    return { send: (command: Command) => worker.sent.push(command), dispose: () => {} };
  },
}));

const { connectEngine, useSim } = await import("./sync");

test("a load the engine fails on answers that load: the error shows, nothing stays loaded or pending", () => {
  const stop = connectEngine();
  expect(worker.sent.map((c) => c.type)).toEqual(["load"]);
  expect(useSim.getState().stale).toBe(true);
  worker.reply({ type: "error", message: "bad description", load: true });
  expect(useSim.getState()).toMatchObject({ status: "error", error: "bad description", loaded: null, nets: null, runtime: [], stale: false });
  // An error from another command leaves the result alone.
  worker.reply({ type: "error", message: "switch value" });
  expect(useSim.getState()).toMatchObject({ error: "switch value", stale: false });
  stop();
});