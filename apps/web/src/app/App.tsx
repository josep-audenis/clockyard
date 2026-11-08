import { useEffect, useId, useRef, useState } from "react";
import { definitionName } from "../canvas/layout";
import { mountCanvas, useCanvasHints } from "../canvas/scene";
import {
  contains,
  fieldsProblem,
  hex,
  isFielded,
  takesWidth,
  MAX_LABEL,
  MAX_WIDTH,
  maxValue,
  parseValue,
  showValue,
  type CircuitComponent,
  type Junction,
  type ComponentKind,
  type PartKind,
} from "../editor/document";
import { deleteRefusal, liveDefinitions, mainCircuit, useEditor } from "../editor/store";
import { connectEngine, control, setSpeed, SPEEDS, useSim } from "../simulation/sync";
import { FORMAT_VERSION, parseDocument, serializeDocument } from "../storage/file";

/** `label` is not a part: it places a named junction (ADR 0015). */
/** A parts-panel tile; `width` arms the part that wide (a Register is an 8-bit D flip-flop). */
type Part = { kind: ComponentKind | "label"; name: string; key?: string; width?: number };
// Shortcut letters follow the design system's PartTile spec.
const LIBRARY: { title: string; parts: Part[] }[] = [
  {
    title: "Inputs",
    parts: [
      { kind: "switch", name: "Switch", key: "S" },
      // The global clock (ADR 0017).
      { kind: "clock", name: "Clock" },
    ],
  },
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
  {
    // A bus taken apart into fields, or fields joined into a bus (ADR 0014).
    title: "Wiring",
    parts: [
      { kind: "split", name: "Splitter" },
      { kind: "merge", name: "Merger" },
      // A net label: junctions with the same name on a sheet are one net (ADR 0015).
      { kind: "label", name: "Label" },
    ],
  },
  {
    // One sized flip-flop kind; a register is a wide one (ADR 0017).
    title: "Memory",
    parts: [
      { kind: "dff", name: "D flip-flop" },
      { kind: "dff", name: "Register", width: 8 },
    ],
  },
];
const NAMES = new Map(LIBRARY.flatMap(({ parts }) => parts.flatMap(({ kind, name, width }) => (width ? [] : [[kind, name] as const]))));
/** What a part is called: its kind (a wide D flip-flop is a register), or for a custom component its definition's name. */
const kindName = (part: Pick<CircuitComponent, "kind" | "definition" | "props">) =>
  part.kind === "custom"
    ? (definitionName(part.definition) ?? "Component")
    : part.kind === "dff" && (part.props.width ?? 1) > 1
      ? "Register"
      : NAMES.get(part.kind);
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
        <RunControls />
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
  const armedLabel = useEditor((s) => s.armedLabel);
  const armedWidth = useEditor((s) => s.armedWidth);
  const armLabel = useEditor((s) => s.armLabel);
  const armedDefinition = useEditor((s) => s.armedDefinition);
  const armChip = useEditor((s) => s.armChip);
  const sheet = useEditor((s) => s.sheet);
  // Names and nesting only: the open sheet's own contents never change which chips may go on it.
  const definitions = useEditor((s) => s.definitions);
  // On a definition's sheet, neither it nor anything containing it may be placed: that would contain itself.
  const chips = definitions.filter((d) => !sheet || !contains(definitions, d.id, sheet));
  // The chip whose delete was refused; the reason is kept current, and goes once it no longer holds.
  const [refused, setRefused] = useState<string | null>(null);
  const error = useEditor((s) => (refused ? deleteRefusal(s, refused) : null));
  const deleteChip = (id: string, name: string) => {
    setRefused(id);
    if (deleteRefusal(useEditor.getState(), id) || !window.confirm(`Delete the component ${name}? This cannot be undone.`)) return;
    useEditor.getState().deleteDefinition(id);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const kind = SHORTCUTS.get(e.key.toUpperCase());
      if (kind && kind !== "label") useEditor.getState().arm(kind);
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
            {parts.map(({ kind, name, key, width = 1 }) => (
              <button
                key={name}
                type="button"
                className="part-tile type-label"
                aria-pressed={kind === "label" ? armedLabel : armed === kind && armedWidth === width}
                aria-keyshortcuts={key}
                onClick={() =>
                  kind === "label" ? armLabel(!armedLabel) : arm(armed === kind && armedWidth === width ? null : kind, width)
                }
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
          <ul className="chip-list">
            {chips.map((d) => {
              const on = armed === "custom" && armedDefinition === d.id;
              return (
                <li key={d.id} className="chip-row">
                  <button
                    type="button"
                    className="part-tile type-label"
                    aria-pressed={on}
                    onClick={() => (on ? arm(null) : armChip(d.id))}
                  >
                    {d.name}
                  </button>
                  <button
                    type="button"
                    className="chip-delete type-label"
                    aria-label={`Delete ${d.name}`}
                    title={`Delete ${d.name}`}
                    onClick={() => deleteChip(d.id, d.name)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="field-hint field-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <p className="type-caption parts-hint">
        Pick a part or press its key, then click the canvas to place it. Esc cancels. Drag from a port or junction to wire it (click a junction, then drag, to move it);
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
  const junction = useEditor((s) =>
    s.selection.length === 1 ? s.circuit.junctions.find((j) => j.id === s.selection[0]) : undefined,
  );
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
        ) : junction ? (
          <JunctionProperties key={`${junction.id}:${junction.name ?? ""}`} junction={junction} />
        ) : selection.length > 1 ? (
          <MakeComponent count={selection.length} />
        ) : (
          <p className="type-body inspector-empty">Select a component to edit its properties.</p>
        )}
      </section>
    </aside>
  );
}

/** A junction's name makes it a net label (ADR 0015); a new label's Name field takes focus. */
function JunctionProperties({ junction }: { junction: Junction }) {
  const focus = useCanvasHints((s) => s.focusValue === junction.id);
  return (
    <div className="inspector-body">
      <p className="type-label inspector-kind">{junction.name ? "Label" : "Junction"}</p>
      <CommitField
        label="Name"
        saved={junction.name ?? ""}
        hint="Junctions with the same name on this sheet are one net."
        focus={focus}
        // One undoable edit; clearing the name of a junction with no wires removes it.
        onCommit={(value) => useEditor.getState().setName(junction.id, value)}
      />
    </div>
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
          {error ?? "Its switches become inputs and its LEDs outputs, named by their labels. Wires crossing its edge become new pins."}
        </p>
      </div>
      <button
        type="button"
        className="button type-label"
        onClick={() => {
          // Wires crossing the selection become pins from the engine's nets (ADR 0016); no netlist while errors stand.
          const { stale, loaded } = useSim.getState();
          setError(useEditor.getState().makeComponent(name, { stale, nets: loaded && loaded.netCount > 0 ? loaded : null }));
        }}
      >
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

/**
 * A text field committed on blur (Enter blurs) and cancelled by Escape: the design system's Field rule.
 * Its parent remounts it (by `key`) when the stored value changes.
 */
function CommitField({
  label,
  saved,
  hint,
  onCommit,
  maxLength = MAX_LABEL,
  focus = false,
}: {
  label: string;
  saved: string;
  hint: string;
  onCommit: (value: string) => void;
  maxLength?: number;
  /** Takes the keyboard once, when the canvas hands it over (a just-placed label). */
  focus?: boolean;
}) {
  const [draft, setDraft] = useState(saved);
  /** Escape leaves the field without saving. */
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    input.current?.select();
    useCanvasHints.setState({ focusValue: null });
  }, [focus]);
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <input
        ref={input}
        id={`${id}-input`}
        aria-describedby={`${id}-hint`}
        className="input"
        value={draft}
        maxLength={maxLength}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!cancelled.current) onCommit(draft);
          cancelled.current = false;
          // Show what was stored: when normalizing leaves the value unchanged, nothing remounts the field.
          setDraft(saved);
        }}
        onKeyDown={(e) => {
          // Enter and Escape during IME composition pick or dismiss a candidate; they are not ours.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key !== "Enter" && e.key !== "Escape") return;
          if (e.key === "Escape") cancelled.current = true;
          e.currentTarget.blur();
        }}
      />
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
    </div>
  );
}

function PartProperties({ part }: { part: CircuitComponent }) {
  const name = useEditor((s) => s.definitions.find((d) => d.id === part.definition)?.name);
  return (
    <div className="inspector-body">
      <p className="type-label inspector-kind">{kindName(part)}</p>
      <CommitField
        label="Label"
        saved={part.props.label ?? ""}
        hint={PIN_HINT[part.kind] ?? "Shown under the part on the canvas."}
        // One undoable edit.
        onCommit={(value) => useEditor.getState().setLabel(part.id, value)}
      />
      {isFielded(part.kind) && (
        <CommitField
          key={`fields:${part.props.fields?.join()}`}
          label="Fields"
          saved={(part.props.fields ?? []).join(", ")}
          hint={fieldsHint(part.props.fields ?? [])}
          // One undoable edit; it also removes wires to fields that go. Invalid lists change nothing.
          // Room for 32 one-bit fields written "1, 1, …".
          maxLength={4 * MAX_WIDTH}
          onCommit={(value) => {
            // Digits only, as in Width: no 0x4, 1e1 or 4.0.
            const tokens = value.split(/[\s,]+/).filter(Boolean);
            const fields = tokens.every((t) => /^\d+$/.test(t)) ? tokens.map(Number) : [];
            if (!fieldsProblem(fields)) useEditor.getState().setFields(part.id, fields);
          }}
        />
      )}
      {takesWidth(part.kind) && (
        <CommitField
          key={`width:${part.props.width ?? 1}`}
          label="Width"
          saved={String(part.props.width ?? 1)}
          hint={`Bits on every port, 1 to ${MAX_WIDTH}.`}
          // One undoable edit; anything but a whole number in range leaves the width as it was.
          onCommit={(value) => /^\s*\d+\s*$/.test(value) && useEditor.getState().setWidth(part.id, Number(value))}
        />
      )}
      {part.kind === "switch" && (part.props.width ?? 1) > 1 && <ValueField part={part} />}
      {part.definition && name !== undefined && (
        <CommitField
          key={name}
          label="Component name"
          saved={name}
          hint="Renames the component everywhere it is used."
          onCommit={(value) => part.definition && useEditor.getState().renameDefinition(part.definition, value)}
        />
      )}
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

/** The Fields field's hint: what the list means and how wide the bus is. */
function fieldsHint(fields: number[]) {
  const total = fields.reduce((sum, f) => sum + f, 0);
  return `Field widths, lowest bits first, separated by commas: ${total} of ${MAX_WIDTH} bits.`;
}

/**
 * A wide switch's value (ADR 0014): decimal, 0x… or 0b…, committed on Enter or blur, Escape cancels,
 * ↑ and ↓ step by 1. Not an edit, like a toggle. Focused when the switch is clicked on the canvas.
 */
function ValueField({ part }: { part: CircuitComponent }) {
  const width = part.props.width ?? 1;
  const value = useEditor((s) => s.inputs[part.id] ?? 0);
  const focus = useCanvasHints((s) => s.focusValue === part.id);
  /** What is being typed; null shows the stored value. */
  const [draft, setDraft] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    input.current?.select();
    useCanvasHints.setState({ focusValue: null });
  }, [focus]);
  const set = (next: number) => {
    useEditor.getState().setInput(part.id, next);
    setDraft(null);
    setWrong(false);
  };
  const commit = () => {
    if (draft === null) return;
    const parsed = parseValue(draft, width);
    if (parsed === null) setWrong(true);
    else set(parsed);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-input`}>
        Value
      </label>
      <input
        ref={input}
        id={`${id}-input`}
        aria-describedby={`${id}-hint`}
        aria-invalid={wrong}
        className="input type-value"
        value={draft ?? String(value)}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // Leaving keeps a valid value and drops anything else, as other fields do.
          const parsed = draft === null ? null : parseValue(draft, width);
          if (parsed !== null) useEditor.getState().setInput(part.id, parsed);
          setDraft(null);
          setWrong(false);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(null);
            setWrong(false);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const from = (draft === null ? null : parseValue(draft, width)) ?? value;
            set(Math.min(Math.max(from + (e.key === "ArrowUp" ? 1 : -1), 0), maxValue(width)));
          }
        }}
      />
      <p id={`${id}-hint`} className={`field-hint${wrong ? " field-error" : ""}`} role={wrong ? "alert" : undefined}>
        {wrong
          ? `Not a value from 0 to ${maxValue(width)}.`
          : `${hex(value, width)}. Decimal, 0x… or 0b…; ↑ and ↓ step by 1.`}
      </p>
    </div>
  );
}

/** A part's label, or its kind and position among parts of that kind ("Switch 2"). */
function partName(components: CircuitComponent[], part: CircuitComponent) {
  if (part.props.label) return `${kindName(part)} ${part.props.label}`;
  // Numbered among parts called the same, so registers and 1-bit flip-flops count apart.
  const same = components.filter((c) => c.kind === part.kind && c.definition === part.definition && kindName(c) === kindName(part));
  return `${kindName(part)} ${same.indexOf(part) + 1}`;
}

/** The canvas is pixels only; this lists switch and LED states for screen readers (and browser tests). */
function Readout() {
  const components = useEditor((s) => s.circuit.components);
  const loaded = useSim((s) => s.loaded);
  const nets = useSim((s) => s.nets);
  const stale = useSim((s) => s.stale);
  const value = (part: CircuitComponent, port: string) => {
    const net = loaded?.portNets[part.id]?.[port];
    const bits = net === undefined ? undefined : nets?.[net];
    return stale || bits === undefined ? "unknown" : showValue(bits, part.props.width ?? 1);
  };
  const switches = components.filter((c) => c.kind === "switch");
  const leds = components.filter((c) => c.kind === "led");
  return (
    <ul className="visually-hidden" aria-label="Inputs and outputs">
      {switches.map((c) => (
        <li key={c.id}>{`${partName(components, c)}: ${value(c, "out")}`}</li>
      ))}
      {leds.map((c) => (
        <li key={c.id}>{`${partName(components, c)}: ${value(c, "in")}`}</li>
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
  widthMismatch: "Ports of different widths are wired together.",
  unmatchedLabel: "A label has no partner on this sheet.",
  invalidWidth: "A part has a width or fields the engine cannot use.",
  unknownDefinition: "A component's definition is missing.",
  recursiveDefinition: "A component contains itself, so it cannot be built.",
  invalidPin: "A component has an invalid pin.",
  unknownPort: "A wire ends at a port its part does not have.",
  tooLarge: "The circuit is too large once its components are expanded.",
  invalidId: "An ID contains a slash, which is kept for parts inside components.",
};

/** Run/Pause, Step, Reset and the run speed (ADR 0017): the worker runs the clock, the editor only asks. */
function RunControls() {
  const running = useSim((s) => s.running);
  const speed = useSim((s) => s.speed);
  return (
    <div className="run-controls" role="group" aria-label="Simulation">
      <button type="button" className="button" aria-pressed={running} onClick={() => control(running ? "pause" : "run")}>
        {running ? "Pause" : "Run"}
      </button>
      <button type="button" className="button" onClick={() => control("step")}>
        Step
      </button>
      <button type="button" className="button" onClick={() => control("reset")}>
        Reset
      </button>
      <label className="run-speed">
        <span className="visually-hidden">Speed</span>
        <select className="input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s.toLocaleString("en")} Hz
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function StatusBar() {
  const status = useSim((s) => s.status);
  const error = useSim((s) => s.error);
  const loaded = useSim((s) => s.loaded);
  const runtime = useSim((s) => s.runtime);
  const components = useEditor((s) => s.circuit.components);
  const empty = components.length === 0;
  const nets = useSim((s) => s.nets);
  const stale = useSim((s) => s.stale);
  const running = useSim((s) => s.running);
  const time = useSim((s) => s.time);
  // The cycle counter and clock level, once the sheet has anything clocked (ADR 0017).
  const clocked = components.some((c) => c.kind === "clock" || c.kind === "dff");
  const hovered = useCanvasHints((s) => s.wire);
  // A bus under the pointer: its value, as "8 bits: 44, 0x2C" (ADR 0014).
  const bits = hovered === null || stale ? 1 : (loaded?.wireWidths[hovered] ?? 1);
  const net = hovered === null ? undefined : loaded?.wireNets[hovered];
  const probed = bits > 1 && net !== undefined ? nets?.[net] : undefined;

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
              : running
                ? ["Running", "ok"]
                : ["Settled", "ok"];
  const first = errors[0] ?? diagnostics[0];
  // Name the labelled parts involved; unlabelled ones are highlighted on the canvas.
  const named = first
    ? components.filter((c) => c.props.label && first.ids.includes(c.id)).map((c) => partName(components, c))
    : [];
  const message =
    status === "error"
      ? error
      : probed !== undefined
        ? `${bits} bits: ${probed}, ${hex(probed, bits)}`
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
      {clocked && (
        <span className="status-cycle">
          Cycle {Math.floor((time + 1) / 2)}, clock {time % 2 === 1 ? "high" : "low"}
        </span>
      )}
    </footer>
  );
}
