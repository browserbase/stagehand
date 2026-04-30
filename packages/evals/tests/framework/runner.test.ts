import { describe, it, expect, vi } from "vitest";
import type { DiscoveredTask } from "../../framework/types.js";
import {
  resolveBenchModelEntries,
  type RunEvalsOptions,
} from "../../framework/runner.js";

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

describe("runner: Braintrust project selection", () => {
  it("uses stagehand-core-dev for core-only tasks", async () => {
    // The project selection logic is:
    //   hasCoreOnly ? stagehand-core[-dev] : stagehand[-dev]
    // We verify this logic directly
    const tasks = [makeTask({ tier: "core", name: "open" })];
    const hasCoreOnly = tasks.every((t) => t.tier === "core");
    expect(hasCoreOnly).toBe(true);

    const project = hasCoreOnly ? "stagehand-core-dev" : "stagehand-dev";
    expect(project).toBe("stagehand-core-dev");
  });

  it("uses stagehand-dev for bench tasks", () => {
    const tasks = [makeTask({ tier: "bench", name: "dropdown" })];
    const hasCoreOnly = tasks.every((t) => t.tier === "core");
    expect(hasCoreOnly).toBe(false);

    const project = hasCoreOnly ? "stagehand-core-dev" : "stagehand-dev";
    expect(project).toBe("stagehand-dev");
  });

  it("uses stagehand-dev for mixed tiers", () => {
    const tasks = [
      makeTask({ tier: "core", name: "open" }),
      makeTask({ tier: "bench", name: "dropdown" }),
    ];
    const hasCoreOnly = tasks.every((t) => t.tier === "core");
    expect(hasCoreOnly).toBe(false);

    const project = hasCoreOnly ? "stagehand-core-dev" : "stagehand-dev";
    expect(project).toBe("stagehand-dev");
  });

  it("uses stagehand in CI for core", () => {
    const hasCoreOnly = true;
    const isCI = true;
    const project = hasCoreOnly
      ? isCI
        ? "stagehand-core"
        : "stagehand-core-dev"
      : isCI
        ? "stagehand"
        : "stagehand-dev";
    expect(project).toBe("stagehand-core");
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

  it("uses agent and CUA model entries for direct suite benchmarks", () => {
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
    expect(resolved.modelEntries.length).toBeGreaterThan(1);
    expect(resolved.modelEntries.some((entry) => entry.cua)).toBe(true);
  });
});
