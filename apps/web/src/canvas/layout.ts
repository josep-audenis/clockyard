// Where each port sits on a part's body, in grid units from its top-left
// corner (ADR 0004: the engine owns port names, the canvas owns their layout).
// Sizes follow the design system's CanvasKit spec; ports sit on grid points.
// `LAYOUTS` is each kind unrotated; `layoutOf` applies a part's rotation.
// A custom component's layout comes from its definition's pins (ADR 0012).
import { pinsOf, type CircuitComponent, type ComponentKind, type Definition } from "../editor/document";

export type Point = { x: number; y: number };

export type Layout = {
  width: number;
  height: number;
  inputs: Record<string, Point>;
  outputs: Record<string, Point>;
};

const gate: Layout = { width: 4, height: 4, inputs: { a: { x: 0, y: 1 }, b: { x: 0, y: 3 } }, outputs: { out: { x: 4, y: 2 } } };

export const LAYOUTS: Record<ComponentKind, Layout> = {
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

/** A layout turned 90° clockwise about its box: (x, y) in w×h goes to (h - y, x) in h×w. */
function turned({ width, height, inputs, outputs }: Layout): Layout {
  const turn = (ports: Record<string, Point>) =>
    Object.fromEntries(Object.entries(ports).map(([name, p]) => [name, { x: height - p.y, y: p.x }]));
  return { width: height, height: width, inputs: turn(inputs), outputs: turn(outputs) };
}

const rotated = new Map<string, Layout>();
/** Unrotated layouts and names of the definitions in use, by definition ID. */
const custom = new Map<string, { name: string; layout: Layout }>();
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
    const layout = {
      width: 4,
      height: 2 * Math.max(inputs.length, outputs.length, 1),
      inputs: column(inputs, 0),
      outputs: column(outputs, 4),
    };
    custom.set(d.id, { name: d.name, layout });
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

/** Name of a definition, for instances' captions and the inspector. */
export const definitionName = (id: string | undefined) => (id === undefined ? undefined : custom.get(id)?.name);

/** A part's layout as placed: its kind's (or definition's) layout turned clockwise by its rotation. */
export function layoutOf({ kind, rotation, definition }: Pick<CircuitComponent, "kind" | "rotation" | "definition">): Layout {
  const key = kind === "custom" ? `custom:${definition}:${rotation}` : `${kind}:${rotation}`;
  let layout = rotated.get(key);
  if (!layout) {
    layout = kind === "custom" ? (custom.get(definition ?? "")?.layout ?? MISSING) : LAYOUTS[kind];
    for (let r = 0; r < rotation; r += 90) layout = turned(layout);
    rotated.set(key, layout);
  }
  return layout;
}
