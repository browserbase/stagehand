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
