import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { EvalLogger } from "../../logger.js";
import {
  claudeCodeHarness,
  getBenchHarness,
} from "../../framework/benchHarness.js";
import { buildBenchMatrixRow } from "../../framework/benchPlanner.js";
import type { DiscoveredTask } from "../../framework/types.js";

function makeTask(overrides: Partial<DiscoveredTask> = {}): DiscoveredTask {
  return {
    name: "agent/webvoyager",
    tier: "bench",
    primaryCategory: "agent",
    categories: ["external_agent_benchmarks"],
    tags: [],
    filePath: "/fake.ts",
    isLegacy: false,
    ...overrides,
  };
}

describe("bench harness registry", () => {
  it("registers claude_code as a concrete non-executable harness", () => {
    const harness = getBenchHarness("claude_code");

    expect(harness).toBe(claudeCodeHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
  });

  it("keeps claude_code execution behind an explicit experimental gate", async () => {
    const task = makeTask();
    const row = buildBenchMatrixRow(
      task,
      "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      {
        harness: "claude_code",
        environment: "BROWSERBASE",
        datasetFilter: "webvoyager",
      },
    );

    await expect(
      claudeCodeHarness.execute?.({
        task,
        input: {
          name: task.name,
          modelName: row.model,
          params: {
            id: "1",
            web: "https://example.com",
            ques: "Find the checkout button",
          },
        },
        row,
        logger: new EvalLogger(false),
      }),
    ).rejects.toThrow(/EVAL_CLAUDE_CODE_EXPERIMENTAL=true/);
  });
});
