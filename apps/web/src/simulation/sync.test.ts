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
const { useEditor } = await import("../editor/store");

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
  vi.advanceTimersByTime(0);
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

test("why a run stopped is the worker's latest word on it, and a pause gives none (ADR 0021)", () => {
  vi.useFakeTimers();
  const stop = connectEngine();
  // Each state is applied once the messages already waiting are handled (ADR 0030).
  const state = (running: boolean, stopped?: Extract<Result, { type: "state" }>["stopped"]) => {
    worker.reply({ type: "state", nets: new Uint32Array(), diagnostics: [], time: 0, running, ...(stopped && { stopped }) });
    vi.runAllTimers();
  };
  state(true);
  state(false, { reason: "lit", led: "l" });
  expect(useSim.getState()).toMatchObject({ running: false, stopped: { reason: "lit", led: "l" } });
  // The worker repeats it with later states (a switch flipped) and drops it after a command or a load.
  state(false, { reason: "lit", led: "l" });
  expect(useSim.getState().stopped).toEqual({ reason: "lit", led: "l" });
  state(false);
  expect(useSim.getState().stopped).toBeNull();
  // Paused by the user: the worker says nothing, so neither does the status bar.
  state(true);
  state(false);
  expect(useSim.getState().stopped).toBeNull();
  stop();
  vi.useRealTimers();
});

test("states that arrive faster than the page shows them are applied once, as the latest; one from before a load is not (ADR 0030)", () => {
  vi.useFakeTimers();
  const editor = useEditor.getState();
  const stop = connectEngine();
  worker.reply({ type: "loaded", portNets: {}, wireNets: {} } as unknown as Result);
  const state = (time: number) => ({ type: "state", nets: new Uint32Array([time]), diagnostics: [], time, running: true }) as unknown as Result;
  worker.reply(state(10));
  vi.runAllTimers();
  const epoch = useSim.getState().epoch;
  const applied: number[] = [];
  const unsubscribe = useSim.subscribe((s, before) => {
    if (s.time !== before.time) applied.push(s.time);
  });
  // A backlog: only its latest is shown. A reset inside it (time back to 0) still counts a new epoch.
  for (const time of [12, 0, 4]) worker.reply(state(time));
  vi.runAllTimers();
  expect(applied).toEqual([4]);
  expect(useSim.getState()).toMatchObject({ time: 4, epoch: epoch + 1, running: true });
  // A state waiting when a load is sent describes the circuit before it: its nets are not shown.
  worker.reply(state(5));
  useEditor.setState({ circuit: { components: [], junctions: [], wires: [{ id: "x", from: { junction: "a" }, to: { junction: "b" } }] } });
  vi.runAllTimers();
  expect(useSim.getState().time).toBe(4);
  unsubscribe();

  // The load answered, then its states: a new circuit is a new epoch, even when its time is not below the last shown.
  worker.reply({ type: "loaded", portNets: {}, wireNets: {} } as unknown as Result);
  const before = useSim.getState().epoch;
  worker.reply(state(7));
  vi.runAllTimers();
  expect(useSim.getState()).toMatchObject({ time: 7, epoch: before + 1 });

  // Any other message applies a waiting state first: an error after a state stays the latest word.
  worker.reply(state(9));
  worker.reply({ type: "error", message: "boom", running: false });
  vi.runAllTimers();
  expect(useSim.getState()).toMatchObject({ time: 9, running: false, status: "error", error: "boom" });

  // A state still waiting when the engine stops is not shown.
  worker.reply(state(11));
  stop();
  vi.runAllTimers();
  expect(useSim.getState().time).toBe(9);
  useEditor.setState(editor, true);
  vi.useRealTimers();
});

test("waveforms: watch follows the load it belongs to, a sent load drops the record, and so does the last unwatch (ADR 0026)", () => {
  vi.useFakeTimers();
  const before = useEditor.getState();
  const stop = connectEngine();
  worker.reply({ type: "loaded", portNets: {}, wireNets: {} } as unknown as Result);
  worker.sent.length = 0;
  const waves = (time: number) => ({ type: "waves", time, nets: [1], traces: [new Float64Array([0, 1])] }) as Result;
  const circuit = {
    components: [
      { id: "s", kind: "switch" as const, position: { x: 0, y: 0 }, rotation: 0 as const, props: {} },
      { id: "l", kind: "led" as const, position: { x: 4, y: 0 }, rotation: 0 as const, props: {} },
    ],
    junctions: [],
    wires: [{ id: "w", from: { component: "s", port: "out" }, to: { component: "l", port: "in" } }],
  };

  // A new circuit and a watch in one change: the load goes first, so the worker resolves the wire in it.
  useEditor.setState({ circuit, watches: ["w", "gone"] });
  expect(worker.sent.map((c) => c.type)).toEqual(["load", "watch"]);
  expect(worker.sent[1]).toEqual({ type: "watch", wires: ["w"] });
  // Read once a frame; a reply while the load is unanswered describes the circuit before it.
  vi.advanceTimersByTime(20);
  expect(worker.sent.at(-1)).toEqual({ type: "readWaves" });
  worker.reply(waves(3));
  expect(useSim.getState().waves).toBeNull();
  worker.reply({ type: "loaded", portNets: {}, wireNets: { w: 1 } } as unknown as Result);
  worker.reply(waves(4));
  expect(useSim.getState().waves?.time).toBe(4);

  // An edit sends a load: the old record goes at once.
  useEditor.setState({ circuit: { ...circuit, components: circuit.components.slice(0, 1), wires: [] } });
  expect(useSim.getState().waves).toBeNull();
  // The wire is gone with it, so nothing is watched any more.
  expect(worker.sent.at(-1)).toEqual({ type: "watch", wires: [] });
  worker.reply({ type: "loaded", portNets: {}, wireNets: {} } as unknown as Result);
  worker.reply(waves(5));
  expect(useSim.getState().waves).toBeNull();

  // Time going back (a load or a reset) counts a new epoch.
  const state = (time: number) => ({ type: "state", nets: new Uint32Array(1), diagnostics: [], time, running: false }) as unknown as Result;
  worker.reply(state(6));
  vi.runAllTimers();
  const epoch = useSim.getState().epoch;
  worker.reply(state(8));
  vi.runAllTimers();
  expect(useSim.getState().epoch).toBe(epoch);
  worker.reply(state(0));
  vi.runAllTimers();
  expect(useSim.getState().epoch).toBe(epoch + 1);

  stop();
  useEditor.setState(before, true);
  vi.useRealTimers();
});
