// The PixiJS circuit canvas (ADR 0007), drawn to the design system's CanvasKit
// spec. Reads the editor and engine stores outside React and redraws on change.
// shortcut: the whole scene is redrawn per change; move to per-object updates when profiling says so.
import { Application, Container, Graphics } from "pixi.js";
import type { CircuitComponent } from "../editor/document";
import { useEditor } from "../editor/store";
import type { PortRef } from "../simulation/protocol";
import { useSim } from "../simulation/sync";
import { componentsInBox, hitTest, portAt, wirePoints, type Point } from "./geometry";
import { LAYOUTS } from "./layout";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** Pointer travel (px) before a press on a part counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

const COLORS = [
  "bench",
  "panel-raised",
  "line-strong",
  "ink-muted",
  "signal-high",
  "signal-high-soft",
  "on-signal-high",
  "signal-low",
  "select",
  "accent",
  "accent-soft",
  "danger",
] as const;
const SIZES = ["grid-cell", "wire-width", "wire-width-high", "select-width", "port-size", "hit-slop", "radius-sm"] as const;

type Theme = { color: Record<(typeof COLORS)[number], string>; size: Record<(typeof SIZES)[number], number> };

// Pixi cannot read CSS variables: copy the tokens once, and again on theme change.
function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return {
    color: Object.fromEntries(COLORS.map((name) => [name, token(name)])) as Theme["color"],
    size: Object.fromEntries(SIZES.map((name) => [name, parseFloat(token(name))])) as Theme["size"],
  };
}

type Gesture =
  | { type: "pan"; last: Point }
  // Drags every selected part; `id` is the one under the pointer, `starts` where each part began.
  | { type: "move"; id: string; grab: Point; starts: Record<string, Point>; start: Point; moved: boolean; recorded: boolean }
  | { type: "wire"; from: PortRef; at: Point }
  // Marquee selection; `base` is the selection kept from before (Shift).
  | { type: "box"; from: Point; to: Point; base: string[] };

const toggled = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

export async function mountCanvas(host: HTMLElement): Promise<() => void> {
  const app = new Application();
  await app.init({
    autoStart: false,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    width: host.clientWidth,
    height: host.clientHeight,
  });
  const canvas = app.canvas;
  host.appendChild(canvas);

  const world = new Container();
  const wires = new Graphics();
  const bodies = new Graphics();
  const overlay = new Graphics();
  world.addChild(wires, bodies, overlay);
  app.stage.addChild(world);

  let theme = readTheme();
  const view = { x: 48, y: 48, zoom: 1 };
  let gesture: Gesture | null = null;
  let hover: PortRef | null = null;
  /** Space held: a left drag pans. */
  let spaceHeld = false;

  let frame = 0;
  const schedule = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      draw();
      app.render();
    });
  };

  const cell = () => theme.size["grid-cell"];
  const px = (p: Point) => ({ x: p.x * cell(), y: p.y * cell() });

  function draw() {
    const { circuit, selection, armed } = useEditor.getState();
    const { loaded, nets, stale, runtime } = useSim.getState();
    const { color, size } = theme;
    const c = cell();

    world.position.set(view.x, view.y);
    world.scale.set(view.zoom);
    // Grid dots are the host's CSS background; every fourth dot when zoomed far out.
    const step = c * view.zoom * (view.zoom < 0.5 ? 4 : 1);
    host.style.backgroundSize = `${step}px ${step}px`;
    host.style.backgroundPosition = `${view.x - step / 2}px ${view.y - step / 2}px`;
    canvas.style.cursor = armed ? "crosshair" : gesture?.type === "pan" ? "grabbing" : spaceHeld ? "grab" : "default";

    const culprits = new Set(
      [...(loaded?.diagnostics ?? []), ...runtime].filter((d) => d.severity === "error").flatMap((d) => d.ids),
    );
    const selected = new Set(selection);
    // A value is shown only once the engine has reported on the current document.
    const signal = (net: number | undefined): 0 | 1 | null =>
      stale || !nets || net === undefined ? null : nets[net] === 1 ? 1 : 0;
    const byId = new Map(circuit.components.map((component) => [component.id, component]));

    wires.clear();
    bodies.clear();
    overlay.clear();

    for (const wire of circuit.wires) {
      const points = wirePoints(byId, wire)?.map(px);
      if (!points) continue;
      const value = signal(loaded?.wireNets[wire.id]);
      const width = value === 1 ? size["wire-width-high"] : size["wire-width"];
      if (selected.has(wire.id)) {
        polyline(wires, points).stroke({ width: width + 2 * size["select-width"], color: color.select, cap: "round", join: "round" });
      }
      polyline(wires, points).stroke({
        width,
        color: culprits.has(wire.id) ? color.danger : value === 1 ? color["signal-high"] : color["signal-low"],
        alpha: value === null ? 0.5 : 1,
        cap: "round",
        join: "round",
      });
    }

    for (const component of circuit.components) {
      const ports = loaded?.portNets[component.id];
      drawBody(component, culprits.has(component.id), (port) => signal(ports?.[port]));
      if (selected.has(component.id)) {
        const { x, y } = px(component.position);
        const { width, height } = LAYOUTS[component.kind];
        const pad = 4;
        overlay
          .roundRect(x - pad, y - pad, width * c + 2 * pad, height * c + 2 * pad, size["radius-sm"])
          .stroke({ width: size["select-width"], color: color.select });
      }
    }

    if (gesture?.type === "wire") {
      const fromPart = byId.get(gesture.from.component);
      const start = fromPart && portAt(fromPart, gesture.from.port);
      if (start) {
        const a = px(start);
        const b = px(gesture.at);
        overlay.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.5, color: color.accent, cap: "round" });
      }
    }
    if (gesture?.type === "box") {
      const a = px(gesture.from);
      const b = px(gesture.to);
      overlay
        .rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
        .fill({ color: color["accent-soft"], alpha: 0.4 })
        .stroke({ width: 1 / view.zoom, color: color.select });
    }
    const hoverPart = hover && byId.get(hover.component);
    const hoverAt = hover && hoverPart && portAt(hoverPart, hover.port);
    if (hoverAt) {
      const { x, y } = px(hoverAt);
      overlay.circle(x, y, size["port-size"]).stroke({ width: 2, color: color.accent });
    }
  }

  function polyline(g: Graphics, points: Point[]) {
    const [first, ...rest] = points;
    if (first) g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    return g;
  }

  function drawBody(component: CircuitComponent, culprit: boolean, value: (port: string) => 0 | 1 | null) {
    const { color, size } = theme;
    const c = cell();
    const { x, y } = px(component.position);
    const body = { color: color["panel-raised"] };
    const outline = { width: 1.5, color: culprit ? color.danger : color["line-strong"] };
    const g = bodies;
    const bubble = (bx: number, by: number) => g.circle(bx, by, 4).fill(body).stroke(outline);
    const lead = (x1: number, x2: number, ly: number) => g.moveTo(x1, ly).lineTo(x2, ly).stroke(outline);

    switch (component.kind) {
      case "switch": {
        g.roundRect(x, y, 2 * c, 2 * c, size["radius-sm"]).fill(body).stroke(outline);
        if (value("out") === 1) {
          g.roundRect(x + 8, y + 8, 16, 16, 2).fill({ color: color["signal-high"] });
          g.moveTo(x + 16, y + 12).lineTo(x + 16, y + 20).stroke({ width: 2, color: color["on-signal-high"], cap: "round" });
        } else {
          g.roundRect(x + 9, y + 9, 14, 14, 2).stroke({ width: 2, color: color["signal-low"] });
        }
        break;
      }
      case "led": {
        const cx = x + c;
        const cy = y + c;
        lead(x, cx - 10, cy);
        if (value("in") === 1) {
          g.circle(cx, cy, 18).fill({ color: color["signal-high-soft"] });
          g.circle(cx, cy, 11).fill({ color: color["signal-high"] });
        } else {
          g.circle(cx, cy, 10).fill(body).stroke({ width: 2, color: culprit ? color.danger : color["signal-low"] });
        }
        break;
      }
      case "not":
        g.moveTo(x, y).lineTo(x + 2.5 * c, y + c).lineTo(x, y + 2 * c).closePath().fill(body).stroke(outline);
        bubble(x + 2.75 * c, y + c);
        break;
      case "and":
      case "nand": {
        // IEEE distinctive shape: flat back, semicircular front; NAND makes room for its bubble.
        const front = component.kind === "and" ? 4 * c : 3.5 * c;
        const r = 2 * c;
        g.moveTo(x, y)
          .lineTo(x + front - r, y)
          .arc(x + front - r, y + r, r, -Math.PI / 2, Math.PI / 2)
          .lineTo(x, y + 2 * r)
          .closePath()
          .fill(body)
          .stroke(outline);
        if (component.kind === "nand") bubble(x + 3.75 * c, y + 2 * c);
        break;
      }
      case "or":
      case "nor":
      case "xor":
      case "xnor": {
        const exclusive = component.kind === "xor" || component.kind === "xnor";
        const inverted = component.kind === "nor" || component.kind === "xnor";
        const back = x + (exclusive ? 0.5 * c : 0);
        const tip = x + (inverted ? 3.5 * c : 4 * c);
        const h = 4 * c;
        g.moveTo(back, y)
          .quadraticCurveTo(back + 0.6 * (tip - back), y, tip, y + h / 2)
          .quadraticCurveTo(back + 0.6 * (tip - back), y + h, back, y + h)
          .quadraticCurveTo(back + c, y + h / 2, back, y)
          .closePath()
          .fill(body)
          .stroke(outline);
        if (exclusive) g.moveTo(x, y).quadraticCurveTo(x + c, y + h / 2, x, y + h).stroke(outline);
        // The concave back sits 3/8 of a cell in at the input rows.
        lead(x, back + 0.375 * c, y + c);
        lead(x, back + 0.375 * c, y + 3 * c);
        if (inverted) bubble(x + 3.75 * c, y + 2 * c);
        break;
      }
    }

    const layout = LAYOUTS[component.kind];
    const r = size["port-size"] / 2;
    for (const p of Object.values(layout.inputs)) {
      g.circle(x + p.x * c, y + p.y * c, r).fill({ color: color.bench }).stroke({ width: 1.5, color: color["ink-muted"] });
    }
    for (const p of Object.values(layout.outputs)) {
      g.circle(x + p.x * c, y + p.y * c, r).fill({ color: color["ink-muted"] });
    }
  }

  // --- Input ---------------------------------------------------------------

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvas.getBoundingClientRect();
    const scale = view.zoom * cell();
    return { x: (e.clientX - rect.left - view.x) / scale, y: (e.clientY - rect.top - view.y) / scale };
  };
  // Pick radius is set in screen pixels so ports stay clickable when zoomed out.
  const pick = () => (theme.size["port-size"] / 2 + theme.size["hit-slop"]) / (view.zoom * cell());

  const onPointerDown = (e: PointerEvent) => {
    const p = toWorld(e);
    const editor = useEditor.getState();
    canvas.setPointerCapture(e.pointerId);
    // A press on the canvas ends any page text selection, so the next copy is the canvas's again.
    window.getSelection()?.removeAllRanges();
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      gesture = { type: "pan", last: { x: e.clientX, y: e.clientY } };
    } else if (e.button === 0 && editor.armed) {
      const { width, height } = LAYOUTS[editor.armed];
      editor.add(editor.armed, { x: Math.round(p.x - width / 2), y: Math.round(p.y - height / 2) });
    } else if (e.button === 0) {
      const hit = hitTest(editor.circuit, p, pick());
      const part = hit?.type === "component" ? editor.circuit.components.find((c) => c.id === hit.id) : undefined;
      if (hit?.type === "port") {
        gesture = { type: "wire", from: hit.ref, at: p };
      } else if (part && e.shiftKey) {
        editor.select(toggled(editor.selection, part.id));
      } else if (part) {
        if (!editor.selection.includes(part.id)) editor.select([part.id]);
        const selected = new Set(useEditor.getState().selection);
        const starts = Object.fromEntries(editor.circuit.components.filter((c) => selected.has(c.id)).map((c) => [c.id, c.position]));
        const grab = { x: p.x - part.position.x, y: p.y - part.position.y };
        gesture = { type: "move", id: part.id, grab, starts, start: { x: e.clientX, y: e.clientY }, moved: false, recorded: false };
      } else if (hit?.type === "wire") {
        editor.select(e.shiftKey ? toggled(editor.selection, hit.id) : [hit.id]);
      } else {
        const base = e.shiftKey ? editor.selection : [];
        editor.select(base);
        gesture = { type: "box", from: p, to: p, base };
      }
    }
    schedule();
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = toWorld(e);
    const editor = useEditor.getState();
    if (gesture?.type === "pan") {
      view.x += e.clientX - gesture.last.x;
      view.y += e.clientY - gesture.last.y;
      gesture.last = { x: e.clientX, y: e.clientY };
    } else if (gesture?.type === "move") {
      const g = gesture;
      g.moved ||= Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > DRAG_THRESHOLD;
      const anchor = g.starts[g.id];
      const part = editor.circuit.components.find((c) => c.id === g.id);
      if (g.moved && anchor && part) {
        // Snap the part under the pointer; every other selected part moves by the same cells.
        const dx = Math.round(p.x - g.grab.x) - anchor.x;
        const dy = Math.round(p.y - g.grab.y) - anchor.y;
        if (part.position.x !== anchor.x + dx || part.position.y !== anchor.y + dy) {
          // The whole drag is one undo step.
          if (!g.recorded) editor.record();
          g.recorded = true;
          editor.move(Object.fromEntries(Object.entries(g.starts).map(([id, s]) => [id, { x: s.x + dx, y: s.y + dy }])));
        }
      }
    } else if (gesture?.type === "wire") {
      gesture.at = p;
    } else if (gesture?.type === "box") {
      gesture.to = p;
      const boxed = new Set([...gesture.base, ...componentsInBox(editor.circuit, gesture.from, p)]);
      // Wires between selected parts are selected too, so the highlight matches what copy and delete take.
      const wires = editor.circuit.wires.filter((w) => boxed.has(w.from.component) && boxed.has(w.to.component));
      editor.select([...new Set([...boxed, ...wires.map((w) => w.id)])]);
    }
    const hit = gesture?.type === "wire" || !gesture ? hitTest(editor.circuit, p, pick()) : null;
    hover = hit?.type === "port" ? hit.ref : null;
    schedule();
  };

  const onPointerUp = (e: PointerEvent) => {
    const editor = useEditor.getState();
    if (gesture?.type === "move" && !gesture.moved) {
      const id = gesture.id;
      // A plain click inside a multi-selection narrows it to the clicked part.
      if (editor.selection.length > 1) editor.select([id]);
      if (editor.circuit.components.find((c) => c.id === id)?.kind === "switch") editor.toggle(id);
    } else if (gesture?.type === "wire") {
      const hit = hitTest(editor.circuit, toWorld(e), pick());
      if (hit?.type === "port") editor.connect(gesture.from, hit.ref);
    }
    gesture = null;
    schedule();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    // Keep the point under the cursor fixed.
    view.x = sx - ((sx - view.x) * zoom) / view.zoom;
    view.y = sy - ((sy - view.y) * zoom) / view.zoom;
    view.zoom = zoom;
    schedule();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const editor = useEditor.getState();
    // Only with focus on the page itself: Backspace on a focused button or field is not a canvas edit.
    const onCanvas = e.target === document.body;
    const key = e.key.toLowerCase();
    const undo = (e.ctrlKey || e.metaKey) && !e.altKey && key === "z" && !e.shiftKey;
    const redo = (e.ctrlKey || e.metaKey) && !e.altKey && ((key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey));
    if (undo || redo) {
      e.preventDefault();
      // A gesture in progress refers to the circuit being replaced.
      gesture = null;
      if (undo) editor.undo();
      else editor.redo();
    } else if (
      onCanvas &&
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey &&
      ["c", "x", "v", "d", "a"].includes(key) &&
      // Selected page text (a diagnostic, say) copies the native way.
      !((key === "c" || key === "x") && !window.getSelection()?.isCollapsed)
    ) {
      e.preventDefault(); // also stops the browser's own Ctrl+D bookmark and Ctrl+A select-all
      gesture = null;
      if (key === "c") editor.copy();
      else if (key === "x") editor.cut();
      else if (key === "v") editor.paste();
      else if (key === "d") editor.duplicate();
      else editor.selectAll();
    } else if (onCanvas && e.key === " ") {
      e.preventDefault();
      spaceHeld = true;
      schedule();
    } else if (onCanvas && (e.key === "Delete" || e.key === "Backspace") && editor.selection.length > 0) {
      e.preventDefault();
      gesture = null;
      editor.remove(editor.selection);
    } else if (e.key === "Escape") {
      gesture = null;
      editor.arm(null);
      editor.select([]);
      schedule();
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  // A cancelled press (OS interruption, lost touch) is not a release: change nothing.
  canvas.addEventListener("pointercancel", () => {
    gesture = null;
    schedule();
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  const releaseSpace = (e: KeyboardEvent | FocusEvent) => {
    if (e instanceof KeyboardEvent && e.key !== " ") return;
    spaceHeld = false;
    schedule();
  };
  window.addEventListener("keyup", releaseSpace);
  window.addEventListener("blur", releaseSpace);

  const resize = new ResizeObserver(() => {
    app.renderer.resize(host.clientWidth, host.clientHeight);
    schedule();
  });
  resize.observe(host);

  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    theme = readTheme();
    schedule();
  };
  scheme.addEventListener("change", onScheme);

  const unsubscribe = [useEditor.subscribe(schedule), useSim.subscribe(schedule)];
  schedule();

  return () => {
    unsubscribe.forEach((stop) => stop());
    cancelAnimationFrame(frame);
    resize.disconnect();
    scheme.removeEventListener("change", onScheme);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", releaseSpace);
    window.removeEventListener("blur", releaseSpace);
    app.destroy(true, { children: true });
  };
}
