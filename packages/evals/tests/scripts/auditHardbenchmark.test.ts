import { describe, expect, it } from "vitest";
import { applyAudit, auditRows, checkRubric } from "../../scripts/audit-hardbenchmark.js";

const rubric = {
  items: [
    { criterion: "Stop before checkout", description: "Do not submit the order", maxPoints: 2 },
  ],
};
describe("offline HardBench audit", () => {
  it("validates required fields, duplicate criteria and finite points without dropping rows", () => {
    expect(checkRubric(rubric)).toEqual([]);
    for (const maxPoints of [undefined, 0, -1, NaN, Infinity])
      expect(checkRubric({ items: [{ ...rubric.items[0], maxPoints }] }).length).toBeGreaterThan(0);
    expect(checkRubric({ items: [null] })).toEqual(["item 0: not an object"]);
    expect(checkRubric({ items: [...rubric.items, ...rubric.items] })).toContain(
      "item 1: duplicate criterion",
    );
    expect(() =>
      auditRows([
        { id: "x", ques: "Task" },
        { id: "x", ques: "Task" },
      ]),
    ).toThrow(/Duplicate/);
  });
  it("flags a stop-boundary ambiguity without invalidating the task", () => {
    const row = { id: "x", ques: "Buy the item", precomputed_rubric: rubric };
    expect(auditRows([row])[0]).toMatchObject({ stopBeforePurchase: true, rubricProblems: [] });
    expect(applyAudit([row], auditRows([row]))[0]).toMatchObject({
      verdict_review: "stop-before-purchase",
    });
    expect(row).not.toHaveProperty("verdict_review");
  });
  it("preserves manual retirements and rubric version when applying defects", () => {
    const rows: Parameters<typeof auditRows>[0] = [
      {
        id: "x",
        ques: "Task",
        valid: false,
        invalid_reason: "manual retirement",
        rubric_version: "1.2",
        clarifications: ["critical-point"],
        precomputed_rubric: null,
      },
      { id: "y", ques: "Task", precomputed_rubric: null },
    ];
    const updated = applyAudit(rows, auditRows(rows));
    expect(updated[0]).toEqual(rows[0]);
    expect(updated[1]).toMatchObject({
      valid: false,
      invalid_reason: "rubric: precomputed_rubric.items missing or empty",
    });
  });
});
