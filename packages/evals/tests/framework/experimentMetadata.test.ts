import { describe, expect, it } from "vitest";
import { buildExperimentMetadata } from "../../framework/runner.js";
import type { AvailableModel } from "stagehand-v3";
import type { Testcase } from "../../types/evals.js";

function row(meta: Partial<Omit<Testcase["metadata"], "model">> & { model?: string }): Testcase {
  return {
    input: { name: "agent/hardbenchmark", modelName: "openai/gpt-5.4-mini" as AvailableModel },
    name: "agent/hardbenchmark",
    tags: [],
    metadata: {
      test: "t",
      ...meta,
      model: (meta.model ?? "openai/gpt-5.4-mini") as AvailableModel,
    },
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

  it("prefers explicit core surface and omits core placeholder models", () => {
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

it("prefers explicit model and startup overrides", () => {
  const meta = buildExperimentMetadata({
    environment: "LOCAL",
    tier: "core",
    modelOverride: "openai/override",
    coreStartupProfile: "tool_create_local",
    useApi: true,
    testcases: [row({ model: "openai/row", startupProfile: "tool_create_browserbase" })],
  });
  expect(meta).toMatchObject({
    model: "openai/override",
    startup_profile: "tool_create_local",
    api: true,
  });
});

it("stamps the campaign tag only when one is set", () => {
  const base = { environment: "LOCAL" as const, tier: "bench" as const, testcases: [row({})] };
  expect(buildExperimentMetadata({ ...base, campaign: "facade-0831" }).campaign).toBe(
    "facade-0831",
  );
  expect(buildExperimentMetadata(base)).not.toHaveProperty("campaign");
});
