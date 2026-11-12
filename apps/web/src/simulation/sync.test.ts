// sync.ts imports the browser client (Worker), which the mock replaces at run time but tsc still reads.
/// <reference lib="dom" />
import { expect, test, vi } from "vitest";
import type { Command, Result } from "./protocol";

// The worker stands in as a callback: the test plays its replies.
const worker = vi.hoisted(() => ({ reply: (() => {}) as (result: Result) => void, sent: [] as Command[] }));
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
test("assembler requests resolve from the replies carrying their request numbers, in any order (ADR 0019)", async () => {
  const { assemble, disassemble } = await import("./sync");
  const stop = connectEngine();
  worker.sent.length = 0;
  const words = assemble("LDI 5");
  const lines = disassemble([0x1005]);
  const [first, second] = worker.sent as { request: number }[];
  // Answered out of order: each promise still gets its own reply.
  worker.reply({ type: "disassembled", request: second?.request ?? -1, lines: ["LDI 5"] });
  worker.reply({ type: "assembled", request: first?.request ?? -1, words: [0x1005], errors: [] });
  await expect(words).resolves.toEqual({ type: "assembled", request: first?.request, words: [0x1005], errors: [] });
  await expect(lines).resolves.toEqual(["LDI 5"]);
  stop();
});
