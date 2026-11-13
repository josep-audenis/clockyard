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

const { connectEngine, useSim, watchMemory } = await import("./sync");

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

test("an assembler request never waits forever: no engine, a failed request, or the engine stopping", async () => {
  const { assemble, disassemble } = await import("./sync");
  // Before the engine starts: answered at once, as an error with no line.
  await expect(assemble("NOP")).resolves.toEqual({ words: [], errors: [{ line: 0, message: "Could not assemble: the engine is not running." }] });
  const stop = connectEngine();
  worker.sent.length = 0;
  const failed = disassemble([1]);
  const { request } = worker.sent[0] as { request: number };
  worker.reply({ type: "error", message: "boom", request });
  await expect(failed).resolves.toBeNull();
  // A failed request is that request's business: the simulation's status is untouched.
  expect(useSim.getState().error).not.toBe("boom");
  const pending = assemble("NOP");
  stop();
  await expect(pending).resolves.toMatchObject({ words: [], errors: [{ line: 0 }] });
});

test("watched memories are read once a frame however many states arrive, a newly watched one at once; equal words keep their array (ADR 0021)", () => {
  vi.useFakeTimers();
  const stop = connectEngine();
  worker.reply({ type: "loaded", portNets: {}, wireNets: {} } as unknown as Result);
  const reads = () => worker.sent.filter((c) => c.type === "readMemory");
  worker.sent.length = 0;
  watchMemory(new Map([["s", 128]]));
  vi.advanceTimersByTime(20);
  expect(reads()).toEqual([{ type: "readMemory", component: "s", count: 128 }]);
  worker.sent.length = 0;
  watchMemory(new Map([["s", 128]])); // the same screens: nothing new to read
  const state = { type: "state", nets: new Uint32Array(1), diagnostics: [], time: 1, running: true } as unknown as Result;
  for (let i = 0; i < 3; i++) worker.reply(state);
  expect(reads()).toEqual([]);
  vi.advanceTimersByTime(20);
  expect(reads()).toHaveLength(1);
  worker.reply({ type: "memory", component: "s", words: new Uint32Array([1, 2]) });
  const first = useSim.getState().memory.s;
  worker.reply({ type: "memory", component: "s", words: new Uint32Array([1, 2]) });
  expect(useSim.getState().memory.s).toBe(first);
  worker.reply({ type: "memory", component: "s", words: new Uint32Array([1, 3]) });
  expect([...(useSim.getState().memory.s ?? [])]).toEqual([1, 3]);
  stop();
  vi.useRealTimers();
});

test("why a run stopped is kept until the next command, and a pause gives none (ADR 0021)", async () => {
  const { control } = await import("./sync");
  const stop = connectEngine();
  const state = (running: boolean, stopped?: Extract<Result, { type: "state" }>["stopped"]) =>
    worker.reply({ type: "state", nets: new Uint32Array(), diagnostics: [], time: 0, running, ...(stopped && { stopped }) });
  state(true);
  state(false, { reason: "lit", led: "l" });
  expect(useSim.getState()).toMatchObject({ running: false, stopped: { reason: "lit", led: "l" } });
  // Later states (a switch flipped) keep it; any command clears it.
  state(false);
  expect(useSim.getState().stopped).toEqual({ reason: "lit", led: "l" });
  control("step");
  expect(useSim.getState().stopped).toBeNull();
  // Paused by the user: the worker says nothing, so neither does the status bar.
  control("run");
  state(true);
  control("pause");
  state(false);
  expect(useSim.getState().stopped).toBeNull();
  stop();
});
