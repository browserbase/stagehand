import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProgressEvent } from "../../framework/runner.js";
import type { TaskResult } from "../../framework/types.js";
import { reportRowPhase } from "../../framework/rowContext.js";
import { EvalLogger } from "../../logger.js";
import fs from "node:fs";

/**
 * The live board keys rows by the runner's progress events. Suite testcases
 * all share `input.name` (`agent/hardbenchmark`), so these tests drive the
 * Braintrust task function directly with suite-shaped inputs and check that
 * every event carries the case, the trial and a unique row key.
 */

vi.mock("playwright", () => ({ chromium: {} }));

type TaskFn = (input: unknown, hooks?: { trialIndex?: number }) => Promise<TaskResult>;
let capturedTask: TaskFn | undefined;
let releaseEval: (() => void) | undefined;

vi.mock("../../framework/braintrust.js", () => ({
  hasBraintrustApiKey: () => false,
  resolveBraintrustProjectName: () => "stagehand-dev",
  loadBraintrust: async () => ({
    // Hold Eval open until the test has called the task function itself.
    Eval: async (_name: string, options: { task: TaskFn }) => {
      capturedTask = options.task;
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

describe("runner progress events carry row identity", () => {
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

  it("gives two cases and two trials four distinct row keys with case labels", async () => {
    const events: RunProgressEvent[] = [];
    const { run, task } = await startRun(events);
    benchResults.push(
      { _success: true },
      { _success: false, harnessStatus: "max_turns", error: "50 turns" },
      {
        _success: false,
        judgeOutcomeSuccess: true,
        outcomeGates: ["no_browser_use"],
        error: "gated",
      },
      { _success: false, harnessStatus: "sdk_error", harnessStopReason: "stream closed" },
    );
    const a = input("47e314cc452c540524ffb7cf520285a3", "https://www.recreation.gov/");
    const b = input("9b2c07aa11112222333344445555aaaa", "imgur.com");
    await Promise.all([
      task(a, { trialIndex: 0 }),
      task(a, { trialIndex: 1 }),
      task(b, { trialIndex: 0 }),
      task(b, { trialIndex: 1 }),
    ]);
    releaseEval?.();
    await run;

    const started = events.filter((e) => e.type === "started");
    const finished = events.filter((e) => e.type === "passed" || e.type === "failed");
    expect(started).toHaveLength(4);
    expect(new Set(started.map((e) => e.rowKey)).size).toBe(4);
    expect(started.map((e) => [e.case?.shortId, e.case?.domain, e.trial])).toEqual(
      expect.arrayContaining([
        ["47e314cc", "recreation.gov", 0],
        ["47e314cc", "recreation.gov", 1],
        ["9b2c07aa", "imgur.com", 0],
        ["9b2c07aa", "imgur.com", 1],
      ]),
    );
    expect(finished.map((e) => e.outcome).sort()).toEqual(
      ["gated", "max_turns", "pass", "sdk_error"].sort(),
    );
    for (const e of finished) {
      expect(typeof e.durationMs).toBe("number");
      expect(started.some((s) => s.rowKey === e.rowKey)).toBe(true);
    }
  });

  it("attributes phases reported deep in the harness to the right concurrent row", async () => {
    const events: RunProgressEvent[] = [];
    const { run, task } = await startRun(events);
    const { executeBenchTask } = await import("../../framework/benchRunner.js");
    // Two rows interleave their phases; each report must land on its own row.
    vi.mocked(executeBenchTask).mockImplementation(async (input) => {
      const web = String((input.params as { web: string }).web);
      reportRowPhase("session");
      await new Promise((resolve) => setTimeout(resolve, web === "a.com" ? 5 : 1));
      reportRowPhase("agent", { sessionUrl: `https://www.browserbase.com/sessions/${web}` });
      await new Promise((resolve) => setTimeout(resolve, 2));
      reportRowPhase("verify");
      return { _success: true, sessionUrl: `https://www.browserbase.com/sessions/${web}` };
    });
    await Promise.all([
      task(input("aaaaaaaa00000000aaaaaaaa00000000", "a.com"), { trialIndex: 0 }),
      task(input("bbbbbbbb00000000bbbbbbbb00000000", "b.com"), { trialIndex: 0 }),
    ]);
    vi.mocked(executeBenchTask).mockReset();
    vi.mocked(executeBenchTask).mockImplementation(
      async () => benchResults.shift() ?? { _success: true },
    );
    releaseEval?.();
    await run;

    for (const domain of ["a.com", "b.com"]) {
      const phases = events.filter((e) => e.type === "phase" && e.case?.domain === domain);
      expect(phases.map((e) => e.phase)).toEqual(["session", "agent", "verify"]);
      expect(phases[1].sessionUrl).toBe(`https://www.browserbase.com/sessions/${domain}`);
      const done = events.find((e) => e.type === "passed" && e.case?.domain === domain);
      expect(done?.sessionUrl).toBe(`https://www.browserbase.com/sessions/${domain}`);
      expect(new Set(phases.map((e) => e.rowKey)).size).toBe(1);
    }
  });

  it("writes each row's log lines to its own file and streams them as log events", async () => {
    const events: RunProgressEvent[] = [];
    const { run, task } = await startRun(events);
    const { executeBenchTask } = await import("../../framework/benchRunner.js");
    vi.mocked(executeBenchTask).mockImplementation(async (input) => {
      const web = String((input.params as { web: string }).web);
      // echo=true: only the row routing keeps this line off the console.
      new EvalLogger(true).log({ category: "codex", message: `navigating ${web}`, level: 1 });
      console.log(`raw console from ${web}`);
      return { _success: web === "a.com" };
    });
    const log = vi.spyOn(console, "log");
    await Promise.all([
      task(input("aaaaaaaa00000000aaaaaaaa00000000", "a.com"), { trialIndex: 0 }),
      task(input("bbbbbbbb00000000bbbbbbbb00000000", "b.com"), { trialIndex: 0 }),
    ]);
    vi.mocked(executeBenchTask).mockReset();
    vi.mocked(executeBenchTask).mockImplementation(
      async () => benchResults.shift() ?? { _success: true },
    );
    releaseEval?.();
    await run;

    const logEvents = events.filter((e) => e.type === "log");
    expect(
      logEvents
        .map((e) => [e.case?.domain, e.log?.category, e.log?.message])
        .filter(([, c]) => c === "codex"),
    ).toEqual(
      expect.arrayContaining([
        ["a.com", "codex", "navigating a.com"],
        ["b.com", "codex", "navigating b.com"],
      ]),
    );
    for (const domain of ["a.com", "b.com"]) {
      const done = events.find(
        (e) => (e.type === "passed" || e.type === "failed") && e.case?.domain === domain,
      );
      expect(done?.logPath).toMatch(
        new RegExp(
          `${domain.slice(0, 1).repeat(8)}-${domain.replace(".", "\\.")}__openai-gpt-5\\.4-mini\\.log$`,
        ),
      );
      const text = fs.readFileSync(done!.logPath!, "utf8");
      expect(text).toContain(`[codex] navigating ${domain}`);
      expect(text).not.toContain(domain === "a.com" ? "b.com" : "a.com");
    }
    // EvalLogger lines inside a row never reach the console.
    expect(log.mock.calls.flat().join("\n")).not.toContain("navigating");
    log.mockRestore();
  });

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
      expect(events.filter((e) => e.type === "started").map((e) => e.case?.domain)).toEqual([
        "a.com",
      ]);
      finishFirst();
      await Promise.all([first, second]);
      expect(events.filter((e) => e.type === "started").map((e) => e.case?.domain)).toEqual([
        "a.com",
        "b.com",
      ]);
      releaseEval?.();
      await run;
    } finally {
      if (saved === undefined) delete process.env.EVAL_PROVIDER_CONCURRENCY;
      else process.env.EVAL_PROVIDER_CONCURRENCY = saved;
    }
  });
});
