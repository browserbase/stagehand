import { describe, expect, it } from "vitest";
import {
  AVAILABLE_CUA_MODELS,
  type AvailableModel,
} from "@browserbasehq/stagehand";
import type { DiscoveredTask } from "../../framework/types.js";
import {
  buildBenchMatrixRow,
  generateBenchTestcases,
} from "../../framework/benchPlanner.js";
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

describe("benchPlanner", () => {
  it("builds stagehand matrix rows by default", () => {
    const task = makeTask();
    const row = buildBenchMatrixRow(task, "openai/gpt-4.1-mini" as AvailableModel, {
      environment: "BROWSERBASE",
      provider: "openai",
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

  it("marks explicit computer-use model overrides as CUA", () => {
    const cuaModel = AVAILABLE_CUA_MODELS[0];
    const [testcase] = generateBenchTestcases(
      [
        makeTask({
          name: "agent/webvoyager",
          primaryCategory: "agent",
          categories: ["external_agent_benchmarks"],
        }),
      ],
      {
        modelOverride: cuaModel,
        datasetFilter: "webvoyager",
        harness: "stagehand",
      },
    );

    expect(testcase.input.modelName).toBe(cuaModel);
    expect(testcase.input.isCUA).toBe(true);
    expect(testcase.input.agentMode).toBe("cua");
    expect(testcase.tags).toContain("cua");
  });

  it("lets an explicit agent mode override inferred suite mode", () => {
    const [testcase] = generateBenchTestcases(
      [
        makeTask({
          name: "agent/webvoyager",
          primaryCategory: "agent",
          categories: ["external_agent_benchmarks"],
        }),
      ],
      {
        modelOverride: "openai/gpt-4.1-mini",
        datasetFilter: "webvoyager",
        harness: "stagehand",
        agentMode: "dom",
      },
    );

    expect(testcase.input.agentMode).toBe("dom");
    expect(testcase.input.isCUA).toBe(false);
    expect(testcase.tags).toContain("dom");
    expect(testcase.tags).not.toContain("hybrid");
    expect(testcase.metadata.agentMode).toBe("dom");
  });

  it("can expand a stagehand model across explicit agent modes", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases(
          [
            makeTask({
              name: "agent/webvoyager",
              primaryCategory: "agent",
              categories: ["external_agent_benchmarks"],
            }),
          ],
          {
            modelOverride: "openai/gpt-4.1-mini",
            datasetFilter: "webvoyager",
            harness: "stagehand",
            agentModes: ["dom", "hybrid"],
          },
        ),
    );

    expect(testcases).toHaveLength(2);
    expect(testcases.map((testcase) => testcase.input.agentMode).sort()).toEqual([
      "dom",
      "hybrid",
    ]);
    expect(testcases.map((testcase) => testcase.input.modelName)).toEqual([
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-mini",
    ]);
    expect(testcases.every((testcase) => testcase.input.isCUA === false)).toBe(
      true,
    );
  });

  it("does not expand non-agent model overrides across agent modes", () => {
    const testcases = generateBenchTestcases([makeTask()], {
      modelOverride: "openai/gpt-4.1-mini",
      harness: "stagehand",
      agentModes: ["dom", "hybrid"],
    });

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.modelName).toBe("openai/gpt-4.1-mini");
    expect(testcases[0].input.agentMode).toBeUndefined();
    expect(testcases[0].input.isCUA).toBeUndefined();
    expect(testcases[0].tags).not.toContain("dom");
    expect(testcases[0].tags).not.toContain("hybrid");
    expect(testcases[0].metadata.agentMode).toBeUndefined();
  });

  it("keeps claude_code as a harness-level matrix without stagehand agent modes", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases(
          [
            makeTask({
              name: "agent/webvoyager",
              primaryCategory: "agent",
              categories: ["external_agent_benchmarks"],
            }),
          ],
          {
            modelOverride: "anthropic/claude-sonnet-4-20250514",
            datasetFilter: "webvoyager",
            harness: "claude_code",
            agentModes: ["dom", "hybrid"],
          },
        ),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.modelName).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
    expect(testcases[0].input.agentMode).toBeUndefined();
    expect(testcases[0].input.isCUA).toBeUndefined();
    expect(testcases[0].tags).toContain("harness/claude_code");
    expect(testcases[0].tags).not.toContain("dom");
    expect(testcases[0].tags).not.toContain("hybrid");
    expect(testcases[0].metadata.harness).toBe("claude_code");
    expect(testcases[0].metadata.toolSurface).toBe("browse_cli");
    expect(testcases[0].metadata.startupProfile).toBe("tool_launch_local");
    expect(testcases[0].metadata.agentMode).toBeUndefined();
  });

  it("filters unsupported Claude Code tasks from broad targets", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases(
          [
            makeTask(),
            makeTask({
              name: "agent/webvoyager",
              primaryCategory: "agent",
              categories: ["external_agent_benchmarks"],
            }),
          ],
          {
            modelOverride: "anthropic/claude-sonnet-4-20250514",
            datasetFilter: "webvoyager",
            harness: "claude_code",
          },
        ),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/webvoyager");
    expect(testcases[0].tags).toContain("harness/claude_code");
    expect(testcases.map((testcase) => testcase.input.name)).not.toContain(
      "dropdown",
    );
  });

  it("generates direct WebVoyager suite testcases from source datasets", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_WEBVOYAGER_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases(
          [
            makeTask({
              name: "agent/webvoyager",
              primaryCategory: "agent",
              categories: ["external_agent_benchmarks"],
            }),
          ],
          {
            modelOverride: "openai/gpt-4.1-mini",
            datasetFilter: "webvoyager",
            harness: "stagehand",
          },
        ),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/webvoyager");
    expect(testcases[0].input.agentMode).toBe("hybrid");
    expect(testcases[0].input.isCUA).toBe(false);
    expect(testcases[0].input.params?.id).toBeTruthy();
    expect(testcases[0].metadata.dataset).toBe("webvoyager");
    expect(testcases[0].metadata.categories).toEqual([
      "external_agent_benchmarks",
    ]);
    expect(testcases[0].metadata.category).toBe("external_agent_benchmarks");
  });

  it("generates direct OnlineMind2Web suite testcases from source datasets", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_MAX_K: "1",
        EVAL_ONLINEMIND2WEB_LIMIT: "1",
      },
      async () =>
        generateBenchTestcases(
          [
            makeTask({
              name: "agent/onlineMind2Web",
              primaryCategory: "agent",
              categories: ["external_agent_benchmarks"],
            }),
          ],
          {
            modelOverride: "openai/gpt-4.1-mini",
            datasetFilter: "onlineMind2Web",
            harness: "stagehand",
          },
        ),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/onlineMind2Web");
    expect(testcases[0].input.agentMode).toBe("hybrid");
    expect(testcases[0].input.isCUA).toBe(false);
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
        generateBenchTestcases(
          [
            makeTask({
              name: "agent/webtailbench",
              primaryCategory: "agent",
              categories: ["external_agent_benchmarks"],
            }),
          ],
          {
            modelOverride: "openai/gpt-4.1-mini",
            datasetFilter: "webtailbench",
            harness: "stagehand",
          },
        ),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.name).toBe("agent/webtailbench");
    expect(testcases[0].input.agentMode).toBe("hybrid");
    expect(testcases[0].input.isCUA).toBe(false);
    expect(testcases[0].input.params?.id).toBeTruthy();
    expect(testcases[0].metadata.dataset).toBe("webtailbench");
  });
});
