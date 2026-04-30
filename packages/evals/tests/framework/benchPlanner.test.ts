import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
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
    const row = buildBenchMatrixRow(
      task,
      "openai/gpt-4.1-mini" as AvailableModel,
      {
        environment: "BROWSERBASE",
        provider: "openai",
        useApi: true,
      },
    );

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

  it("marks explicit CUA-only model overrides as CUA", () => {
    const cuaModel = "openai/computer-use-preview" as AvailableModel;
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

  it("defaults hybrid-capable CUA model overrides to hybrid", () => {
    const [testcase] = generateBenchTestcases(
      [
        makeTask({
          name: "agent/webvoyager",
          primaryCategory: "agent",
          categories: ["external_agent_benchmarks"],
        }),
      ],
      {
        modelOverride: "openai/gpt-5.4-mini",
        datasetFilter: "webvoyager",
        harness: "stagehand",
      },
    );

    expect(testcase.input.modelName).toBe("openai/gpt-5.4-mini");
    expect(testcase.input.isCUA).toBe(false);
    expect(testcase.input.agentMode).toBe("hybrid");
    expect(testcase.tags).toContain("hybrid");
    expect(testcase.tags).not.toContain("cua");
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
    expect(
      testcases.map((testcase) => testcase.input.agentMode).sort(),
    ).toEqual(["dom", "hybrid"]);
    expect(testcases.map((testcase) => testcase.input.modelName)).toEqual([
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-mini",
    ]);
    expect(testcases.every((testcase) => testcase.input.isCUA === false)).toBe(
      true,
    );
  });

  it("runs configured non-CUA agent models in dom and hybrid modes", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_AGENT_MODELS: "openai/gpt-4.1-mini",
        EVAL_AGENT_MODELS_CUA: " ",
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
            datasetFilter: "webvoyager",
            harness: "stagehand",
          },
        ),
    );

    expect(testcases).toHaveLength(2);
    expect(
      testcases.map((testcase) => testcase.input.agentMode).sort(),
    ).toEqual(["dom", "hybrid"]);
    expect(
      testcases.every(
        (testcase) => testcase.input.modelName === "openai/gpt-4.1-mini",
      ),
    ).toBe(true);
  });

  it("can run CUA-capable models in requested dom and hybrid modes", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_AGENT_MODELS: "openai/gpt-4.1-mini",
        EVAL_AGENT_MODELS_CUA: "google/gemini-3-flash-preview",
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
            datasetFilter: "webvoyager",
            harness: "stagehand",
            agentModes: ["dom", "hybrid"],
          },
        ),
    );

    expect(
      testcases.map((testcase) => testcase.input.agentMode).sort(),
    ).toEqual(["dom", "dom", "hybrid", "hybrid"]);
    expect(
      testcases
        .filter(
          (testcase) =>
            testcase.input.modelName === "google/gemini-3-flash-preview",
        )
        .map((testcase) => testcase.input.agentMode)
        .sort(),
    ).toEqual(["dom", "hybrid"]);
  });

  it("can select only CUA entries with explicit cua mode", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_AGENT_MODELS: "openai/gpt-4.1-mini",
        EVAL_AGENT_MODELS_CUA: "google/gemini-3-flash-preview",
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
            datasetFilter: "webvoyager",
            harness: "stagehand",
            agentModes: ["cua"],
          },
        ),
    );

    expect(testcases).toHaveLength(1);
    expect(testcases[0].input.modelName).toBe("google/gemini-3-flash-preview");
    expect(testcases[0].input.agentMode).toBe("cua");
    expect(testcases[0].input.isCUA).toBe(true);
  });

  it("rejects non-CUA model overrides in explicit cua mode", async () => {
    await expect(
      withEnvOverrides(
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
              agentMode: "cua",
            },
          ),
      ),
    ).rejects.toThrow(/CUA-capable models are required/);
  });

  it("does not run non-CUA models in requested cua mode", async () => {
    const testcases = await withEnvOverrides(
      {
        EVAL_AGENT_MODELS: "openai/gpt-4.1-mini",
        EVAL_AGENT_MODELS_CUA: "google/gemini-3-flash-preview",
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
            datasetFilter: "webvoyager",
            harness: "stagehand",
            agentModes: ["cua"],
          },
        ),
    );

    expect(testcases.map((testcase) => testcase.input.modelName)).toEqual([
      "google/gemini-3-flash-preview",
    ]);
    expect(testcases[0].input.agentMode).toBe("cua");
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

  it("keeps codex as a harness-level matrix with browse_cli metadata", async () => {
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
            modelOverride: "openai/gpt-5.4-mini",
            datasetFilter: "webvoyager",
            harness: "codex",
            agentModes: ["dom", "hybrid"],
          },
        ),
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
    expect(testcases[0].input.agentMode).toBe("dom");
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
    expect(testcases[0].input.agentMode).toBe("dom");
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
    expect(testcases[0].input.agentMode).toBe("dom");
    expect(testcases[0].input.isCUA).toBe(false);
    expect(testcases[0].input.params?.id).toBeTruthy();
    expect(testcases[0].metadata.dataset).toBe("webtailbench");
  });
});
