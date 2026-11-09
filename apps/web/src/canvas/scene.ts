// The PixiJS circuit canvas (ADR 0007), drawn to the design system's CanvasKit
// spec. Reads the editor and engine stores outside React and redraws on change.
// shortcut: the whole scene is redrawn per change; move to per-object updates when profiling says so.
import { Application, Container, Graphics, Text } from "pixi.js";
import { create } from "zustand";
import {
  DEFAULT_FIELDS,
  endOwner,
  fieldRanges,
  hex,
  DEFAULT_ADDRESS,
  isFielded,
  isMemory,
  sameEnd,
  type Circuit,
  type CircuitComponent,
  type Junction,
} from "../editor/document";
import { armedProps, useEditor } from "../editor/store";
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
  "signal-bus",
  "select",
  "accent",
  "accent-soft",
  "danger",
  "caution",
  "ink",
] as const;
const SIZES = ["grid-cell", "wire-width", "wire-width-high", "bus-width", "select-width", "port-size", "hit-slop", "radius-sm"] as const;

/**
 * What the canvas tells the rest of the editor: the wire under the pointer (the status
 * bar shows a bus's value), and a wide switch just clicked, whose Value field takes focus.
 */
export const useCanvasHints = create<{ wire: string | null; focusValue: string | null; zoom: number }>(() => ({
  wire: null,
  focusValue: null,
  zoom: 1,
}));

/** The zoom controls' commands, bound while a canvas is mounted. */
export const viewControls: { zoomBy?: (factor: number) => void; fit?: () => void } = {};

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
function placement(part: Pick<CircuitComponent, "kind" | "rotation" | "definition" | "props">, p: Point): Point {
  const { width, height } = layoutOf(part);
  return { x: Math.round(p.x - width / 2), y: Math.round(p.y - height / 2) };
}

const positionOf = (circuit: Circuit, id: string) =>
  (circuit.components.find((c) => c.id === id) ?? circuit.junctions.find((j) => j.id === id))?.position;

const samePoint = (a: Point | undefined, b: Point) => a !== undefined && a.x === b.x && a.y === b.y;

const toggled = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

/** Starts the canvas in `host`; `bind` makes it the one the zoom controls drive. Resolves to its stop function. */
export async function mountCanvas(host: HTMLElement): Promise<{ stop: () => void; bind: () => void }> {
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
  /** A label placed by the current press, whose Name field takes focus when it is released. */
  let placedLabel: string | null = null;
  /** Each label tag's box as last drawn, in world pixels (before pan and zoom), keyed by junction ID. */
  const tagBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  /** The label whose tag is under `p`; a box from the last frame counts only while its label still has a name. */
  const tagAt = (p: Point) => {
    const { x, y } = px(p);
    const id = [...tagBoxes].reverse().find(([, b]) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.[0];
    return id && useEditor.getState().circuit.junctions.some((j) => j.id === id && j.name) ? id : undefined;
  };
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
    const { circuit, selection, armed, armedLabel } = useEditor.getState();
    const { loaded, nets, stale, runtime } = useSim.getState();
    const { color, size } = theme;
    const c = cell();
    tagBoxes.clear();

    world.position.set(view.x, view.y);
    world.scale.set(view.zoom);
    // Grid dots are the host's CSS background; every fourth dot when zoomed far out.
    const step = c * view.zoom * (view.zoom < 0.5 ? 4 : 1);
    host.style.backgroundSize = `${step}px ${step}px`;
    host.style.backgroundPosition = `${view.x - step / 2}px ${view.y - step / 2}px`;
    canvas.style.cursor = armed || armedLabel ? "crosshair" : gesture?.type === "pan" ? "grabbing" : spaceHeld ? "grab" : "default";

    const culprits = new Set(
      [...(loaded?.diagnostics ?? []), ...runtime].filter((d) => d.severity === "error").flatMap((d) => d.ids),
    );
    const selected = new Set(selection);
    // A value is shown only once the engine has reported on the current document.
    const signal = (net: number | undefined): number | null => (stale || !nets || net === undefined ? null : (nets[net] ?? 0));
    // The engine reports each wire's width (ADR 0014). While an edit waits for it, the last report stands (wire IDs are
    // stable), so buses do not thin for a frame; with no netlist (validation errors) every wire is 1 bit.
    const bitsOf = (wire: string | undefined) => (wire === undefined ? 1 : (loaded?.wireWidths[wire] ?? 1));
    /** Hex tags of hovered buses, drawn once every wire is, so no other wire crosses them. */
    const tags: (() => void)[] = [];
    const at = places(circuit);
    const paths = currentRoutes(circuit);
    const hovered = useCanvasHints.getState().wire;

    wires.clear();
    overlay.clear();
    seen.clear();

    for (const wire of circuit.wires) {
      const points = paths.get(wire.id)?.map(px);
      if (!points) continue;
      const value = signal(loaded?.wireNets[wire.id]);
      const bits = bitsOf(wire.id);
      // CanvasKit: a bus has one width and colour whatever it carries; a slash tag gives its width, a hex tag on hover its value.
      const lit = bits === 1 && value !== null && value !== 0;
      const width = bits > 1 ? size["bus-width"] : lit ? size["wire-width-high"] : size["wire-width"];
      if (selected.has(wire.id)) {
        polyline(wires, points).stroke({ width: width + 2 * size["select-width"], color: color.select, cap: "round", join: "round" });
      }
      polyline(wires, points).stroke({
        width,
        color: culprits.has(wire.id) ? color.danger : bits > 1 ? color["signal-bus"] : lit ? color["signal-high"] : color["signal-low"],
        alpha: value === null ? 0.5 : 1,
        cap: "round",
        join: "round",
      });
      const [a, b] = points;
      if (bits > 1 && a && b) {
        // The slash crosses the middle of the first segment, with the width just past it.
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const across = a.y === b.y ? { x: 4, y: -8 } : { x: 8, y: -4 };
        const bus = { width: 1.5, color: color["signal-bus"], cap: "round" } as const;
        wires.moveTo(m.x - across.x, m.y - across.y).lineTo(m.x + across.x, m.y + across.y).stroke(bus);
        put(`${wire.id}:bits`, String(bits), m.x + 6, m.y - 6, { x: 0, y: 1 }, color["signal-bus"]);
        if (hovered === wire.id && value !== null) {
          tags.push(() => {
            const tag = put(`${wire.id}:value`, hex(value, bits), m.x + 10, m.y + 10, { x: 0, y: 0 }, color["signal-bus"]);
            wires
              .roundRect(m.x + 6, m.y + 7, tag.width + 8, tag.height + 6, size["radius-sm"])
              .fill({ color: color.bench })
              .stroke({ width: 1.5, color: color["signal-bus"] });
          });
        }
      }
    }
    for (const tag of tags) tag();

    // ADR 0015: a named junction is a tag beside its dot, on the first side (right, left, below, above)
    // that none of its wires leaves from. Its outline is the net's tone, or caution while unmatched.
    const unmatched = new Set((loaded?.diagnostics ?? []).filter((d) => d.code === "unmatchedLabel").flatMap((d) => d.ids));
    // The selected label's name: its partners on the sheet are outlined too. A display aid only; the engine joins them.
    const chosen = selection.length === 1 ? circuit.junctions.find((j) => j.id === selection[0])?.name : undefined;
    // The sides each junction's wires leave from, from their routes, in one pass over the wires.
    const sides = new Map<string, Set<string>>();
    for (const w of circuit.wires) {
      const points = paths.get(w.id);
      if (!points || points.length < 2) continue;
      for (const [end, from, near] of [[w.from, points[0], points[1]], [w.to, points.at(-1), points.at(-2)]] as const) {
        if (!("junction" in end) || !from || !near) continue;
        const [dx, dy] = [near.x - from.x, near.y - from.y];
        const taken = sides.get(end.junction) ?? new Set<string>();
        taken.add(dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "below" : "above");
        sides.set(end.junction, taken);
      }
    }
    const drawTag = (junction: Junction, x: number, y: number, tone: string, unknown: boolean) => {
      const taken = sides.get(junction.id) ?? new Set<string>();
      const side = ["right", "left", "below", "above"].find((s) => !taken.has(s)) ?? "right";
      const gap = 8;
      const [tx, ty, anchor] =
        side === "right"
          ? [x + gap, y, { x: 0, y: 0.5 }]
          : side === "left"
            ? [x - gap, y, { x: 1, y: 0.5 }]
            : side === "below"
              ? [x, y + gap, { x: 0.5, y: 0 }]
              : [x, y - gap, { x: 0.5, y: 1 }];
      const text = put(`${junction.id}:name`, junction.name ?? "", tx, ty, anchor, color.ink);
      text.alpha = unknown ? 0.5 : 1;
      const pad = 3;
      const box = { x: tx - anchor.x * text.width - pad, y: ty - anchor.y * text.height - pad, w: text.width + 2 * pad, h: text.height + 2 * pad };
      tagBoxes.set(junction.id, box);
      wires
        .roundRect(box.x, box.y, box.w, box.h, size["radius-sm"])
        .fill({ color: color.bench })
        .stroke({ width: 1.5, color: unmatched.has(junction.id) ? color.caution : tone });
      if (chosen !== undefined && junction.name === chosen) {
        wires.roundRect(box.x - 3, box.y - 3, box.w + 6, box.h + 6, size["radius-sm"]).stroke({ width: 1, color: color.select });
      }
    };

    // CanvasKit: a junction is a 4px dot in its net's state colour, read from any wire on it.
    // Wires the engine was not sent (to a deleted pin, ADR 0013) carry no state, so they never colour a dot.
    const live = loaded ? circuit.wires.filter((w) => w.id in loaded.wireNets) : circuit.wires;
    const wireAt = new Map(live.flatMap((w) => [endOwner(w.from), endOwner(w.to)].map((owner) => [owner, w.id])));
    for (const junction of circuit.junctions) {
      const attached = wireAt.get(junction.id);
      const value = signal(attached === undefined ? undefined : loaded?.wireNets[attached]);
      const lit = value !== null && value !== 0;
      const tone = bitsOf(attached) > 1 ? color["signal-bus"] : lit ? color["signal-high"] : color["signal-low"];
      const { x, y } = px(junction.position);
      if (selected.has(junction.id)) wires.circle(x, y, 8).stroke({ width: size["select-width"], color: color.select });
      wires.circle(x, y, junction.name ? 3 : 4).fill({ color: tone, alpha: value === null ? 0.5 : 1 });
      if (junction.name) drawTag(junction, x, y, tone, value === null);
    }

    for (const component of circuit.components) {
      const ports = loaded?.portNets[component.id];
      const value = (port: string) => signal(ports?.[port]);
      drawBody(component, culprits.has(component.id), value);
      const bits = component.props.width ?? 1;
      if ((component.kind === "switch" || component.kind === "led" || component.kind === "dff") && bits > 1) {
        // A wide switch, LED or register shows its value in hex, upright whatever its rotation.
        const shown = value(component.kind === "switch" ? "out" : component.kind === "dff" ? "q" : "in");
        const { width, height } = layoutOf(component);
        const centre = px({ x: component.position.x + width / 2, y: component.position.y + height / 2 });
        const text = shown === null ? "--" : hex(shown, bits);
        // Along the body: a wide part turned upright is too narrow for 8 hex digits across it.
        const along = component.rotation % 180 === 0 ? 0 : -90;
        put(`${component.id}:value`, text, centre.x, centre.y, { x: 0.5, y: 0.5 }, color["signal-bus"]).angle = along;
      }
      if (isMemory(component.kind)) {
        // Its size, words × bits, in the middle of the body (ADR 0018).
        const { width, height } = layoutOf(component);
        const centre = px({ x: component.position.x + width / 2, y: component.position.y + height / 2 });
        const words = 2 ** (component.props.addressWidth ?? DEFAULT_ADDRESS);
        put(`${component.id}:size`, `${words}×${bits}`, centre.x, centre.y, { x: 0.5, y: 0.5 }, color["ink-muted"]).angle =
          component.rotation % 180 === 0 ? 0 : -90;
      }
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
    // An armed label: where a click would put it.
    if (armedLabel && pointer && !gesture) {
      const at = toWorld(pointer);
      const point = { x: Math.round(at.x), y: Math.round(at.y) };
      const { x, y } = px(point);
      // On a port or junction a click is refused: shown in danger, as an armed part's preview is.
      overlay.circle(x, y, 4).stroke({ width: 1.5, color: occupied(circuit, point) ? color.danger : color.accent });
    }
    // The armed part, half see-through, where a click would place it, turned as it would be.
    if (armed && pointer && !gesture) {
      const rotation = useEditor.getState().armedRotation;
      const definition = useEditor.getState().armedDefinition ?? undefined;
      // A splitter or merger previews with the fields it will be placed with.
      const shape = { kind: armed, rotation, definition, props: armedProps(armed, useEditor.getState().armedWidth) };
      const ghost = { id: GHOST, ...shape, position: placement(shape, toWorld(pointer)) };
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
    for (const [key, text] of texts) {
      if (seen.has(key)) continue;
      texts.delete(key);
      text.destroy();
    }
  }

  /** Texts drawn this frame; the rest are removed once it is drawn. */
  const seen = new Set<string>();
  /** A text at world point (x, y) in the canvas-label style, reused across frames by `key`. */
  function put(key: string, value: string, x: number, y: number, anchor: Point, fill = theme.color["ink-muted"]) {
    seen.add(key);
    let text = texts.get(key);
    if (!text) {
      const style = { fontFamily: theme.mono, fontSize: 11, fontWeight: "500", fill } as const;
      // shortcut: rendered at twice the device ratio, so labels soften beyond 2x zoom; switch to BitmapText if that bothers.
      text = new Text({ text: value, style, resolution: 2 * window.devicePixelRatio });
      texts.set(key, text);
      labels.addChild(text);
    }
    if (text.text !== value) text.text = value;
    text.anchor.set(anchor.x, anchor.y);
    text.position.set(x, y);
    return text;
  }

  // CanvasKit: labels in the canvas-label style, ink-muted, centred below the body;
  // a custom component also shows its definition's name (unless labelled) and its pin names inside.
  function drawLabels(components: CircuitComponent[]) {
    const c = cell();
    const label = (key: string, value: string, x: number, y: number, anchor: Point, angle = 0) => {
      put(key, value, x * c, y * c, anchor).angle = angle;
    };
    for (const component of components) {
      const layout = layoutOf(component);
      const { x, y } = component.position;
      const caption = component.props.label ?? (component.kind === "custom" ? definitionName(component.definition) : undefined);
      if (caption) label(component.id, caption, x + layout.width / 2, y + layout.height + 6 / c, { x: 0.5, y: 0 });
      if (component.kind !== "custom" && component.kind !== "dff" && !isMemory(component.kind) && !isFielded(component.kind)) continue;
      // A chip's pin names, or a splitter's or merger's bit ranges ("7:4"), just inside the body,
      // facing in from the side the port is on.
      const ranges = fieldRanges(component.props.fields ?? DEFAULT_FIELDS);
      const nameOf = (port: string) =>
        component.kind === "custom"
          ? pinLabel(component.definition, port)
          : component.kind === "dff"
            ? // The clock input is marked by the triangle on the body.
              ({ d: "D", q: "Q" }[port] ?? "")
            : isMemory(component.kind)
              ? ({ addr: "A", din: "D", we: "WE", out: "Q" }[port] ?? "")
            : /^f\d+$/.test(port)
              ? ranges[Number(port.slice(1))]
              : "";
      for (const [port, p] of Object.entries({ ...layout.inputs, ...layout.outputs })) {
        const name = nameOf(port);
        if (!name) continue;
        const inset = 0.3;
        // Ports on the top or bottom of a turned part sit one cell apart side by side: their
        // names run up the body, reading inward, so neighbours never overlap.
        const [dx, dy, anchor, angle] =
          p.x === 0
            ? [inset, 0, { x: 0, y: 0.5 }, 0]
            : p.x === layout.width
              ? [-inset, 0, { x: 1, y: 0.5 }, 0]
              : p.y === 0
                ? [0, inset, { x: 1, y: 0.5 }, -90]
                : [0, -inset, { x: 0, y: 0.5 }, -90];
        label(`${component.id}:${port}`, name, x + p.x + dx, y + p.y + dy, anchor, angle);
      }
    }
  }

  function polyline(g: Graphics, points: Point[]) {
    const [first, ...rest] = points;
    if (first) g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    return g;
  }

  function drawBody(component: CircuitComponent, culprit: boolean, value: (port: string) => number | null) {
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
      case "switch":
      case "led": {
        // Wide (ADR 0014): a plain box; its hex value is drawn as a label.
        if (local.width > 2) {
          g.roundRect(x, y, local.width * c, local.height * c, size["radius-sm"]).fill(body).stroke(outline);
          break;
        }
        if (component.kind === "led") {
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
        g.roundRect(x, y, 2 * c, 2 * c, size["radius-sm"]).fill(body).stroke(outline);
        if (value("out") === 1) {
          g.roundRect(x + 8, y + 8, 16, 16, 2).fill({ color: color["signal-high"] });
          g.moveTo(x + 16, y + 12).lineTo(x + 16, y + 20).stroke({ width: 2, color: color["on-signal-high"], cap: "round" });
        } else {
          g.roundRect(x + 9, y + 9, 14, 14, 2).stroke({ width: 2, color: color["signal-low"] });
        }
        break;
      }
      case "clock": {
        // A box with a square wave, drawn in the clock's level (ADR 0017).
        g.roundRect(x, y, 2 * c, 2 * c, size["radius-sm"]).fill(body).stroke(outline);
        const level = value("out") === 1 ? color["signal-high"] : color["signal-low"];
        const [lo, hi] = [y + 1.4 * c, y + 0.6 * c];
        polyline(g, [
          { x: x + 0.3 * c, y: lo },
          { x: x + 0.7 * c, y: lo },
          { x: x + 0.7 * c, y: hi },
          { x: x + 1.3 * c, y: hi },
          { x: x + 1.3 * c, y: lo },
          { x: x + 1.7 * c, y: lo },
        ]).stroke({ width: 2, color: level, join: "round" });
        break;
      }
      case "rom":
      case "ram":
        // A memory (ADR 0018): a box, its size and port names as labels, a RAM's clock input marked.
        g.roundRect(x, y, local.width * c, local.height * c, size["radius-sm"]).fill(body).stroke(outline);
        if (component.kind === "ram") g.moveTo(x, y + 7 * c - 6).lineTo(x + 8, y + 7 * c).lineTo(x, y + 7 * c + 6).stroke(outline);
        break;
      case "dff":
        // A box with D and Q as labels, and the clock input marked by a triangle (ADR 0017).
        g.roundRect(x, y, local.width * c, local.height * c, size["radius-sm"]).fill(body).stroke(outline);
        g.moveTo(x, y + 3 * c - 6).lineTo(x + 8, y + 3 * c).lineTo(x, y + 3 * c + 6).stroke(outline);
        break;
      case "split":
      case "merge":
        // A bar outlined in the bus colour (CanvasKit: signal-bus paints buses and splitter bodies).
        g.roundRect(x, y, local.width * c, local.height * c, size["radius-sm"])
          .fill(body)
          .stroke({ width: 1.5, color: culprit ? color.danger : color["signal-bus"] });
        break;
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
    // A wire dropped on a label's tag joins the label, not a wire under the tag.
    const tag = wiring ? tagAt(p) : undefined;
    const label = tag && at.junctions.get(tag)?.position;
    if (tag && label) return { at: label, end: { junction: tag } };
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
    } else if (e.button === 0 && editor.armedLabel) {
      // A net label (ADR 0015) at the nearest grid point. Its Name field takes the keyboard on release,
      // after the press has moved focus where it will.
      placedLabel = editor.addLabel({ x: Math.round(p.x), y: Math.round(p.y) });
    } else if (e.button === 0 && editor.armed) {
      const part = { id: GHOST, kind: editor.armed, rotation: editor.armedRotation, definition: editor.armedDefinition ?? undefined, props: {} };
      const position = placement(part, p);
      // A port on a junction would look joined: refused, and the part stays armed (the preview shows why).
      if (!placementStacks(editor.circuit, { ...part, position })) editor.add(part.kind, position);
    } else if (e.button === 0) {
      const hit = hitTest(editor.circuit, p, pick(), currentRoutes(editor.circuit));
      // A label's tag selects and drags it; its dot still draws wires (ADR 0015).
      const tag = hit?.type === "port" || hit?.type === "junction" ? undefined : tagAt(p);
      const item = tag ?? (hit?.type === "component" || hit?.type === "junction" ? hit.id : undefined);
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
    const wire = !gesture && hit?.type === "wire" ? hit.id : null;
    if (useCanvasHints.getState().wire !== wire) useCanvasHints.setState({ wire });
    schedule();
  };

  const onPointerUp = (e: PointerEvent) => {
    const editor = useEditor.getState();
    if (placedLabel) useCanvasHints.setState({ focusValue: placedLabel });
    placedLabel = null;
    if (gesture?.type === "move" && !gesture.moved) {
      const id = gesture.id;
      // A plain click inside a multi-selection narrows it to the clicked part.
      if (editor.selection.length > 1) editor.select([id]);
      const part = editor.circuit.components.find((c) => c.id === id);
      if (part?.kind === "switch" && (part.props.width ?? 1) > 1) {
        // A wide switch is set in the inspector (ADR 0014): select it and send the keyboard there.
        editor.select([id]);
        useCanvasHints.setState({ focusValue: id });
      } else if (part?.kind === "switch") {
        editor.toggle(id);
      }
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

  /** Zooms to `wanted` (clamped), keeping screen point (sx, sy) over the same world point. */
  const zoomAt = (sx: number, sy: number, wanted: number) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wanted));
    view.x = sx - ((sx - view.x) * zoom) / view.zoom;
    view.y = sy - ((sy - view.y) * zoom) / view.zoom;
    view.zoom = zoom;
    useCanvasHints.setState({ zoom });
    schedule();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, view.zoom * Math.exp(-e.deltaY * 0.0015));
  };

  /** Frames the whole sheet in the canvas, at most at 2x (labels soften beyond); an empty sheet goes back to the start view. */
  const fit = () => {
    const circuit = useEditor.getState().circuit;
    const points = [
      ...circuit.components.flatMap((part) => {
        const { width, height } = layoutOf(part);
        return [part.position, { x: part.position.x + width, y: part.position.y + height }];
      }),
      ...circuit.junctions.map((j) => j.position),
      ...[...currentRoutes(circuit).values()].flat(),
    ];
    if (points.length === 0) {
      Object.assign(view, { x: 48, y: 48 });
      return zoomAt(0, 0, 1);
    }
    // A margin of two cells round the parts (and room for labels below them).
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [left, top] = [Math.min(...xs) - 2, Math.min(...ys) - 2];
    const [w, h] = [Math.max(...xs) + 2 - left, Math.max(...ys) + 3 - top];
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(2, host.clientWidth / (w * cell()), host.clientHeight / (h * cell()))));
    view.zoom = zoom;
    view.x = (host.clientWidth - w * cell() * zoom) / 2 - left * cell() * zoom;
    view.y = (host.clientHeight - h * cell() * zoom) / 2 - top * cell() * zoom;
    useCanvasHints.setState({ zoom });
    schedule();
  };
  const zoomBy = (factor: number) => zoomAt(host.clientWidth / 2, host.clientHeight / 2, view.zoom * factor);

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
    } else if (onCanvas && !e.ctrlKey && !e.metaKey && !e.altKey && key === "f" && !gesture) {
      fit();
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
    useCanvasHints.setState({ wire: null });
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

  const bind = () => Object.assign(viewControls, { fit, zoomBy });
  const stop = () => {
    unsubscribe.forEach((stop) => stop());
    // Only this canvas's: one discarded during start-up never bound its own (see the caller).
    if (viewControls.fit === fit) {
      delete viewControls.fit;
      delete viewControls.zoomBy;
    }
    cancelAnimationFrame(frame);
    resize.disconnect();
    scheme.removeEventListener("change", onScheme);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", releaseSpace);
    window.removeEventListener("blur", releaseSpace);
    app.destroy(true, { children: true });
  };
  return { stop, bind };
}
