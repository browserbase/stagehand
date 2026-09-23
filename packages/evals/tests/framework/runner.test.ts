import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import {
  resolveBenchModelEntries,
  runEvals,
  type RunEvalsOptions,
} from "../../framework/runner.js";
import { resolveBraintrustProjectName } from "../../framework/braintrust.js";

vi.mock("playwright", () => ({
  chromium: {},
}));

/**
 * We can't import generateTestcases directly (it's not exported),
 * but we can test the public behavior through the module's exports
 * and verify the logic by constructing the same inputs.
 *
 * For now, test the behaviors we can observe: project name selection
 * and the agent model detection fix.
 */

function makeTask(overrides: Partial<DiscoveredTask>): DiscoveredTask {
  return {
    name: "test",
    tier: "bench",
    primaryCategory: "act",
    categories: ["act"],
    tags: [],
    filePath: "/fake.ts",
    isLegacy: false,
    ...overrides,
  };
}

function emptyRegistry(): TaskRegistry {
  return {
    tasks: [],
    byName: new Map(),
    byTier: new Map(),
    byCategory: new Map(),
  };
}

describe("runner: Braintrust project selection", () => {
  const saved = {
    CI: process.env.CI,
    BRAINTRUST_PROJECT_NAME: process.env.BRAINTRUST_PROJECT_NAME,
  };
  beforeEach(() => {
    delete process.env.CI;
    delete process.env.BRAINTRUST_PROJECT_NAME;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("uses stagehand-core-dev for core-only tasks", () => {
    const tasks = [makeTask({ tier: "core", name: "open" })];
    const hasCoreOnly = tasks.every((t) => t.tier === "core");
    expect(resolveBraintrustProjectName(hasCoreOnly ? "core" : "bench")).toBe("stagehand-core-dev");
  });

  it("uses stagehand-dev for bench and mixed tiers", () => {
    const mixed = [
      makeTask({ tier: "core", name: "open" }),
      makeTask({ tier: "bench", name: "dd" }),
    ];
    const hasCoreOnly = mixed.every((t) => t.tier === "core");
    expect(resolveBraintrustProjectName(hasCoreOnly ? "core" : "bench")).toBe("stagehand-dev");
    expect(resolveBraintrustProjectName()).toBe("stagehand-dev");
  });

  it("drops the -dev suffix in CI", () => {
    process.env.CI = "true";
    expect(resolveBraintrustProjectName("core")).toBe("stagehand-core");
    expect(resolveBraintrustProjectName("bench")).toBe("stagehand");
  });

  it("BRAINTRUST_PROJECT_NAME overrides the tier/CI matrix for both tiers", () => {
    process.env.CI = "true";
    process.env.BRAINTRUST_PROJECT_NAME = "  my-team-evals ";
    expect(resolveBraintrustProjectName("core")).toBe("my-team-evals");
    expect(resolveBraintrustProjectName("bench")).toBe("my-team-evals");
  });

  it("ignores a blank BRAINTRUST_PROJECT_NAME", () => {
    process.env.BRAINTRUST_PROJECT_NAME = "   ";
    expect(resolveBraintrustProjectName()).toBe("stagehand-dev");
  });
});

describe("runner: single-task agent model detection", () => {
  it("detects agent category for a single agent task", () => {
    const benchTasks = [
      makeTask({
        name: "agent/google_flights",
        categories: ["agent"],
        primaryCategory: "agent",
      }),
    ];

    // Replicate the logic from generateTestcases
    let effectiveCategory: string | null = null;
    if (
      !effectiveCategory &&
      benchTasks.length === 1 &&
      benchTasks[0].categories.length === 1 &&
      (benchTasks[0].categories[0] === "agent" ||
        benchTasks[0].categories[0] === "external_agent_benchmarks")
    ) {
      effectiveCategory = benchTasks[0].categories[0];
    }

    expect(effectiveCategory).toBe("agent");
  });

  it("detects external_agent_benchmarks for a single benchmark task", () => {
    const benchTasks = [
      makeTask({
        name: "agent/webvoyager",
        categories: ["external_agent_benchmarks"],
        primaryCategory: "agent",
      }),
    ];

    let effectiveCategory: string | null = null;
    if (
      !effectiveCategory &&
      benchTasks.length === 1 &&
      benchTasks[0].categories.length === 1 &&
      (benchTasks[0].categories[0] === "agent" ||
        benchTasks[0].categories[0] === "external_agent_benchmarks")
    ) {
      effectiveCategory = benchTasks[0].categories[0];
    }

    expect(effectiveCategory).toBe("external_agent_benchmarks");
  });

  it("does NOT auto-detect for multiple tasks", () => {
    const benchTasks = [
      makeTask({ name: "agent/a", categories: ["agent"] }),
      makeTask({ name: "agent/b", categories: ["agent"] }),
    ];

    let effectiveCategory: string | null = null;
    if (
      !effectiveCategory &&
      benchTasks.length === 1 &&
      benchTasks[0].categories.length === 1 &&
      (benchTasks[0].categories[0] === "agent" ||
        benchTasks[0].categories[0] === "external_agent_benchmarks")
    ) {
      effectiveCategory = benchTasks[0].categories[0];
    }

    expect(effectiveCategory).toBeNull();
  });

  it("does NOT auto-detect for non-agent single task", () => {
    const benchTasks = [makeTask({ name: "dropdown", categories: ["act"] })];

    let effectiveCategory: string | null = null;
    if (
      !effectiveCategory &&
      benchTasks.length === 1 &&
      benchTasks[0].categories.length === 1 &&
      (benchTasks[0].categories[0] === "agent" ||
        benchTasks[0].categories[0] === "external_agent_benchmarks")
    ) {
      effectiveCategory = benchTasks[0].categories[0];
    }

    expect(effectiveCategory).toBeNull();
  });

  it("resolves suite benchmarks as the external-benchmark category", () => {
    const benchTasks = [
      makeTask({
        name: "agent/webvoyager",
        categories: ["external_agent_benchmarks"],
        primaryCategory: "agent",
      }),
    ];

    const resolved = resolveBenchModelEntries(benchTasks, {
      categoryFilter: undefined,
      modelOverride: undefined,
    } as RunEvalsOptions);

    expect(resolved.effectiveCategory).toBe("external_agent_benchmarks");
    expect(resolved.isAgentCategory).toBe(true);
    expect(resolved.modelEntries.length).toBeGreaterThan(0);
    expect(resolved.modelEntries.every((entry) => entry.mode === "hybrid")).toBe(true);
  });
});

describe("runner: core tool validation", () => {
  it("rejects stagehand_facade before planning core tasks", async () => {
    const onProgress = vi.fn();
    await expect(
      runEvals({
        tasks: [makeTask({ tier: "core", name: "open" })],
        registry: emptyRegistry(),
        coreToolSurface: "stagehand_facade",
        onProgress,
      }),
    ).rejects.toThrow(/available only as an agent harness mount/iu);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("keeps ordinary empty core planning unchanged", async () => {
    const onProgress = vi.fn();
    await expect(
      runEvals({
        tasks: [],
        registry: emptyRegistry(),
        coreToolSurface: "understudy_code",
        onProgress,
      }),
    ).resolves.toMatchObject({ summary: { passed: 0, failed: 0, total: 0 } });
    expect(onProgress).toHaveBeenCalledWith({ type: "planned", total: 0 });
  });
});
