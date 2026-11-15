// The bundled challenges (challenges/, ADR 0025): each challenge, its starter document, and a check's
// report in words. The engine decides pass or fail; this only names what it reported.
import type { CircuitDocument } from "../editor/document";
import type { Challenge, Report } from "../simulation/protocol";
import { parseDocument } from "./file";

const files = import.meta.glob<Challenge>("../../../../challenges/*.json", { eager: true, import: "default" });
const starters = import.meta.glob<string>("../../../../challenges/starters/*.clockyard.json", {
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

const assignments = (values: { name: string; value: number }[]) => values.map(({ name, value }) => `${name} = ${value}`).join(", ");

/** A report in words: "Passed, 4 of 4 steps.", the first failing step, or why the check could not run. */
export function reportText(report: Report, challenge: Challenge): string {
  switch (report.result) {
    case "passed":
      return `Passed, ${report.steps} of ${challenge.steps.length} steps.`;
    case "failed": {
      const wrong = report.mismatches.map(({ name, expected, got }) => `${name} should be ${expected} but is ${got}`).join("; ");
      return `Step ${report.step + 1} of ${challenge.steps.length} failed. With ${assignments(report.inputs)}: ${wrong}.`;
    }
    case "refused":
      return report.reason;
  }
}
