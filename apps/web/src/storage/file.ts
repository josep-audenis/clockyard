// Project files: the circuit document as JSON (docs/architecture.md#circuit-document).
// Imported files are untrusted: every field is checked and unknown fields are dropped.
import {
  COMPONENT_KINDS,
  fieldsProblem,
  DEFAULT_ADDRESS,
  FIXED_WIDTH,
  isFielded,
  isMemory,
  MAX_ADDRESS,
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  MAX_SOURCE,
  wordsProblem,
  MAX_BENDS,
  MAX_LABEL,
  MAX_WIDTH,
  normalizeLabel,
  normalizeName,
  normalizeNetName,
  ROTATIONS,
  sameEnd,
  withoutDeletedPins,
  type CircuitComponent,
  type Circuit,
  type CircuitDocument,
  type Definition,
  type PartKind,
  type Junction,
  type Props,
  type Wire,
} from "../editor/document";

export const FORMAT_VERSION = 9;

/** How a part of fixed width is named when a file gives it a width. */
const FIXED_NAMES: Partial<Record<PartKind, string>> = { clock: "clock", seg7: "seven-segment display", keyboard: "keyboard" };

export type ParseResult = { ok: true; document: CircuitDocument } | { ok: false; error: string };

export function serializeDocument(document: CircuitDocument): string {
  // Wires to deleted pins stay in the editor for undo only (ADR 0013, amended).
  const { circuit, definitions } = document;
  const clean = (c: Circuit) => withoutDeletedPins(c, definitions);
  return JSON.stringify(
    { ...document, circuit: clean(circuit), definitions: definitions.map((d) => ({ ...d, circuit: clean(d.circuit) })) },
    null,
    2,
  );
}

export function parseDocument(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  try {
    return { ok: true, document: readDocument(data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function object(value: unknown, where: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${where} must be an object.`);
  return value;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be a list.`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} must be text.`);
  return value;
}

function id(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${where} must be a non-empty ID.`);
  return value;
}

/** Grid coordinates stay well inside exact integer range, so stepping a paste always moves it. */
const MAX_COORDINATE = 1_000_000;

function integer(value: unknown, where: string): number {
  if (!Number.isInteger(value) || Math.abs(value as number) > MAX_COORDINATE) {
    throw new Error(`${where} must be a whole number from -${MAX_COORDINATE} to ${MAX_COORDINATE}.`);
  }
  return value as number;
}

/** Known properties only; unknown ones are dropped like any other unknown field. */
function readProps(props: Record<string, unknown>, kind: PartKind, where: string): Props {
  const read: Props = {};
  if (props.label !== undefined) {
    const label = normalizeLabel(text(props.label, `${where} label`));
    if ([...label].length > MAX_LABEL) throw new Error(`${where} label is longer than ${MAX_LABEL} characters.`);
    if (label) read.label = label;
  }
  // ADR 0014: a width only where it sets port widths; a custom component's pins set its own,
  // and a splitter's or merger's fields set its.
  if (props.width !== undefined) {
    if (kind === "custom") throw new Error(`${where} is a custom component, which takes no width.`);
    if (isFielded(kind)) throw new Error(`${where} is a splitter or merger, which takes fields, not a width.`);
    const fixed = FIXED_WIDTH[kind];
    if (fixed !== undefined) throw new Error(`${where} is a ${FIXED_NAMES[kind]}, which is always ${fixed} bit${fixed === 1 ? "" : "s"} wide.`);
    const width = props.width;
    if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > MAX_WIDTH) {
      throw new Error(`${where} width must be a whole number from 1 to ${MAX_WIDTH}.`);
    }
    // 1 is the default, so it is not stored and exports exactly as before.
    if (width !== 1) read.width = width as number;
  }
  if (isFielded(kind)) {
    if (props.fields === undefined) throw new Error(`${where} is a splitter or merger without fields.`);
    const problem = fieldsProblem(props.fields);
    if (problem) throw new Error(`${where} fields ${problem}.`);
    read.fields = [...(props.fields as number[])];
  } else if (props.fields !== undefined) {
    throw new Error(`${where} has fields, which only splitters and mergers take.`);
  }
  // ADR 0018: an address width on a memory, and a ROM's words and assembly source.
  if (props.addressWidth !== undefined) {
    if (!isMemory(kind)) throw new Error(`${where} has an address width, which only ROMs, RAMs and screens take.`);
    const address = props.addressWidth;
    if (!Number.isInteger(address) || (address as number) < 1 || (address as number) > MAX_ADDRESS) {
      throw new Error(`${where} address width must be a whole number from 1 to ${MAX_ADDRESS}.`);
    }
    // 8 is the default, so it is not stored.
    if (address !== DEFAULT_ADDRESS) read.addressWidth = address as number;
  }
  if (props.data !== undefined) {
    if (kind !== "rom") throw new Error(`${where} has data, which only ROMs hold.`);
    const problem = wordsProblem(props.data, read.width ?? 1, read.addressWidth ?? DEFAULT_ADDRESS);
    if (problem) throw new Error(`${where} data ${problem}.`);
    read.data = [...(props.data as number[])];
  }
  if (props.source !== undefined) {
    if (kind !== "rom") throw new Error(`${where} has assembly source, which only ROMs keep.`);
    const source = text(props.source, `${where} source`);
    if (source.length > MAX_SOURCE) throw new Error(`${where} source is longer than ${MAX_SOURCE} characters.`);
    if (source) read.source = source;
  }
  // ADR 0021: a screen's pixels per row.
  if (props.columns !== undefined) {
    if (kind !== "screen") throw new Error(`${where} has columns, which only screens take.`);
    const columns = props.columns;
    if (!Number.isInteger(columns) || (columns as number) < 1 || (columns as number) > MAX_COLUMNS) {
      throw new Error(`${where} columns must be a whole number from 1 to ${MAX_COLUMNS}.`);
    }
    // 32 is the default, so it is not stored.
    if (columns !== DEFAULT_COLUMNS) read.columns = columns as number;
  }
  return read;
}

/** A definition's name, held to what the editor stores (`normalizeName`); too long is refused, like a label. */
function readName(value: unknown, where: string): string {
  const name = normalizeLabel(text(value, where));
  if ([...name].length > MAX_LABEL) throw new Error(`${where} is longer than ${MAX_LABEL} characters.`);
  return normalizeName(name);
}

function readDocument(data: unknown): CircuitDocument {
  if (!isObject(data) || data.format !== "clockyard") throw new Error("This is not a Clockyard file.");
  const version = data.version;
  if (typeof version !== "number") throw new Error("The file has no format version.");
  if (version > FORMAT_VERSION) {
    throw new Error(`This file uses format version ${version}, from a newer Clockyard. This version reads up to ${FORMAT_VERSION}.`);
  }
  if (![1, 2, 3, 4, 5, 6, 7, 8, FORMAT_VERSION].includes(version)) throw new Error(`Format version ${version} is not supported.`);
  // Version 4 → 5 (ADR 0014): widths arrive as props; nothing to change.
  // Version 5 → 6 (ADR 0015): junctions may carry a net label's name; nothing to change.
  // Version 6 → 7 (ADR 0017): clock and dff kinds; nothing to change.
  // Version 7 → 8 (ADR 0018): rom and ram kinds, addressWidth, data and source; nothing to change.
  // Version 8 → 9 (ADR 0021): seg7, screen and keyboard kinds, and a screen's columns; nothing to change.

  const metadata = object(data.metadata, "metadata");
  const circuit = object(data.circuit, "circuit");
  // Version 1 → 2 (ADR 0010): junctions arrive; v1 wires already join two ports.
  if (version === 1) circuit.junctions = [];
  // Version 2 → 3 (ADR 0012): custom component definitions arrive.
  const rawDefinitions = version < 3 ? [] : array(data.definitions, "definitions");

  // Every definition's ID first: instances anywhere may refer to any of them.
  const definitionIds = new Set<string>();
  const shells = rawDefinitions.map((raw, i) => {
    const where = `Definition ${i + 1}`;
    const d = object(raw, where);
    const definitionId = elementId(d.id, `${where} id`);
    if (definitionIds.has(definitionId)) throw new Error(`${where}: ID ${definitionId} is used more than once.`);
    definitionIds.add(definitionId);
    return { d, where, id: definitionId };
  });
  const definitions = shells.map(({ d, where, id: definitionId }): Definition => ({
    id: definitionId,
    name: readName(d.name, `${where} name`),
    circuit: readCircuit(object(d.circuit, `${where} circuit`), `${where}: `, definitionIds),
  }));

  const main = readCircuit(circuit, "", definitionIds);
  if (version < 4) pinPortsById([main, ...definitions.map((d) => d.circuit)], definitions);

  return {
    format: "clockyard",
    version: FORMAT_VERSION,
    metadata: {
      name: text(metadata.name, "metadata.name"),
      createdAt: text(metadata.createdAt, "metadata.createdAt"),
      modifiedAt: text(metadata.modifiedAt, "metadata.modifiedAt"),
    },
    circuit: main,
    definitions,
  };
}

/** Version 3 → 4 (ADR 0013): wires named an instance's port by its pin's label, now by the pin part's ID. */
function pinPortsById(circuits: Circuit[], definitions: Definition[]) {
  const byLabel = new Map(
    definitions.map((d) => [
      d.id,
      new Map(d.circuit.components.filter((c) => c.kind === "switch" || c.kind === "led").map((c) => [c.props.label ?? "", c.id])),
    ]),
  );
  for (const circuit of circuits) {
    const parts = new Map(circuit.components.map((c) => [c.id, c]));
    for (const end of circuit.wires.flatMap((w) => [w.from, w.to])) {
      if ("junction" in end) continue;
      const part = parts.get(end.component);
      const id = part?.kind === "custom" && part.definition ? byLabel.get(part.definition)?.get(end.port) : undefined;
      if (id) end.port = id;
    }
  }
}

/** An element's ID: also never containing `/`, which separates instance paths once components are expanded. */
function elementId(value: unknown, where: string): string {
  const result = id(value, where);
  if (result.includes("/")) throw new Error(`${where} must not contain "/".`);
  return result;
}

/** One circuit (the main one or a definition's); `where` prefixes its messages. */
function readCircuit(circuit: Record<string, unknown>, where0: string, definitionIds: Set<string>): Circuit {
  const seen = new Set<string>();
  const unique = (value: string, where: string) => {
    if (seen.has(value)) throw new Error(`${where}: ID ${value} is used more than once.`);
    seen.add(value);
    return value;
  };

  const components = array(circuit.components, `${where0}circuit.components`).map((raw, i): CircuitComponent => {
    const where = `${where0}Component ${i + 1}`;
    const c = object(raw, where);
    const kind = text(c.kind, `${where} kind`);
    if (kind !== "custom" && !(COMPONENT_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`${where} has unknown kind "${kind}".`);
    }
    const position = object(c.position, `${where} position`);
    const rotation = c.rotation;
    if (!(ROTATIONS as readonly unknown[]).includes(rotation)) throw new Error(`${where} rotation must be 0, 90, 180 or 270.`);
    const part: CircuitComponent = {
      id: unique(elementId(c.id, `${where} id`), where),
      kind: kind as PartKind,
      position: { x: integer(position.x, `${where} x`), y: integer(position.y, `${where} y`) },
      rotation: rotation as CircuitComponent["rotation"],
      props: readProps(object(c.props, `${where} props`), kind as PartKind, where),
    };
    if (kind === "custom") {
      const definition = id(c.definition, `${where} definition`);
      if (!definitionIds.has(definition)) throw new Error(`${where} refers to missing definition ${definition}.`);
      part.definition = definition;
    }
    return part;
  });

  const junctions = array(circuit.junctions, `${where0}circuit.junctions`).map((raw, i): Junction => {
    const where = `${where0}Junction ${i + 1}`;
    const j = object(raw, where);
    const position = object(j.position, `${where} position`);
    const junction: Junction = {
      id: unique(elementId(j.id, `${where} id`), where),
      position: { x: integer(position.x, `${where} x`), y: integer(position.y, `${where} y`) },
    };
    // A net label (ADR 0015): normalized as the editor stores it, so equal-looking names match; blank is none.
    if (j.name !== undefined) {
      const name = normalizeNetName(text(j.name, `${where} name`));
      if ([...name].length > MAX_LABEL) throw new Error(`${where} name is longer than ${MAX_LABEL} characters.`);
      if (name) junction.name = name;
    }
    return junction;
  });

  const componentIds = new Set(components.map((c) => c.id));
  const junctionIds = new Set(junctions.map((j) => j.id));
  const end = (raw: unknown, where: string): Wire["from"] => {
    const ref = object(raw, where);
    if ("junction" in ref) {
      const junction = id(ref.junction, `${where} junction`);
      if (!junctionIds.has(junction)) throw new Error(`${where} refers to missing junction ${junction}.`);
      return { junction };
    }
    const component = id(ref.component, `${where} component`);
    if (!componentIds.has(component)) throw new Error(`${where} refers to missing component ${component}.`);
    return { component, port: id(ref.port, `${where} port`) };
  };
  const wires = array(circuit.wires, `${where0}circuit.wires`).map((raw, i): Wire => {
    const where = `${where0}Wire ${i + 1}`;
    const w = object(raw, where);
    const from = end(w.from, `${where} start`);
    const to = end(w.to, `${where} end`);
    // The editor never draws one; on screen it would be an invisible, unclickable wire.
    if (sameEnd(from, to)) throw new Error(`${where} starts and ends at the same place.`);
    const wire: Wire = { id: unique(elementId(w.id, `${where} id`), where), from, to };
    if (w.bends !== undefined) {
      const bends = array(w.bends, `${where} bends`);
      if (bends.length > MAX_BENDS) throw new Error(`${where} has more than ${MAX_BENDS} bends.`);
      wire.bends = bends.map((raw, j) => {
        const point = object(raw, `${where} bend ${j + 1}`);
        return { x: integer(point.x, `${where} bend ${j + 1} x`), y: integer(point.y, `${where} bend ${j + 1} y`) };
      });
    }
    return wire;
  });

  return { components, junctions, wires };
}
