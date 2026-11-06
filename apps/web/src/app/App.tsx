import { useEffect, useRef } from "react";
import { mountCanvas } from "../canvas/scene";
import type { ComponentKind } from "../editor/document";
import { useEditor } from "../editor/store";
import { connectEngine, useSim } from "../simulation/sync";

const GATES: ComponentKind[] = ["not", "and", "nand", "or", "nor", "xor", "xnor"];
const LIBRARY: { title: string; parts: { kind: ComponentKind; name: string }[] }[] = [
  { title: "Inputs", parts: [{ kind: "switch", name: "Switch" }] },
  { title: "Outputs", parts: [{ kind: "led", name: "LED" }] },
  { title: "Gates", parts: GATES.map((kind) => ({ kind, name: kind.toUpperCase() })) },
];

export function App() {
  useEffect(() => connectEngine(), []);

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
      </header>
      <div className="workspace">
        <PartsLibrary />
        <Canvas />
      </div>
      <StatusBar />
    </div>
  );
}

function PartsLibrary() {
  const armed = useEditor((s) => s.armed);
  const arm = useEditor((s) => s.arm);
  return (
    <aside className="parts" aria-label="Parts">
      {LIBRARY.map(({ title, parts }) => (
        <section key={title} className="panel">
          <h2 className="type-heading panel-title">{title.toUpperCase()}</h2>
          <div className="part-grid">
            {parts.map(({ kind, name }) => (
              <button
                key={kind}
                type="button"
                className="part-tile type-label"
                aria-pressed={armed === kind}
                onClick={() => arm(armed === kind ? null : kind)}
              >
                {name}
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="type-caption parts-hint">Pick a part, then click the canvas to place it.</p>
    </aside>
  );
}

function Canvas() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    // React may unmount before Pixi finishes its async start-up.
    mountCanvas(element).then(
      (stop) => (disposed ? stop() : (dispose = stop)),
      (error: unknown) => (element.textContent = `Canvas failed to start: ${String(error)}`),
    );
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);
  return <main ref={host} className="canvas-host" aria-label="Circuit canvas" />;
}

// Plain sentences for the status bar; the engine's messages name opaque IDs, which the canvas highlights instead.
const PLAIN: Record<string, string> = {
  outputToOutput: "A wire connects two outputs.",
  inputToInput: "A wire connects two inputs, so nothing drives it.",
  multipleDrivers: "An input has more than one driver.",
  unconnectedInput: "An input is unconnected and reads 0.",
  unstable: "The circuit did not settle: a loop keeps oscillating.",
};

function StatusBar() {
  const status = useSim((s) => s.status);
  const error = useSim((s) => s.error);
  const loaded = useSim((s) => s.loaded);
  const runtime = useSim((s) => s.runtime);
  const empty = useEditor((s) => s.circuit.components.length === 0);

  const diagnostics = [...(loaded?.diagnostics ?? []), ...runtime];
  const errors = diagnostics.filter((d) => d.severity === "error");
  const [state, tone] =
    status === "error"
      ? ["Engine error", "danger"]
      : status === "loading"
        ? ["Starting", "muted"]
        : errors.some((d) => d.code === "unstable")
          ? ["Unstable", "danger"]
          : errors.length > 0
            ? ["Invalid", "danger"]
            : empty
              ? ["No circuit", "muted"]
              : ["Settled", "ok"];
  const first = errors[0] ?? diagnostics[0];
  const message =
    status === "error"
      ? error
      : first && `${PLAIN[first.code] ?? first.message}${diagnostics.length > 1 ? ` (+${diagnostics.length - 1} more)` : ""}`;

  return (
    <footer className="statusbar" role="status">
      <span className={`status-state status-${tone}`}>
        <span className="status-dot" aria-hidden="true" />
        {state}
      </span>
      <span className="status-message" title={diagnostics.map((d) => d.message).join("\n")}>
        {message}
      </span>
    </footer>
  );
}
