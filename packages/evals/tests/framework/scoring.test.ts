import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { exactMatch, passRate } from "../../scoring.js";

describe("core scoring", () => {
  it("reports Pass for successful core outputs", () => {
    const result = passRate({
      input: {
        name: "navigation/open",
        modelName: "openai/gpt-4.1-mini" as AvailableModel,
      },
      output: { _success: true },
      expected: true,
    });

    expect(result).toEqual({
      name: "Pass",
      score: 1,
    });
  });

  it("keeps Exact match available for bench-style scoring", () => {
    const result = exactMatch({
      input: {
        name: "bench/task",
        modelName: "openai/gpt-4.1-mini" as AvailableModel,
      },
      output: { _success: true },
      expected: true,
    });

    expect(result).toEqual({
      name: "Exact match",
      score: 1,
    });
  });
});
