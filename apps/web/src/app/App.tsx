import { useEffect, useRef, useState } from "react";
import { startSimulation, type SimClient } from "../simulation/client";
import type { Result } from "../simulation/protocol";

type Engine = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };
type AndResult = Extract<Result, { type: "andResult" }>;

const bit = (value: boolean) => (value ? "1" : "0");

export function App() {
  const [engine, setEngine] = useState<Engine>({ status: "loading" });
  const [inputs, setInputs] = useState({ a: false, b: false });
  const [result, setResult] = useState<AndResult | null>(null);
  const sim = useRef<SimClient | null>(null);

  useEffect(() => {
    const client = startSimulation((message) => {
      if (message.type === "ready") setEngine({ status: "ready" });
      else if (message.type === "error") setEngine({ status: "error", message: message.message });
      else setResult(message);
    });
    sim.current = client;
    return () => client.dispose();
  }, []);

  useEffect(() => {
    sim.current?.send({ type: "evalAnd", ...inputs });
  }, [inputs]);

  // Only show an output the engine computed for the inputs currently shown.
  const out = result && result.a === inputs.a && result.b === inputs.b ? result.out : null;

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
        <section className="probe" aria-label="Engine round trip">
          <h1 className="type-heading">PHASE 0 · ENGINE ROUND TRIP</h1>
          <div className="probe-row">
            {(["a", "b"] as const).map((name) => (
              <button
                key={name}
                type="button"
                className="switch"
                aria-pressed={inputs[name]}
                onClick={() => setInputs((current) => ({ ...current, [name]: !current[name] }))}
              >
                <span className="type-label">{name.toUpperCase()}</span>
                <span className="type-value">{bit(inputs[name])}</span>
              </button>
            ))}
            <span className="gate type-value">AND</span>
            <output className="led type-display" data-high={out === true} aria-label="A AND B">
              {out === null ? "–" : bit(out)}
            </output>
          </div>
          <p className="type-caption caption">Computed in Rust (sim-core) through WebAssembly in a Web Worker.</p>
        </section>
      </main>
    </div>
  );
}
