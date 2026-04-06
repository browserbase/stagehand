import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverTasks, resolveTarget } from "../../framework/discovery.js";
import type { TaskRegistry, DiscoveredTask } from "../../framework/types.js";

// ---------------------------------------------------------------------------
// Helpers — create temp task trees for discovery tests
// ---------------------------------------------------------------------------

let tmpDir: string;

function createFile(relativePath: string, content = "export default {};\n") {
  const full = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-discovery-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// discoverTasks
// ---------------------------------------------------------------------------

describe("discoverTasks", () => {
  it("discovers core and bench tasks", async () => {
    createFile("core/navigation/open.ts");
    createFile("core/navigation/reload.ts");
    createFile("bench/act/click.ts");
    createFile("bench/agent/gaia.ts");

    const registry = await discoverTasks(tmpDir, false);

    expect(registry.tasks).toHaveLength(4);
    expect(registry.byTier.get("core")).toHaveLength(2);
    expect(registry.byTier.get("bench")).toHaveLength(2);
  });

  it("derives correct tier and category from path", async () => {
    createFile("bench/extract/prices.ts");

    const registry = await discoverTasks(tmpDir, false);
    const task = registry.tasks[0];

    expect(task.tier).toBe("bench");
    expect(task.primaryCategory).toBe("extract");
    expect(task.categories).toContain("extract");
  });

  it("prefixes agent task names with agent/", async () => {
    createFile("bench/agent/gaia.ts");

    const registry = await discoverTasks(tmpDir, false);
    const task = registry.byName.get("agent/gaia");

    expect(task).toBeDefined();
    expect(task!.name).toBe("agent/gaia");
    expect(task!.primaryCategory).toBe("agent");
  });

  it("indexes by category", async () => {
    createFile("bench/act/a.ts");
    createFile("bench/act/b.ts");
    createFile("bench/extract/c.ts");

    const registry = await discoverTasks(tmpDir, false);

    expect(registry.byCategory.get("act")).toHaveLength(2);
    expect(registry.byCategory.get("extract")).toHaveLength(1);
  });

  it("ignores .d.ts files", async () => {
    createFile("bench/act/click.ts");
    createFile("bench/act/click.d.ts");

    const registry = await discoverTasks(tmpDir, false);

    expect(registry.tasks).toHaveLength(1);
  });

  it("returns empty registry for nonexistent directory", async () => {
    const registry = await discoverTasks("/nonexistent/path", false);

    expect(registry.tasks).toHaveLength(0);
  });

  it("ignores files at wrong nesting depth", async () => {
    // File directly in tier dir (no category subdirectory) — should be skipped
    createFile("bench/stray.ts");

    const registry = await discoverTasks(tmpDir, false);

    expect(registry.tasks).toHaveLength(0);
  });

  it("discovers .js files too", async () => {
    createFile("bench/act/click.js");

    const registry = await discoverTasks(tmpDir, false);

    expect(registry.tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveTarget
// ---------------------------------------------------------------------------

describe("resolveTarget", () => {
  // Build a mock registry for target resolution tests
  function buildMockRegistry(): TaskRegistry {
    const tasks: DiscoveredTask[] = [
      { name: "navigation/open", tier: "core", primaryCategory: "navigation", categories: ["navigation"], tags: [], filePath: "/a", isLegacy: false },
      { name: "navigation/reload", tier: "core", primaryCategory: "navigation", categories: ["navigation"], tags: [], filePath: "/b", isLegacy: false },
      { name: "act/click", tier: "bench", primaryCategory: "act", categories: ["act"], tags: [], filePath: "/c", isLegacy: true },
      { name: "act/dropdown", tier: "bench", primaryCategory: "act", categories: ["act", "regression"], tags: [], filePath: "/d", isLegacy: true },
      { name: "agent/gaia", tier: "bench", primaryCategory: "agent", categories: ["agent"], tags: [], filePath: "/e", isLegacy: true },
    ];

    const byName = new Map(tasks.map((t) => [t.name, t]));
    const byTier = new Map<"core" | "bench", DiscoveredTask[]>();
    const byCategory = new Map<string, DiscoveredTask[]>();

    for (const t of tasks) {
      if (!byTier.has(t.tier)) byTier.set(t.tier, []);
      byTier.get(t.tier)!.push(t);
      for (const cat of t.categories) {
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(t);
      }
    }

    return { tasks, byName, byTier, byCategory };
  }

  it("no target returns bench tasks", () => {
    const registry = buildMockRegistry();
    const result = resolveTarget(registry);

    expect(result).toHaveLength(3); // act/click, act/dropdown, agent/gaia
    expect(result.every((t) => t.tier === "bench")).toBe(true);
  });

  it("tier name returns all tasks in that tier", () => {
    const registry = buildMockRegistry();

    expect(resolveTarget(registry, "core")).toHaveLength(2);
    expect(resolveTarget(registry, "bench")).toHaveLength(3);
  });

  it("category name returns matching tasks", () => {
    const registry = buildMockRegistry();

    expect(resolveTarget(registry, "act")).toHaveLength(2);
    expect(resolveTarget(registry, "navigation")).toHaveLength(2);
    expect(resolveTarget(registry, "agent")).toHaveLength(1);
  });

  it("tier:category qualifier scopes correctly", () => {
    const registry = buildMockRegistry();
    const result = resolveTarget(registry, "core:navigation");

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.tier === "core")).toBe(true);
  });

  it("specific task name returns that task", () => {
    const registry = buildMockRegistry();
    const result = resolveTarget(registry, "agent/gaia");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("agent/gaia");
  });

  it("partial name match works", () => {
    const registry = buildMockRegistry();
    const result = resolveTarget(registry, "dropdown");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("act/dropdown");
  });

  it("throws on unknown target", () => {
    const registry = buildMockRegistry();

    expect(() => resolveTarget(registry, "nonexistent")).toThrow(
      /No tasks found/,
    );
  });

  it("throws on ambiguous category across tiers", () => {
    // Add a "navigation" category to bench tier to create ambiguity
    const registry = buildMockRegistry();
    const ambiguousTask: DiscoveredTask = {
      name: "bench_nav", tier: "bench", primaryCategory: "navigation",
      categories: ["navigation"], tags: [], filePath: "/f", isLegacy: true,
    };
    registry.tasks.push(ambiguousTask);
    registry.byName.set(ambiguousTask.name, ambiguousTask);
    registry.byTier.get("bench")!.push(ambiguousTask);
    if (!registry.byCategory.has("navigation")) {
      registry.byCategory.set("navigation", []);
    }
    registry.byCategory.get("navigation")!.push(ambiguousTask);

    expect(() => resolveTarget(registry, "navigation")).toThrow(
      /exists in both/,
    );
  });

  it("throws on unknown tier in qualifier", () => {
    const registry = buildMockRegistry();

    expect(() => resolveTarget(registry, "unknown:act")).toThrow(
      /Unknown tier/,
    );
  });
});
