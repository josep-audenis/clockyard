import { useEffect, useRef, useState } from "react";
import { project, type CircuitDocument } from "../editor/document";
import { startSimulation, type SimClient } from "../simulation/client";
import type { Result } from "../simulation/protocol";

type Engine = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };
type Loaded = Extract<Result, { type: "loaded" }>;

// Fixed demo until the canvas editor lands; the engine sees only its projection.
const at = (x: number, y: number) => ({ position: { x, y }, rotation: 0 as const, props: {} });
const DEMO: CircuitDocument = {
  format: "clockyard",
  version: 1,
  metadata: { name: "AND demo", createdAt: "2026-11-06T00:00:00Z", modifiedAt: "2026-11-06T00:00:00Z" },
  circuit: {
    components: [
      { id: "a", kind: "switch", ...at(0, 0) },
      { id: "b", kind: "switch", ...at(0, 2) },
      { id: "and", kind: "and", ...at(4, 1) },
      { id: "led", kind: "led", ...at(8, 1) },
    ],
    wires: [
      { id: "w-a", from: { component: "a", port: "out" }, to: { component: "and", port: "a" } },
      { id: "w-b", from: { component: "b", port: "out" }, to: { component: "and", port: "b" } },
      { id: "w-out", from: { component: "and", port: "out" }, to: { component: "led", port: "in" } },
    ],
  },
};

export function App() {
  const [engine, setEngine] = useState<Engine>({ status: "loading" });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nets, setNets] = useState<Uint8Array | null>(null);
  const sim = useRef<SimClient | null>(null);

  useEffect(() => {
    const client = startSimulation((message) => {
      if (message.type === "ready") setEngine({ status: "ready" });
      else if (message.type === "error") setEngine({ status: "error", message: message.message });
      else if (message.type === "loaded") setLoaded(message);
      else setNets(message.nets);
    });
    client.send({ type: "load", circuit: project(DEMO.circuit) });
    sim.current = client;
    return () => client.dispose();
  }, []);

  // Every value shown is read from the engine's nets; null until the engine has replied.
  const value = (component: string, port: string) => {
    const net = loaded?.portNets[component]?.[port];
    return net === undefined ? null : (nets?.[net] ?? null);
  };
  const out = value("led", "in");

  return (
    <div className="shell">
      <header className="toolbar">
        <span className="wordmark">
          {/* The mark inline on tokens so it follows the theme; fixed-ink copies live in docs/assets. */}
          <svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true">
            <rect width="64" height="64" rx="6" fill="var(--bench)" stroke="var(--line)" strokeWidth="2" />
            <path d="M44 48H16" fill="none" stroke="var(--signal-low)" strokeWidth="5" strokeLinecap="round" />
            <path d="M16 48V16H47" fill="none" stroke="var(--signal-high)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="48" cy="16" r="5.5" fill="var(--signal-high)" />
            <circle cx="48" cy="48" r="4.5" fill="var(--bench)" stroke="var(--signal-low)" strokeWidth="3" />
          </svg>
          Clockyard
        </span>
        <span className={`engine-status engine-${engine.status}`} role="status">
          engine: {engine.status === "error" ? `error — ${engine.message}` : engine.status}
        </span>
      </header>
      <main className="bench">
        <section className="probe" aria-label="Switches, AND gate and LED">
          <h1 className="type-heading">PHASE 1 · FIRST SLICE</h1>
          <div className="probe-row">
            {(["a", "b"] as const).map((name) => {
              const on = value(name, "out");
              return (
                <button
                  key={name}
                  type="button"
                  className="switch"
                  aria-pressed={on === 1}
                  disabled={on === null}
                  onClick={() => sim.current?.send({ type: "setInput", component: name, value: on === 1 ? 0 : 1 })}
                >
                  <span className="type-label">{name.toUpperCase()}</span>
                  <span className="type-value">{on ?? "–"}</span>
                </button>
              );
            })}
            <span className="gate type-value">AND</span>
            <output className="led type-display" data-high={out === 1} aria-label="A AND B">
              {out ?? "–"}
            </output>
          </div>
          {loaded?.diagnostics.map((d, i) => (
            <p key={i} className={`type-caption diagnostic diagnostic-${d.severity}`}>
              {d.message}
            </p>
          ))}
          <p className="type-caption caption">Netlist compiled and settled in Rust (sim-core) through WebAssembly in a Web Worker.</p>
        </section>
      </main>
    </div>
  );
}
