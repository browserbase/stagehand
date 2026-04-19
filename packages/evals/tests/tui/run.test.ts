import { describe, expect, it } from "vitest";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import { deriveCategoryFilter } from "../../tui/commands/run.js";

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
        name: "agent/gaia",
        primaryCategory: "external_agent_benchmarks",
        categories: ["external_agent_benchmarks"],
      }),
    ]);

    expect(deriveCategoryFilter(registry, "agent/gaia")).toBeUndefined();
  });
});
