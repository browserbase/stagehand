import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import {
  canExecuteBenchHarness,
  deriveCategoryFilter,
  runCommand,
} from "../../tui/commands/run.js";

const runEvalsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    experimentName: "test-experiment",
    summary: { passed: 0, failed: 0, total: 0 },
    results: [],
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

afterEach(() => {
  runEvalsMock.mockClear();
  vi.restoreAllMocks();
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

    expect(deriveCategoryFilter(registry, "core:navigation")).toBe(
      "navigation",
    );
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

  it("omits legacy-only suite tasks from broad dry-runs", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/gaia",
        primaryCategory: "agent",
        categories: ["agent"],
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
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.tasks).toEqual(["agent/webvoyager"]);
    expect(payload.skippedTasks).toEqual(["agent/gaia"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints bench matrix metadata in dry-runs", async () => {
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
      model: "openai/gpt-4.1-mini",
      harness: "stagehand",
      agentMode: "dom",
      environment: "BROWSERBASE",
      useApi: false,
    });
  });

  it("expands dry-run matrices across configured agent modes", async () => {
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
        agentModes: ["dom", "hybrid"],
        datasetFilter: "webvoyager",
        envOverrides: {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        dryRun: true,
        preview: false,
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.runOptions.agentModes).toEqual(["dom", "hybrid"]);
    expect(payload.matrix).toHaveLength(2);
    expect(
      payload.matrix.map((row: { agentMode: string }) => row.agentMode),
    ).toEqual(["dom", "hybrid"]);
    expect(
      payload.matrix.map(
        (row: { harnessConfig: { agentMode: string; isCUA: boolean } }) =>
          row.harnessConfig,
      ),
    ).toEqual([
      expect.objectContaining({ agentMode: "dom", isCUA: false }),
      expect.objectContaining({ agentMode: "hybrid", isCUA: false }),
    ]);
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
        agentModes: ["dom", "hybrid"],
        datasetFilter: "webvoyager",
        envOverrides: {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        dryRun: true,
        preview: false,
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
      browseCliEntrypoint: expect.stringContaining(
        "packages/cli/dist/index.js",
      ),
      agentMode: null,
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
        agentModes: ["dom", "hybrid"],
        datasetFilter: "webvoyager",
        envOverrides: {
          EVAL_MAX_K: "1",
          EVAL_WEBVOYAGER_LIMIT: "1",
        },
        dryRun: true,
        preview: false,
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
      browseCliEntrypoint: expect.stringContaining(
        "packages/cli/dist/index.js",
      ),
      agentMode: null,
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

  it("rejects claude_code for unsupported bench targets instead of emitting an empty matrix", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "observe/observe_github",
        primaryCategory: "observe",
        categories: ["observe"],
      }),
    ]);

    await expect(
      runCommand(
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
          verbose: false,
        },
        registry,
      ),
    ).rejects.toThrow(/only supports agent benchmark suites/);
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

  it("prints expanded plan dimensions in the run heading", async () => {
    const registry = makeRegistry([
      makeTask({
        name: "agent/alpha",
        primaryCategory: "agent",
        categories: ["agent"],
      }),
      makeTask({
        name: "agent/beta",
        primaryCategory: "agent",
        categories: ["agent"],
      }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(
      {
        target: "agent",
        normalizedTarget: "agent",
        trials: 4,
        concurrency: 25,
        environment: "BROWSERBASE",
        model: "openai/gpt-4.1-mini",
        useApi: false,
        harness: "stagehand",
        agentModes: ["dom", "hybrid"],
        envOverrides: {},
        dryRun: false,
        preview: false,
        verbose: false,
      },
      registry,
    );

    const output = log.mock.calls
      .map(([line]) => stripAnsi(String(line)))
      .join("\n");
    expect(output).toContain("Running: agent");
    expect(output).toContain(
      "Plan: 2 tasks × 1 model × 2 modes × 4 trials = 16 runs",
    );
    expect(output).toContain(
      "Env: BROWSERBASE  Harness: stagehand  Concurrency: 25",
    );
    expect(runEvalsMock).toHaveBeenCalledOnce();
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
    const counts = Object.fromEntries(
      rows.map((r) => [String(r.values.category), r.runs]),
    );
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
