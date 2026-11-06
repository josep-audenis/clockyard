// Where each port sits on a part's body, in grid units from its top-left
// corner (ADR 0004: the engine owns port names, the canvas owns their layout).
// Sizes follow the design system's CanvasKit spec; ports sit on grid points.
// shortcut: rotation is ignored (always 0); apply it here when parts can rotate.
import type { ComponentKind } from "../editor/document";

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
