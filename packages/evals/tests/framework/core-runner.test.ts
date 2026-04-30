/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import { createMetricsCollector } from "../../framework/metrics.js";

const tempDirs: string[] = [];
const tracedNames: string[] = [];
const evalMock = vi.fn();
const flushMock = vi.fn(async () => {});
const generateSummaryMock = vi.fn(async () => {});
const buildCoreContextMock = vi.fn();
const resolveDefaultCoreStartupProfileMock = vi.fn(
  () => "runner_provided_local_cdp",
);
let originalCi: string | undefined;

vi.mock("braintrust", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("braintrust");
  return {
    ...actual,
    Eval: evalMock,
    flush: flushMock,
    traced: async (fn: () => Promise<unknown>, meta: { name: string }) => {
      tracedNames.push(meta.name);
      return await fn();
    },
  };
});

vi.mock("../../summary.js", () => ({
  generateSummary: generateSummaryMock,
}));

vi.mock("../../framework/context.js", () => ({
  buildCoreContext: buildCoreContextMock,
  resolveDefaultCoreStartupProfile: resolveDefaultCoreStartupProfileMock,
}));

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-core-runner-"));
  tempDirs.push(dir);
  return dir;
}

function makeRegistry(tasks: DiscoveredTask[]): TaskRegistry {
  const byName = new Map(tasks.map((task) => [task.name, task]));
  const byTier = new Map<"core" | "bench", DiscoveredTask[]>();
  const byCategory = new Map<string, DiscoveredTask[]>();

  for (const task of tasks) {
    if (!byTier.has(task.tier)) byTier.set(task.tier, []);
    byTier.get(task.tier)!.push(task);
    for (const category of task.categories) {
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push(task);
    }
  }

  return { tasks, byName, byTier, byCategory };
}

beforeEach(() => {
  originalCi = process.env.CI;
  delete process.env.CI;
  tracedNames.length = 0;
  evalMock.mockReset();
  flushMock.mockClear();
  generateSummaryMock.mockClear();
  buildCoreContextMock.mockReset();
  resolveDefaultCoreStartupProfileMock.mockClear();
});

afterEach(() => {
  if (originalCi === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCi;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("core runner", () => {
  it("uses Pass scoring and separates startup, task, and cleanup tracing", async () => {
    const taskDir = makeTempDir();
    const taskFile = path.join(taskDir, "task.mjs");
    fs.writeFileSync(
      taskFile,
      `
      export default {
        __taskDefinition: true,
        meta: {},
        fn: async (ctx) => {
          ctx.metrics.record("custom_ms", 7);
        },
      };
      `,
    );

    const task: DiscoveredTask = {
      name: "navigation/open",
      tier: "core",
      primaryCategory: "navigation",
      categories: ["navigation"],
      tags: [],
      filePath: taskFile,
      isLegacy: false,
    };

    buildCoreContextMock.mockImplementation(
      async (options: { logger: unknown }) => ({
        ctx: {
          page: {},
          tool: {
            getRawMetrics: async () => ({ pageCount: 1 }),
          },
          startupProfile: "runner_provided_local_cdp",
          adapter: {
            name: "understudy_code",
            family: "understudy",
            surface: "code",
            metadata: {
              environment: "local",
              browserOwnership: "runner",
              connectionMode: "attach_ws",
              startupProfile: "runner_provided_local_cdp",
            },
          },
          assert: {},
          metrics: createMetricsCollector(),
          logger: options.logger,
        },
        cleanup: async () => {},
      }),
    );

    let capturedProject = "";
    let capturedScores: Array<(args: any) => { name: string; score: number }> =
      [];
    let capturedEvalOptions: any;
    evalMock.mockImplementation(
      async (projectName: string, config: any, evalOptions: any) => {
        capturedProject = projectName;
        capturedScores = config.scores;
        capturedEvalOptions = evalOptions;
        const data = await config.data();
        const results = [];
        for (const testcase of data) {
          results.push({
            input: testcase.input,
            output: await config.task(testcase.input),
          });
        }
        return {
          summary: {
            experimentName: "navigation/open-3fb31541",
            experimentUrl:
              "https://www.braintrust.dev/app/Browserbase/p/stagehand/experiments/navigation/open-3fb31541",
            scores: {
              Pass: {
                name: "Pass",
                score: 1,
                improvements: 0,
                regressions: 0,
              },
            },
          },
          results,
        };
      },
    );

    const { runEvals } = await import("../../framework/runner.js");
    const result = await runEvals({
      tasks: [task],
      registry: makeRegistry([task]),
      concurrency: 1,
      trials: 1,
      environment: "LOCAL",
      coreToolSurface: "understudy_code",
      coreStartupProfile: "runner_provided_local_cdp",
    });

    expect(capturedProject).toBe("stagehand-core-dev");
    expect(
      capturedScores[0]({
        input: { name: "navigation/open", modelName: "openai/gpt-4.1-mini" },
        output: { _success: true },
        expected: true,
      }),
    ).toEqual({
      name: "Pass",
      score: 1,
    });
    expect(flushMock).toHaveBeenCalledTimes(1);
    expect(generateSummaryMock).toHaveBeenCalledWith(
      expect.any(Array),
      "navigation/open-3fb31541",
      "https://www.braintrust.dev/app/Browserbase/p/stagehand/experiments/navigation/open-3fb31541",
      {
        Pass: {
          name: "Pass",
          score: 1,
          improvements: 0,
          regressions: 0,
        },
      },
    );
    expect(result.experimentName).toBe("navigation/open-3fb31541");
    expect(capturedEvalOptions.reporter.name).toBe(
      "stagehand-evals-silent-reporter",
    );
    expect(typeof capturedEvalOptions.progress.start).toBe("function");
    expect(typeof capturedEvalOptions.progress.increment).toBe("function");
    expect(typeof capturedEvalOptions.progress.stop).toBe("function");
    expect(tracedNames).toEqual(["session.startup", "task", "cleanup"]);

    const metrics = result.results[0].output.metrics as Record<
      string,
      { value: number }
    >;
    expect(metrics.custom_ms.value).toBe(7);
    expect(metrics.startup_ms.value).toBeTypeOf("number");
    expect(metrics.task_ms.value).toBeTypeOf("number");
    expect(metrics.cleanup_ms.value).toBeTypeOf("number");
    expect(metrics.total_ms.value).toBeGreaterThanOrEqual(0);
  });
});
