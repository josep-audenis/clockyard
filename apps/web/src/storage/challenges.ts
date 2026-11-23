// The bundled challenges (challenges/, ADR 0025): each challenge, its starter document, and a check's
// report in words. The engine decides pass or fail; this only names what it reported.
import { project, type CircuitDocument } from "../editor/document";
import type { Challenge, CircuitDescription, Report } from "../simulation/protocol";
import { parseDocument } from "./file";

const files = import.meta.glob<Challenge>("../../../../challenges/*.json", { eager: true, import: "default" });
const starters = import.meta.glob<string>("../../../../challenges/starters/*.clockyard.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

// The benches of challenges 10 to 12 (ADR 0034): circuits with a slot for the part a challenge asks for.
const benches = import.meta.glob<string>("../../../../challenges/benches/*.clockyard.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** `name`: the file name without `.json`, such as `01-inverter`, as `metadata.challenge` records it. */
export type ChallengeEntry = { name: string; challenge: Challenge };

const stem = (path: string, suffix: string) => path.slice(path.lastIndexOf("/") + 1, -suffix.length);

/** Every challenge, in file-name order. */
export const CHALLENGES: ChallengeEntry[] = Object.entries(files)
  .map(([path, challenge]) => ({ name: stem(path, ".json"), challenge }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const findChallenge = (name: string | undefined) => CHALLENGES.find((c) => c.name === name);

/** The challenge's starter, read as Import reads a file, recording the challenge and dated now. */
export function starterDocument(name: string, now = new Date().toISOString()): CircuitDocument {
  const text = Object.entries(starters).find(([path]) => stem(path, ".clockyard.json") === name)?.[1];
  if (text === undefined) throw new Error(`There is no starter for challenge ${name}.`);
  const result = parseDocument(text);
  if (!result.ok) throw new Error(`The starter for challenge ${name} does not open: ${result.error}`);
  const { document } = result;
  return { ...document, metadata: { ...document.metadata, createdAt: now, modifiedAt: now, challenge: name } };
}

/**
 * The bench a challenge is checked on, projected as the engine reads a circuit; undefined for a challenge the
 * engine builds its own bench for (ADR 0025). The engine takes the part to check from the user's document.
 */
export function benchOf(challenge: Challenge): CircuitDescription | undefined {
  if (challenge.bench === undefined) return undefined;
  const text = Object.entries(benches).find(([path]) => stem(path, ".clockyard.json") === challenge.bench)?.[1];
  if (text === undefined) throw new Error(`There is no bench ${challenge.bench}.`);
  const result = parseDocument(text);
  if (!result.ok) throw new Error(`The bench ${challenge.bench} does not open: ${result.error}`);
  return project(result.document.circuit, result.document.definitions);
}

/** The steps a pass counts: the challenge's own, or those of all its runs. */
const stepCount = (challenge: Challenge) => challenge.steps.length + (challenge.runs ?? []).reduce((n, run) => n + run.steps.length, 0);
/** A mismatch's name in words: an output pin or LED as it is, a memory byte (`ram[16]`) as "RAM byte 16". */
const named = (name: string) => {
  const byte = /^(\w+)\[(\d+)\]$/.exec(name);
  return byte ? `${byte[1] === "ram" ? "RAM" : byte[1]} byte ${byte[2]}` : name;
};

/**
 * A value with unknown bits in words (ADR 0035): one bit as `X` or `Z`; a wider one in hex, a digit `Z` if all its
 * bits are Z, `X` if any other is unknown. A known value is its number.
 * shortcut: a mismatch carries no width, so a top digit of fewer than four bits that is all Z reads X here, where
 * `hex` in editor/document.ts would say Z. No challenge allows a tri-state buffer; give mismatches a width when one does.
 */
export function showUnknown(value: number, unknown = 0): string {
  if (unknown === 0) return String(value);
  if ((value | unknown) >>> 1 === 0) return value ? "X" : "Z";
  let digits = "";
  for (let rest = (value | unknown) >>> 0, shift = 0; rest !== 0; rest >>>= 4, shift += 4) {
    const [v, u] = [(value >>> shift) & 15, (unknown >>> shift) & 15];
    digits = (u === 0 ? v.toString(16).toUpperCase() : u === 15 && v === 0 ? "Z" : "X") + digits;
  }
  return `0x${digits}`;
}

const assignments = (values: { name: string; value: number }[]) => values.map(({ name, value }) => `${name} = ${value}`).join(", ");

/**
 * A report in words: "Passed, 4 of 4 steps." (on a bench, "Passed all 2 runs, 6 steps: Load; Add.", the runs joined by
 * semicolons since their names hold commas, ADR 0040), the first failing step, or why the check could not run.
 */
export function reportText(report: Report, challenge: Challenge): string {
  switch (report.result) {
    case "passed":
      return challenge.runs?.length
        ? `Passed all ${challenge.runs.length} runs, ${report.steps} steps: ${challenge.runs.map((run) => run.name).join("; ")}.`
        : `Passed, ${report.steps} of ${stepCount(challenge)} steps.`;
    case "failed": {
      const wrong = report.mismatches.map(({ name, expected, got, unknown }) => `${named(name)} should be ${expected} but is ${showUnknown(got, unknown)}`).join("; ");
      // On a bench the run is named, and its steps are counted within it (ADR 0034).
      const steps = challenge.runs?.find((run) => run.name === report.run)?.steps.length ?? challenge.steps.length;
      const where = `${report.run === undefined ? "Step" : `Run ${report.run}, step`} ${report.step + 1} of ${steps} failed.`;
      return `${where} ${report.inputs.length > 0 ? `With ${assignments(report.inputs)}: ` : ""}${wrong}.`;
    }
    case "refused":
      return report.reason;
  }
}
