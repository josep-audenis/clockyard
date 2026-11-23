import { expect, test } from "vitest";
import { benchOf, CHALLENGES, findChallenge, reportText, showUnknown, starterDocument } from "./challenges";

const entry = findChallenge("01-inverter");
if (!entry) throw new Error("the inverter challenge is missing");
const inverter = entry.challenge;

test("every bundled challenge is listed in order, with a starter on its definition", () => {
  expect(CHALLENGES.map((c) => c.name)).toEqual(["01-inverter", "02-xor", "03-half-adder", "04-full-adder", "05-adder8", "06-register", "07-register8", "08-counter8", "09-alu", "10-cpu", "11-program", "12-display"]);
  for (const { name, challenge } of CHALLENGES) {
    const document = starterDocument(name, "2026-11-15T13:00:00.000Z");
    expect(document.metadata).toEqual({ name: challenge.title, createdAt: "2026-11-15T13:00:00.000Z", modifiedAt: "2026-11-15T13:00:00.000Z", challenge: name });
    expect(document.definitions.map((d) => d.id)).toContain(challenge.definition);
  }
  expect(() => starterDocument("99-nothing")).toThrow("There is no starter for challenge 99-nothing.");
});

test("a report reads as the step and values it names", () => {
  expect(reportText({ result: "passed", steps: 2 }, inverter)).toBe("Passed, 2 of 2 steps.");
  const failed = reportText(
    {
      result: "failed",
      step: 1,
      inputs: [
        { name: "A", value: 1 },
        { name: "B", value: 1 },
      ],
      mismatches: [
        { name: "Y", expected: 0, got: 1 },
        { name: "C", expected: 1, got: 0 },
      ],
    },
    inverter,
  );
  expect(failed).toBe("Step 2 of 2 failed. With A = 1, B = 1: Y should be 0 but is 1; C should be 1 but is 0.");
  expect(reportText({ result: "refused", reason: "Pin A is 1 bit wide; this challenge needs 8 bits." }, inverter)).toBe(
    "Pin A is 1 bit wide; this challenge needs 8 bits.",
  );
});

test("a challenge with a bench gets it projected, and its reports name the run and the byte (ADR 0034)", () => {
  expect(benchOf(inverter)).toBeUndefined();
  const cpu = findChallenge("10-cpu")?.challenge;
  if (!cpu) throw new Error("the CPU challenge is missing");
  const bench = benchOf(cpu);
  // The computer round the slot, with the slot's definition empty and the bench's own parts.
  expect(bench?.components.find((c) => c.id === "cpu")).toMatchObject({ kind: "custom", definition: "cpu" });
  expect(bench?.definitions?.map((d) => d.id)).toEqual(["cpu", "bench-mux8", "bench-reg8"]);

  const runs = cpu.runs ?? [];
  const steps = runs.reduce((n, run) => n + run.steps.length, 0);
  expect(steps).toBe(3 * runs.length);
  // A pass names its runs, joined by semicolons since run names hold commas (ADR 0040).
  expect(reportText({ result: "passed", steps }, cpu)).toBe(`Passed all ${runs.length} runs, ${steps} steps: ${runs.map((run) => run.name).join("; ")}.`);
  expect(reportText({ result: "passed", steps }, cpu)).toContain("Load and show; Add, subtract and flags; ");
  // Every challenge with a bench has one that opens.
  for (const { challenge } of CHALLENGES) expect(benchOf(challenge) === undefined).toBe(challenge.bench === undefined);
  const failed = reportText(
    {
      result: "failed",
      run: "Store and load",
      step: 0,
      inputs: [{ name: "key", value: 0 }],
      mismatches: [
        { name: "halt", expected: 1, got: 0 },
        { name: "ram[16]", expected: 7, got: 0 },
        { name: "screen[3]", expected: 129, got: 0 },
      ],
    },
    cpu,
  );
  expect(failed).toBe("Run Store and load, step 1 of 3 failed. With key = 0: halt should be 1 but is 0; RAM byte 16 should be 7 but is 0; screen byte 3 should be 129 but is 0.");
  // A run that set nothing says nothing of inputs.
  expect(reportText({ result: "failed", run: "Devices", step: 0, inputs: [], mismatches: [{ name: "out", expected: 3, got: 0 }] }, cpu)).toBe(
    "Run Devices, step 1 of 3 failed. out should be 3 but is 0.",
  );
});

test("a value with unknown bits is written with X and Z digits (ADR 0035)", () => {
  expect(showUnknown(3)).toBe("3");
  expect(showUnknown(1, 1)).toBe("X");
  expect(showUnknown(0, 1)).toBe("Z");
  // 0xF known, then a digit all Z, then one with a single X bit.
  expect(showUnknown(0x10f, 0x1f0)).toBe("0xXZF");
  const failed = reportText({ result: "failed", step: 0, inputs: [], mismatches: [{ name: "Y", expected: 1, got: 1, unknown: 1 }] }, inverter);
  expect(failed).toContain("Y should be 1 but is X.");
});

test("a bench challenge's text comes in paragraphs, its instructions one to a line; the others are one paragraph (ADR 0040)", () => {
  const text = (name: string) => findChallenge(name)?.challenge.text ?? "";
  for (const name of ["10-cpu", "11-program", "12-display"]) expect(text(name).split("\n\n").length).toBeGreaterThan(2);
  expect(text("10-cpu")).toContain("The opcodes:\n0 NOP: nothing\n1 LDI n: A = n\n");
  expect(text("11-program")).toContain("The instructions:\n0 NOP: nothing\n");
  for (const { name, challenge } of CHALLENGES) if (!challenge.bench) expect(challenge.text, name).not.toContain("\n");
});
