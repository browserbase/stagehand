import { describe, expect, it } from "vitest";
import { auditRows, checkRubric } from "../../scripts/audit-hardbenchmark.js";

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
    expect(row).toEqual({ id: "x", ques: "Buy the item", precomputed_rubric: rubric });
  });
  it("reports rubric defects without mutating the corpus or its rubric metadata", () => {
    const rows: Parameters<typeof auditRows>[0] = [
      {
        id: "x",
        ques: "Task",
        set: "core",
        rubric_version: "1.2",
        clarifications: ["critical-point"],
        precomputed_rubric: null,
      },
    ];
    const before = structuredClone(rows);
    expect(auditRows(rows)).toEqual([
      {
        id: "x",
        rubricProblems: ["precomputed_rubric.items missing or empty"],
        stopBeforePurchase: false,
      },
    ]);
    expect(rows).toEqual(before);
  });
});
