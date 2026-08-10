import { beforeEach, describe, expect, it, vi } from "vitest";

const braintrustMock = vi.hoisted(() => ({
  rows: new Map<string, { id: string; name: string; created?: string }>(),
  apiCalls: [] as Array<{ endpoint: string; params: Record<string, unknown> }>,
  fetchedCalls: [] as Array<{ project: string; experiment: string }>,
  loginCalls: 0,
}));

vi.mock("braintrust", () => ({
  loginToState: async () => {
    braintrustMock.loginCalls += 1;
    return {
      orgName: "Browserbase",
      appPublicUrl: "https://braintrust.example",
      apiConn: () => ({
        get_json: async (endpoint: string, params: Record<string, unknown>) => {
          braintrustMock.apiCalls.push({ endpoint, params });

          if (endpoint === "/v1/experiment") {
            const project = String(params.project_name);
            const experiment = Array.isArray(params.ids)
              ? String(params.ids[0])
              : String(params.experiment_name);
            const row = braintrustMock.rows.get(`${project}:${experiment}`);
            return { objects: row ? [row] : [] };
          }

          if (endpoint === "/experiment-comparison2") {
            return {
              scores: {
                Pass: {
                  name: "Pass",
                  score: 1,
                  improvements: 0,
                  regressions: 0,
                },
              },
              metrics: {
                duration: {
                  name: "duration",
                  metric: 1,
                  unit: "s",
                  improvements: 0,
                  regressions: 0,
                },
                errors: {
                  name: "errors",
                  metric: 0,
                  unit: "count",
                  improvements: 0,
                  regressions: 0,
                },
              },
            };
          }

          throw new Error(`Unexpected Braintrust endpoint ${endpoint}`);
        },
      }),
    };
  },
  init: (project: string, options: { experiment: string }) => ({
    fetchedData: async () => {
      braintrustMock.fetchedCalls.push({
        project,
        experiment: options.experiment,
      });
      return [
        {
          is_root: true,
          input: { name: `${options.experiment}/task` },
          output: {
            _success: true,
            metrics: {
              total_ms: { value: 100 },
            },
          },
        },
      ];
    },
  }),
}));

import {
  clearBraintrustReportCache,
  collectExperimentMetrics,
  detectCompareMode,
  extractBenchCases,
  fetchManyExperimentData,
  inferExperimentMode,
  resolveExperimentProjectsAcrossProjects,
  sharedBenchCaseKeys,
  summarizeBenchAgentConfigs,
  type ExperimentData,
  type ExperimentEvent,
} from "../../lib/braintrust-report.js";

describe("braintrust-report", () => {
  beforeEach(() => {
    clearBraintrustReportCache();
    braintrustMock.rows.clear();
    braintrustMock.apiCalls.length = 0;
    braintrustMock.fetchedCalls.length = 0;
    braintrustMock.loginCalls = 0;
    process.env.BRAINTRUST_API_KEY = "test-key";
  });

  it("resolves compare inputs across bench and core projects independently", async () => {
    braintrustMock.rows.set("stagehand-core-dev:core-exp", {
      id: "core-id",
      name: "core-exp",
    });
    braintrustMock.rows.set("stagehand-dev:bench-exp", {
      id: "bench-id",
      name: "bench-exp",
    });

    const resolved = await resolveExperimentProjectsAcrossProjects(
      ["stagehand-dev", "stagehand-core-dev"],
      [
        { label: "Core", experiment: "core-exp" },
        { label: "Bench", experiment: "bench-exp" },
      ],
    );

    expect(resolved.map((entry) => entry.projectName)).toEqual([
      "stagehand-core-dev",
      "stagehand-dev",
    ]);
    expect(resolved.map((entry) => entry.experimentId)).toEqual([
      "core-id",
      "bench-id",
    ]);
  });

  it("uses per-input projects and reuses cached payloads across fetches", async () => {
    braintrustMock.rows.set("stagehand-core-dev:core-exp", {
      id: "core-id",
      name: "core-exp",
    });
    braintrustMock.rows.set("stagehand-dev:bench-exp", {
      id: "bench-id",
      name: "bench-exp",
    });

    const inputs = [
      {
        label: "Core",
        experiment: "core-exp",
        project: "stagehand-core-dev",
      },
      {
        label: "Bench",
        experiment: "bench-exp",
        project: "stagehand-dev",
      },
    ];

    const first = await fetchManyExperimentData("stagehand-core-dev", inputs);
    const second = await fetchManyExperimentData("stagehand-core-dev", inputs);

    expect(first.map((row) => row.projectName)).toEqual([
      "stagehand-core-dev",
      "stagehand-dev",
    ]);
    expect(second.map((row) => row.experimentId)).toEqual([
      "core-id",
      "bench-id",
    ]);
    expect(
      braintrustMock.apiCalls.filter(
        (call) => call.endpoint === "/experiment-comparison2",
      ),
    ).toHaveLength(2);
    expect(braintrustMock.fetchedCalls).toHaveLength(2);
  });

  it("scopes cached Braintrust payloads by API key", async () => {
    braintrustMock.rows.set("stagehand-dev:exp", {
      id: "exp-id",
      name: "exp",
    });

    await fetchManyExperimentData(
      "stagehand-dev",
      [{ label: "A", experiment: "exp" }],
      { apiKey: "key-a" },
    );
    await fetchManyExperimentData(
      "stagehand-dev",
      [{ label: "A", experiment: "exp" }],
      { apiKey: "key-b" },
    );

    expect(braintrustMock.loginCalls).toBe(2);
    expect(
      braintrustMock.apiCalls.filter(
        (call) => call.endpoint === "/v1/experiment",
      ),
    ).toHaveLength(2);
    expect(
      braintrustMock.apiCalls.filter(
        (call) => call.endpoint === "/experiment-comparison2",
      ),
    ).toHaveLength(2);
    expect(braintrustMock.fetchedCalls).toHaveLength(2);
  });

  it("honors explicit core tier before modelName heuristics", () => {
    expect(
      inferExperimentMode("stagehand-dev", [
        {
          is_root: true,
          input: {
            name: "act/login",
            modelName: "none",
          },
          metadata: {
            tier: "core",
            test: "act/login",
            task: "act/login",
          },
          output: {
            _success: true,
          },
        },
      ]),
    ).toBe("core");
  });

  it("extracts bench cases without collapsing suite-level task names", () => {
    const events: ExperimentEvent[] = [
      {
        is_root: true,
        input: {
          name: "agent/webvoyager",
          modelName: "google/gemini-2.0-flash",
          agentMode: "cua",
          params: { id: "wv-1", web_name: "Amazon" },
        },
        metadata: {
          tier: "bench",
          task: "agent/webvoyager",
          test: "agent/webvoyager:wv-1",
          dataset: "webvoyager",
          task_id: "wv-1",
          model: "google/gemini-2.0-flash",
          agentMode: "cua",
        },
        output: {
          _success: true,
          metrics: { total_ms: { value: 1000 } },
        },
      },
      {
        is_root: true,
        input: {
          name: "agent/webvoyager",
          modelName: "google/gemini-2.0-flash",
          agentMode: "cua",
          params: { id: "wv-2", web_name: "Flights" },
        },
        metadata: {
          tier: "bench",
          task: "agent/webvoyager",
          test: "agent/webvoyager:wv-2",
          dataset: "webvoyager",
          task_id: "wv-2",
          model: "google/gemini-2.0-flash",
          agentMode: "cua",
        },
        output: {
          _success: false,
          metrics: { total_ms: { value: 2000 } },
        },
      },
    ];

    const cases = extractBenchCases(events);

    expect(cases).toHaveLength(2);
    expect(cases.map((benchCase) => benchCase.taskId)).toEqual([
      "wv-1",
      "wv-2",
    ]);
    expect(new Set(cases.map((benchCase) => benchCase.key)).size).toBe(2);
  });

  it("detects bench/core modes and rejects mixed comparisons", () => {
    const core = makeExperimentData({
      mode: "core",
      projectName: "stagehand-core-dev",
      tasks: [{ name: "act/login", success: true }],
    });
    const bench = makeExperimentData({
      mode: "bench",
      projectName: "stagehand-dev",
      benchCases: [
        {
          key: "webvoyager::wv-1::model-a::cua::1",
          suite: "agent/webvoyager",
          dataset: "webvoyager",
          taskId: "wv-1",
          taskName: "agent/webvoyager:wv-1",
          model: "model-a",
          agentMode: "cua",
          trial: 1,
          success: true,
          metrics: {},
        },
      ],
    });

    expect(detectCompareMode([core])).toBe("core");
    expect(detectCompareMode([bench])).toBe("bench");
    expect(() => detectCompareMode([core, bench])).toThrow(
      /Cannot compare core and bench experiments together yet/,
    );
  });

  it("computes shared bench case keys from the case-centric identity", () => {
    const a = makeExperimentData({
      mode: "bench",
      benchCases: [
        makeBenchCase("webvoyager::wv-1::model-a::cua::1"),
        makeBenchCase("webvoyager::wv-2::model-a::cua::1"),
      ],
    });
    const b = makeExperimentData({
      mode: "bench",
      benchCases: [
        makeBenchCase("webvoyager::wv-1::model-a::cua::1"),
        makeBenchCase("webvoyager::wv-3::model-a::cua::1"),
      ],
    });

    expect(sharedBenchCaseKeys([a, b])).toEqual([
      "webvoyager::wv-1::model-a::cua::1",
    ]);
  });

  it("summarizes bench agent configs with model lists and metrics", () => {
    const cases = [
      {
        ...makeBenchCase("webvoyager::wv-1::model-a::cua::1"),
        harness: "stagehand",
        environment: "BROWSERBASE",
        api: true,
        toolSurface: "act",
        startupProfile: "tool_launch_local",
        metrics: { total_ms: 1000, cost_usd: 0.01 },
      },
      {
        ...makeBenchCase("webvoyager::wv-2::model-b::cua::1"),
        harness: "stagehand",
        environment: "BROWSERBASE",
        api: true,
        toolSurface: "act",
        startupProfile: "tool_launch_local",
        success: false,
        metrics: { total_ms: 2000, cost_usd: 0.03 },
      },
    ];

    const summaries = summarizeBenchAgentConfigs(cases);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].models).toEqual(["model-a", "model-b"]);
    expect(summaries[0].passed).toBe(1);
    expect(summaries[0].total).toBe(2);
    expect(summaries[0].metrics.cost_usd.mean).toBe(0.02);
  });

  it("collects derived and raw experiment metrics for compare output", () => {
    const row = makeExperimentData({
      mode: "bench",
      raw: {
        scores: {},
        metrics: {
          cost_usd: {
            name: "cost_usd",
            metric: 0.42,
            unit: "usd",
            improvements: 0,
            regressions: 0,
          },
        },
      },
      benchCases: [
        {
          ...makeBenchCase("webvoyager::wv-1::model-a::cua::1"),
          durationMs: 1250,
        },
      ],
    });

    const metrics = collectExperimentMetrics([row]);

    expect(metrics.map((metric) => metric.key)).toContain(
      "derived:mean_case_duration",
    );
    expect(metrics.map((metric) => metric.key)).toContain(
      "braintrust:cost_usd",
    );
  });
});

function makeBenchCase(key: string): ExperimentData["benchCases"][number] {
  const [, taskId, model, agentMode, trial] = key.split("::");
  return {
    key,
    suite: "agent/webvoyager",
    dataset: "webvoyager",
    taskId,
    taskName: `agent/webvoyager:${taskId}`,
    model,
    agentMode,
    trial: Number(trial),
    success: true,
    metrics: {},
  };
}

function makeExperimentData(
  overrides: Partial<ExperimentData>,
): ExperimentData {
  return {
    label: "Experiment",
    experimentName: "exp",
    experimentId: "id",
    experimentUrl: "https://braintrust.example/exp",
    projectName: "stagehand-dev",
    mode: "core",
    passScore: 1,
    totalTasks: 1,
    passedTasks: 1,
    durationSeconds: 1,
    errorsMetric: 0,
    raw: { scores: {}, metrics: {} },
    taskMetrics: {},
    tasks: [],
    benchCases: [],
    ...overrides,
  };
}
