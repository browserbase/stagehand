import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { DiscoveredTask } from "../../framework/types.js";
import { buildBenchMatrixRow, generateBenchTestcases } from "../../framework/benchPlanner.js";
import { withEnvOverrides } from "../../tui/commands/parse.js";

function makeTask(overrides: Partial<DiscoveredTask> = {}): DiscoveredTask {
  return {
    name: "dropdown",
    tier: "bench",
    primaryCategory: "act",
    categories: ["act"],
    tags: [],
    filePath: "/fake.js",
    isLegacy: false,
    ...overrides,
  };
}

function makeSuiteTask(name: string): DiscoveredTask {
  return makeTask({
    name,
    primaryCategory: "agent",
    categories: ["external_agent_benchmarks"],
  });
}

describe("benchPlanner", () => {
  it("builds stagehand matrix rows by default", () => {
    const task = makeTask();
    const row = buildBenchMatrixRow(task, "openai/gpt-4.1-mini" as AvailableModel, {
      environment: "BROWSERBASE",
      useApi: true,
    });

    expect(row).toMatchObject({
      harness: "stagehand",
      task: "dropdown",
      category: "act",
      taskKind: "act",
      model: "openai/gpt-4.1-mini",
      provider: "openai",
      environment: "BROWSERBASE",
      useApi: true,
      config: {
        harness: "stagehand",
        model: "openai/gpt-4.1-mini",
        provider: "openai",
        environment: "BROWSERBASE",
        useApi: true,
      },
    });
  });

  it("annotates generated bench testcases with harness metadata", () => {
    const [testcase] = generateBenchTestcases([makeTask()], {
      modelOverride: "openai/gpt-4.1-mini",
      harness: "stagehand",
      environment: "LOCAL",
    });

    expect(testcase.input.modelName).toBe("openai/gpt-4.1-mini");
    expect(testcase.tags).toContain("harness/stagehand");
    expect(testcase.metadata.harness).toBe("stagehand");
    expect(testcase.metadata.environment).toBe("LOCAL");
  });

  it("rejects agent suites on the stagehand harness", async () => {
    const generate = () =>
      withEnvOverrides(
        {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        async () =>
          generateBenchTestcases([makeSuiteTask("agent/webvoyager")], {
            modelOverride: "openai/gpt-4.1-mini",
            datasetFilter: "webvoyager",
            harness: "stagehand",
          }),
      );

    await expect(generate()).rejects.toThrow("Agent benchmark suites require an external harness");
  });

  it("keeps claude_code as a harness-level matrix", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases([makeSuiteTask("agent/webvoyager")], {
          modelOverride: "anthropic/claude-sonnet-4-20250514",
          datasetFilter: "webvoyager",
          harness: "claude_code",
        }),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.modelName).toBe("anthropic/claude-sonnet-4-20250514");
    expect(testcases[0].input.agentMode).toBeUndefined();
    expect(testcases[0].input.isCUA).toBeUndefined();
    expect(testcases[0].tags).toContain("harness/claude_code");
    expect(testcases[0].metadata.harness).toBe("claude_code");
    expect(testcases[0].metadata.toolSurface).toBe("browse_cli");
    expect(testcases[0].metadata.startupProfile).toBe("tool_launch_local");
    expect(testcases[0].metadata.agentMode).toBeUndefined();
  });

  it("keeps codex as a harness-level matrix with browse_cli metadata", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases([makeSuiteTask("agent/webvoyager")], {
          modelOverride: "openai/gpt-5.4-mini",
          datasetFilter: "webvoyager",
          harness: "codex",
        }),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.modelName).toBe("openai/gpt-5.4-mini");
    expect(testcases[0].input.agentMode).toBeUndefined();
    expect(testcases[0].input.isCUA).toBeUndefined();
    expect(testcases[0].tags).toContain("harness/codex");
    expect(testcases[0].metadata.harness).toBe("codex");
    expect(testcases[0].metadata.toolSurface).toBe("browse_cli");
    expect(testcases[0].metadata.startupProfile).toBe("tool_launch_local");
    expect(testcases[0].metadata.toolCommand).toBe("browse");
    expect(testcases[0].metadata.agentMode).toBeUndefined();
  });

  it("rejects unsupported Claude Code tasks from broad targets", async () => {
    const generate = () =>
      withEnvOverrides(
        {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        async () =>
          generateBenchTestcases([makeTask(), makeSuiteTask("agent/webvoyager")], {
            modelOverride: "anthropic/claude-sonnet-4-20250514",
            datasetFilter: "webvoyager",
            harness: "claude_code",
          }),
      );

    await expect(generate()).rejects.toThrow(
      'Harness "claude_code" only supports agent benchmark suites',
    );
    await expect(generate()).rejects.toThrow("Unsupported task(s): dropdown");
  });

  it("generates direct WebVoyager suite testcases from source datasets", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases([makeSuiteTask("agent/webvoyager")], {
          modelOverride: "openai/gpt-4.1-mini",
          datasetFilter: "webvoyager",
          harness: "claude_code",
        }),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/webvoyager");
    expect(testcases[0].input.params?.id).toBeTruthy();
    expect(testcases[0].metadata.dataset).toBe("webvoyager");
    expect(testcases[0].metadata.categories).toEqual(["external_agent_benchmarks"]);
    expect(testcases[0].metadata.category).toBe("external_agent_benchmarks");
  });

  it("generates direct OnlineMind2Web suite testcases from source datasets", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_ONLINEMIND2WEB_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases([makeSuiteTask("agent/onlineMind2Web")], {
          modelOverride: "openai/gpt-4.1-mini",
          datasetFilter: "onlineMind2Web",
          harness: "claude_code",
        }),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/onlineMind2Web");
    expect(testcases[0].input.params?.task_id).toBeTruthy();
    expect(testcases[0].metadata.dataset).toBe("onlineMind2Web");
  });

  it("generates direct WebTailBench suite testcases from source datasets", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBTAILBENCH_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases([makeSuiteTask("agent/webtailbench")], {
          modelOverride: "openai/gpt-4.1-mini",
          datasetFilter: "webtailbench",
          harness: "claude_code",
        }),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/webtailbench");
    expect(testcases[0].input.params?.id).toBeTruthy();
    expect(testcases[0].metadata.dataset).toBe("webtailbench");
    // task_category must carry the dataset row's fine-grained category
    // (e.g. hotels_head / flights), not collapse to the directory category.
    const rowCategory = testcases[0].input.params?.category as string;
    expect(rowCategory).toBeTruthy();
    expect(testcases[0].metadata.task_category).toBe(rowCategory);
    expect(testcases[0].metadata.task_category).not.toBe(testcases[0].metadata.category);
    expect(testcases[0].metadata.task_category).not.toBe("agent");
  });
});
