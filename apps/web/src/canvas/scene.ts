// The PixiJS circuit canvas (ADR 0007), drawn to the design system's CanvasKit
// spec. Reads the editor and engine stores outside React and redraws on change.
// shortcut: the whole scene is redrawn per change; move to per-object updates when profiling says so.
import { Application, Container, Graphics, Text } from "pixi.js";
import { endOwner, sameEnd, type Circuit, type CircuitComponent } from "../editor/document";
import { useEditor } from "../editor/store";
import type { Endpoint } from "../simulation/protocol";
import { useSim } from "../simulation/sync";
import {
  endAt,
  dragSegment,
  exitOf,
  hitTest,
  itemsInBox,
  nearestOnRoute,
  occupied,
  places,
  placementStacks,
  stacksJunction,
  type Hit,
  type Point,
} from "./geometry";
import { definitionName, layoutOf, layoutsVersion, pinLabel } from "./layout";
import { routes, routesKeeping } from "./routing";

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

type Theme = { color: Record<(typeof COLORS)[number], string>; size: Record<(typeof SIZES)[number], number>; mono: string };

// Pixi cannot read CSS variables: copy the tokens once, and again on theme change.
function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return {
    color: Object.fromEntries(COLORS.map((name) => [name, token(name)])) as Theme["color"],
    size: Object.fromEntries(SIZES.map((name) => [name, parseFloat(token(name))])) as Theme["size"],
    mono: token("font-mono"),
  };
}

type Gesture =
  | { type: "pan"; last: Point }
  // Drags every selected part and junction; `id` is the one under the pointer, `starts` where each began.
  // `blocked`: where the item under the pointer would go if that cell did not stack a junction.
  | {
      type: "move";
      id: string;
      grab: Point;
      starts: Record<string, Point>;
      start: Point;
      moved: boolean;
      recorded: boolean;
      blocked: Point | null;
      /** Routes of wires the drag does not touch, kept as they were while it lasts. */
      frozen: Map<string, Point[]>;
    }
  | { type: "wire"; from: Endpoint; at: Point }
  // Drags one segment of a wire's route sideways (ADR 0011); `route` is the route when pressed.
  | {
      type: "segment";
      wire: string;
      index: number;
      route: Point[];
      exits: [number, number];
      start: Point;
      moved: boolean;
      recorded: boolean;
      frozen: Map<string, Point[]>;
    }
  // Marquee selection; `base` is the selection kept from before (Shift).
  | { type: "box"; from: Point; to: Point; base: string[] };

/** Shape ID of the placement preview; never a document ID (those are UUIDs). */
const GHOST = "placement-preview";

/** Where a part placed at `p` goes: centred on the pointer, turned by `rotation`. */
function placement(part: Pick<CircuitComponent, "kind" | "rotation" | "definition">, p: Point): Point {
  const { width, height } = layoutOf(part);
  return { x: Math.round(p.x - width / 2), y: Math.round(p.y - height / 2) };
}

const positionOf = (circuit: Circuit, id: string) =>
  (circuit.components.find((c) => c.id === id) ?? circuit.junctions.find((j) => j.id === id))?.position;

const samePoint = (a: Point | undefined, b: Point) => a !== undefined && a.x === b.x && a.y === b.y;

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
  /** Parts, each its own Graphics drawn unrotated about its centre and turned by its rotation. */
  const bodies = new Container();
  const shapes = new Map<string, Graphics>();
  /** What each part's shape was last drawn showing; see drawBody. */
  const looks = new Map<string, string>();
  /** Bumped on theme change, so every shape is drawn again in the new colours. */
  let themeVersion = 0;
  const overlay = new Graphics();
  const labels = new Container();
  world.addChild(wires, bodies, labels, overlay);
  /** Label text objects by component ID, reused across redraws. */
  const texts = new Map<string, Text>();
  app.stage.addChild(world);

  let theme = readTheme();
  const view = { x: 48, y: 48, zoom: 1 };
  let gesture: Gesture | null = null;
  /** Where a wire being drawn would attach (a port, junction or point on a wire). */
  let hover: Point | null = null;
  /** Space held: a left drag pans. */
  let spaceHeld = false;
  /** Pointer position on screen while it is over the canvas: where an armed part would be placed (after pan or zoom too). */
  let pointer: { clientX: number; clientY: number } | null = null;

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
    // shortcut: a bus reads as lit whenever it is non-zero, until buses get their own drawing (ADR 0014 step 4).
    const signal = (net: number | undefined): 0 | 1 | null =>
      stale || !nets || net === undefined ? null : nets[net] === 0 ? 0 : 1;
    const at = places(circuit);
    const paths = currentRoutes(circuit);

    wires.clear();
    overlay.clear();

    for (const wire of circuit.wires) {
      const points = paths.get(wire.id)?.map(px);
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

    // CanvasKit: a junction is a 4px dot in its net's state colour, read from any wire on it.
    const wireAt = new Map(circuit.wires.flatMap((w) => [endOwner(w.from), endOwner(w.to)].map((owner) => [owner, w.id])));
    for (const junction of circuit.junctions) {
      const attached = wireAt.get(junction.id);
      const value = signal(attached === undefined ? undefined : loaded?.wireNets[attached]);
      const { x, y } = px(junction.position);
      if (selected.has(junction.id)) wires.circle(x, y, 8).stroke({ width: size["select-width"], color: color.select });
      wires
        .circle(x, y, 4)
        .fill({ color: value === 1 ? color["signal-high"] : color["signal-low"], alpha: value === null ? 0.5 : 1 });
    }

    for (const component of circuit.components) {
      const ports = loaded?.portNets[component.id];
      drawBody(component, culprits.has(component.id), (port) => signal(ports?.[port]));
      if (selected.has(component.id)) {
        const { x, y } = px(component.position);
        const { width, height } = layoutOf(component);
        const pad = 4;
        overlay
          .roundRect(x - pad, y - pad, width * c + 2 * pad, height * c + 2 * pad, size["radius-sm"])
          .stroke({ width: size["select-width"], color: color.select });
      }
    }

    drawLabels(circuit.components);
    const present = new Set(circuit.components.map((component) => component.id));
    // The armed part, half see-through, where a click would place it, turned as it would be.
    if (armed && pointer && !gesture) {
      const rotation = useEditor.getState().armedRotation;
      const definition = useEditor.getState().armedDefinition ?? undefined;
      const shape = { kind: armed, rotation, definition };
      const ghost = { id: GHOST, ...shape, position: placement(shape, toWorld(pointer)), props: {} };
      // Outlined in the danger colour where a click would be refused.
      drawBody(ghost, placementStacks(circuit, ghost), () => null);
      present.add(GHOST);
    }
    for (const [id, shape] of shapes) {
      if (present.has(id)) continue;
      shapes.delete(id);
      looks.delete(id);
      shape.destroy();
    }

    if (gesture?.type === "wire") {
      const start = endAt(at, gesture.from);
      if (start) {
        const a = px(start);
        const b = px(gesture.at);
        overlay.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.5, color: color.accent, cap: "round" });
      }
    }
    if (gesture?.type === "move" && gesture.blocked) {
      // Where the dragged item cannot go: releasing here leaves everything at the last free cell.
      const { x, y } = px(gesture.blocked);
      const { id } = gesture;
      const part = circuit.components.find((c) => c.id === id);
      const danger = { width: size["select-width"], color: color.danger };
      if (part) {
        const { width, height } = layoutOf(part);
        overlay.roundRect(x - 4, y - 4, width * c + 8, height * c + 8, size["radius-sm"]).stroke(danger);
      } else {
        overlay.circle(x, y, 8).stroke(danger);
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
    if (hover) {
      const { x, y } = px(hover);
      overlay.circle(x, y, size["port-size"]).stroke({ width: 2, color: color.accent });
    }
  }

  // CanvasKit: labels in the canvas-label style, ink-muted, centred below the body;
  // a custom component also shows its definition's name (unless labelled) and its pin names inside.
  function drawLabels(components: CircuitComponent[]) {
    const c = cell();
    const style = { fontFamily: theme.mono, fontSize: 11, fontWeight: "500", fill: theme.color["ink-muted"] } as const;
    const seen = new Set<string>();
    const put = (key: string, value: string, x: number, y: number, anchor: Point) => {
      seen.add(key);
      let text = texts.get(key);
      if (!text) {
        // shortcut: rendered at twice the device ratio, so labels soften beyond 2x zoom; switch to BitmapText if that bothers.
        text = new Text({ text: value, style, resolution: 2 * window.devicePixelRatio });
        texts.set(key, text);
        labels.addChild(text);
      }
      if (text.text !== value) text.text = value;
      text.anchor.set(anchor.x, anchor.y);
      text.position.set(x * c, y * c);
    };
    for (const component of components) {
      const layout = layoutOf(component);
      const { x, y } = component.position;
      const caption = component.props.label ?? (component.kind === "custom" ? definitionName(component.definition) : undefined);
      if (caption) put(component.id, caption, x + layout.width / 2, y + layout.height + 6 / c, { x: 0.5, y: 0 });
      if (component.kind !== "custom") continue;
      // Pin names just inside the body, facing in from the side the port is on.
      for (const [port, p] of Object.entries({ ...layout.inputs, ...layout.outputs })) {
        const name = pinLabel(component.definition, port);
        if (!name) continue;
        const inset = 0.3;
        const [dx, dy, anchor] =
          p.x === 0
            ? [inset, 0, { x: 0, y: 0.5 }]
            : p.x === layout.width
              ? [-inset, 0, { x: 1, y: 0.5 }]
              : p.y === 0
                ? [0, inset, { x: 0.5, y: 0 }]
                : [0, -inset, { x: 0.5, y: 1 }];
        put(`${component.id}:${port}`, name, x + p.x + dx, y + p.y + dy, anchor);
      }
    }
    for (const [key, text] of texts) {
      if (seen.has(key)) continue;
      texts.delete(key);
      text.destroy();
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
    let g = shapes.get(component.id);
    if (!g) {
      g = new Graphics();
      shapes.set(component.id, g);
      bodies.addChild(g);
    }
    // Drawn in the part's own unrotated frame, then turned about its centre into the placed box.
    const local = layoutOf({ ...component, rotation: 0 });
    const placed = layoutOf(component);
    const at = px(component.position);
    g.pivot.set((local.width * c) / 2, (local.height * c) / 2);
    g.position.set(at.x + (placed.width * c) / 2, at.y + (placed.height * c) / 2);
    g.angle = component.rotation;
    g.alpha = component.id === GHOST ? 0.5 : 1;
    // Moving or turning a part is only a transform; its shape is rebuilt only when what it shows changes.
    const ports = [...Object.keys(local.inputs), ...Object.keys(local.outputs)];
    // A chip's size and port places follow its definition's pins, so they are part of what is shown.
    const chip = component.kind === "custom" ? layoutsVersion() : "";
    const look = `${component.kind}|${local.width}x${local.height}|${chip}|${culprit}|${ports.map(value).join()}|${themeVersion}`;
    if (looks.get(component.id) === look) return;
    looks.set(component.id, look);
    g.clear();
    const [x, y] = [0, 0];
    const body = { color: color["panel-raised"] };
    const outline = { width: 1.5, color: culprit ? color.danger : color["line-strong"] };
    const bubble = (bx: number, by: number) => g.circle(bx, by, 4).fill(body).stroke(outline);
    const lead = (x1: number, x2: number, ly: number) => g.moveTo(x1, ly).lineTo(x2, ly).stroke(outline);

    switch (component.kind) {
      case "custom": {
        // A chip: a plain box; its name and pin names are drawn as labels.
        g.roundRect(x, y, local.width * c, local.height * c, size["radius-sm"]).fill(body).stroke(outline);
        break;
      }
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

    const layout = local;
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

  /** Routes for drawing and picking: during a drag, wires it does not touch keep their routes (ADR 0011). */
  function currentRoutes(circuit: Circuit) {
    const g = gesture;
    return (g?.type === "move" || g?.type === "segment") && g.moved ? routesKeeping(circuit, g.frozen) : routes(circuit);
  }

  /** Routes as they are now, without the wires that touch `ids` or are `wire`: what a starting drag freezes. */
  function frozenFor(circuit: Circuit, ids: Set<string>, wire?: string) {
    const all = routes(circuit);
    return new Map(
      circuit.wires
        .filter((w) => w.id !== wire && !ids.has(endOwner(w.from)) && !ids.has(endOwner(w.to)))
        .flatMap((w) => {
          const points = all.get(w.id);
          return points ? [[w.id, points] as const] : [];
        }),
    );
  }

  /** Ends a drag; a cancelled one is taken back entirely, with nothing left to redo. */
  function endGesture(cancel: boolean) {
    const g = gesture;
    gesture = null;
    if (cancel && (g?.type === "move" || g?.type === "segment") && g.recorded) useEditor.getState().revert();
    schedule();
  }

  /**
   * What a wire dropped at `p` attaches to: a port, a junction, or (while wiring)
   * a grid point on a wire, which the drop splits. A point at a wire's own end
   * attaches to that end instead.
   */
  function target(circuit: Circuit, hit: Hit, p: Point, wiring: boolean): { at: Point; end?: Endpoint; wire?: string } | null {
    const at = places(circuit);
    if (hit?.type === "port" || hit?.type === "junction") {
      const end: Endpoint = hit.type === "port" ? hit.ref : { junction: hit.id };
      const point = endAt(at, end);
      return point ? { at: point, end } : null;
    }
    const wire = wiring && hit?.type === "wire" ? circuit.wires.find((w) => w.id === hit.id) : undefined;
    const points = wire && currentRoutes(circuit).get(wire.id);
    const point = points && nearestOnRoute(points, p);
    if (!wire || !point) return null;
    const end = [wire.from, wire.to].find((e) => samePoint(endAt(at, e), point));
    if (end) return { at: point, end };
    // Never drop a junction onto another port or junction: two dots on one spot would look joined.
    return occupied(circuit, point) ? null : { at: point, wire: wire.id };
  }

  const onPointerDown = (e: PointerEvent) => {
    const p = toWorld(e);
    // Leaving a field commits it (the inspector's label) before this press changes the selection.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const editor = useEditor.getState();
    canvas.setPointerCapture(e.pointerId);
    // A press on the canvas ends any page text selection, so the next copy is the canvas's again.
    window.getSelection()?.removeAllRanges();
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      gesture = { type: "pan", last: { x: e.clientX, y: e.clientY } };
    } else if (e.button === 0 && editor.armed) {
      const part = { id: GHOST, kind: editor.armed, rotation: editor.armedRotation, definition: editor.armedDefinition ?? undefined, props: {} };
      const position = placement(part, p);
      // A port on a junction would look joined: refused, and the part stays armed (the preview shows why).
      if (!placementStacks(editor.circuit, { ...part, position })) editor.add(part.kind, position);
    } else if (e.button === 0) {
      const hit = hitTest(editor.circuit, p, pick(), currentRoutes(editor.circuit));
      const item = hit?.type === "component" || hit?.type === "junction" ? hit.id : undefined;
      const position = item && positionOf(editor.circuit, item);
      if (hit?.type === "port") {
        gesture = { type: "wire", from: hit.ref, at: p };
      } else if (hit?.type === "junction" && !e.shiftKey && !editor.selection.includes(hit.id)) {
        // An unselected junction draws a wire, as a port does; once selected it drags like a part.
        gesture = { type: "wire", from: { junction: hit.id }, at: p };
      } else if (item && e.shiftKey) {
        editor.select(toggled(editor.selection, item));
      } else if (item && position) {
        if (!editor.selection.includes(item)) editor.select([item]);
        const selected = new Set(useEditor.getState().selection);
        const movable = [...editor.circuit.components, ...editor.circuit.junctions].filter((m) => selected.has(m.id));
        const starts = Object.fromEntries(movable.map((m) => [m.id, m.position]));
        const grab = { x: p.x - position.x, y: p.y - position.y };
        const start = { x: e.clientX, y: e.clientY };
        const frozen = frozenFor(editor.circuit, selected);
        gesture = { type: "move", id: item, grab, starts, start, moved: false, recorded: false, blocked: null, frozen };
      } else if (hit?.type === "wire" && e.shiftKey) {
        editor.select(toggled(editor.selection, hit.id));
      } else if (hit?.type === "wire") {
        editor.select([hit.id]);
        const wire = editor.circuit.wires.find((w) => w.id === hit.id);
        const route = currentRoutes(editor.circuit).get(hit.id);
        if (wire && route) {
          const at = places(editor.circuit);
          const exits: [number, number] = [exitOf(at, wire.from), exitOf(at, wire.to)];
          const start = { x: e.clientX, y: e.clientY };
          const frozen = frozenFor(editor.circuit, new Set(), wire.id);
          gesture = { type: "segment", wire: wire.id, index: hit.segment, route, exits, start, moved: false, recorded: false, frozen };
        }
      } else {
        const base = e.shiftKey ? editor.selection : [];
        editor.select(base);
        gesture = { type: "box", from: p, to: p, base };
      }
    }
    schedule();
  };

  const onPointerMove = (e: PointerEvent) => {
    pointer = { clientX: e.clientX, clientY: e.clientY };
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
      const current = positionOf(editor.circuit, g.id);
      if (g.moved && anchor && current) {
        // Snap the item under the pointer; everything else selected moves by the same cells.
        const dx = Math.round(p.x - g.grab.x) - anchor.x;
        const dy = Math.round(p.y - g.grab.y) - anchor.y;
        const positions = Object.fromEntries(Object.entries(g.starts).map(([id, s]) => [id, { x: s.x + dx, y: s.y + dy }]));
        // A cell that would stack a junction on a port or junction is skipped (and outlined in danger);
        // the items wait at the last free cell.
        const wanted = { x: anchor.x + dx, y: anchor.y + dy };
        const stacks = stacksJunction(editor.circuit, positions);
        g.blocked = stacks ? wanted : null;
        if ((current.x !== wanted.x || current.y !== wanted.y) && !stacks) {
          // The whole drag is one undo step.
          if (!g.recorded) editor.record();
          g.recorded = true;
          editor.move(positions);
        }
      }
    } else if (gesture?.type === "segment") {
      const g = gesture;
      g.moved ||= Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > DRAG_THRESHOLD;
      if (g.moved) {
        const next = dragSegment(g.route, g.index, { x: Math.round(p.x), y: Math.round(p.y) }, g.exits);
        const bends = next.slice(1, -1);
        const wire = editor.circuit.wires.find((w) => w.id === g.wire);
        if (wire && JSON.stringify(bends) !== JSON.stringify(currentRoutes(editor.circuit).get(wire.id)?.slice(1, -1))) {
          // The whole drag is one undo step.
          if (!g.recorded) editor.record();
          g.recorded = true;
          editor.shape(g.wire, bends);
        }
      }
    } else if (gesture?.type === "wire") {
      gesture.at = p;
    } else if (gesture?.type === "box") {
      gesture.to = p;
      const boxed = new Set([...gesture.base, ...itemsInBox(editor.circuit, gesture.from, p)]);
      // Wires between selected items are selected too, so the highlight matches what copy and delete take.
      const wires = editor.circuit.wires.filter((w) => boxed.has(endOwner(w.from)) && boxed.has(endOwner(w.to)));
      editor.select([...new Set([...boxed, ...wires.map((w) => w.id)])]);
    }
    const hit = gesture?.type === "wire" || !gesture ? hitTest(editor.circuit, p, pick(), currentRoutes(editor.circuit)) : null;
    hover = target(editor.circuit, hit, p, gesture?.type === "wire")?.at ?? null;
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
      const p = toWorld(e);
      const end = target(editor.circuit, hitTest(editor.circuit, p, pick(), currentRoutes(editor.circuit)), p, true);
      const from = gesture.from;
      if (end?.wire) editor.connectToWire(from, end.wire, end.at);
      // Released on the junction it started from: a click, which selects it.
      else if (end?.end && "junction" in from && sameEnd(from, end.end)) editor.select([from.junction]);
      else if (end?.end) editor.connect(from, end.end);
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
    } else if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      key === "r" &&
      // Armed from a part tile, focus is still on that button: R must still turn the part being placed.
      (editor.armed || (onCanvas && editor.selection.length > 0))
    ) {
      e.preventDefault();
      gesture = null;
      // While placing, R turns the part about to be placed; otherwise the selection.
      if (editor.armed) editor.turnArmed(e.shiftKey ? -1 : 1);
      else editor.rotate(editor.selection, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      // During a drag, Escape puts things back where the drag started; otherwise it clears.
      if (gesture?.type === "move" || gesture?.type === "segment") return endGesture(true);
      gesture = null;
      editor.arm(null);
      editor.select([]);
      schedule();
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  // A cancelled press (OS interruption, lost touch) is not a release: take back what it did.
  canvas.addEventListener("pointercancel", () => endGesture(true));
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
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
    themeVersion++;
    // Labels are recreated in the new theme's ink.
    for (const text of texts.values()) text.destroy();
    texts.clear();
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
