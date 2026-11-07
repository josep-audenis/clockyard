// Where each port sits on a part's body, in grid units from its top-left
// corner (ADR 0004: the engine owns port names, the canvas owns their layout).
// Sizes follow the design system's CanvasKit spec; ports sit on grid points.
// `LAYOUTS` is each kind unrotated; `layoutOf` applies a part's rotation.
// A custom component's layout comes from its definition's pins (ADR 0012).
import {
  DEFAULT_FIELDS,
  isFielded,
  pinsOf,
  type CircuitComponent,
  type ComponentKind,
  type Definition,
  type FieldedKind,
  type Props,
} from "../editor/document";

export type Point = { x: number; y: number };

export type Layout = {
  width: number;
  height: number;
  inputs: Record<string, Point>;
  outputs: Record<string, Point>;
};

const gate: Layout = { width: 4, height: 4, inputs: { a: { x: 0, y: 1 }, b: { x: 0, y: 3 } }, outputs: { out: { x: 4, y: 2 } } };

/** Every built-in kind but splitters and mergers, whose layout follows their fields (`bar`). */
export const LAYOUTS: Record<Exclude<ComponentKind, FieldedKind>, Layout> = {
  switch: { width: 2, height: 2, inputs: {}, outputs: { out: { x: 2, y: 1 } } },
  led: { width: 2, height: 2, inputs: { in: { x: 0, y: 1 } }, outputs: {} },
  not: { width: 3, height: 2, inputs: { in: { x: 0, y: 1 } }, outputs: { out: { x: 3, y: 1 } } },
  and: gate,
  nand: gate,
  or: gate,
  nor: gate,
  xor: gate,
  xnor: gate,
};

/**
 * A switch or LED wider than 1 bit: a 5×2 body that shows its value in hex, its
 * port at the middle of the side where a 1-bit one has it (ADR 0014). Gates keep
 * their shape at any width.
 */
const WIDE: Partial<Record<ComponentKind, Layout>> = {
  switch: { width: 5, height: 2, inputs: {}, outputs: { out: { x: 5, y: 1 } } },
  led: { width: 5, height: 2, inputs: { in: { x: 0, y: 1 } }, outputs: {} },
};

/**
 * A splitter or merger: a bar 3 cells wide and one cell taller than it has fields,
 * the bus at (0, 1) for a split's `in` or (3, 1) for a merge's `out`, and field
 * `fi` one cell apart on the other side, `f0` (the lowest bits) at the top (ADR 0014).
 */
function bar(kind: FieldedKind, count: number): Layout {
  const side = kind === "split" ? 3 : 0;
  const fields = Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, { x: side, y: 1 + i }]));
  return kind === "split"
    ? { width: 3, height: count + 1, inputs: { in: { x: 0, y: 1 } }, outputs: fields }
    : { width: 3, height: count + 1, inputs: fields, outputs: { out: { x: 3, y: 1 } } };
}

/** A layout turned 90° clockwise about its box: (x, y) in w×h goes to (h - y, x) in h×w. */
function turned({ width, height, inputs, outputs }: Layout): Layout {
  const turn = (ports: Record<string, Point>) =>
    Object.fromEntries(Object.entries(ports).map(([name, p]) => [name, { x: height - p.y, y: p.x }]));
  return { width: height, height: width, inputs: turn(inputs), outputs: turn(outputs) };
}

const rotated = new Map<string, Layout>();
/** Unrotated layouts and names of the definitions in use, by definition ID. */
const custom = new Map<string, { name: string; layout: Layout; labels: Map<string, string> }>();
/** Layout of an instance whose definition is missing: a plain box with no ports. */
const MISSING: Layout = { width: 4, height: 2, inputs: {}, outputs: {} };

/**
 * Sets the definitions instances are laid out from: a box 4 wide, inputs down
 * the left and outputs down the right, one every 2 cells, in pin order.
 */
export function setDefinitionLayouts(definitions: Definition[]) {
  const before = new Map([...custom].map(([id, { layout }]) => [id, JSON.stringify(layout)]));
  custom.clear();
  for (const d of definitions) {
    const { inputs, outputs } = pinsOf(d.circuit);
    const column = (pins: { name: string }[], x: number) => Object.fromEntries(pins.map((p, i) => [p.name, { x, y: 1 + 2 * i }]));
    const labels = new Map(d.circuit.components.map((c) => [c.id, c.props.label ?? ""]));
    const layout = {
      width: 4,
      height: 2 * Math.max(inputs.length, outputs.length, 1),
      inputs: column(inputs, 0),
      outputs: column(outputs, 4),
    };
    custom.set(d.id, { name: d.name, layout, labels });
  }
  // Only a real change of pins invalidates layouts (and routes kept for instances), not every edit of a sheet.
  const changed = custom.size !== before.size || [...custom].some(([id, { layout }]) => before.get(id) !== JSON.stringify(layout));
  if (changed) {
    layouts++;
    rotated.clear();
  }
}

let layouts = 0;
/** Changes whenever instances' layouts may have: routes kept from before must not trust their ports. */
export const layoutsVersion = () => layouts;

/** What an instance's port is called on screen: its pin's label (the port itself is the pin part's ID). */
export const pinLabel = (definition: string | undefined, port: string) =>
  (definition === undefined ? undefined : custom.get(definition)?.labels.get(port)) ?? "";

/** Name of a definition, for instances' captions and the inspector. */
export const definitionName = (id: string | undefined) => (id === undefined ? undefined : custom.get(id)?.name);

/**
 * A part's layout as placed: its kind's (or definition's) layout, wide where its
 * width calls for one, turned clockwise by its rotation. Cached, so two parts
 * with the same layout get the same object.
 */
export function layoutOf({
  kind,
  rotation,
  definition,
  props,
}: Pick<CircuitComponent, "kind" | "rotation" | "definition"> & { props?: Props }): Layout {
  const wide = kind !== "custom" && (props?.width ?? 1) > 1 ? WIDE[kind] : undefined;
  const fields = (props?.fields ?? DEFAULT_FIELDS).length;
  const key =
    kind === "custom"
      ? `custom:${definition}:${rotation}`
      : isFielded(kind)
        ? `${kind}:${fields}:${rotation}`
        : `${kind}${wide ? ":wide" : ""}:${rotation}`;
  let layout = rotated.get(key);
  if (!layout) {
    layout =
      kind === "custom"
        ? (custom.get(definition ?? "")?.layout ?? MISSING)
        : isFielded(kind)
          ? bar(kind, fields)
          : (wide ?? LAYOUTS[kind]);
    for (let r = 0; r < rotation; r += 90) layout = turned(layout);
    rotated.set(key, layout);
  }
  return layout;
}
