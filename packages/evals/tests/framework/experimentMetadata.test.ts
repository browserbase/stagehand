import { describe, expect, it } from "vitest";
import { buildExperimentMetadata } from "../../framework/runner.js";
import type { Testcase } from "../../types/evals.js";

function row(meta: Record<string, unknown>): Testcase {
  return {
    input: { name: "agent/hardbenchmark", modelName: "openai/gpt-5.4-mini" as never },
    name: "agent/hardbenchmark",
    tags: [],
    metadata: { model: "openai/gpt-5.4-mini", test: "t", ...meta } as never,
    expected: true,
  };
}

describe("buildExperimentMetadata", () => {
  it("always carries tool surface and model for bench runs, derived from rows", () => {
    const meta = buildExperimentMetadata({
      environment: "BROWSERBASE",
      tier: "bench",
      harness: "mastra",
      testcases: [
        row({ toolSurface: "stagehand_facade", provider: "openai", dataset: "hardbenchmark" }),
        row({ toolSurface: "stagehand_facade", provider: "openai", dataset: "hardbenchmark" }),
      ],
    });
    expect(meta).toMatchObject({
      environment: "BROWSERBASE",
      tier: "bench",
      harness: "mastra",
      tool_surface: "stagehand_facade",
      model: "openai/gpt-5.4-mini",
      provider: "openai",
      dataset: "hardbenchmark",
      task_count: 2,
    });
  });

  it("lists several distinct surfaces or models instead of dropping them", () => {
    const meta = buildExperimentMetadata({
      environment: "LOCAL",
      tier: "bench",
      testcases: [
        row({ toolSurface: "stagehand_facade", model: "a/x" }),
        row({ toolSurface: "stagehand_facade_legacy", model: "b/y" }),
      ],
    });
    expect(meta.tool_surface).toEqual(["stagehand_facade", "stagehand_facade_legacy"]);
    expect(meta.model).toEqual(["a/x", "b/y"]);
  });

  it("prefers explicit core surface / model override and omits core placeholder models", () => {
    const meta = buildExperimentMetadata({
      environment: "LOCAL",
      tier: "core",
      coreToolSurface: "understudy_code",
      testcases: [row({ model: "none" })],
    });
    expect(meta.tool_surface).toBe("understudy_code");
    expect(meta).not.toHaveProperty("model");
  });
});
