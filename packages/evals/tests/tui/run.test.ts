import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import {
  canExecuteBenchHarness,
  deriveCategoryFilter,
  runCommand,
} from "../../tui/commands/run.js";

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
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

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
      makeTask({ name: "agent/gaia", primaryCategory: "agent", categories: ["agent"] }),
      makeTask({ name: "agent/webvoyager", primaryCategory: "agent", categories: ["agent"] }),
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
      agentMode: "hybrid",
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
        verbose: false,
      },
      registry,
    );

    const payload = JSON.parse(String(log.mock.calls[0][0]));
    expect(payload.runOptions.agentModes).toEqual(["dom", "hybrid"]);
    expect(payload.matrix).toHaveLength(2);
    expect(payload.matrix.map((row: { agentMode: string }) => row.agentMode)).toEqual([
      "dom",
      "hybrid",
    ]);
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
      browseCliEntrypoint: expect.stringContaining("packages/cli/dist/index.js"),
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

  it("allows executable harnesses without env gates", () => {
    expect(canExecuteBenchHarness("stagehand")).toBe(true);
    expect(canExecuteBenchHarness("claude_code")).toBe(true);
    expect(canExecuteBenchHarness("codex")).toBe(false);
  });
});
