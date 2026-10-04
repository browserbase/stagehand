import { describe, expect, it } from "vitest";
import { toSummaryResult } from "../../framework/runner.js";
import type { EvalInput } from "../../types/evals.js";

const input = { name: "agent/hardbenchmark", modelName: "google/gemini-3.5-flash" } as EvalInput;

describe("toSummaryResult", () => {
  it("keeps object outputs and derives the score", () => {
    const row = toSummaryResult({
      input,
      output: { _success: true, steps: 4 },
      metadata: { categories: ["navigation", 3] },
    });
    expect(row).toEqual({
      input,
      output: { _success: true, steps: 4 },
      name: "agent/hardbenchmark",
      score: 1,
      categories: ["navigation"],
    });
  });

  it("wraps boolean outputs", () => {
    expect(toSummaryResult({ input, output: false }).output).toEqual({ _success: false });
  });

  it("treats a Braintrust row without output as a failed row carrying the error", () => {
    const row = toSummaryResult({ input, output: undefined, error: new Error("span failed") });
    expect(row.score).toBe(0);
    expect(row.output).toEqual({ _success: false, error: "span failed" });
    expect(row.name).toBe("agent/hardbenchmark");
  });

  it("explains a missing output when Braintrust reports no error either", () => {
    expect(toSummaryResult({ input }).output).toEqual({
      _success: false,
      error: "Braintrust reported no output for this task",
    });
    expect(toSummaryResult({ input, output: null, error: "boom" }).output).toEqual({
      _success: false,
      error: "boom",
    });
  });
});
