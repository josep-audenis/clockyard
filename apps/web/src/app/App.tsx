import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { definitionName, definitionsVersion, layoutOf } from "../canvas/layout";
import { mountCanvas, useCanvasHints, viewControls } from "../canvas/scene";
import {
  contains,
  endOwner,
  fieldsProblem,
  hex,
  DEFAULT_ADDRESS,
  isFielded,
  isMemory,
  MAX_ADDRESS,
  MAX_COLUMNS,
  screenSize,
  MAX_SOURCE,
  takesWidth,
  widthOf,
  MAX_LABEL,
  MAX_NOTES,
  MAX_WIDTH,
  maxValue,
  normalizeNotes,
  parseValue,
  project,
  showValue,
  type Circuit,
  type CircuitComponent,
  type CircuitDocument,
  type Definition,
  type Junction,
  type ComponentKind,
  type PartKind,
} from "../editor/document";
import { withContents } from "../editor/blueprints";
import { deleteRefusal, liveDefinitions, liveWatches, mainCircuit, MAX_WATCHES, useEditor } from "../editor/store";
import { assemble, check, connectEngine, control, disassemble, readMemory, setSpeed, setUntil, SPEEDS, useSim, type Loaded } from "../simulation/sync";
import type { AsmError, Report } from "../simulation/protocol";
import { MAX_DOCUMENT_BYTES, parseDocument, serializeDocument } from "../storage/file";
import { CHALLENGES, findChallenge, reportText, starterDocument, type ChallengeEntry } from "../storage/challenges";
import { EXAMPLES, exampleDocument } from "../storage/examples";
import { libraryKey } from "../storage/projects";
import { LINK_KEY, linkFragment, readLinkFragment } from "../storage/link";
import { Icon, PartGlyph, type IconName } from "./icons";
import {
  clearProgress,
  connectStorage,
  currentDocument,
  deleteProject,
  libraryDocument,
  recordPass,
  removeFromLibrary,
  saveToLibrary,
  newCircuit,
  openDocument,
  openProject,
  replacingIsSafe,
  useProjects,
} from "../storage/persist";

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
      // Devices (ADR 0021): the key held down, as an 8-bit code.
      { kind: "keyboard", name: "Keyboard" },
    ],
  },
  {
    title: "Outputs",
    parts: [
      { kind: "led", name: "LED", key: "L" },
      { kind: "seg7", name: "Seven-segment" },
      // A 32 × 32 picture: 128 words of 8 pixels.
      { kind: "screen", name: "Screen", width: 8 },
    ],
  },
  {
    title: "Gates",
    parts: [
      // In columns: each gate above its inverse.
      { kind: "and", name: "AND", key: "A" },
      { kind: "or", name: "OR", key: "O" },
      { kind: "xor", name: "XOR", key: "X" },
      { kind: "nand", name: "NAND" },
      { kind: "nor", name: "NOR" },
      { kind: "xnor", name: "XNOR" },
      { kind: "not", name: "NOT", key: "N" },
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
      // ADR 0018: 8-bit words, 8 address bits.
      { kind: "rom", name: "ROM", width: 8 },
      { kind: "ram", name: "RAM", width: 8 },
    ],
  },
];
/** Each kind's name: its first tile's (a D flip-flop's, not a Register's). */
const NAMES = new Map<string, string>();
for (const { kind, name } of LIBRARY.flatMap(({ parts }) => parts)) if (!NAMES.has(kind)) NAMES.set(kind, name);
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
/** A toolbar or canvas control: a glyph, usually a label, and a tip shown on hover and keyboard focus. */
function ToolButton({
  icon,
  label,
  tip,
  iconOnly = false,
  className = "",
  ...rest
}: { icon: IconName; label: string; tip: string; iconOnly?: boolean } & ComponentProps<"button">) {
  return (
    <button type="button" className={`button button-quiet ${className}`} aria-label={iconOnly ? label : undefined} aria-description={tip} {...rest}>
      <Icon name={icon} />
      {!iconOnly && <span className="button-label">{label}</span>}
      {/* Hidden from the accessibility tree: the name stays the label, and the tip is the description above. */}
      <span className="tip" aria-hidden="true" onClick={(e) => e.stopPropagation()}>
        {tip}
      </span>
    </button>
  );
}

/** What the editor last did that shows only on the canvas or elsewhere: said once by the status bar's quiet region. */
const useAnnouncement = create<{ text: string }>(() => ({ text: "" }));
const announce = (text: string) => useAnnouncement.setState({ text });

/** The panes F6 steps through, in the order they sit on screen. */
const PANES = [".toolbar", ".parts", "main", ".inspector"];

/** Hands the keyboard to the canvas: a field being typed in commits, and part and canvas keys work next. */
const focusCanvas = () => document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
/** Whether a key press is the canvas's: with focus on it, or on nothing. Keys on a focused control stay that control's (WCAG 2.1.4). */
const onCanvas = (target: EventTarget | null) => target === document.body || (target instanceof Element && target.matches("main"));

/**
 * When a key press removes or disables the control that has focus (Undo with nothing left, a deleted row, a closed
 * sheet), focus moves to its nearest neighbour in the same pane instead of falling back to the page.
 */
function keepFocus() {
  const from = document.activeElement;
  const pane = from?.closest(".waves, .toolbar, .parts, .inspector");
  if (!(from instanceof HTMLElement) || !pane) return;
  const stops = [...pane.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex='0']")];
  const at = stops.indexOf(from);
  const usable = (el: HTMLElement) => el.isConnected && !el.matches(":disabled") && el.offsetParent !== null;
  const rescue = () => {
    if (usable(from) || (document.activeElement !== document.body && document.activeElement !== from)) return;
    const next = [...stops.slice(at + 1), ...stops.slice(0, at).reverse()].find(usable);
    if (next) next.focus();
    else focusPane(pane.matches(".waves") ? "main" : ".inspector");
  };
  requestAnimationFrame(rescue);
  // Deleting a project finishes after its storage does.
  setTimeout(rescue, 250);
}

/** Moves the keyboard to a pane. A pane is a stop for this only: Tab and clicks pass over it again afterwards. */
function focusPane(selector: string) {
  const pane = document.querySelector<HTMLElement>(selector);
  if (!pane) return;
  if (pane.tagName !== "MAIN") {
    pane.tabIndex = -1;
    pane.addEventListener("blur", () => pane.removeAttribute("tabindex"), { once: true });
  }
  pane.focus();
}

export function App() {
  useEffect(() => connectEngine(), []);
  // Escape hides an open tip (WCAG 1.4.13), and using a control hides its tip, until the pointer leaves it or focus moves.
  useEffect(() => {
    const root = document.documentElement;
    let tipped: Element | null = null;
    const hide = () => {
      tipped = document.querySelector(".button:hover");
      root.setAttribute("data-tips-off", "");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") hide();
      if (e.key === "Enter") keepFocus();
      if (e.key !== "F6" || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      const at = PANES.findIndex((pane) => document.activeElement?.closest(pane));
      // From outside every pane, forward starts at the first and back at the last.
      const from = at >= 0 ? at : e.shiftKey ? 0 : -1;
      focusPane(PANES[(from + (e.shiftKey ? -1 : 1) + PANES.length) % PANES.length] ?? "main");
    };
    const show = (e: Event) => {
      if (e.type === "focusin" || !(e.target instanceof Element) || e.target.closest(".button") !== tipped) root.removeAttribute("data-tips-off");
    };
    // A click on a button leaves the keyboard with the canvas, as a press on the canvas does. Tab still reaches every button.
    const keepKeys = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("button") || e.target.closest("dialog")) return;
      e.preventDefault();
      // Not focusCanvas: after a click the canvas should not show the keyboard's ring.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    // Space acts when it is released.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") keepFocus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("mousedown", keepKeys);
    window.addEventListener("pointerover", show);
    window.addEventListener("focusin", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("mousedown", keepKeys);
      window.removeEventListener("pointerover", show);
      window.removeEventListener("focusin", show);
    };
  }, []);
  // Projects in this browser (ADR 0029); a link in the address opens instead of the last project.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    const reopen = !new URLSearchParams(window.location.hash.slice(1)).has(LINK_KEY);
    void connectStorage({ reopen }).then((disconnect) => (gone ? disconnect() : (stop = disconnect)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  return (
    <div className="shell">
      <header className="toolbar">
        <div className="toolbar-start">
          <h1 className="wordmark">
            {/* The mark inline on tokens so it follows the theme; fixed-ink copies live in docs/assets. */}
            <svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true">
              <rect width="64" height="64" rx="6" fill="var(--bench)" stroke="var(--line)" strokeWidth="2" />
              <path d="M44 48H16" fill="none" stroke="var(--signal-low)" strokeWidth="5" strokeLinecap="round" />
              <path d="M16 48V16H47" fill="none" stroke="var(--signal-high)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="48" cy="16" r="5.5" fill="var(--signal-high)" />
              <circle cx="48" cy="48" r="4.5" fill="var(--bench)" stroke="var(--signal-low)" strokeWidth="3" />
            </svg>
            <span className="wordmark-name">Clockyard</span>
          </h1>
          <span className="toolbar-sep" aria-hidden="true" />
          <ProjectTitle />
          <Breadcrumb />
        </div>
        <div className="transport">
          <RunControls />
        </div>
        <div className="toolbar-end">
          <HistoryControls />
          <span className="toolbar-sep" aria-hidden="true" />
          <FileActions />
          <span className="toolbar-sep" aria-hidden="true" />
          <ShortcutsHelp />
        </div>
      </header>
      <div className="workspace">
        <PartsLibrary />
        <div className="canvas-column">
          <Canvas />
          <WavePanels />
        </div>
        <Inspector />
        <Readout />
      </div>
      <StatusBar />
    </div>
  );
}

/** Asks before an opened file or link replaces a circuit that has parts, unless it is saved in this browser (ADR 0029). */
function mayReplace(): boolean {
  if (replacingIsSafe()) return true;
  const state = useEditor.getState();
  const replacing = mainCircuit(state).components.length > 0 || state.definitions.length > 0 || normalizeNotes(state.metadata.notes ?? "") !== "";
  return !replacing || window.confirm("Replace the current circuit? Changes since your last export will be lost.");
}

/** The open project's name (ADR 0029), edited in place; Enter or leaving the field keeps it, Escape does not. */
function ProjectName({ saved }: { saved: string }) {
  const [draft, setDraft] = useState(saved);
  const cancelled = useRef(false);
  return (
    <input
      className="project-name type-label"
      aria-label="Project name"
      value={draft}
      size={Math.max(draft.length, 8)}
      maxLength={64}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") focusCanvas();
        if (e.key === "Escape") {
          cancelled.current = true;
          focusCanvas();
        }
      }}
      onBlur={() => {
        if (!cancelled.current && draft !== saved) useEditor.getState().rename(draft);
        cancelled.current = false;
        setDraft(saved);
      }}
    />
  );
}

function ProjectTitle() {
  const name = useEditor((s) => s.metadata.name);
  return <ProjectName key={name} saved={name} />;
}

/** Above this, Copy link warns that some apps cut links (ADR 0024). */
const LONG_LINK = 8000;

function FileActions() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A link the clipboard refused, shown to copy by hand.
  const [manual, setManual] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const report = (message: string | null, isError = false) => {
    setError(isError ? message : null);
    setNotice(isError ? null : message);
    setManual(null);
  };

  // A circuit in the address's fragment (ADR 0024): opened as Import opens a file, on load and when
  // the fragment changes in this tab, then removed from the address either way.
  useEffect(() => {
    // Only the newest open loads: a later fragment change, or this effect's cleanup, makes earlier ones stale.
    let latest = 0;
    const open = async (asking: boolean) => {
      const me = ++latest;
      const result = await readLinkFragment(window.location.hash);
      if (me !== latest || result === null) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (!result.ok) return report(`Could not open the link: ${result.error}`, true);
      if (asking && !mayReplace()) return;
      if (await openDocument(result.document)) announce(`Opened ${result.document.metadata.name}.`);
      report(null);
    };
    void open(false);
    const changed = () => void open(true);
    window.addEventListener("hashchange", changed);
    return () => {
      latest = -1;
      window.removeEventListener("hashchange", changed);
    };
  }, []);

  const exportFile = () => {
    const saved = currentDocument();
    const url = URL.createObjectURL(new Blob([serializeDocument(saved)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${slug(saved.metadata.name)}.clockyard.json` });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
    report(null);
  };

  const copyLink = async () => {
    const { origin, pathname, search } = window.location;
    let link: string;
    try {
      link = `${origin}${pathname}${search}#${await linkFragment(currentDocument())}`;
    } catch (cause) {
      return report(`Could not make a link: ${cause instanceof Error ? cause.message : String(cause)}`, true);
    }
    const size = `${link.length.toLocaleString("en")} characters. Anyone with it can read the whole circuit.`;
    const long = link.length > LONG_LINK ? " Some apps cut links this long; a file from Export is safer." : "";
    try {
      await navigator.clipboard.writeText(link);
      report(`Link copied, ${size}${long}`);
    } catch {
      report(`Copy this link by hand, ${size}${long}`);
      setManual(link);
    }
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_DOCUMENT_BYTES) return report(`Could not open ${file.name}: it is too large to be a Clockyard circuit.`, true);
    const result = parseDocument(await file.text());
    if (!result.ok) return report(`Could not open ${file.name}: ${result.error}`, true);
    if (!mayReplace()) return;
    if (await openDocument(result.document)) announce(`Opened ${result.document.metadata.name}.`);
    report(null);
  };

  return (
    <div className="file-actions">
      {/* Floats under the toolbar, so a long message is read whole and moves nothing. */}
      <div className="file-messages">
        {error && (
          <span className="file-error type-label" role="alert" title={error}>
            {error}
          </span>
        )}
        {/* Announced, but not a second status region next to the status bar's. */}
        <span className="file-notice type-label" aria-live="polite" title={notice ?? undefined}>
          {notice}
        </span>
        {manual && (
          <input className="input file-link" readOnly value={manual} aria-label="Link to this circuit" onFocus={(e) => e.target.select()} />
        )}
        {(error || notice) && (
          <button
            type="button"
            className="button button-quiet button-icon"
            aria-label="Dismiss"
            onClick={() => report(null)}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <ToolButton icon="import" label="Import" tip="Open a circuit from a file" onClick={() => picker.current?.click()} />
      <ToolButton icon="export" label="Export" tip="Save this circuit as a file" onClick={exportFile} />
      <ToolButton
        icon="link"
        label="Copy link"
        className="tip-end"
        tip="Copy a link that opens this circuit. Anyone with the link can read the whole circuit."
        onClick={() => void copyLink()}
      />
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
  // The component library (ADR 0029), where the browser keeps storage.
  const stored = useProjects((s) => s.available === true);
  const [kept, setKept] = useState<string | null>(null);
  // One save at a time, so a double click cannot ask twice or save twice.
  const keeping = useRef(false);
  const keep = async (name: string, id: string) => {
    if (keeping.current) return;
    keeping.current = true;
    setKept(null);
    const replacing = useProjects.getState().library.some((e) => e.id === libraryKey(name));
    if (!replacing || window.confirm(`Replace ${name} in your library? Projects that already added it keep their copy.`)) {
      if (await saveToLibrary(id)) setKept(`${name} ${replacing ? "replaced" : "saved"} in your library.`);
    }
    keeping.current = false;
  };
  const tab = useLibrary((s) => s.tab);
  const baseId = useId();
  // One stop for the whole palette: Tab enters on the last tile used, arrow keys move between tiles.
  const [rove, setRove] = useState(0);
  const onPaletteKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLElement>(".part-tile")];
    const at = tiles.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + 3, ArrowUp: at - 3, Home: 0, End: tiles.length - 1 }[e.key];
    if (at < 0 || to === undefined) return;
    e.preventDefault();
    tiles[Math.min(Math.max(to, 0), tiles.length - 1)]?.focus();
  };
  const onTabKey = (e: ReactKeyboardEvent) => {
    const at = TABS.findIndex(([id]) => id === tab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length]?.[0] ?? "parts";
    useLibrary.setState({ tab: next });
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  };
  const panelProps = (id: LibraryTab) => ({
    role: "tabpanel",
    id: `${baseId}-panel-${id}`,
    "aria-labelledby": `${baseId}-tab-${id}`,
    hidden: tab !== id,
  });
  const deleteChip = (id: string, name: string) => {
    setRefused(id);
    if (deleteRefusal(useEditor.getState(), id) || !window.confirm(`Delete the component ${name}? This cannot be undone.`)) return;
    useEditor.getState().deleteDefinition(id);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only while the canvas has the keyboard: a letter typed on a focused control does not arm a part.
      if (e.ctrlKey || e.metaKey || e.altKey || !onCanvas(e.target) || document.querySelector("dialog[open]")) return;
      const kind = SHORTCUTS.get(e.key.toUpperCase());
      if (kind && kind !== "label") useEditor.getState().arm(kind);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <aside className="parts" aria-label="Parts">
      <div className="library-nav" role="tablist" aria-label="Library" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            id={`${baseId}-tab-${id}`}
            type="button"
            role="tab"
            className="library-link type-label"
            aria-selected={id === tab}
            aria-controls={`${baseId}-panel-${id}`}
            tabIndex={id === tab ? 0 : -1}
            onClick={() => showTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div {...panelProps("parts")}>
      <div className="palette" role="toolbar" aria-label="Part palette" onKeyDown={onPaletteKey}>
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
                  tabIndex={tileIndex.get(name) === rove ? 0 : -1}
                  onFocus={() => setRove(tileIndex.get(name) ?? 0)}
                  onClick={(e) => {
                    // From the keyboard there is no pointer to place with: the part goes straight onto the sheet.
                    if (e.detail === 0) placeFromKeyboard(kind, width);
                    else if (kind === "label") armLabel(!armedLabel);
                    else arm(armed === kind && armedWidth === width ? null : kind, width);
                  }}
                >
                  <PartGlyph name={name} />
                  <span className="part-name">{name}</span>
                  {key && <kbd className="kbd">{key}</kbd>}
                </button>
              ))}
            </div>
          </section>
        ))}
        <p className="type-caption parts-hint">Pick a part or press its key, then click the canvas to place it. Esc cancels.</p>
      </div>
      <section className="panel" data-section="chips">
        <h2 className="type-heading panel-title">CHIPS</h2>
        {chips.length === 0 ? (
          <p className="type-caption parts-empty">
            Select a circuit with labelled switches and LEDs, then use Make component in the inspector, or add components from an example or a file.
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
                    onClick={(e) => (e.detail === 0 ? placeFromKeyboard("custom", 1, d.id) : on ? arm(null) : armChip(d.id))}
                  >
                    <PartGlyph />
                    <span className="part-name">{d.name}</span>
                  </button>
                  {stored && (
                    <button
                      type="button"
                      className="chip-delete chip-save type-label"
                      aria-label={`Save ${d.name} to your library`}
                      title={`Save ${d.name} to your library, with the components it contains`}
                      onClick={() => void keep(d.name, d.id)}
                    >
                      <Icon name="bookmark" size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="chip-delete type-label"
                    aria-label={`Delete ${d.name}`}
                    title={`Delete ${d.name}`}
                    onClick={() => deleteChip(d.id, d.name)}
                  >
                    <Icon name="close" size={14} />
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
        {stored && (
          <p className="field-hint" aria-live="polite">
            {kept}
          </p>
        )}
        <AddComponents />
      </section>
      </div>
      <div {...panelProps("projects")}>
        <ProjectsPanel />
      </div>
      <div {...panelProps("learn")}>
        <ExampleList />
        <ChallengeList />
      </div>
    </aside>
  );
}

/** The left panel's tabs: what can go on the sheet, what is saved, and what to learn from. */
const TABS = [
  ["parts", "Parts"],
  ["projects", "Projects"],
  ["learn", "Learn"],
] as const;
type LibraryTab = (typeof TABS)[number][0];
const useLibrary = create<{ tab: LibraryTab }>(() => ({ tab: "parts" }));
/** Each palette tile's place in the palette, for its arrow keys. */
const tileIndex = new Map(LIBRARY.flatMap(({ parts }) => parts).map(({ name }, i) => [name, i]));

/** Shows a tab of the left panel. Focus inside a panel that goes moves to the tab, not back to the page. */
function showTab(tab: LibraryTab) {
  const leaving = document.activeElement?.closest("[role=tabpanel]");
  useLibrary.setState({ tab });
  requestAnimationFrame(() => {
    document.querySelector(".parts")?.scrollTo({ top: 0 });
    if (leaving) document.querySelector<HTMLElement>(".library-nav [aria-selected=true]")?.focus();
  });
}

/** Opens the Learn tab at a section; from the keyboard, focus goes to its heading so Tab carries on there. */
function showLearn(section: "examples" | "challenges", keyboard: boolean) {
  useLibrary.setState({ tab: "learn" });
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>(`[data-section="${section}"] h2`);
    heading?.scrollIntoView({ block: "nearest" });
    if (!heading || !keyboard) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}

/** After opening something from the panel: says so, and goes back to the parts to build with. */
function opened(message: string) {
  announce(message);
  showTab("parts");
}

/** Puts a part on the sheet without a pointer: at the left, below everything there, selected for the inspector. */
function placeFromKeyboard(kind: PartKind | "label", width: number, definition?: string) {
  const editor = useEditor.getState();
  const { components, junctions } = editor.circuit;
  const bottom = Math.max(-2, ...components.map((c) => c.position.y + layoutOf(c).height), ...junctions.map((j) => j.position.y));
  const position = { x: 2, y: bottom + 3 };
  if (kind === "label") {
    const id = editor.addLabel(position);
    // Its Name field takes the keyboard, as after a click.
    if (id) useCanvasHints.setState({ focusValue: id });
  } else {
    if (definition) editor.armChip(definition);
    else editor.arm(kind, width);
    const id = useEditor.getState().add(kind, position);
    const { circuit } = useEditor.getState();
    const part = circuit.components.find((c) => c.id === id);
    if (part) announce(`${partName(circuit.components, part)} placed and selected.`);
  }
  viewControls.fit?.();
}

/** The keyboard and gesture reference: from the toolbar, or `?` anywhere outside a field. */
function ShortcutsHelp() {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const id = useId();
  // Focus starts at the title, so a short window opens on the top of the list and not on the button below it.
  const open = () => {
    dialog.current?.showModal();
    title.current?.focus();
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || !onCanvas(e.target) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <>
      <ToolButton
        icon="keyboard"
        label="Keyboard shortcuts"
        tip="Keyboard shortcuts and gestures (?)"
        iconOnly
        className="button-icon tip-end"
        aria-keyshortcuts="Shift+?"
        onClick={open}
      />
      <dialog
        ref={dialog}
        className="dialog dialog-wide"
        aria-labelledby={`${id}-title`}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <h2 ref={title} id={`${id}-title`} className="type-title dialog-title" tabIndex={-1}>
          Shortcuts and gestures
        </h2>
        <dl className="shortcut-list type-body">
          {HELP.map(([keys, action]) => (
            <div key={action}>
              <dt>{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          <button type="button" className="button button-quiet type-label" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

const keys = (...names: string[]) =>
  names.map((name, i) => (
    <kbd key={i} className="kbd">
      {name}
    </kbd>
  ));
/** The shortcuts-and-gestures list: what to do, and what it does. */
const HELP: [ReactNode, string][] = [
  ["Drag from a port or junction", "Wire it"],
  ["Drop a wire on a wire", "Branch it"],
  ["Drag a wire", "Reshape it"],
  ["Click a junction, then drag", "Move it"],
  ["Drag empty space", "Select; Shift adds"],
  [keys("R"), "Rotate; Shift turns back"],
  [keys("Del"), "Delete the selection"],
  [<>{keys("Space")} + drag</>, "Pan"],
  ["Wheel", "Zoom"],
  [keys("F"), "Fit the sheet in view"],
  [keys(MOD, "C", "X", "V"), "Copy, cut, paste"],
  [keys(MOD, "D", "A"), "Duplicate, select all"],
  [keys(MOD, "Z"), "Undo"],
  [keys(MOD, "Shift", "Z"), "Redo"],
  [<>{keys("Enter")} on a part</>, "Place it on the sheet"],
  [<>{keys("←", "→", "↑", "↓")} in the palette</>, "Move between parts"],
  [keys("F6"), "Next pane; Shift goes back"],
  [keys("?"), "This list"],
];

function Canvas() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    // React may unmount before Pixi finishes its async start-up.
    mountCanvas(element).then(
      ({ stop, bind }) => {
        if (disposed) return stop();
        dispose = stop;
        bind();
      },
      (error: unknown) => (element.textContent = `Canvas failed to start: ${String(error)}`),
    );
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);
  return (
    <div className="canvas-area">
      <main
        ref={host}
        className="canvas-host"
        aria-label="Circuit canvas"
        tabIndex={0}
        aria-description="Part keys arm a part, F fits the sheet, R turns, Delete removes the selection. Press question mark for all shortcuts."
      />
      <div className="canvas-tools" role="region" aria-label="Canvas tools">
        <EmptyHint />
        <ZoomControls />
      </div>
    </div>
  );
}

/** Pixels per tick, and a lane's height, on the waveform panel (ADR 0026). */
const TICK_PX = 12;
const LANE_HEIGHT = 24;
/** Height of the time axis above the lanes. */
const AXIS_HEIGHT = 20;
/** Cycles between labels on the time axis: 5 cycles are 120 pixels. */
const CYCLE_LABELS = 5;

/**
 * In a trace as the worker sends it, `[t0, v0, t1, v1, …]`, the index of the last change at or before `tick`, or -1
 * when the record starts later. A binary search: a trace holds up to 4,097 changes, read every frame.
 */
function changeAt(trace: Float64Array, tick: number): number {
  let [low, high, found] = [0, (trace.length >> 1) - 1, -1];
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((trace[2 * middle] ?? Infinity) <= tick) [found, low] = [middle, middle + 1];
    else high = middle - 1;
  }
  return found;
}

/** What a trace held at `tick`; nothing before its record began. */
function valueAt(trace: Float64Array, tick: number): number | undefined {
  const i = changeAt(trace, tick);
  return i < 0 ? undefined : trace[2 * i + 1];
}

/** A trace's name: its net label, else the part driving it with the port unless that is `out`, else the wire's ID. */
function traceName(circuit: Circuit, loaded: Loaded, net: number, wire: string): string {
  const onNet = circuit.wires.filter((w) => loaded.wireNets[w.id] === net);
  const label = circuit.junctions.find((j) => j.name && onNet.some((w) => endOwner(w.from) === j.id || endOwner(w.to) === j.id));
  if (label?.name) return label.name;
  const part = circuit.components.find((c) => c.id === loaded.netDrivers[net]);
  if (!part) return wire;
  const port = Object.entries(loaded.portNets[part.id] ?? {}).find(([, n]) => n === net)?.[0];
  const name = partName(circuit.components, part);
  return port && port !== "out" ? `${name} ${port}` : name;
}

/** One lane: a 1-bit trace as a high and low line, a wider one as a band with each value's hex digits where they fit. */
function Lane({ trace, width, start, end }: { trace: Float64Array; width: number; start: number; end: number }) {
  // From the change in force at `start`: keyed by the tick each began, so a band keeps its element as time scrolls.
  const segments: { tick: number; x0: number; x1: number; value: number; cutLeft: boolean; cutRight: boolean }[] = [];
  for (let i = Math.max(0, changeAt(trace, start)); 2 * i < trace.length; i++) {
    const [tick = 0, value = 0] = [trace[2 * i], trace[2 * i + 1]];
    if (tick > end) break;
    const to = Math.min(trace[2 * i + 2] ?? end + 1, end + 1);
    const from = Math.max(tick, start);
    // A value running past the window's edge has no end to draw there.
    const cutRight = (trace[2 * i + 2] ?? Infinity) > end;
    if (to > from) segments.push({ tick, x0: (from - start) * TICK_PX, x1: (to - start) * TICK_PX, value, cutLeft: tick < start, cutRight });
  }
  const [top, bottom, middle] = [4, LANE_HEIGHT - 4, LANE_HEIGHT / 2];
  if (width === 1) {
    const d = segments.map(({ x0, x1, value }, i) => `${i ? "V" : `M${x0} `}${value ? top : bottom}H${x1}`).join("");
    // Amber only where the signal is 1, as on a wire (ADR 0008).
    const high = segments.flatMap(({ x0, x1, value }) => (value ? [`M${x0} ${top}H${x1}`] : [])).join("");
    return (
      <>
        <path className="wave-bit" d={d} />
        <path className="wave-high" d={high} />
      </>
    );
  }
  return segments.map(({ tick, x0, x1, value, cutLeft, cutRight }) => {
    // Without `0x`, so an 8-bit value fits in one cycle; the value column has it in full.
    const text = hex(value, width).slice(2);
    return (
      <g key={tick}>
        <polygon
          className="wave-bus"
          points={[
            ...(cutLeft ? [[x0, bottom], [x0, top]] : [[x0 + 1, middle], [x0 + 3, top]]),
            ...(cutRight ? [[x1, top], [x1, bottom]] : [[x1 - 3, top], [x1 - 1, middle], [x1 - 3, bottom]]),
            ...(cutLeft ? [] : [[x0 + 3, bottom]]),
          ]
            .map(([x, y]) => `${x},${y}`)
            .join(" ")}
        />
        {x1 - x0 >= text.length * 7 + 8 && (
          <text className="wave-text" x={(x0 + x1) / 2} y={middle} textAnchor="middle" dominantBaseline="central">
            {text}
          </text>
        )}
      </g>
    );
  });
}

/** The waveform panel, started afresh whenever time goes back (a load or a reset), so no cursor outlives its record. */
function WavePanels() {
  const epoch = useSim((s) => s.epoch);
  return <WavePanel key={epoch} />;
}

/**
 * The watched wires' recorded values over ticks (ADR 0026), drawn from the engine's record alone. A click places a
 * cursor; Left and Right move it a tick, Escape removes it; the value column shows the cursor's tick, or now.
 */
function WavePanel() {
  const watches = useEditor(useShallow(liveWatches));
  const circuit = useEditor((s) => s.circuit);
  const watch = useEditor((s) => s.watch);
  const loaded = useSim((s) => s.loaded);
  const waves = useSim((s) => s.waves);
  const stale = useSim((s) => s.stale);
  const running = useSim((s) => s.running);
  const [cursor, setCursor] = useState<number | null>(null);
  const [lanes, setLanes] = useState<HTMLDivElement | null>(null);
  const [laneWidth, setLaneWidth] = useState(0);
  const help = useId();
  useEffect(() => {
    if (!lanes) return;
    const observer = new ResizeObserver(() => setLaneWidth(lanes.clientWidth));
    observer.observe(lanes);
    return () => observer.disconnect();
  }, [lanes]);
  if (watches.length === 0) return null;

  // One row per net, named by the first wire watched on it; its × stops watching every wire on that net.
  const rows: { wires: string[]; net: number; width: number }[] = [];
  for (const wire of watches) {
    const net = loaded?.wireNets[wire];
    if (net === undefined) continue;
    const row = rows.find((r) => r.net === net);
    if (row) row.wires.push(wire);
    else rows.push({ wires: [wire], net, width: loaded?.wireWidths[wire] ?? 1 });
  }
  const time = waves?.time ?? 0;
  const start = Math.max(0, time + 1 - Math.max(1, Math.floor(laneWidth / TICK_PX)));
  // A cursor scrolled out of the window is gone; a run under way does not drag it along.
  const at = cursor !== null && cursor >= start && cursor <= time ? cursor : null;
  const following = running && at === null;
  const where = at === null ? `now, tick ${time}` : `tick ${at}, cycle ${Math.floor((at + 1) / 2)}`;
  const trace = (net: number) => (stale || !waves ? undefined : waves.traces[waves.nets.indexOf(net)]);
  const height = AXIS_HEIGHT + rows.length * LANE_HEIGHT;
  const tickAt = (e: ReactMouseEvent<HTMLDivElement>) =>
    Math.min(time, start + Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / TICK_PX));
  // Moving the cursor by key says what the signals held there.
  const moveTo = (tick: number) => {
    setCursor(tick);
    const held = rows.map(({ wires, net, width }) => {
      const t = trace(net);
      const value = t && valueAt(t, tick);
      return `${loaded ? traceName(circuit, loaded, net, wires[0] ?? "") : ""} ${value === undefined ? "unknown" : showValue(value, width)}`;
    });
    announce(held.join(", "));
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (step) moveTo(Math.min(Math.max((at ?? time) + step, start), time));
    else if (e.key === "Home") moveTo(start);
    else if (e.key === "End") moveTo(time);
    else if (e.key === "Escape") setCursor(null);
    else return;
    // Not the canvas's too: Escape there clears the selection.
    e.preventDefault();
    e.stopPropagation();
  };
  // Rising edges every few cycles, labelled with their cycle number.
  const cycles: number[] = [];
  for (let c = Math.max(1, Math.ceil((start + 1) / 2 / CYCLE_LABELS)) * CYCLE_LABELS; 2 * c - 1 <= time; c += CYCLE_LABELS) cycles.push(c);

  return (
    <section className="waves" aria-label="Waveforms">
      <div className="waves-names">
        <p className="type-label waves-time">{at === null ? `Now: tick ${time}` : `Cursor: tick ${at}, cycle ${Math.floor((at + 1) / 2)}`}</p>
        <p id={help} className="visually-hidden">
          Click a lane to place the cursor. Left and Right move it a tick, Escape removes it.
        </p>
        <ul className="waves-rows">
          {rows.map(({ wires, net, width }) => {
            const name = loaded ? traceName(circuit, loaded, net, wires[0] ?? "") : (wires[0] ?? "");
            const t = trace(net);
            const value = t && valueAt(t, at ?? time);
            return (
              <li key={net} className="waves-row">
                <span className="type-label waves-name">{name}</span>
                <span className="type-value waves-value">{value === undefined ? "unknown" : showValue(value, width)}</span>
                <button
                  type="button"
                  className="button button-quiet waves-remove"
                  aria-label={`Stop watching ${name}`}
                  onClick={() => wires.forEach((w) => watch(w, false))}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div
        ref={setLanes}
        className="waves-lanes"
        tabIndex={0}
        role="slider"
        aria-label="Waveform cursor"
        aria-describedby={help}
        // Still while a run moves time on, or a screen reader would read every tick.
        aria-valuemin={following ? 0 : start}
        aria-valuemax={following ? 0 : time}
        aria-valuenow={following ? 0 : (at ?? time)}
        aria-valuetext={following ? "following the run" : where}
        onKeyDown={onKeyDown}
        onClick={(e) => setCursor(tickAt(e))}
      >
        <svg width={(time + 1 - start) * TICK_PX} height={height} aria-hidden="true">
          {cycles.map((c) => (
            <text key={c} className="wave-axis" x={(2 * c - 1 - start) * TICK_PX} y={12}>
              {c}
            </text>
          ))}
          {rows.map(({ net, width }, i) => {
            const t = trace(net);
            return (
              <g key={net} transform={`translate(0 ${AXIS_HEIGHT + i * LANE_HEIGHT})`}>
                {t && <Lane trace={t} width={width} start={start} end={time} />}
              </g>
            );
          })}
          {at !== null && <line className="wave-cursor" x1={(at - start + 0.5) * TICK_PX} x2={(at - start + 0.5) * TICK_PX} y1={0} y2={height} />}
        </svg>
      </div>
    </section>
  );
}

/** On an empty sheet with nothing armed: how to start. */
function EmptyHint() {
  const show = useEditor((s) => s.circuit.components.length === 0 && s.circuit.junctions.length === 0 && !s.armed && !s.armedLabel);
  if (!show) return null;
  return (
    <div className="canvas-empty">
      <p className="type-body">
        <strong>Empty sheet.</strong> Choose a part, or press <kbd className="kbd">S</kbd> for a switch, then click here to place it.
      </p>
      {/* The whole loop, drawn as one wire. */}
      <ol className="empty-steps type-caption">
        <li>
          <PartGlyph name="AND" />
          Place parts
        </li>
        <li>
          <PartGlyph name="Splitter" />
          Drag to wire
        </li>
        <li>
          <PartGlyph name="Clock" />
          Run it
        </li>
      </ol>
      <div className="canvas-empty-actions">
        <button type="button" className="button type-label" onClick={(e) => showLearn("examples", e.detail === 0)}>
          Browse examples
        </button>
        <button type="button" className="button type-label" onClick={(e) => showLearn("challenges", e.detail === 0)}>
          Try a challenge
        </button>
      </div>
    </div>
  );
}

function ZoomControls() {
  const zoom = useCanvasHints((s) => s.zoom);
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <ToolButton icon="minus" label="Zoom out" tip="Zoom out" iconOnly className="button-icon" onClick={() => viewControls.zoomBy?.(1 / 1.25)} />
      <button type="button" className="button button-quiet zoom-level" title="Zoom to 100%" onClick={() => viewControls.zoomBy?.(1 / zoom)}>
        {Math.round(zoom * 100)}%
      </button>
      <ToolButton icon="plus" label="Zoom in" tip="Zoom in" iconOnly className="button-icon" onClick={() => viewControls.zoomBy?.(1.25)} />
      <span className="toolbar-sep" aria-hidden="true" />
      <ToolButton icon="fit" label="Fit" tip="Fit the sheet in view (F)" className="tip-end" aria-keyshortcuts="F" onClick={() => viewControls.fit?.()} />
    </div>
  );
}

/** "16 Nov, 09:30": when a project changed, in the reader's own locale. */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Projects kept in this browser (ADR 0029): New circuit, and every saved project, newest first, to open or delete.
 * The work in it is saved as it changes; Export keeps a copy anywhere else.
 */
function ProjectsPanel() {
  const { available, reason, projectId, projects } = useProjects();
  return (
    <section className="panel" aria-labelledby="projects-title" data-section="projects">
      <h2 id="projects-title" className="type-heading panel-title">
        PROJECTS
      </h2>
      <button type="button" className="button type-label projects-new" onClick={() => void (mayReplace() && newCircuit().then(() => opened("New circuit started.")))}>
        <Icon name="plus" size={14} />
        New circuit
      </button>
      {available === false ? (
        <p className="type-caption parts-empty" role="alert">
          {`Not saved in this browser: ${reason ?? "storage is not available"}. Export to keep your work.`}
        </p>
      ) : (
        <>
          {projects.length > 0 && (
            <ul className="chip-list">
              {projects.map((p) => (
                <li key={p.id} className="chip-row">
                  <button
                    type="button"
                    className="part-tile type-label project-tile"
                    aria-current={p.id === projectId ? "true" : undefined}
                    title={`Changed ${when(p.modifiedAt)}`}
                    onClick={() => void (p.id !== projectId && openProject(p.id).then(() => opened(`Opened ${p.name}.`)))}
                  >
                    <span className="project-tile-name">{p.name}</span>
                    <span className="type-caption project-tile-when">{when(p.modifiedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="chip-delete type-label"
                    aria-label={`Delete project ${p.name}`}
                    title={`Delete project ${p.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete the project ${p.name} from this browser? This cannot be undone.`))
                        void deleteProject(p.id).then(() => announce(`Deleted ${p.name}.`));
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="type-caption parts-empty">Saved in this browser as you work. Export keeps a copy anywhere else.</p>
        </>
      )}
    </section>
  );
}

/** Opens a challenge's starter (ADR 0025), asking first as Import does, on the sheet of the component to build. */
function ChallengeList() {
  const progress = useProjects((s) => s.progress);
  const start = async ({ name, challenge }: ChallengeEntry) => {
    // Bundled and proved to open by challenges.test.ts.
    const document = starterDocument(name);
    if (!mayReplace()) return;
    if (await openDocument(document)) {
      useEditor.getState().openSheet(challenge.definition);
      opened(`Opened the challenge ${challenge.title}.`);
    }
  };
  return (
    <section className="panel" aria-labelledby="challenges-title" data-section="challenges">
      <h2 id="challenges-title" className="type-heading panel-title">
        CHALLENGES
      </h2>
      <ol className="challenge-list">
        {CHALLENGES.map((entry, i) => (
          <li key={entry.name}>
            {/* Numbered: they are an order to work through, and a chip may share a title. */}
            <button type="button" className="part-tile type-label" onClick={() => void start(entry)}>
              <span className="part-name">
                <span className="challenge-number">{i + 1}.</span> {entry.challenge.title}
              </span>
              {progress[entry.name] && (
                <span className="challenge-done" role="img" aria-label="passed">
                  <Icon name="check" size={14} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      {Object.keys(progress).length > 0 && (
        <button
          type="button"
          className="button type-label challenge-clear"
          onClick={() => {
            if (window.confirm("Clear your challenge progress in this browser?")) void clearProgress();
          }}
        >
          Clear progress
        </button>
      )}
    </section>
  );
}

/** "A, B and C". */
const list = (items: string[]) => new Intl.ListFormat("en").format(items);

/**
 * Components from another document (ADR 0027): a project file or a bundled example is read, never opened, and the
 * components ticked come into this document with those they contain. The rules for IDs and names are `addDefinitions`.
 */
function AddComponents() {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();
  // The source chosen, `example:name` or `library:id`, kept so that arrow keys on the closed list step through them
  // (Windows fires change on each).
  const [example, setExample] = useState("");
  const library = useProjects((s) => s.library);
  const shelf = example.startsWith("library:") ? library.find((e) => `library:${e.id}` === example) : undefined;
  const [source, setSource] = useState<{ title: string; definitions: Definition[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Only the latest choice of source is shown, whichever finishes loading first.
  const latest = useRef(0);

  const choose = async (title: string, read: () => Promise<CircuitDocument>) => {
    const me = ++latest.current;
    // The list goes while the next loads, so nothing is ticked in, or added from, the source before it.
    setSource(null);
    setPicked([]);
    setMessage(null);
    try {
      const document = await read();
      if (me !== latest.current) return;
      setSource({ title, definitions: document.definitions });
      setPicked([]);
      if (document.definitions.length === 0) setMessage({ text: `${title} has no components.`, error: false });
    } catch (error) {
      if (me !== latest.current) return;
      setSource(null);
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };
  const readFile = async (file: File) => {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`Could not read ${file.name}: it is too large to be a Clockyard circuit.`);
    const result = parseDocument(await file.text());
    if (!result.ok) throw new Error(`Could not read ${file.name}: ${result.error}`);
    return result.document;
  };
  const add = () => {
    if (!source) return;
    const { added, reused } = useEditor.getState().addComponents(source.definitions, picked);
    const names = (ds: Definition[]) => [...new Set(ds.map((d) => d.name))];
    const text = [
      added.length > 0 && `Added ${list(names(added))}.`,
      reused.length > 0 && `${list(names(reused))} ${names(reused).length === 1 ? "was" : "were"} already here.`,
    ]
      .filter(Boolean)
      .join(" ");
    setMessage({ text, error: false });
    setPicked([]);
    // Add is disabled now that nothing is ticked: focus moves on instead of falling back to the page.
    close.current?.focus();
  };
  // Everything each component brings along, at any depth, so the list says what comes with it.
  const contents = (definition: Definition) =>
    withContents(source?.definitions ?? [], [definition.id])
      .filter((d) => d.id !== definition.id)
      .map((d) => d.name);

  return (
    <>
      <button
        type="button"
        className="button type-label add-components"
        onClick={() => {
          // A fresh choice each time: a library entry saved again since would otherwise be added as it was.
          setExample("");
          setSource(null);
          setPicked([]);
          setMessage(null);
          dialog.current?.showModal();
        }}
      >
        <Icon name="plus" size={14} />
        Add components…
      </button>
      {/* Keys typed here are the dialog's, not part shortcuts. */}
      <dialog ref={dialog} className="dialog" aria-labelledby={`${id}-title`} onKeyDown={(e) => e.stopPropagation()}>
        <h2 id={`${id}-title`} className="type-title dialog-title">
          Add components
        </h2>
        <p className="type-body dialog-text">
          Copy components from another circuit into this one. Pick a bundled example, a component from your library, or a project
          file; it is read, not opened.
        </p>
        <div className="dialog-row">
          <label className="field-label" htmlFor={`${id}-example`}>
            From an example or your library
          </label>
          <span className="select">
          <select
            id={`${id}-example`}
            className="input"
            value={example}
            onChange={(e) => {
              const value = e.target.value;
              setExample(value);
              const entry = EXAMPLES.find((x) => `example:${x.name}` === value);
              const kept = library.find((x) => `library:${x.id}` === value);
              if (entry) void choose(entry.title, () => exampleDocument(entry.name));
              else if (kept) void choose(kept.name, async () => libraryDocument(kept));
            }}
          >
            <option value="">Choose…</option>
            <optgroup label="Examples">
              {EXAMPLES.map(({ name, title }) => (
                <option key={name} value={`example:${name}`}>
                  {title}
                </option>
              ))}
            </optgroup>
            {library.length > 0 && (
              <optgroup label="Your library">
                {library.map((e) => (
                  <option key={e.id} value={`library:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          </span>
          <button type="button" className="button type-label" onClick={() => picker.current?.click()}>
            From a file…
          </button>
          <input
            ref={picker}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="components-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setExample("");
              void choose(file.name, () => readFile(file));
            }}
          />
        </div>
        {source && source.definitions.length > 0 && (
          <fieldset className="dialog-choices">
            <legend className="type-label">{`Components in ${source.title}`}</legend>
            {source.definitions.map((d) => {
              const inner = contents(d);
              return (
                <label key={d.id} className="dialog-choice type-body">
                  <input
                    type="checkbox"
                    checked={picked.includes(d.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))}
                  />
                  {d.name}
                  {inner.length > 0 && <span className="type-caption dialog-hint">{` with ${list(inner)}`}</span>}
                </label>
              );
            })}
          </fieldset>
        )}
        <p className={`type-body dialog-text${message?.error ? " field-error" : ""}`} aria-live="polite">
          {message?.text}
        </p>
        <div className="dialog-actions">
          {shelf && (
            <button
              type="button"
              className="button type-label"
              onClick={async () => {
                if (!window.confirm(`Remove ${shelf.name} from your library? Projects that already added it keep their copy.`)) return;
                const failed = await removeFromLibrary(shelf.id);
                if (failed) return setMessage({ text: `Could not remove ${shelf.name} from your library: ${failed}`, error: true });
                setExample("");
                setSource(null);
                setPicked([]);
                setMessage({ text: `${shelf.name} removed from your library.`, error: false });
                // This button goes with the entry: focus moves on instead of falling back to the page.
                close.current?.focus();
              }}
            >
              Remove from library
            </button>
          )}
          <button type="button" className="button button-primary type-label" disabled={picked.length === 0} onClick={add}>
            Add
          </button>
          <button ref={close} type="button" className="button button-quiet type-label" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

/** The bundled examples, from a gate to a game (ADR 0027); each opens as Import opens a file, asking before it replaces a circuit. */
function ExampleList() {
  const [problem, setProblem] = useState<string | null>(null);
  // Only the latest click opens: a second click, or another example's file loading sooner, never asks twice.
  const latest = useRef(0);
  const open = async (name: string) => {
    const me = ++latest.current;
    setProblem(null);
    try {
      const document = await exampleDocument(name);
      if (me === latest.current && mayReplace() && (await openDocument(document))) opened(`Opened ${document.metadata.name}.`);
    } catch (error) {
      // Bundled and proved to open by examples.test.ts; what remains is the file failing to load.
      setProblem(`Could not open the example: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <section className="panel" aria-labelledby="examples-title" data-section="examples">
      <h2 id="examples-title" className="type-heading panel-title">
        EXAMPLES
      </h2>
      <ol className="challenge-list">
        {EXAMPLES.map(({ name, title }) => (
          <li key={name}>
            <button type="button" className="part-tile type-label" onClick={() => void open(name)}>
              <span className="part-name">{title}</span>
            </button>
          </li>
        ))}
      </ol>
      {problem && (
        <p className="type-body field-error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** The document's notes (ADR 0027): plain text that travels with the file and its link, edited in place, outside undo. */
function NotesPanel() {
  const notes = useEditor((s) => s.metadata.notes ?? "");
  const id = useId();
  return (
    <section className="panel panel-notes" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="type-heading panel-title">
        NOTES
      </h2>
      <div className="inspector-body">
        <label className="visually-hidden" htmlFor={`${id}-notes`}>
          Notes
        </label>
        <textarea
          id={`${id}-notes`}
          aria-describedby={`${id}-hint`}
          className="input notes"
          rows={8}
          value={notes}
          placeholder="What this circuit does, and what to try."
          onChange={(e) => useEditor.getState().setNotes(e.target.value)}
        />
        <p id={`${id}-hint`} className="field-hint">
          {`Plain text, saved with the file and in links, up to ${MAX_NOTES.toLocaleString("en")} characters. A blank line starts a new paragraph.`}
        </p>
      </div>
    </section>
  );
}

/** The challenge the document was started from: its text and Check (ADR 0025). The engine decides; this shows its report. */
function ChallengePanel() {
  const entry = useEditor((s) => findChallenge(s.metadata.challenge));
  const sheet = useEditor((s) => s.sheet);
  // The check reads the definitions only (the bench ignores the main circuit); a sheet switch keeps their circuits.
  const circuits = useEditor(useShallow((s) => liveDefinitions(s).map((d) => d.circuit)));
  const built = useEditor((s) => (entry ? s.definitions.find((d) => d.id === entry.challenge.definition) : undefined));
  // With the circuits it checked: any edit to them since makes it out of date, and it is no longer shown.
  const [checked, setChecked] = useState<{ report: Report; circuits: Circuit[] } | null>(null);
  const checking = useRef(false);
  const progress = useProjects((s) => s.progress);
  const current = checked?.circuits.length === circuits.length && checked.circuits.every((c, i) => c === circuits[i]) ? checked.report : null;
  if (!entry) return null;
  const { challenge } = entry;
  const run = async () => {
    // Not disabled while it runs, so keyboard focus stays on the button.
    if (checking.current) return;
    checking.current = true;
    // Cleared first, so the same report checked again is shown and announced again.
    setChecked(null);
    const state = useEditor.getState();
    const definitions = liveDefinitions(state);
    const report = await check(project(mainCircuit(state), definitions), challenge);
    checking.current = false;
    if (report.result === "passed") void recordPass(entry.name);
    setChecked({ report, circuits: definitions.map((d) => d.circuit) });
  };
  return (
    <section className="panel" aria-labelledby="challenge-title">
      <h2 id="challenge-title" className="type-heading panel-title">
        CHALLENGE
      </h2>
      <div className="inspector-body">
        <p className="type-label inspector-kind">{challenge.title}</p>
        <p className="type-body challenge-text">{challenge.text}</p>
        {progress[entry.name] && <p className="type-caption challenge-text">{`First passed ${when(progress[entry.name] ?? "")}.`}</p>}
        {built && sheet !== built.id && (
          <button type="button" className="button type-label" onClick={() => useEditor.getState().openSheet(built.id)}>
            Open {built.name}
          </button>
        )}
        <button type="button" className="button type-label" onClick={() => void run()}>
          Check
        </button>
        {/* Announced, but not a second status region next to the status bar's. */}
        <p className={`type-body challenge-result${current?.result === "passed" ? " challenge-passed" : ""}`} aria-live="polite">
          {current && reportText(current, challenge)}
        </p>
      </div>
    </section>
  );
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
          // Remounts for another part; each field remounts itself when its own value changes.
          <PartProperties key={part.id} part={part} />
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
            <WatchToggle wire={wire.id} />
          </div>
        ) : junction ? (
          <JunctionProperties key={junction.id} junction={junction} />
        ) : selection.length > 1 ? (
          <MakeComponent count={selection.length} />
        ) : (
          <p className="type-body inspector-empty">Select a component to edit its properties.</p>
        )}
      </section>
      <ChallengePanel />
      <NotesPanel />
    </aside>
  );
}

/** Shows a wire's net in the waveform panel, or stops (ADR 0026). */
function WatchToggle({ wire }: { wire: string }) {
  const watching = useEditor((s) => s.watches.includes(wire));
  const full = useEditor((s) => liveWatches(s).length >= MAX_WATCHES);
  const watch = useEditor((s) => s.watch);
  return (
    <>
      <button type="button" className="button type-label" disabled={!watching && full} onClick={() => watch(wire, !watching)}>
        {watching ? "Stop watching" : "Watch"}
      </button>
      {!watching && full && <p className="type-body inspector-empty">{`At most ${MAX_WATCHES} wires can be watched.`}</p>}
    </>
  );
}

/** A junction's name makes it a net label (ADR 0015); a new label's Name field takes focus. */
function JunctionProperties({ junction }: { junction: Junction }) {
  const focus = useCanvasHints((s) => s.focusValue === junction.id);
  return (
    <div className="inspector-body">
      <p className="type-label inspector-kind">{junction.name ? "Label" : "Junction"}</p>
      <CommitField
        key={`name:${junction.name ?? ""}`}
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
      <span className="toolbar-sep" aria-hidden="true" />
      <ToolButton icon="back" label="Main circuit" tip="Back to the main circuit" iconOnly className="button-icon" onClick={closeSheet} />
      <span className="breadcrumb-current" aria-current="page" title={name}>
        {name}
      </span>
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
  problem,
  maxLength = MAX_LABEL,
  focus = false,
}: {
  label: string;
  saved: string;
  hint: string;
  onCommit: (value: string) => void;
  /** What is wrong with a value, if anything: it is not committed, and the field says why. */
  problem?: (value: string) => string | null;
  maxLength?: number;
  /** Takes the keyboard once, when the canvas hands it over (a just-placed label). */
  focus?: boolean;
}) {
  const [draft, setDraft] = useState(saved);
  const [wrong, setWrong] = useState<string | null>(null);
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
        aria-invalid={wrong !== null}
        className="input"
        value={draft}
        maxLength={maxLength}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setWrong(null);
        }}
        onBlur={() => {
          const bad = cancelled.current ? null : (problem?.(draft) ?? null);
          const wasCancelled = cancelled.current;
          cancelled.current = false;
          // A refused value stays in the field with its reason, until it is corrected or Escape puts the old one back.
          setWrong(bad);
          if (bad) return;
          if (!wasCancelled) onCommit(draft);
          // Show what was stored: when normalizing leaves the value unchanged, nothing remounts the field.
          setDraft(saved);
        }}
        onKeyDown={(e) => {
          // Enter and Escape during IME composition pick or dismiss a candidate; they are not ours.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") {
            const bad = problem?.(draft) ?? null;
            setWrong(bad);
            if (!bad) focusCanvas();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            setWrong(null);
            focusCanvas();
          }
        }}
      />
      <p id={`${id}-hint`} className={`field-hint${wrong ? " field-error" : ""}`} role={wrong ? "alert" : undefined}>
        {wrong ?? hint}
      </p>
    </div>
  );
}

function PartProperties({ part }: { part: CircuitComponent }) {
  const name = useEditor((s) => s.definitions.find((d) => d.id === part.definition)?.name);
  return (
    <div className="inspector-body">
      <p className="type-label inspector-kind">
        <PartGlyph name={part.kind === "custom" ? undefined : kindName(part)} />
        {kindName(part)}
      </p>
      <CommitField
        key={`label:${part.props.label ?? ""}`}
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
          problem={(value) => {
            const tokens = value.split(/[\s,]+/).filter(Boolean);
            const why = tokens.every((t) => /^\d+$/.test(t)) ? fieldsProblem(tokens.map(Number)) : "Use whole numbers separated by commas.";
            return why && (why.endsWith(".") ? why : `Fields ${why}.`);
          }}
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
          problem={wholeNumber(MAX_WIDTH)}
          // One undoable edit; anything but a whole number in range leaves the width as it was.
          onCommit={(value) => /^\s*\d+\s*$/.test(value) && useEditor.getState().setWidth(part.id, Number(value))}
        />
      )}
      {part.kind === "switch" && (part.props.width ?? 1) > 1 && <ValueField part={part} />}
      {isMemory(part.kind) && (
        <CommitField
          key={`address:${part.props.addressWidth ?? DEFAULT_ADDRESS}`}
          label="Address bits"
          saved={String(part.props.addressWidth ?? DEFAULT_ADDRESS)}
          hint={`${2 ** (part.props.addressWidth ?? DEFAULT_ADDRESS)} words; 1 to ${MAX_ADDRESS} address bits.`}
          problem={wholeNumber(MAX_ADDRESS)}
          // One undoable edit; a ROM keeps the words that still fit.
          onCommit={(value) => /^\s*\d+\s*$/.test(value) && useEditor.getState().setAddressWidth(part.id, Number(value))}
        />
      )}
      {part.kind === "screen" && <ColumnsField part={part} />}
      {part.kind === "rom" && <RomContents key={`${part.props.width ?? 1}:${(part.props.data ?? []).join()}`} part={part} />}
      {part.kind === "rom" && (part.props.width ?? 1) === 16 && <ProgramEditor key={part.id} part={part} />}
      {(part.kind === "ram" || part.kind === "screen") && <RamDump part={part} />}
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

/** A whole number from 1 to `max`, as a field's `problem` check. */
const wholeNumber = (max: number) => (value: string) =>
  /^\s*\d+\s*$/.test(value) && Number(value) >= 1 && Number(value) <= max ? null : `Enter a whole number from 1 to ${max}.`;

/** Words as the inspector shows them: hex, eight to a line. */
const wordLines = (words: readonly number[], width: number) =>
  Array.from({ length: Math.ceil(words.length / 8) }, (_, row) =>
    words
      .slice(8 * row, 8 * row + 8)
      .map((w) => hex(w, width))
      .join(" "),
  ).join("\n");

/**
 * A ROM's words (ADR 0018): typed in hex, decimal or binary as a wide switch's value, separated by spaces or
 * new lines, from address 0. Applied as one edit when the box loses focus; anything that does not parse or fit
 * changes nothing and says why.
 */
function RomContents({ part }: { part: CircuitComponent }) {
  const width = part.props.width ?? 1;
  const address = part.props.addressWidth ?? DEFAULT_ADDRESS;
  const saved = wordLines(part.props.data ?? [], width);
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const apply = () => {
    const tokens = draft.split(/[\s,]+/).filter(Boolean);
    const words = tokens.map((t) => parseValue(t, width));
    const bad = tokens.find((_, i) => words[i] === null);
    if (bad !== undefined) return setProblem(`${bad} is not a value from 0 to ${maxValue(width)}.`);
    if (words.length > 2 ** address) return setProblem(`${words.length} words do not fit in ${2 ** address} addresses.`);
    setProblem(null);
    useEditor.getState().setData(part.id, words as number[]);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-contents`}>
        Contents
      </label>
      <textarea
        id={`${id}-contents`}
        aria-describedby={`${id}-hint`}
        aria-invalid={problem !== null}
        className="input memory-words"
        rows={6}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
      />
      <p id={`${id}-hint`} className={`field-hint${problem ? " field-error" : ""}`} role={problem ? "alert" : undefined}>
        {problem ?? `Words from address 0, in hex (0x…), decimal or binary (0b…), separated by spaces or commas. Missing words read 0.`}
      </p>
    </div>
  );
}

/**
 * A 16-bit ROM's program as reference-CPU assembly (ADR 0019): Assemble writes the words and keeps the source,
 * as one undoable edit, which reloads and resets the circuit. Errors are listed by line and change nothing. Below,
 * the ROM's words as assembly, and a note when they are no longer what the kept source assembles to.
 */
function ProgramEditor({ part }: { part: CircuitComponent }) {
  const saved = part.props.source ?? "";
  const data = part.props.data;
  const address = part.props.addressWidth ?? DEFAULT_ADDRESS;
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<AsmError[]>([]);
  /** The last Assemble's result, shown while the ROM still holds the words and source it wrote. */
  const [status, setStatus] = useState<{ text: string; words: string; source: string } | null>(null);
  /** The listing; null while it is on its way, "unavailable" when the engine cannot answer. */
  const [listing, setListing] = useState<string[] | null | "unavailable">(null);
  /** Whether the words are what the kept source assembles to; "broken" when that source no longer assembles. */
  const [check, setCheck] = useState<"ok" | "edited" | "broken">("ok");
  const id = useId();
  // Undo, redo or an import that changes the kept source shows that source, not what was typed before
  // (state adjusted while rendering, as React recommends over an effect).
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setDraft(saved);
    setErrors([]);
  }
  // The listing and the source check follow the ROM's words, whatever changed them.
  useEffect(() => {
    let current = true;
    const words = data ?? [];
    void disassemble(words.slice(0, DUMP_WORDS)).then((lines) => current && setListing(lines ?? "unavailable"));
    void assemble(saved).then((result) => {
      if (!current) return;
      setCheck(saved === "" ? "ok" : result.errors.length > 0 ? "broken" : result.words.join() !== words.join() ? "edited" : "ok");
    });
    return () => {
      current = false;
    };
  }, [data, saved]);
  const run = async () => {
    // Cleared first, so the same errors twice are announced twice.
    setErrors([]);
    setStatus(null);
    const result = await assemble(draft);
    const room = 2 ** address;
    const problems =
      result.errors.length > 0
        ? result.errors
        : result.words.length > room
          ? [{ line: 0, message: `${result.words.length} words do not fit in ${room} addresses: give the ROM more address bits.` }]
          : [];
    setErrors(problems);
    if (problems.length > 0) return;
    useEditor.getState().setData(part.id, result.words, draft);
    setStatus({ text: `Assembled ${result.words.length} ${result.words.length === 1 ? "word" : "words"}.`, words: result.words.join(), source: draft });
  };
  const note =
    (status?.words === (data ?? []).join() && status.source === saved && status.text) ||
    (check === "edited"
      ? "The words no longer match this source: they were edited directly. Assemble to write them again."
      : check === "broken"
        ? "This source no longer assembles; the words are as they were. Fix it and Assemble."
        : "Reference-CPU assembly (docs/reference-cpu.md). Assemble writes the program and resets the circuit.");
  const digits = Math.ceil(address / 4);
  const total = data?.length ?? 0;
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-source`}>
        Assembly
      </label>
      <textarea
        id={`${id}-source`}
        aria-describedby={`${id}-hint`}
        className="input memory-words"
        rows={8}
        spellCheck={false}
        maxLength={MAX_SOURCE}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setErrors([]);
          setStatus(null);
        }}
      />
      {errors.length > 0 ? (
        <div id={`${id}-hint`} className="field-hint field-error" role="alert">
          <ul className="asm-errors">
            {errors.map((e) => (
              <li key={`${e.line}:${e.message}`}>{e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p id={`${id}-hint`} className="field-hint" role="status">
          {note}
        </p>
      )}
      <button type="button" className="button type-label" onClick={() => void run()}>
        Assemble
      </button>
      <p className="field-label" id={`${id}-listing`}>
        Disassembly
      </p>
      <pre className="memory-words" role="region" tabIndex={0} aria-labelledby={`${id}-listing`}>
        {listing === null
          ? "…"
          : listing === "unavailable"
            ? "Not available: the engine is not running."
            : listing.length === 0
              ? "Empty: every word reads 0, which runs as NOP."
              : listing.map((line, a) => `${a.toString(16).toUpperCase().padStart(digits, "0")}  ${line}`).join("\n") +
                (total > DUMP_WORDS ? `\n… ${total - DUMP_WORDS} more words` : "")}
      </pre>
    </div>
  );
}

/** Most RAM words the inspector lists; a larger RAM shows its first ones. */
// shortcut: shows only the first 256 words, add paging when programs use more.
const DUMP_WORDS = 256;

/** A RAM's contents as the engine holds them (ADR 0018), asked for again after every state while shown. */
function RamDump({ part }: { part: CircuitComponent }) {
  const width = part.props.width ?? 1;
  const total = 2 ** (part.props.addressWidth ?? DEFAULT_ADDRESS);
  const nets = useSim((s) => s.nets);
  const own = useSim((s) => s.memory[part.id]);
  const id = useId();
  // On any sheet the open sheet is what is simulated, so the part's own ID names it.
  // Only the words shown cross from the worker, however large the RAM.
  // A screen's canvas reads its shown words into the same slot (ADR 0021): asking for as many keeps the two from alternating.
  const count = part.kind === "screen" ? screenSize(part.props).words : DUMP_WORDS;
  useEffect(() => readMemory(part.id, count), [part.id, count, nets]);
  const words = own ? [...own.slice(0, DUMP_WORDS)] : null;
  return (
    <div className="field">
      <p className="field-label" id={`${id}-label`}>
        Contents
      </p>
      {/* Focusable, so the list can be scrolled from the keyboard; named for screen readers. */}
      <pre className="memory-words" role="region" tabIndex={0} aria-label={part.kind === "screen" ? "Screen contents" : "RAM contents"}>
        {words === null ? "…" : words.length === 0 ? "Not simulated: the circuit has errors." : wordLines(words, width)}
      </pre>
      <p className="field-hint">
        {total > DUMP_WORDS ? `The first ${DUMP_WORDS} of ${total} words. ` : ""}Written while the circuit runs; cleared by Reset and by any change to the wiring.
      </p>
    </div>
  );
}

/** A screen's pixels per row (ADR 0021), and the picture they make. */
function ColumnsField({ part }: { part: CircuitComponent }) {
  const { columns, rows, words } = screenSize(part.props);
  const total = 2 ** (part.props.addressWidth ?? DEFAULT_ADDRESS) * (part.props.width ?? 1);
  const cut = total > columns * rows ? ` The first ${rows} rows are shown.` : "";
  return (
    <CommitField
      key={`columns:${columns}`}
      label="Columns"
      saved={String(columns)}
      hint={`Pixels per row, 1 to ${MAX_COLUMNS}: ${columns} × ${rows} pixels from ${words} words, most significant bit leftmost.${cut}`}
      problem={wholeNumber(MAX_COLUMNS)}
      // One undoable edit; anything but a whole number in range leaves the columns as they were.
      onCommit={(value) => /^\s*\d+\s*$/.test(value) && useEditor.getState().setColumns(part.id, Number(value))}
    />
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
        onChange={(e) => {
          setDraft(e.target.value);
          setWrong(false);
        }}
        onBlur={() => {
          // Leaving keeps a valid value; anything else stays, marked, until it is corrected or Escape drops it.
          if (draft === null) return;
          const parsed = parseValue(draft, width);
          if (parsed === null) return setWrong(true);
          useEditor.getState().setInput(part.id, parsed);
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
  return partNames(components).get(part.id) ?? `${kindName(part)}`;
}

/**
 * Names by parts array, while definitions (whose names name custom parts) are unchanged: built once per edit, however
 * many names are asked for (a waveform's lanes read them every frame).
 */
const namesOf = new WeakMap<CircuitComponent[], { definitions: number; names: Map<string, string> }>();
/**
 * Every part's name (see `partName`), in one pass: a list of many parts named one by one would count among all the
 * parts once per part, which at thousands of LEDs held each engine state up for seconds (ADR 0030).
 */
function partNames(components: CircuitComponent[]): Map<string, string> {
  const cached = namesOf.get(components);
  if (cached?.definitions === definitionsVersion()) return cached.names;
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const part of components) {
    const kind = kindName(part);
    // Numbered among parts called the same, so registers and 1-bit flip-flops count apart.
    const same = `${part.kind}|${part.definition}|${kind}`;
    const n = (counts.get(same) ?? 0) + 1;
    counts.set(same, n);
    const label = part.props.label;
    // A label that only repeats the kind ("Clock" on a clock) is not said twice.
    const named = label && kind !== undefined && label.toLowerCase() === kind.toLowerCase() ? kind : `${kind} ${label}`;
    names.set(part.id, label ? named : `${kind} ${n}`);
  }
  namesOf.set(components, { definitions: definitionsVersion(), names });
  return names;
}

/** The canvas is pixels only; this lists switch, keyboard, LED and seven-segment states for screen readers (and browser tests). */
function Readout() {
  const components = useEditor((s) => s.circuit.components);
  // Named once per edit, not per state.
  const names = partNames(components);
  const loaded = useSim((s) => s.loaded);
  const nets = useSim((s) => s.nets);
  const stale = useSim((s) => s.stale);
  const value = (part: CircuitComponent, port: string) => {
    const net = loaded?.portNets[part.id]?.[port];
    const bits = net === undefined ? undefined : nets?.[net];
    return stale || bits === undefined ? "unknown" : showValue(bits, widthOf(part));
  };
  // Inputs first, then outputs (ADR 0021: a keyboard is read as a switch, a seven-segment display as an LED).
  const switches = components.filter((c) => c.kind === "switch" || c.kind === "keyboard");
  const leds = components.filter((c) => c.kind === "led" || c.kind === "seg7");
  return (
    <ul className="visually-hidden" aria-label="Inputs and outputs">
      {switches.map((c) => (
        <li key={c.id}>{`${names.get(c.id)}: ${value(c, "out")}`}</li>
      ))}
      {leds.map((c) => (
        <li key={c.id}>{`${names.get(c.id)}: ${value(c, c.kind === "seg7" ? "seg" : "in")}`}</li>
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
  invalidContents: "A ROM's words do not fit its width or its address space.",
  invalidWidth: "A part has a width or fields the engine cannot use.",
  unknownDefinition: "A component's definition is missing.",
  recursiveDefinition: "A component contains itself, so it cannot be built.",
  invalidPin: "A component has an invalid pin.",
  unknownPort: "A wire ends at a port its part does not have.",
  tooLarge: "The circuit is too large once its components are expanded.",
  invalidId: "An ID contains a slash, which is kept for parts inside components.",
};

/** Whether the open project is saved (ADR 0029); not announced while all is well, as it changes with every edit. */
function SaveStatus() {
  const { available, savedAt, copied, error, projectId } = useProjects();
  if (available === false) return <span className="status-save status-warn">Not saved in this browser</span>;
  if (error)
    return (
      <span className="status-save status-warn" role="alert">
        {error}
      </span>
    );
  if (copied)
    return (
      <span className="status-save status-warn" role="alert">
        Another tab changed or deleted this project, so this work was saved as a copy.
      </span>
    );
  if (!projectId || !savedAt) return null;
  return <span className="status-save">{`Saved ${when(savedAt)}`}</span>;
}

/** Undo and Redo, for those who do not know the shortcuts. */
function HistoryControls() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  return (
    <div className="tool-group" role="group" aria-label="History">
      <ToolButton
        icon="undo"
        label="Undo"
        tip={`Undo (${MOD}+Z)`}
        iconOnly
        className="button-icon"
        aria-keyshortcuts="Control+Z Meta+Z"
        disabled={!canUndo}
        onClick={() => useEditor.getState().undo()}
      />
      <ToolButton
        icon="redo"
        label="Redo"
        tip={`Redo (${MOD}+Shift+Z)`}
        iconOnly
        className="button-icon"
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        disabled={!canRedo}
        onClick={() => useEditor.getState().redo()}
      />
    </div>
  );
}

/** Run/Pause, Step, Reset and the run speed (ADR 0017): the worker runs the clock, the editor only asks. */
function RunControls() {
  const running = useSim((s) => s.running);
  const speed = useSim((s) => s.speed);
  const until = useSim((s) => s.until);
  const components = useEditor((s) => s.circuit.components);
  // Any 1-bit LED on the open sheet can stop a run: an instruction step, a breakpoint, run to halt (ADR 0019).
  const leds = components.filter((c) => c.kind === "led" && (c.props.width ?? 1) === 1);
  const names = partNames(components);
  // A choice whose LED is gone (deleted, or another sheet opened) goes back to a plain run.
  const chosen = leds.some((c) => c.id === until) ? until : null;
  useEffect(() => {
    if (chosen !== until) setUntil(chosen);
  }, [chosen, until]);
  return (
    <div className="run-controls" role="group" aria-label="Simulation">
      {/* As wide for Pause as for Run, so the toolbar does not shift. */}
      <ToolButton
        icon={running ? "pause" : "run"}
        label={running ? "Pause" : "Run"}
        tip={running ? "Stop the clock here" : components.length === 0 ? "Place a part first" : "Start the clock"}
        className={`run-toggle ${running ? "is-running" : "button-primary"}`}
        disabled={!running && components.length === 0}
        onClick={() => control(running ? "pause" : "run")}
      />
      <ToolButton icon="step" label="Step" tip="Advance one clock cycle" onClick={() => control("step")} />
      <ToolButton icon="reset" label="Reset" tip="Clear the state and go back to cycle 0" onClick={() => control("reset")} />
      <span className="toolbar-sep" aria-hidden="true" />
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
      <label className="run-select">
        <span className="visually-hidden">Run until</span>
        <select className="input" value={chosen ?? ""} onChange={(e) => setUntil(e.target.value || null)}>
          <option value="">Until paused</option>
          {leds.map((c) => (
            <option key={c.id} value={c.id}>
              Until {names.get(c.id)} lights
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Whether `parts`, or a definition they are instances of (at any depth), hold a clock or flip-flop. */
function hasClocked(parts: CircuitComponent[], definitions: Definition[], seen = new Set<string>()): boolean {
  return parts.some((c) => {
    if (c.kind === "clock" || c.kind === "dff") return true;
    if (c.kind !== "custom" || !c.definition || seen.has(c.definition)) return false;
    seen.add(c.definition);
    const inner = definitions.find((d) => d.id === c.definition)?.circuit.components ?? [];
    return hasClocked(inner, definitions, seen);
  });
}

/** The ticks the readout's trace shows, and its pixels per tick. */
const TRACE_TICKS = 16;
const TRACE_STEP = 4;

/** The cycle and the clock's level, once the sheet has anything clocked (ADR 0017), over a small live trace of the clock. */
function CycleReadout() {
  const time = useSim((s) => s.time);
  const components = useEditor((s) => s.circuit.components);
  const definitions = useEditor((s) => s.definitions);
  if (!hasClocked(components, definitions)) return null;
  const high = time % 2 === 1;
  // The clock is high on odd ticks: the trace needs only that, newest at the right.
  const ticks = Array.from({ length: TRACE_TICKS }, (_, i) => time - TRACE_TICKS + 1 + i).filter((t) => t >= 0);
  const x = (t: number) => (t - (time - TRACE_TICKS + 1)) * TRACE_STEP;
  const y = (t: number) => (t % 2 === 1 ? 2 : 10);
  return (
    // Outside the status region, which it would flood while running.
    <span className="cycle-readout">
      <svg className="cycle-trace" viewBox={`0 0 ${TRACE_TICKS * TRACE_STEP} 12`} width={TRACE_TICKS * TRACE_STEP} height="12" aria-hidden="true">
        <path className="cycle-low" d={ticks.map((t, i) => `${i ? "V" : `M${x(t)} `}${y(t)}H${x(t) + TRACE_STEP}`).join("")} />
        {/* A clock at 1 is a logic 1: amber, as on a wire. */}
        <path className="cycle-high" d={ticks.flatMap((t) => (t % 2 === 1 ? [`M${x(t)} 2H${x(t) + TRACE_STEP}`] : [])).join("")} />
      </svg>
      <span>
        Cycle {Math.floor((time + 1) / 2)}, clock {high ? "high" : "low"}
      </span>
    </span>
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
  const stopped = useSim((s) => s.stopped);
  const time = useSim((s) => s.time);
  const definitions = useEditor((s) => s.definitions);
  // The cycle counter and clock level, once the sheet has anything clocked, inside components too (ADR 0017).
  const clocked = hasClocked(components, definitions);
  const hovered = useCanvasHints((s) => s.wire);
  // A bus under the pointer: its value, as "8 bits: 44, 0x2C" (ADR 0014).
  const bits = hovered === null || stale ? 1 : (loaded?.wireWidths[hovered] ?? 1);
  const net = hovered === null ? undefined : loaded?.wireNets[hovered];
  const probed = bits > 1 && net !== undefined ? nets?.[net] : undefined;
  // While a part is armed, how to place it.
  // A keyboard part with the keys says so, and how to give them back (ADR 0021).
  const keyboard = useCanvasHints((s) => s.keyboard);
  const placing = useEditor((s) =>
    s.armedLabel
      ? "Placing a label: click a grid point. Esc cancels."
      : s.armed &&
        `Placing ${kindName({ kind: s.armed, definition: s.armedDefinition ?? undefined, props: { width: s.armedWidth } })}: click to place it, R turns it. Esc cancels.`,
  );

  const diagnostics = [...(loaded?.diagnostics ?? []), ...runtime];
  const errors = diagnostics.filter((d) => d.severity === "error");
  const unstable = errors.some((d) => d.code === "unstable");
  // Why the last run ended by itself (ADR 0021): its LED, while the sheet still has it, or the loop that did not settle,
  // which keeps the unstable diagnostic and its part names after "Stopped: ".
  const lit = stopped?.reason === "lit" ? components.find((c) => c.id === stopped.led) : undefined;
  const why = !running && lit && errors.length === 0 ? `Stopped: ${partName(components, lit)} lit.` : null;
  const stoppedUnstable = !running && stopped?.reason === "unstable" && unstable ? "Stopped: " : "";
  const [state, tone] =
    status === "error"
      ? ["Engine error", "danger"]
      : status === "loading"
        ? ["Starting", "muted"]
        : unstable
          ? ["Unstable", "danger"]
          : errors.length > 0
            ? ["Invalid", "danger"]
            : empty
              ? ["No circuit", "muted"]
              : running
                ? ["Running", "ok"]
                : why
                  ? ["Stopped", "ok"]
                  : ["Settled", "ok"];
  const first = errors[0] ?? diagnostics[0];
  // Name the labelled parts involved; unlabelled ones are highlighted on the canvas.
  const named = first
    ? components.filter((c) => c.props.label && first.ids.includes(c.id)).map((c) => partName(components, c))
    : [];
  const message =
    status === "error"
      ? error
      : keyboard
        ? "The keyboard has the keys: what you type goes to the circuit. Esc, Tab or a click elsewhere gives them back."
        : placing ||
          why ||
          (first &&
        `${first.code === "unstable" ? stoppedUnstable : ""}${PLAIN[first.code] ?? first.message}${named.length > 0 ? ` (${named.join(", ")})` : ""}${diagnostics.length > 1 ? ` (+${diagnostics.length - 1} more)` : ""}`) ||
          (clocked && !running && time > 0 && !empty ? "Clock paused." : null);

  // Said once, for what shows only on the canvas: time moved by Step or Reset, another sheet opened.
  const sheet = useEditor((s) => s.sheet);
  const said = useAnnouncement((s) => s.text);
  const last = useRef({ time, sheet });
  useEffect(() => {
    const { time: lastTime, sheet: lastSheet } = last.current;
    last.current = { time, sheet };
    if (sheet !== lastSheet) {
      const name = useEditor.getState().definitions.find((d) => d.id === sheet)?.name;
      announce(name ? `Editing ${name}.` : "Back on the main circuit.");
    } else if (time !== lastTime && !running && clocked) {
      announce(`Now at cycle ${Math.floor((time + 1) / 2)}, clock ${time % 2 === 1 ? "high" : "low"}.`);
    }
  }, [time, sheet, running, clocked]);
  // Every problem, in plain words, for when the status line has room for one.
  const details = useRef<HTMLDialogElement>(null);
  const detailsId = useId();
  const describe = (d: (typeof diagnostics)[number]) => {
    const parts = components.filter((c) => c.props.label && d.ids.includes(c.id)).map((c) => partName(components, c));
    return `${PLAIN[d.code] ?? d.message}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
  };

  return (
    <footer className="statusbar">
      {/* Announced on change; the cycle counter, which changes many times a second while running, is not. */}
      <div className="status-live" role="status">
        <span className={`status-state status-${tone}${state === "Running" ? " status-running" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          {state}
        </span>
        <span className="status-message" title={diagnostics.map((d) => d.message).join("\n")}>
          {message}
        </span>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
      {/* Follows the pointer, so it stays out of the status region. */}
      {probed !== undefined && <span className="status-probe">{`${bits} bits: ${probed}, ${hex(probed, bits)}`}</span>}
      <SaveStatus />
      {diagnostics.length > 1 && (
        <button type="button" className="button button-quiet status-more" onClick={() => details.current?.showModal()}>
          All {diagnostics.length} problems
        </button>
      )}
      <CycleReadout />
      <dialog ref={details} className="dialog" aria-labelledby={detailsId} onKeyDown={(e) => e.stopPropagation()}>
        <h2 id={detailsId} className="type-title dialog-title">
          Problems on this sheet
        </h2>
        <ul className="problem-list type-body">
          {diagnostics.map((d, i) => (
            <li key={`${d.code}:${i}`}>{describe(d)}</li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="button button-quiet type-label" onClick={() => details.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </footer>
  );
}
