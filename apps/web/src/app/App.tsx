import { useEffect, useId, useRef, useState } from "react";
import { definitionName } from "../canvas/layout";
import { mountCanvas } from "../canvas/scene";
import { contains, MAX_LABEL, normalizeLabel, type CircuitComponent, type ComponentKind, type PartKind } from "../editor/document";
import { liveDefinitions, mainCircuit, useEditor } from "../editor/store";
import { connectEngine, useSim } from "../simulation/sync";
import { FORMAT_VERSION, parseDocument, serializeDocument } from "../storage/file";

type Part = { kind: ComponentKind; name: string; key?: string };
// Shortcut letters follow the design system's PartTile spec.
const LIBRARY: { title: string; parts: Part[] }[] = [
  { title: "Inputs", parts: [{ kind: "switch", name: "Switch", key: "S" }] },
  { title: "Outputs", parts: [{ kind: "led", name: "LED", key: "L" }] },
  {
    title: "Gates",
    parts: [
      { kind: "not", name: "NOT", key: "N" },
      { kind: "and", name: "AND", key: "A" },
      { kind: "nand", name: "NAND" },
      { kind: "or", name: "OR", key: "O" },
      { kind: "nor", name: "NOR" },
      { kind: "xor", name: "XOR", key: "X" },
      { kind: "xnor", name: "XNOR" },
    ],
  },
];
const NAMES = new Map(LIBRARY.flatMap(({ parts }) => parts.map(({ kind, name }) => [kind, name] as const)));
/** What a part is called: its kind, or for a custom component its definition's name. */
const kindName = (part: Pick<CircuitComponent, "kind" | "definition">) =>
  part.kind === "custom" ? (definitionName(part.definition) ?? "Component") : NAMES.get(part.kind);
const SHORTCUTS = new Map(LIBRARY.flatMap(({ parts }) => parts.flatMap(({ kind, key }) => (key ? [[key, kind] as const] : []))));
/** The platform's name for the shortcut modifier (design system Kbd rule). */
const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";
/** Larger files are refused before reading; real circuits are far smaller. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
        <Breadcrumb />
        <FileActions />
      </header>
      <div className="workspace">
        <PartsLibrary />
        <Canvas />
        <Inspector />
        <Readout />
      </div>
      <StatusBar />
    </div>
  );
}

function FileActions() {
  const name = useEditor((s) => s.metadata.name);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const exportFile = () => {
    const state = useEditor.getState();
    const modifiedAt = new Date().toISOString();
    // The whole document, whichever sheet is open: the main circuit and every definition as it is now.
    const text = serializeDocument({
      format: "clockyard",
      version: FORMAT_VERSION,
      metadata: { ...state.metadata, modifiedAt },
      circuit: mainCircuit(state),
      definitions: liveDefinitions(state),
    });
    const { metadata } = state;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${slug(metadata.name)}.clockyard.json` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
    setError(null);
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) return setError(`Could not open ${file.name}: it is too large to be a Clockyard circuit.`);
    const result = parseDocument(await file.text());
    if (!result.ok) return setError(`Could not open ${file.name}: ${result.error}`);
    const state = useEditor.getState();
    const replacing = mainCircuit(state).components.length > 0 || state.definitions.length > 0;
    if (replacing && !window.confirm("Replace the current circuit? Changes since your last export will be lost.")) return;
    useEditor.getState().load(result.document);
    setError(null);
  };

  return (
    <div className="file-actions">
      <span className="project-name type-label">{name}</span>
      {error && (
        <span className="file-error type-caption" role="alert" title={error}>
          {error}
        </span>
      )}
      <button type="button" className="button type-label" onClick={() => picker.current?.click()}>
        Import
      </button>
      <button type="button" className="button type-label" onClick={exportFile}>
        Export
      </button>
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="import-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // so picking the same file again still fires
          if (file) void importFile(file);
        }}
      />
    </div>
  );
}

const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "circuit";

function PartsLibrary() {
  const armed = useEditor((s) => s.armed);
  const arm = useEditor((s) => s.arm);
  const armedDefinition = useEditor((s) => s.armedDefinition);
  const armChip = useEditor((s) => s.armChip);
  const sheet = useEditor((s) => s.sheet);
  // Names and nesting only: the open sheet's own contents never change which chips may go on it.
  const definitions = useEditor((s) => s.definitions);
  // On a definition's sheet, neither it nor anything containing it may be placed: that would contain itself.
  const chips = definitions.filter((d) => !sheet || !contains(definitions, d.id, sheet));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const kind = SHORTCUTS.get(e.key.toUpperCase());
      if (kind) useEditor.getState().arm(kind);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <aside className="parts" aria-label="Parts">
      {LIBRARY.map(({ title, parts }) => (
        <section key={title} className="panel">
          <h2 className="type-heading panel-title">{title.toUpperCase()}</h2>
          <div className="part-grid">
            {parts.map(({ kind, name, key }) => (
              <button
                key={kind}
                type="button"
                className="part-tile type-label"
                aria-pressed={armed === kind}
                aria-keyshortcuts={key}
                onClick={() => arm(armed === kind ? null : kind)}
              >
                {name}
                {key && <kbd className="kbd">{key}</kbd>}
              </button>
            ))}
          </div>
        </section>
      ))}
      <section className="panel">
        <h2 className="type-heading panel-title">CHIPS</h2>
        {chips.length === 0 ? (
          <p className="type-caption parts-empty">
            Select a circuit with labelled switches and LEDs, then use Make component in the inspector.
          </p>
        ) : (
          <div className="part-grid">
            {chips.map((d) => {
              const on = armed === "custom" && armedDefinition === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  className="part-tile type-label"
                  aria-pressed={on}
                  onClick={() => (on ? arm(null) : armChip(d.id))}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        )}
      </section>
      <p className="type-caption parts-hint">
        Pick a part or press its key, then click the canvas to place it. Esc cancels. Drag from a port to wire it;
        drop on a wire to branch it; drag a wire to reshape it. <kbd className="kbd">R</kbd> rotates, <kbd className="kbd">Shift</kbd>{" "}
        <kbd className="kbd">R</kbd> back. Drag empty space to select, Shift
        to add; hold Space and drag to pan. <kbd className="kbd">{MOD}</kbd> <kbd className="kbd">C</kbd>{" "}
        <kbd className="kbd">X</kbd> <kbd className="kbd">V</kbd> <kbd className="kbd">D</kbd> <kbd className="kbd">A</kbd>{" "}
        copy, cut, paste, duplicate and select all. <kbd className="kbd">{MOD}</kbd>{" "}
        <kbd className="kbd">Z</kbd> undoes, <kbd className="kbd">{MOD}</kbd> <kbd className="kbd">Shift</kbd>{" "}
        <kbd className="kbd">Z</kbd> redoes.
      </p>
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

function Inspector() {
  const selection = useEditor((s) => s.selection);
  const part = useEditor((s) => (s.selection.length === 1 ? s.circuit.components.find((c) => c.id === s.selection[0]) : undefined));
  const wire = useEditor((s) => (s.selection.length === 1 ? s.circuit.wires.find((w) => w.id === s.selection[0]) : undefined));
  const resetRoute = useEditor((s) => s.resetRoute);
  return (
    <aside className="inspector" aria-label="Inspector">
      <section className="panel">
        <h2 className="type-heading panel-title">PROPERTIES</h2>
        {part ? (
          // Remounts for another part, or when undo changes the label, so the field shows the saved value.
          <PartProperties key={`${part.id}:${part.props.label ?? ""}`} part={part} />
        ) : wire ? (
          <div className="inspector-body">
            <p className="type-label inspector-kind">Wire</p>
            <p className="type-body inspector-empty">
              {wire.bends ? "Route shaped by hand." : "Routed automatically. Drag a segment to reshape it."}
            </p>
            {wire.bends && (
              <button type="button" className="button type-label" onClick={() => resetRoute(wire.id)}>
                Reset route
              </button>
            )}
          </div>
        ) : selection.length > 1 ? (
          <MakeComponent count={selection.length} />
        ) : (
          <p className="type-body inspector-empty">
            {selection.length === 0 ? "Select a component to edit its properties." : "Junctions have no properties."}
          </p>
        )}
      </section>
    </aside>
  );
}

/** For a selection: turn it into a reusable component (ADR 0012). */
function MakeComponent({ count }: { count: number }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="inspector-body">
      <p className="type-body inspector-empty">{`${count} items selected.`}</p>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          Component name
        </label>
        <input
          id={`${id}-name`}
          aria-describedby={`${id}-hint`}
          className="input"
          value={name}
          maxLength={MAX_LABEL}
          spellCheck={false}
          placeholder="Full adder"
          onChange={(e) => setName(e.target.value)}
        />
        <p id={`${id}-hint`} className={`field-hint${error ? " field-error" : ""}`} role={error ? "alert" : undefined}>
          {error ?? "Its labelled switches become inputs and its labelled LEDs outputs."}
        </p>
      </div>
      <button type="button" className="button type-label" onClick={() => setError(useEditor.getState().makeComponent(name))}>
        Make component
      </button>
    </div>
  );
}

/** Where the editor is: the main circuit, or a definition open on its own sheet, with the way back. */
function Breadcrumb() {
  const sheet = useEditor((s) => s.sheet);
  const closeSheet = useEditor((s) => s.closeSheet);
  const name = useEditor((s) => s.definitions.find((d) => d.id === s.sheet)?.name);
  if (!sheet) return null;
  return (
    <nav className="breadcrumb type-label" aria-label="Sheet">
      <button type="button" className="button type-label" onClick={closeSheet}>
        Main circuit
      </button>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{name}</span>
    </nav>
  );
}

const PIN_HINT: Partial<Record<PartKind, string>> = {
  switch: "Names this input pin of the circuit.",
  led: "Names this output pin of the circuit.",
};

function PartProperties({ part }: { part: CircuitComponent }) {
  const saved = part.props.label ?? "";
  const [draft, setDraft] = useState(saved);
  /** Escape leaves the field without saving. */
  const cancelled = useRef(false);
  const id = useId();
  return (
    <div className="inspector-body">
      <p className="type-label inspector-kind">{kindName(part)}</p>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-label`}>
          Label
        </label>
        <input
          id={`${id}-label`}
          aria-describedby={`${id}-hint`}
          className="input"
          value={draft}
          maxLength={MAX_LABEL}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          // Committed on blur (Enter blurs), as one undoable edit: the design system's Field rule.
          onBlur={() => {
            if (!cancelled.current) useEditor.getState().setLabel(part.id, draft);
            cancelled.current = false;
            // Show what was stored: when trimming leaves the label unchanged, nothing remounts the field.
            setDraft((value) => (normalizeLabel(value) === saved ? saved : value));
          }}
          onKeyDown={(e) => {
            // Enter and Escape during IME composition pick or dismiss a candidate; they are not ours.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key !== "Enter" && e.key !== "Escape") return;
            if (e.key === "Escape") {
              cancelled.current = true;
              setDraft(saved);
            }
            e.currentTarget.blur();
          }}
        />
        <p id={`${id}-hint`} className="field-hint">
          {PIN_HINT[part.kind] ?? "Shown under the part on the canvas."}
        </p>
      </div>
      {part.kind === "custom" && part.definition && (
        <button
          type="button"
          className="button type-label"
          onClick={() => part.definition && useEditor.getState().openSheet(part.definition)}
        >
          Edit component
        </button>
      )}
    </div>
  );
}

/** A part's label, or its kind and position among parts of that kind ("Switch 2"). */
function partName(components: CircuitComponent[], part: CircuitComponent) {
  if (part.props.label) return `${kindName(part)} ${part.props.label}`;
  const same = components.filter((c) => c.kind === part.kind && c.definition === part.definition);
  return `${kindName(part)} ${same.indexOf(part) + 1}`;
}

/** The canvas is pixels only; this lists switch and LED states for screen readers (and browser tests). */
function Readout() {
  const components = useEditor((s) => s.circuit.components);
  const loaded = useSim((s) => s.loaded);
  const nets = useSim((s) => s.nets);
  const stale = useSim((s) => s.stale);
  const value = (id: string, port: string) => {
    const net = loaded?.portNets[id]?.[port];
    return stale || !nets || net === undefined ? "unknown" : nets[net] === 1 ? "on" : "off";
  };
  const switches = components.filter((c) => c.kind === "switch");
  const leds = components.filter((c) => c.kind === "led");
  return (
    <ul className="visually-hidden" aria-label="Inputs and outputs">
      {switches.map((c) => (
        <li key={c.id}>{`${partName(components, c)}: ${value(c.id, "out")}`}</li>
      ))}
      {leds.map((c) => (
        <li key={c.id}>{`${partName(components, c)}: ${value(c.id, "in")}`}</li>
      ))}
    </ul>
  );
}

// Plain sentences for the status bar; the engine's messages name opaque IDs, which the canvas highlights instead.
const PLAIN: Record<string, string> = {
  outputToOutput: "Outputs are wired together.",
  inputToInput: "Inputs are wired together with no output driving them.",
  multipleDrivers: "An input has more than one driver.",
  unconnectedInput: "An input is unconnected and reads 0.",
  unstable: "The circuit did not settle: a loop keeps oscillating.",
  unknownDefinition: "A component's definition is missing.",
  recursiveDefinition: "A component contains itself, so it cannot be built.",
  invalidPin: "A component has an unnamed or repeated pin: label each of its switches and LEDs once.",
  tooLarge: "The circuit is too large once its components are expanded.",
};

function StatusBar() {
  const status = useSim((s) => s.status);
  const error = useSim((s) => s.error);
  const loaded = useSim((s) => s.loaded);
  const runtime = useSim((s) => s.runtime);
  const components = useEditor((s) => s.circuit.components);
  const empty = components.length === 0;

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
  // Name the labelled parts involved; unlabelled ones are highlighted on the canvas.
  const named = first
    ? components.filter((c) => c.props.label && first.ids.includes(c.id)).map((c) => partName(components, c))
    : [];
  const message =
    status === "error"
      ? error
      : first &&
        `${PLAIN[first.code] ?? first.message}${named.length > 0 ? ` (${named.join(", ")})` : ""}${diagnostics.length > 1 ? ` (+${diagnostics.length - 1} more)` : ""}`;

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
