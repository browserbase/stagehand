import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

/**
 * Verify that the runner passes noSendLogs to Braintrust Eval and skips
 * flush() when BRAINTRUST_API_KEY is absent. This file lives separately
 * because it needs to vi.mock the braintrust module at the top level.
 */

vi.mock("playwright", () => ({
  chromium: {},
}));

const mockEval = vi.fn<
  (
    name: string,
    options: unknown,
    evalOptions?: unknown,
  ) => Promise<{
    results: unknown[];
    summary: { experimentName: string; scores: Record<string, unknown> };
  }>
>(async () => ({
  results: [],
  summary: { experimentName: "test", scores: {} },
}));
const mockFlush = vi.fn(async () => {});
let mockHasKey = false;

vi.mock("../../framework/braintrust.js", () => ({
  hasBraintrustApiKey: () => mockHasKey,
  loadBraintrust: async () => ({
    Eval: mockEval,
    flush: mockFlush,
  }),
  tracedSpan: async <T>(fn: () => Promise<T>) => fn(),
}));

describe("runner.ts skips Braintrust logging when API key is absent", () => {
  const originalKey = process.env.BRAINTRUST_API_KEY;
  const originalPersist = process.env.VERIFIER_PERSIST_TRAJECTORIES;

  beforeEach(() => {
    delete process.env.BRAINTRUST_API_KEY;
    // Keep the runner's experiment-link write from leaking a `.trajectories/`
    // tree into cwd when these tests run outside CI.
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
    mockEval.mockClear();
    mockFlush.mockClear();
    mockHasKey = false;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.BRAINTRUST_API_KEY = originalKey;
    } else {
      delete process.env.BRAINTRUST_API_KEY;
    }
    if (originalPersist !== undefined) {
      process.env.VERIFIER_PERSIST_TRAJECTORIES = originalPersist;
    } else {
      delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
    }
    // runEvals stamps these; don't leak them into other test files.
    delete process.env.EVAL_TRAJECTORY_GROUP;
    delete process.env.EVAL_EXPERIMENT_NAME;
    delete process.env.EVAL_MODEL_OVERRIDE;
    delete process.env.EVAL_PROVIDER;
  });

  it("passes noSendLogs: true to Eval when BRAINTRUST_API_KEY is unset", async () => {
    mockHasKey = false;
    const { runEvals } = await import("../../framework/runner.js");

    const task = {
      name: "test-task",
      tier: "bench" as const,
      primaryCategory: "extract",
      categories: ["extract"],
      tags: [] as string[],
      filePath: "/fake.ts",
      isLegacy: false,
    };

    await runEvals({
      tasks: [task],
      registry: {
        tasks: [task],
        byName: new Map([[task.name, task]]),
        byTier: new Map([["bench", [task]]]),
        byCategory: new Map([["extract", [task]]]),
      },
      trials: 1,
    });

    expect(mockEval).toHaveBeenCalledTimes(1);
    const evalOptions = mockEval.mock.calls[0][2];
    expect(evalOptions).toHaveProperty("noSendLogs", true);

    // flush should NOT be called
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("does NOT pass noSendLogs when BRAINTRUST_API_KEY is set", async () => {
    mockHasKey = true;
    const { runEvals } = await import("../../framework/runner.js");

    const task = {
      name: "test-task",
      tier: "bench" as const,
      primaryCategory: "extract",
      categories: ["extract"],
      tags: [] as string[],
      filePath: "/fake.ts",
      isLegacy: false,
    };

    await runEvals({
      tasks: [task],
      registry: {
        tasks: [task],
        byName: new Map([[task.name, task]]),
        byTier: new Map([["bench", [task]]]),
        byCategory: new Map([["extract", [task]]]),
      },
      trials: 1,
    });

    expect(mockEval).toHaveBeenCalledTimes(1);
    const evalOptions = mockEval.mock.calls[0][2];
    expect(evalOptions).not.toHaveProperty("noSendLogs");

    // flush SHOULD be called
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});
