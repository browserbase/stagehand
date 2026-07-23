import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRepoRootDir } from "../runtimePaths.js";
import { generateSummary } from "../summary.js";
import type { SummaryResult } from "../types/evals.js";

const summaryPath = path.join(getRepoRootDir(), "eval-summary.json");
let originalSummary: string | undefined;

beforeEach(() => {
  originalSummary = fs.existsSync(summaryPath)
    ? fs.readFileSync(summaryPath, "utf8")
    : undefined;
});

afterEach(() => {
  if (originalSummary === undefined) {
    if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
    return;
  }

  fs.writeFileSync(summaryPath, originalSummary);
});

function makeResult(name: string, success: boolean): SummaryResult {
  return {
    input: {
      name,
      modelName: "openai/gpt-4.1-mini",
    },
    output: { _success: success },
    name,
    score: success ? 1 : 0,
  };
}

describe("generateSummary", () => {
  it("preserves cross-cutting categories for category-qualified task names", async () => {
    await generateSummary(
      [
        makeResult("observe/observe_github", true),
        makeResult("observe/observe_github", false),
      ],
      "regression-3fb31541",
      "https://www.braintrust.dev/app/Browserbase/p/stagehand/experiments/regression-3fb31541",
    );

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

    expect(summary.experimentName).toBe("regression-3fb31541");
    expect(summary.experimentUrl).toContain("regression-3fb31541");
    expect(summary.categories.observe).toBe(50);
    expect(summary.categories.regression).toBe(50);
    expect(summary.passed[0].categories).toEqual(["observe", "regression"]);
    expect(summary.failed[0].categories).toEqual(["observe", "regression"]);
  });

  it("includes Braintrust scores when provided", async () => {
    await generateSummary(
      [
        makeResult("observe/observe_github", true),
        makeResult("observe/observe_github", false),
      ],
      "regression-b0b8a8f2",
      "https://www.braintrust.dev/app/Browserbase/p/stagehand/experiments/regression-b0b8a8f2",
      {
        "Exact match": {
          name: "Exact match",
          score: 0.875,
          improvements: 0,
          regressions: 0,
        },
      },
    );

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

    expect(summary.scores["Exact match"].score).toBe(0.875);
    expect(summary.categories.regression).toBe(50);
  });
});
