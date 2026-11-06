// The PixiJS circuit canvas (ADR 0007), drawn to the design system's CanvasKit
// spec. Reads the editor and engine stores outside React and redraws on change.
// shortcut: the whole scene is redrawn per change; move to per-object updates when profiling says so.
import { Application, Container, Graphics } from "pixi.js";
import type { CircuitComponent } from "../editor/document";
import { useEditor } from "../editor/store";
import type { PortRef } from "../simulation/protocol";
import { useSim } from "../simulation/sync";
import { hitTest, portAt, wirePoints, type Point } from "./geometry";
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
  | { type: "move"; id: string; grab: Point; start: Point; moved: boolean }
  | { type: "wire"; from: PortRef; at: Point };

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
    canvas.style.cursor = armed ? "crosshair" : gesture?.type === "pan" ? "grabbing" : "default";

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
    if (e.button === 1) {
      gesture = { type: "pan", last: { x: e.clientX, y: e.clientY } };
    } else if (e.button === 0 && editor.armed) {
      const { width, height } = LAYOUTS[editor.armed];
      editor.add(editor.armed, { x: Math.round(p.x - width / 2), y: Math.round(p.y - height / 2) });
    } else if (e.button === 0) {
      const hit = hitTest(editor.circuit, p, pick());
      const part = hit?.type === "component" ? editor.circuit.components.find((c) => c.id === hit.id) : undefined;
      if (hit?.type === "port") {
        gesture = { type: "wire", from: hit.ref, at: p };
      } else if (part) {
        if (!editor.selection.includes(part.id)) editor.select([part.id]);
        const grab = { x: p.x - part.position.x, y: p.y - part.position.y };
        gesture = { type: "move", id: part.id, grab, start: { x: e.clientX, y: e.clientY }, moved: false };
      } else if (hit?.type === "wire") {
        editor.select([hit.id]);
      } else {
        editor.select([]);
        gesture = { type: "pan", last: { x: e.clientX, y: e.clientY } };
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
      gesture.moved ||= Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) > DRAG_THRESHOLD;
      const position = { x: Math.round(p.x - gesture.grab.x), y: Math.round(p.y - gesture.grab.y) };
      const id = gesture.id;
      const part = editor.circuit.components.find((c) => c.id === id);
      if (gesture.moved && part && (part.position.x !== position.x || part.position.y !== position.y)) {
        editor.move(part.id, position);
      }
    } else if (gesture?.type === "wire") {
      gesture.at = p;
    }
    const hit = gesture?.type === "pan" || gesture?.type === "move" ? null : hitTest(editor.circuit, p, pick());
    hover = hit?.type === "port" ? hit.ref : null;
    schedule();
  };

  const onPointerUp = (e: PointerEvent) => {
    const editor = useEditor.getState();
    if (gesture?.type === "move" && !gesture.moved) {
      const id = gesture.id;
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
    if ((e.key === "Delete" || e.key === "Backspace") && editor.selection.length > 0) {
      e.preventDefault();
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
    app.destroy(true, { children: true });
  };
}
