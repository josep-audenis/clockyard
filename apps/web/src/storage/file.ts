// Project files: the circuit document as JSON (docs/architecture.md#circuit-document).
// Imported files are untrusted: every field is checked and unknown fields are dropped.
import {
  COMPONENT_KINDS,
  MAX_LABEL,
  normalizeLabel,
  ROTATIONS,
  sameEnd,
  type CircuitComponent,
  type CircuitDocument,
  type ComponentKind,
  type Junction,
  type Props,
  type Wire,
} from "../editor/document";

export const FORMAT_VERSION = 2;

export type ParseResult = { ok: true; document: CircuitDocument } | { ok: false; error: string };

export function serializeDocument(document: CircuitDocument): string {
  return JSON.stringify(document, null, 2);
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
function readProps(props: Record<string, unknown>, where: string): Props {
  if (props.label === undefined) return {};
  const label = normalizeLabel(text(props.label, `${where} label`));
  if ([...label].length > MAX_LABEL) throw new Error(`${where} label is longer than ${MAX_LABEL} characters.`);
  return label ? { label } : {};
}

function readDocument(data: unknown): CircuitDocument {
  if (!isObject(data) || data.format !== "clockyard") throw new Error("This is not a Clockyard file.");
  const version = data.version;
  if (typeof version !== "number") throw new Error("The file has no format version.");
  if (version > FORMAT_VERSION) {
    throw new Error(`This file uses format version ${version}, from a newer Clockyard. This version reads up to ${FORMAT_VERSION}.`);
  }
  if (version !== 1 && version !== FORMAT_VERSION) throw new Error(`Format version ${version} is not supported.`);

  const metadata = object(data.metadata, "metadata");
  const circuit = object(data.circuit, "circuit");
  // Version 1 → 2 (ADR 0010): junctions arrive; v1 wires already join two ports.
  if (version === 1) circuit.junctions = [];
  const seen = new Set<string>();
  const unique = (value: string, where: string) => {
    if (seen.has(value)) throw new Error(`${where}: ID ${value} is used more than once.`);
    seen.add(value);
    return value;
  };

  const components = array(circuit.components, "circuit.components").map((raw, i): CircuitComponent => {
    const where = `Component ${i + 1}`;
    const c = object(raw, where);
    const kind = text(c.kind, `${where} kind`);
    if (!(COMPONENT_KINDS as readonly string[]).includes(kind)) throw new Error(`${where} has unknown kind "${kind}".`);
    const position = object(c.position, `${where} position`);
    const rotation = c.rotation;
    if (!(ROTATIONS as readonly unknown[]).includes(rotation)) throw new Error(`${where} rotation must be 0, 90, 180 or 270.`);
    return {
      id: unique(id(c.id, `${where} id`), where),
      kind: kind as ComponentKind,
      position: { x: integer(position.x, `${where} x`), y: integer(position.y, `${where} y`) },
      rotation: rotation as CircuitComponent["rotation"],
      props: readProps(object(c.props, `${where} props`), where),
    };
  });

  const junctions = array(circuit.junctions, "circuit.junctions").map((raw, i): Junction => {
    const where = `Junction ${i + 1}`;
    const j = object(raw, where);
    const position = object(j.position, `${where} position`);
    return {
      id: unique(id(j.id, `${where} id`), where),
      position: { x: integer(position.x, `${where} x`), y: integer(position.y, `${where} y`) },
    };
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
  const wires = array(circuit.wires, "circuit.wires").map((raw, i): Wire => {
    const where = `Wire ${i + 1}`;
    const w = object(raw, where);
    const from = end(w.from, `${where} start`);
    const to = end(w.to, `${where} end`);
    // The editor never draws one; on screen it would be an invisible, unclickable wire.
    if (sameEnd(from, to)) throw new Error(`${where} starts and ends at the same place.`);
    return { id: unique(id(w.id, `${where} id`), where), from, to };
  });

  return {
    format: "clockyard",
    version: FORMAT_VERSION,
    metadata: {
      name: text(metadata.name, "metadata.name"),
      createdAt: text(metadata.createdAt, "metadata.createdAt"),
      modifiedAt: text(metadata.modifiedAt, "metadata.modifiedAt"),
    },
    circuit: { components, junctions, wires },
  };
}
