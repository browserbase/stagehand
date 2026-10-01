import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvalsResult } from "../../framework/runner.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import {
  canExecuteBenchHarness,
  deriveCategoryFilter,
  runCommand,
} from "../../tui/commands/run.js";
import {
  formatBenchHarnessFlags,
  listBenchHarnessesForTaskKind,
  registerBenchHarness,
} from "../../framework/benchHarness.js";

const runEvalsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    experimentName: "test-experiment",
    summary: { passed: 0, failed: 0, total: 0 },
    results: [] as RunEvalsResult["results"],
  })),
);

vi.mock("../../framework/runner.js", () => ({
  runEvals: runEvalsMock,
}));

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

// runCommand preflights Browserbase credentials for --env browserbase before
// planning; the mocked runner never opens a session, so any value works.
const savedBrowserbaseKeys = {
  BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
  BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
};
beforeAll(() => {
  process.env.BROWSERBASE_API_KEY ??= "test-key";
  process.env.BROWSERBASE_PROJECT_ID ??= "test-project";
});
afterAll(() => {
  for (const [key, value] of Object.entries(savedBrowserbaseKeys)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterEach(() => {
  runEvalsMock.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

function stripAnsi(value: string): string {
  const esc = String.fromCharCode(27);
  return value.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

describe("deriveCategoryFilter", () => {
  it("returns the category for category targets", () => {
    const registry = makeRegistry([makeTask()]);
    expect(deriveCategoryFilter(registry, "act")).toBe("act");
  });

  it("returns the tier-qualified category for tier:category targets", () => {
    const registry = makeRegistry([
      makeTask({
        name: "navigation/open",
        tier: "core",
        primaryCategory: "navigation",
        categories: ["navigation"],
      }),
    ]);

    expect(deriveCategoryFilter(registry, "core:navigation")).toBe("navigation");
  });

  it("does not treat direct suite task names as categories", () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/webvoyager",
        primaryCategory: "external_agent_benchmarks",
        categories: ["external_agent_benchmarks"],
      }),
    ]);

    expect(deriveCategoryFilter(registry, "agent/webvoyager")).toBeUndefined();
  });

  it("omits agent suites from broad dry-runs on the stagehand harness", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "dropdown",
        primaryCategory: "act",
        categories: ["act"],
      }),
      makeTask({
        name: "agent/webvoyager",
        primaryCategory: "agent",
        categories: ["agent"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "bench",
        normalizedTarget: "bench",
        trials: 1,
        concurrency: 1,
        environment: "LOCAL",
        useApi: false,
        harness: "stagehand",
        envOverrides: {},
        dryRun: true,
        preview: false,
        successMode: "outcome",
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.tasks.sort()).toEqual(["agent/webvoyager", "dropdown"]);
    // The suite is omitted from the planned matrix (external harness only),
    // while the deterministic task still plans.
    expect([...new Set(payload.matrix.map((row: { task: string }) => row.task))]).toEqual([
      "dropdown",
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it("errors explicit suite dry-runs on the stagehand harness", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/webvoyager",
        primaryCategory: "agent",
        categories: ["external_agent_benchmarks"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "b:webvoyager",
        normalizedTarget: "agent/webvoyager",
        trials: 1,
        concurrency: 1,
        environment: "BROWSERBASE",
        model: "openai/gpt-4.1-mini",
        useApi: false,
        harness: "stagehand",
        datasetFilter: "webvoyager",
        envOverrides: {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        dryRun: true,
        preview: false,
        successMode: "outcome",
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.matrix).toEqual([]);
    expect(String(payload.error)).toContain(
      formatBenchHarnessFlags(listBenchHarnessesForTaskKind("suite")),
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("rejects agent-mount-only tools for core dry-runs with registry guidance", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "navigation/open",
        tier: "core",
        primaryCategory: "navigation",
        categories: ["navigation"],
      }),
    ]);

    await expect(
      runCommand(
        {
          target: "core:navigation",
          normalizedTarget: "core:navigation",
          trials: 1,
          concurrency: 1,
          environment: "LOCAL",
          useApi: false,
          coreToolSurface: "stagehand_facade",
          harness: "stagehand",
          envOverrides: {},
          dryRun: true,
          preview: false,
          successMode: "outcome",
          verbose: false,
        },
        registry,
      ),
    ).rejects.toThrow(formatBenchHarnessFlags(listBenchHarnessesForTaskKind("suite")));
  });

  it("prints claude_code dry-run matrices without stagehand agent modes", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/webvoyager",
        primaryCategory: "agent",
        categories: ["external_agent_benchmarks"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "b:webvoyager",
        normalizedTarget: "agent/webvoyager",
        trials: 1,
        concurrency: 1,
        environment: "BROWSERBASE",
        model: "anthropic/claude-sonnet-4-20250514",
        useApi: false,
        harness: "claude_code",
        datasetFilter: "webvoyager",
        envOverrides: {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        dryRun: true,
        preview: false,
        successMode: "outcome",
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.matrix).toHaveLength(1);
    expect(payload.matrix[0]).toMatchObject({
      tier: "bench",
      task: "agent/webvoyager",
      dataset: "webvoyager",
      model: "anthropic/claude-sonnet-4-20250514",
      harness: "claude_code",
      toolSurface: "browse_cli",
      startupProfile: "tool_create_browserbase",
      toolCommand: "browse",
      browseCliVersion: expect.any(String),
      browseCliEntrypoint: expect.stringMatching(/packages[/\\]cli[/\\]bin[/\\]run\.js$/u),
      harnessConfig: {
        harness: "claude_code",
        model: "anthropic/claude-sonnet-4-20250514",
        environment: "BROWSERBASE",
        useApi: false,
        toolSurface: "browse_cli",
        startupProfile: "tool_create_browserbase",
        dataset: "webvoyager",
      },
    });
  });

  it("prints codex dry-run matrices with browse_cli metadata", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/webvoyager",
        primaryCategory: "agent",
        categories: ["external_agent_benchmarks"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "b:webvoyager",
        normalizedTarget: "agent/webvoyager",
        trials: 1,
        concurrency: 1,
        environment: "BROWSERBASE",
        model: "openai/gpt-5.4-mini",
        useApi: false,
        harness: "codex",
        datasetFilter: "webvoyager",
        envOverrides: {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        dryRun: true,
        preview: false,
        successMode: "outcome",
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.matrix).toHaveLength(1);
    expect(payload.matrix[0]).toMatchObject({
      tier: "bench",
      task: "agent/webvoyager",
      dataset: "webvoyager",
      model: "openai/gpt-5.4-mini",
      harness: "codex",
      toolSurface: "browse_cli",
      startupProfile: "tool_create_browserbase",
      toolCommand: "browse",
      browseCliVersion: expect.any(String),
      browseCliEntrypoint: expect.stringMatching(/packages[/\\]cli[/\\]bin[/\\]run\.js$/u),
      harnessConfig: {
        harness: "codex",
        model: "openai/gpt-5.4-mini",
        environment: "BROWSERBASE",
        useApi: false,
        toolSurface: "browse_cli",
        startupProfile: "tool_create_browserbase",
        dataset: "webvoyager",
      },
    });
  });

  it("errors claude_code for unsupported bench targets instead of emitting an empty matrix", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "observe/observe_github",
        primaryCategory: "observe",
        categories: ["observe"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "observe",
        normalizedTarget: "observe",
        trials: 1,
        concurrency: 1,
        environment: "BROWSERBASE",
        model: "anthropic/claude-sonnet-4-20250514",
        useApi: false,
        harness: "claude_code",
        envOverrides: {},
        dryRun: true,
        preview: false,
        successMode: "outcome",
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.matrix).toEqual([]);
    expect(String(payload.error)).toMatch(/only supports agent benchmark suites/);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("rejects --api for non-stagehand bench harnesses even in dry-run", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/webvoyager",
        primaryCategory: "agent",
        categories: ["external_agent_benchmarks"],
      }),
    ]);

    await expect(
      runCommand(
        {
          target: "b:webvoyager",
          normalizedTarget: "agent/webvoyager",
          trials: 1,
          concurrency: 1,
          environment: "BROWSERBASE",
          model: "anthropic/claude-sonnet-4-20250514",
          useApi: true,
          harness: "claude_code",
          datasetFilter: "webvoyager",
          envOverrides: {
            EVAL_MAX_K: "1",
            EVAL_WEBVOYAGER_LIMIT: "1",
          },
          dryRun: true,
          preview: false,
          successMode: "outcome",
          verbose: false,
        },
        registry,
      ),
    ).rejects.toThrow(/does not support --api/);
  });

  it("allows executable harnesses without env gates", () => {
    expect(canExecuteBenchHarness("stagehand")).toBe(true);
    expect(canExecuteBenchHarness("claude_code")).toBe(true);
    expect(canExecuteBenchHarness("codex")).toBe(true);
  });

  it("reports registered planning-only harnesses as non-executable", () => {
    registerBenchHarness({
      harness: "tui_planning_only_harness",
      supportedTaskKinds: ["suite"],
      supportsApi: false,
      supportedToolSurfaces: ["browse_cli"],
    });

    expect(canExecuteBenchHarness("tui_planning_only_harness")).toBe(false);
  });

  it("prints expanded plan dimensions in the run heading", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "act/alpha",
        primaryCategory: "act",
        categories: ["act"],
      }),
      makeTask({
        name: "act/beta",
        primaryCategory: "act",
        categories: ["act"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "act",
        normalizedTarget: "act",
        trials: 4,
        concurrency: 25,
        environment: "BROWSERBASE",
        model: "openai/gpt-4.1-mini",
        useApi: false,
        harness: "stagehand",
        envOverrides: {},
        dryRun: false,
        preview: false,
        successMode: "outcome",
        verbose: false,
      },
      registry,
    );

    const output = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(output).toContain("Running: act");
    expect(output).toContain("Plan: 2 tasks × 1 model × 4 trials = 8 runs");
    expect(output).toContain(
      "Env: BROWSERBASE  Harness: stagehand  Concurrency: 25 global · openai 3",
    );
    expect(runEvalsMock).toHaveBeenCalledOnce();
  });

  it("prints EVAL_PROVIDER_CONCURRENCY widths and forwards queue events to the renderer", async () => {
    const registry = makeRegistry([makeTask({ name: "act/alpha" })]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const saved = process.env.EVAL_PROVIDER_CONCURRENCY;
    process.env.EVAL_PROVIDER_CONCURRENCY = "openai=6";
    type ProgressSink = { onProgress?: (event: unknown) => void };
    (
      runEvalsMock as unknown as {
        mockImplementationOnce: (fn: (options: ProgressSink) => Promise<unknown>) => void;
      }
    ).mockImplementationOnce(async (options) => {
      options.onProgress?.({ type: "planned", total: 2 });
      options.onProgress?.({
        type: "started",
        taskName: "act/alpha",
        modelName: "openai/gpt-4.1-mini",
      });
      options.onProgress?.({
        type: "queue",
        queue: {
          running: 1,
          queued: 1,
          total: 2,
          throttled: 1,
          semaphores: {
            openai: { active: 1, width: 3, baseWidth: 6, waiting: 0, throttledUntil: 1 },
          },
        },
      });
      options.onProgress?.({
        type: "throttled",
        taskName: "act/alpha",
        throttle: {
          source: "provider",
          semaphore: "openai",
          reason: "429",
          widthBefore: 6,
          widthAfter: 3,
        },
      });
      return {
        experimentName: "x",
        summary: { passed: 0, failed: 0, total: 0 },
        results: [] as unknown[],
      };
    });

    try {
      await runCommand(
        {
          target: "act",
          normalizedTarget: "act",
          trials: 1,
          concurrency: 10,
          environment: "BROWSERBASE",
          model: "openai/gpt-4.1-mini",
          useApi: false,
          harness: "stagehand",
          envOverrides: {},
          dryRun: false,
          preview: false,
          successMode: "outcome",
          verbose: true,
        },
        registry,
      );
    } finally {
      if (saved === undefined) delete process.env.EVAL_PROVIDER_CONCURRENCY;
      else process.env.EVAL_PROVIDER_CONCURRENCY = saved;
    }

    const header = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(header).toContain("Concurrency: 10 global · openai 6");
    const stream = stdout.mock.calls.map(([chunk]) => stripAnsi(String(chunk))).join("");
    expect(stream).toContain("running 1 · queued 1 · openai 1/3↓ · throttled 1");
    expect(stream).toContain("act/alpha: openai throttled — width 6 → 3 for 60s, retrying");
  });

  it("shows config provider widths, with EVAL_PROVIDER_CONCURRENCY layered on top", async () => {
    const registry = makeRegistry([
      makeTask({ name: "act/alpha", primaryCategory: "act", categories: ["act"] }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const options = {
      target: "act",
      normalizedTarget: "act",
      trials: 1,
      concurrency: 10,
      environment: "BROWSERBASE",
      model: "openai/gpt-4.1-mini",
      useApi: false,
      harness: "stagehand" as const,
      envOverrides: {},
      dryRun: false,
      preview: false,
      successMode: "outcome" as const,
      verbose: false,
      providerConcurrency: { openai: 4, anthropic: 5 },
    };
    const heading = () => log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    const saved = process.env.EVAL_PROVIDER_CONCURRENCY;
    try {
      delete process.env.EVAL_PROVIDER_CONCURRENCY;
      await runCommand(options, registry);
      expect(heading()).toContain("Concurrency: 10 global · openai 4");
      // The config widths reach the runner, which layers the env on top itself.
      expect(runEvalsMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerConcurrency: { openai: 4, anthropic: 5 } }),
      );

      log.mockClear();
      process.env.EVAL_PROVIDER_CONCURRENCY = "openai=6";
      await runCommand(options, registry);
      expect(heading()).toContain("Concurrency: 10 global · openai 6");
      expect(heading()).not.toContain("openai 4");
    } finally {
      if (saved === undefined) delete process.env.EVAL_PROVIDER_CONCURRENCY;
      else process.env.EVAL_PROVIDER_CONCURRENCY = saved;
    }
  });
});

describe("buildCombinations (preview column-pruning)", () => {
  it("collapses pure-core matrix to no varying columns", async () => {
    const { buildCombinations } = await import("../../tui/preview.js");
    const matrix = [
      {
        tier: "core",
        task: "actions/click",
        category: "actions",
        model: "none",
        environment: "LOCAL",
      },
      {
        tier: "core",
        task: "actions/scroll",
        category: "actions",
        model: "none",
        environment: "LOCAL",
      },
      {
        tier: "core",
        task: "tabs/new_tab",
        category: "tabs",
        model: "none",
        environment: "LOCAL",
      },
    ];
    const { columns, rows } = buildCombinations(matrix);
    // category varies across rows, so it stays — but model/environment are constant and drop.
    expect(columns).toEqual(["category"]);
    // 2 unique categories → 2 combinations.
    expect(rows).toHaveLength(2);
    const counts = Object.fromEntries(rows.map((r) => [String(r.values.category), r.runs]));
    expect(counts).toEqual({ actions: 2, tabs: 1 });
  });

  it("surfaces model and agentMode for an agent matrix", async () => {
    const { buildCombinations } = await import("../../tui/preview.js");
    const tasks = ["agent/a", "agent/b"];
    const models = ["m1", "m2"];
    const modes = ["dom", "hybrid"];
    const matrix = tasks.flatMap<Record<string, unknown>>((task) =>
      models.flatMap<Record<string, unknown>>((model) =>
        modes.map<Record<string, unknown>>((agentMode) => ({
          tier: "bench",
          task,
          category: null,
          dataset: null,
          model,
          harness: "stagehand",
          agentMode,
          environment: "BROWSERBASE",
          useApi: false,
          provider: null,
          toolSurface: null,
          startupProfile: null,
        })),
      ),
    );
    const { columns, rows } = buildCombinations(matrix);
    expect(columns).toEqual(["model", "agentMode"]);
    // 2 models × 2 modes = 4 combos, each runs against 2 tasks.
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.runs === 2)).toBe(true);
  });

  it("returns no columns when all rows share the same shape", async () => {
    const { buildCombinations } = await import("../../tui/preview.js");
    const matrix = [
      { tier: "bench", task: "agent/a", model: "m1", agentMode: "dom" },
      { tier: "bench", task: "agent/b", model: "m1", agentMode: "dom" },
    ];
    const { columns, rows } = buildCombinations(matrix);
    expect(columns).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].runs).toBe(2);
  });

  it("ignores task and harnessConfig when grouping", async () => {
    const { buildCombinations } = await import("../../tui/preview.js");
    const matrix = [
      {
        tier: "bench",
        task: "agent/a",
        model: "m1",
        harnessConfig: { foo: 1 },
      },
      {
        tier: "bench",
        task: "agent/b",
        model: "m1",
        harnessConfig: { foo: 2 },
      },
    ];
    const { columns, rows } = buildCombinations(matrix);
    // Even though harnessConfig differs, it's hidden — single combo.
    expect(columns).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});

describe("preview header constants", () => {
  it("lists every pruned constant column so a single-cell run still names its surface", async () => {
    const { constantColumns, renderPreview } = await import("../../tui/preview.js");
    const matrix = [
      {
        tier: "bench",
        task: "agent/hardbenchmark",
        dataset: "hardbenchmark",
        model: "openai/gpt-5.4-mini",
        harness: "codex",
        environment: "BROWSERBASE",
        useApi: false,
        provider: "openai",
        toolSurface: "stagehand_facade",
        startupProfile: "runner_provided_browserbase_cdp",
        toolCommand: null as string | null,
      },
    ];
    expect(constantColumns(matrix)).toEqual([
      ["model", "openai/gpt-5.4-mini"],
      ["harness", "codex"],
      ["dataset", "hardbenchmark"],
      ["environment", "BROWSERBASE"],
      ["useApi", false],
      ["provider", "openai"],
      ["toolSurface", "stagehand_facade"],
      ["startupProfile", "runner_provided_browserbase_cdp"],
    ]);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderPreview({
      target: "b:hardbenchmark",
      normalizedTarget: "agent/hardbenchmark",
      tasks: ["agent/hardbenchmark"],
      envOverrides: {},
      runOptions: { environment: "BROWSERBASE", concurrency: 3, trials: 1, harness: "codex" },
      matrix,
    });
    const output = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(output).toContain("Env: BROWSERBASE  Concurrency: 3  Trials: 1  Harness: codex");
    expect(output).toContain(
      "Model: openai/gpt-5.4-mini  Dataset: hardbenchmark  Provider: openai  Tool surface: stagehand_facade  Startup: runner_provided_browserbase_cdp",
    );
    expect(output).not.toContain("Provider: openai  Provider:");

    // With --model the override line names it; the constants line doesn't repeat it.
    log.mockClear();
    renderPreview({
      target: "b:hardbenchmark",
      normalizedTarget: "agent/hardbenchmark",
      tasks: ["agent/hardbenchmark"],
      envOverrides: {},
      runOptions: { environment: "BROWSERBASE", harness: "codex", model: "openai/gpt-5.4-mini" },
      matrix,
    });
    const withOverride = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(withOverride).toContain("Model override: openai/gpt-5.4-mini");
    expect(withOverride.match(/openai\/gpt-5\.4-mini/g)).toHaveLength(1);
  });
});

describe("end-of-run summary", () => {
  const benchOptions = {
    target: "b:hardbenchmark",
    normalizedTarget: "agent/hardbenchmark",
    trials: 1,
    concurrency: 2,
    environment: "BROWSERBASE" as const,
    model: "openai/gpt-5.4-mini",
    useApi: false,
    harness: "codex" as const,
    datasetFilter: "hardbenchmark",
    envOverrides: {},
    dryRun: false,
    preview: false,
    successMode: "outcome" as const,
    verbose: false,
  };
  const registry = () =>
    makeRegistry([
      makeTask({
        name: "agent/hardbenchmark",
        primaryCategory: "agent",
        categories: ["external_agent_benchmarks"],
      }),
    ]);
  const row = (name: string, output: Record<string, unknown>) => ({
    name,
    score: output._success ? 1 : 0,
    input: { name, modelName: "openai/gpt-5.4-mini", params: { toolSurface: "stagehand_facade" } },
    output: { _success: false, ...output },
  });
  const mockRun = (results: unknown[], extra: Record<string, unknown> = {}) =>
    (
      runEvalsMock as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      }
    ).mockResolvedValueOnce({
      experimentName: "agent/hardbenchmark-a1b2",
      experimentUrl: "https://www.braintrust.dev/app/x/experiments/agent%2Fhardbenchmark-a1b2",
      judgeModel: "google/gemini-3.5-flash",
      summary: { passed: 0, failed: 0, total: results.length },
      results,
      ...extra,
    });
  const savedCi = process.env.CI;
  const savedColumns = process.stdout.columns;
  beforeEach(() => {
    process.stdout.columns = 180;
  });
  afterEach(() => {
    process.stdout.columns = savedColumns;
    if (savedCi === undefined) delete process.env.CI;
    else process.env.CI = savedCi;
  });

  it("prints the judge line, cell table, failures and experiment URL", async () => {
    delete process.env.CI;
    mockRun([
      row("t1", {
        _success: true,
        criterionCount: 3,
        metrics: { facade_tool_calls: { count: 1, value: 4 } },
      }),
      row("t2", {
        harnessStatus: "sdk_error",
        harnessStopReason: "rate_limit_exceeded (429)",
        criterionCount: 3,
        sessionUrl: "https://www.browserbase.com/sessions/9ab0",
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const streamed: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      streamed.push(stripAnsi(String(chunk)));
      return true;
    });

    await runCommand(benchOptions, registry());

    const output = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(output).toContain(
      "Judge: google/gemini-3.5-flash  Success: outcome  Trajectories: on (.trajectories)",
    );
    expect(output).toMatch(/codex × stagehand_facade × openai\/gpt-5.4-mini\s+50% 1\/2\s+0\s+1/);
    expect(output).toContain(
      "Verifiability: judge google/gemini-3.5-flash · 0/6 criteria unverifiable across 2 graded runs · 0 ungraded",
    );
    expect(output).toMatch(
      /✗ t2\s+sdk_error\s+rate_limit_exceeded \(429\) https:\/\/www.browserbase.com\/sessions\/9ab0/,
    );
    // One headline instead of a second pass rate; the cell row carries it.
    expect(output).toMatch(/^ {2}hardbenchmark · 2 runs · \d+s$/m);
    expect(streamed.join("")).not.toContain("Results:");
    expect(output).toContain(
      "Experiment: agent/hardbenchmark-a1b2  https://www.braintrust.dev/app/x/experiments/agent%2Fhardbenchmark-a1b2",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("marks trajectories off when CI is set", async () => {
    process.env.CI = "1";
    mockRun([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(benchOptions, registry());
    const output = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(output).toContain("Trajectories: off (CI is set)");
  });

  it("prints the dead-judge banner and exits 1 when the judge graded nothing", async () => {
    delete process.env.CI;
    // On main a verifier failure fails the row closed; the agent's claim is kept aside.
    mockRun([
      row("t1", { agentReportedSuccess: true, verifierError: "Fused judgment call failed" }),
      row("t2", {
        agentReportedSuccess: true,
        verifierError: "Verifier returned an uncertainty result",
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(benchOptions, registry());

    const output = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(output).toContain("across 0 graded runs · 2 ungraded");
    // The banner explains it once; the failures list doesn't repeat it per row.
    expect(output).not.toMatch(/\? t\d\s+ungraded/);
    const errors = error.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    expect(errors).toContain(
      "✗ judge produced no grades: all 2 verifier-backed rows failed closed (google/gemini-3.5-flash). The pass rate reflects the verifier, not the agent.",
    );
    expect(process.exitCode).toBe(1);
  });

  it("--json writes only the summary object to stdout; everything human goes to stderr", async () => {
    delete process.env.CI;
    mockRun([row("t1", { _success: true, criterionCount: 2 })]);
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      stderr.push(String(line));
    });

    await runCommand({ ...benchOptions, json: true }, registry());

    // stdout must parse as exactly one JSON document.
    const payload = JSON.parse(stdout.join(""));
    expect(payload).toMatchObject({
      experimentName: "agent/hardbenchmark-a1b2",
      judgeModel: "google/gemini-3.5-flash",
      summary: { passed: 1, failed: 0, total: 1, passRate: 100 },
      deadJudge: false,
    });
    expect(payload.cells).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
    expect(stripAnsi(stderr.join(""))).toContain("Running: b:hardbenchmark");
    expect(error).toHaveBeenCalled();
  });

  it("shows a judge set in config, and honours VERIFIER_PERSIST_TRAJECTORIES over CI", async () => {
    process.env.CI = "1";
    const saved = process.env.VERIFIER_PERSIST_TRAJECTORIES;
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    try {
      mockRun([]);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await runCommand(
        {
          ...benchOptions,
          envOverrides: { EVAL_VERIFIER_MODEL: "anthropic/claude-haiku-4-5" },
        },
        registry(),
      );
      const output = log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
      expect(output).toContain("Judge: anthropic/claude-haiku-4-5 (config)");
      expect(output).toContain("Trajectories: on (.trajectories)");
    } finally {
      if (saved === undefined) delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
      else process.env.VERIFIER_PERSIST_TRAJECTORIES = saved;
    }
  });
});

describe("runCommand zero-browser-pass gate", () => {
  it.each([
    { mode: "configured", limit: "0", exitCode: 1 },
    { mode: "unset", limit: undefined, exitCode: undefined },
  ])(
    "$mode gate reports browserless passes with the expected exit status",
    async ({ limit, exitCode }) => {
      vi.stubEnv("EVAL_MAX_UNVERIFIABLE_CRITERIA", limit);
      process.exitCode = undefined;
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      runEvalsMock.mockResolvedValueOnce({
        experimentName: "browserless-pass",
        summary: { passed: 1, failed: 0, total: 1 },
        results: [
          {
            input: { name: "dropdown", modelName: "openai/gpt-4.1-mini" },
            output: {
              _success: true,
              criterionCount: 1,
              evidenceInsufficient: [],
              metrics: { facade_tool_calls: { value: 0 } },
            },
            name: "dropdown",
            score: 1,
          },
        ],
      });
      await runCommand(
        {
          target: "act",
          normalizedTarget: "act",
          trials: 1,
          concurrency: 1,
          environment: "LOCAL",
          model: "openai/gpt-4.1-mini",
          useApi: false,
          harness: "stagehand",
          envOverrides: {},
          dryRun: false,
          preview: false,
          successMode: "outcome",
          verbose: false,
        },
        makeRegistry([makeTask()]),
      );
      expect(runEvalsMock).toHaveBeenCalledOnce();
      expect(log.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n")).toContain(
        "1 passes without browser use",
      );
      expect(process.exitCode).toBe(exitCode);
      if (limit !== undefined) {
        expect(error).toHaveBeenCalledWith(expect.stringContaining("1 passes without browser use"));
      } else {
        expect(error).not.toHaveBeenCalled();
      }
    },
  );
});

describe("browserbase preflight", () => {
  it("fails before planning when the Browserbase keys are missing", async () => {
    const saved = {
      BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
      BB_API_KEY: process.env.BB_API_KEY,
      BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
      BB_PROJECT_ID: process.env.BB_PROJECT_ID,
    };
    for (const key of Object.keys(saved)) delete process.env[key];
    process.env.BB_PROJECT_ID = "alias-project";
    const registry = makeRegistry([makeTask({ name: "act/alpha" })]);
    try {
      await expect(
        runCommand(
          {
            target: "act",
            normalizedTarget: "act",
            trials: 1,
            concurrency: 1,
            environment: "BROWSERBASE",
            useApi: false,
            harness: "stagehand",
            envOverrides: {},
            dryRun: false,
            preview: false,
            successMode: "outcome",
            verbose: false,
          },
          registry,
        ),
      ).rejects.toThrow(
        "BROWSERBASE_API_KEY missing for --env browserbase — export them or add them to packages/evals/.env",
      );
      expect(runEvalsMock).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("does not preflight dry-runs", async () => {
    const saved = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(
        {
          target: "act",
          normalizedTarget: "act",
          trials: 1,
          concurrency: 1,
          environment: "BROWSERBASE",
          useApi: false,
          harness: "stagehand",
          envOverrides: {},
          dryRun: true,
          preview: false,
          successMode: "outcome",
          verbose: false,
        },
        makeRegistry([makeTask({ name: "act/alpha" })]),
      );
      expect(log).toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.BROWSERBASE_API_KEY;
      else process.env.BROWSERBASE_API_KEY = saved;
    }
  });
});

describe("log streaming and live keys", () => {
  const options = {
    target: "act",
    normalizedTarget: "act",
    trials: 1,
    concurrency: 2,
    environment: "LOCAL" as const,
    model: "openai/gpt-4.1-mini",
    useApi: false,
    harness: "stagehand" as const,
    envOverrides: {},
    dryRun: false,
    preview: false,
    successMode: "outcome" as const,
    verbose: false,
  };
  const row = (id: string, domain: string) => ({
    taskName: "agent/hardbenchmark",
    modelName: "openai/gpt-4.1-mini",
    rowKey: `k-${id}`,
    case: { id, shortId: id.slice(0, 8), domain },
    trial: 0,
  });
  const A = row("aaaaaaaa00000000aaaaaaaa00000000", "a.com");
  const B = row("bbbbbbbb00000000bbbbbbbb00000000", "b.com");

  type Sink = { onProgress?: (event: unknown) => void };
  function mockRunWith(body: (emit: (event: unknown) => void) => Promise<void> | void) {
    (
      runEvalsMock as unknown as {
        mockImplementationOnce: (fn: (options: Sink) => Promise<unknown>) => void;
      }
    ).mockImplementationOnce(async (sink) => {
      await body((event) => sink.onProgress?.(event));
      return { experimentName: "x", summary: { passed: 0, failed: 0, total: 0 }, results: [] };
    });
  }
  const logEvent = (r: typeof A, message: string) => ({
    type: "log",
    ...r,
    log: { category: "codex", message, level: 1 },
  });

  async function capture(run: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await run();
    return stripAnsi(chunks.join(""));
  }

  it("keeps log lines off the terminal by default and streams them with -v", async () => {
    const emit = (e: (event: unknown) => void) => {
      e({ type: "started", ...A });
      e(logEvent(A, "tool browser_navigate a.com"));
    };
    mockRunWith(emit);
    const quiet = await capture(() => runCommand(options, makeRegistry([makeTask()])));
    expect(quiet).not.toContain("browser_navigate");

    vi.restoreAllMocks();
    mockRunWith(emit);
    const verbose = await capture(() =>
      runCommand({ ...options, verbose: true }, makeRegistry([makeTask()])),
    );
    expect(verbose).toMatch(/\d\d:\d\d:\d\d aaaaaaaa codex {2}tool browser_navigate a\.com/);
  });

  it("--follow streams only the matching row", async () => {
    mockRunWith((e) => {
      e({ type: "started", ...A });
      e({ type: "started", ...B });
      e(logEvent(A, "from a"));
      e(logEvent(B, "from b"));
    });
    const text = await capture(() =>
      runCommand({ ...options, follow: "bbbbbbbb" }, makeRegistry([makeTask()])),
    );
    expect(text).toContain("from b");
    expect(text).not.toContain("from a");
  });

  it("the v key cycles off → all → one (oldest running row) → off", async () => {
    const { getActiveRun } = await import("../../tui/liveRun.js");
    const seen: string[] = [];
    mockRunWith((e) => {
      e({ type: "started", ...A });
      e({ type: "started", ...B });
      const run = getActiveRun()!;
      e(logEvent(A, "off-a"));
      run.onKey?.("v"); // all
      e(logEvent(B, "all-b"));
      run.onKey?.("v"); // one → A, the oldest running
      e(logEvent(A, "one-a"));
      e(logEvent(B, "one-b"));
      run.onKey?.("v"); // off
      e(logEvent(A, "off-again"));
      seen.push(String(run.onKey?.("x")));
    });
    const text = await capture(() => runCommand(options, makeRegistry([makeTask()])));
    expect(text).not.toContain("off-a");
    expect(text).toContain("all-b");
    expect(text).toContain("one-a");
    expect(text).not.toContain("one-b");
    expect(text).not.toContain("off-again");
    expect(seen).toEqual(["false"]);
    expect(getActiveRun()).toBeUndefined();
  });

  it("console output inside a row goes to that row's log, not the terminal", async () => {
    const { runInRowContext } = await import("../../framework/rowContext.js");
    const entries: unknown[] = [];
    mockRunWith(async () => {
      await runInRowContext(
        { reportPhase: () => {}, log: (entry) => entries.push(entry) },
        async () => {
          console.log("inside row %s", "a.com");
          console.error("row error");
        },
      );
      console.log("outside any row");
    });
    const text = await capture(() => runCommand(options, makeRegistry([makeTask()])));
    expect(entries).toEqual([
      { category: "console", message: "inside row a.com", level: 1 },
      { category: "console", message: "row error", level: 0 },
    ]);
    expect(text).not.toContain("inside row");
    expect(text).not.toContain("outside any row");
  });
});
