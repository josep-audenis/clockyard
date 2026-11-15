import { expect, test } from "vitest";
import { CHALLENGES, findChallenge, reportText, starterDocument } from "./challenges";

const entry = findChallenge("01-inverter");
if (!entry) throw new Error("the inverter challenge is missing");
const inverter = entry.challenge;

test("every bundled challenge is listed in order, with a starter on its definition", () => {
  expect(CHALLENGES.map((c) => c.name)).toEqual(["01-inverter", "02-xor", "03-half-adder", "04-full-adder", "05-adder8"]);
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
