import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProgressEvent } from "../../framework/runner.js";
import type { TaskResult } from "../../framework/types.js";

/**
 * These tests drive the Braintrust task function directly with suite-shaped
 * inputs to check the progress events the runner emits around each row.
 */

vi.mock("playwright", () => ({ chromium: {} }));

type TaskFn = (input: unknown, hooks?: { trialIndex?: number }) => Promise<TaskResult>;
let capturedTask: TaskFn | undefined;
let capturedData: Array<{ input: { modelName: string } }> | undefined;
let releaseEval: (() => void) | undefined;

vi.mock("../../framework/braintrust.js", () => ({
  hasBraintrustApiKey: () => false,
  resolveBraintrustProjectName: () => "stagehand-dev",
  loadBraintrust: async () => ({
    // Hold Eval open until the test has called the task function itself.
    Eval: async (
      _name: string,
      options: { task: TaskFn; data: () => Array<{ input: { modelName: string } }> },
    ) => {
      capturedTask = options.task;
      capturedData = options.data();
      await new Promise<void>((resolve) => (releaseEval = resolve));
      return { results: [] as unknown[], summary: { experimentName: "t", scores: {} } };
    },
    flush: async () => {},
  }),
  tracedSpan: async <T>(fn: () => Promise<T>) => fn(),
}));

const benchResults: TaskResult[] = [];
vi.mock("../../framework/benchRunner.js", () => ({
  executeBenchTask: vi.fn(async () => benchResults.shift() ?? { _success: true }),
}));

const SUITE = {
  name: "agent/hardbenchmark",
  tier: "bench" as const,
  primaryCategory: "agent",
  categories: ["agent"],
  tags: [] as string[],
  filePath: "/fake.ts",
  isLegacy: false,
};

const input = (id: string, web: string) => ({
  name: "agent/hardbenchmark",
  modelName: "openai/gpt-5.4-mini",
  params: { id, web, ques: `Task for ${web}`, toolSurface: "stagehand_facade" },
});

describe("runner progress events", () => {
  const saved = process.env.VERIFIER_PERSIST_TRAJECTORIES;
  beforeEach(() => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
    capturedTask = undefined;
    benchResults.length = 0;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
    else process.env.VERIFIER_PERSIST_TRAJECTORIES = saved;
    delete process.env.EVAL_TRAJECTORY_GROUP;
    delete process.env.EVAL_EXPERIMENT_NAME;
    delete process.env.EVAL_MODEL_OVERRIDE;
    delete process.env.EVAL_TRAJECTORY_MODEL;
  });

  async function startRun(events: RunProgressEvent[]) {
    const { runEvals } = await import("../../framework/runner.js");
    const run = runEvals({
      tasks: [SUITE],
      registry: {
        tasks: [SUITE],
        byName: new Map([[SUITE.name, SUITE]]),
        byTier: new Map([["bench", [SUITE]]]),
        byCategory: new Map([["agent", [SUITE]]]),
      },
      harness: "codex",
      trials: 2,
      onProgress: (event) => {
        events.push(event);
      },
    }).catch((): undefined => undefined);
    await vi.waitFor(() => expect(capturedTask).toBeDefined());
    return { run, task: capturedTask! };
  }

  it("emits started only once the provider slot is acquired", async () => {
    const saved = process.env.EVAL_PROVIDER_CONCURRENCY;
    process.env.EVAL_PROVIDER_CONCURRENCY = "openai=1";
    try {
      const events: RunProgressEvent[] = [];
      const { run, task } = await startRun(events);
      let finishFirst!: () => void;
      const { executeBenchTask } = await import("../../framework/benchRunner.js");
      vi.mocked(executeBenchTask).mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = () => resolve({ _success: true }))),
      );
      const first = task(input("aaaaaaaa00000000aaaaaaaa00000000", "a.com"), { trialIndex: 0 });
      const second = task(input("bbbbbbbb00000000bbbbbbbb00000000", "b.com"), { trialIndex: 0 });
      await vi.waitFor(() => expect(events.filter((e) => e.type === "started")).toHaveLength(1));
      // The second row is queued behind openai=1: it must not show as started.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events.filter((e) => e.type === "started")).toHaveLength(1);
      expect(
        events.some((e) => e.type === "queue" && e.queue?.semaphores.openai?.waiting === 1),
      ).toBe(true);
      finishFirst();
      await Promise.all([first, second]);
      expect(events.filter((e) => e.type === "started")).toHaveLength(2);
      releaseEval?.();
      await run;
    } finally {
      if (saved === undefined) delete process.env.EVAL_PROVIDER_CONCURRENCY;
      else process.env.EVAL_PROVIDER_CONCURRENCY = saved;
    }
  });

  it("hands Braintrust the rows interleaved across providers", async () => {
    const saved = process.env.EVAL_CODEX_MODELS;
    process.env.EVAL_CODEX_MODELS = "openai/gpt-5.4-mini,anthropic/claude-sonnet-5";
    try {
      const { run } = await startRun([]);
      releaseEval?.();
      await run;
      const providers = (capturedData ?? []).map((row) => row.input.modelName.split("/")[0]);
      expect(new Set(providers)).toEqual(new Set(["openai", "anthropic"]));
      // Model by model would put every openai row first; interleaved, each
      // round takes one provider width (default 3) from every provider.
      expect(providers.indexOf("anthropic")).toBeLessThanOrEqual(3);
    } finally {
      if (saved === undefined) delete process.env.EVAL_CODEX_MODELS;
      else process.env.EVAL_CODEX_MODELS = saved;
    }
  });
});
