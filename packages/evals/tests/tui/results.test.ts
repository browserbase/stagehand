import { afterEach, describe, expect, it, vi } from "vitest";
import { printModelSummary } from "../../tui/results.js";
import type { SummaryResult } from "../../types/evals.js";

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  logSpy.mockClear();
});

function makeResult(modelName: string, success: boolean): SummaryResult {
  return {
    name: "observe/example",
    input: {
      modelName,
      name: "observe/example",
    },
    output: {
      _success: success,
    },
    score: success ? 1 : 0,
  } as SummaryResult;
}

describe("printModelSummary", () => {
  it("prints only the by-model section when multiple models are present", () => {
    printModelSummary([
      makeResult("openai/gpt-4.1-mini", true),
      makeResult("anthropic/claude-haiku-4-5", false),
    ]);

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("By model:");
    expect(output).toContain("openai/gpt-4.1-mini");
    expect(output).toContain("anthropic/claude-haiku-4-5");
    expect(output).not.toContain("Task");
    expect(output).not.toContain("Result");
  });

  it("prints nothing when there is only one model", () => {
    printModelSummary([
      makeResult("openai/gpt-4.1-mini", true),
      makeResult("openai/gpt-4.1-mini", false),
    ]);

    expect(logSpy).not.toHaveBeenCalled();
  });
});
