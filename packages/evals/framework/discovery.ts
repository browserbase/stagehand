/**
 * Auto-discovery: scans tasks/{core,bench}/ directories and builds
 * an in-memory TaskRegistry. No manual evals.config.json registration needed.
 *
 * Convention:
 *   tasks/<tier>/<category>/<taskName>.ts
 *
 * Discovery checks for:
 *   1. Default export from defineTask() (new API)
 *   2. Named export matching the filename (legacy EvalFunction pattern)
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Tier,
  DiscoveredTask,
  TaskRegistry,
  TaskDefinition,
} from "./types.js";

const TIERS: Tier[] = ["core", "bench"];

/**
 * Recursively find all .ts files in a directory, ignoring .d.ts files.
 */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract tier, category, and task name from a file path.
 *
 * Given: /path/to/tasks/bench/act/dropdown.ts
 * Returns: { tier: "bench", category: "act", name: "dropdown" }
 *
 * For nested paths like tasks/bench/agent/gaia.ts:
 * Returns: { tier: "bench", category: "agent", name: "agent/gaia" }
 */
function parseTaskPath(
  filePath: string,
  tasksRoot: string,
): { tier: Tier; category: string; name: string } | null {
  const relative = path.relative(tasksRoot, filePath);
  const parts = relative.replace(/\\/g, "/").split("/");

  // Minimum: <tier>/<category>/<file>.ts
  if (parts.length < 3) return null;

  const tier = parts[0] as Tier;
  if (!TIERS.includes(tier)) return null;

  const category = parts[1];
  const fileName = parts[parts.length - 1].replace(/\.(ts|js)$/, "");

  // For deeper nesting (e.g., bench/agent/subfolder/task.ts), include the
  // intermediate path in the name for uniqueness
  const nameParts = parts.slice(1, -1); // category onwards, excluding filename
  const name =
    nameParts.length > 1
      ? `${nameParts.join("/")}/${fileName}`
      : `${category}/${fileName}`;

  // If category === fileName (e.g., tasks/bench/act/act.ts), simplify to just the name
  const simpleName = category === fileName ? fileName : name;

  return { tier, category, name: simpleName };
}

/**
 * Import a task module and extract the task definition.
 *
 * Handles both new defineTask() default exports and legacy named exports.
 */
async function loadTaskModule(
  filePath: string,
  expectedName: string,
): Promise<{ isLegacy: boolean; definition?: TaskDefinition }> {
  const moduleUrl = pathToFileURL(filePath).href;
  const taskModule = await import(moduleUrl);

  // Check for new-style default export (defineTask)
  const defaultExport = taskModule.default;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return { isLegacy: false, definition: defaultExport };
  }

  // Check for legacy named export matching the filename
  const baseName = expectedName.includes("/")
    ? expectedName.split("/").pop()!
    : expectedName;

  if (typeof taskModule[baseName] === "function") {
    return { isLegacy: true };
  }

  return { isLegacy: false };
}

/**
 * Discover all tasks by scanning the filesystem.
 *
 * @param tasksRoot - Absolute path to the tasks/ directory
 * @param eager - If true, imports modules to read defineTask metadata.
 *                If false (default), only uses filesystem-based inference.
 */
export async function discoverTasks(
  tasksRoot: string,
  eager: boolean = false,
): Promise<TaskRegistry> {
  const tasks: DiscoveredTask[] = [];
  const byName = new Map<string, DiscoveredTask>();
  const byTier = new Map<Tier, DiscoveredTask[]>();
  const byCategory = new Map<string, DiscoveredTask[]>();

  for (const tier of TIERS) {
    const tierDir = path.join(tasksRoot, tier);
    const files = walkDir(tierDir);

    for (const filePath of files) {
      const parsed = parseTaskPath(filePath, tasksRoot);
      if (!parsed) continue;

      let isLegacy = true;
      let extraCategories: string[] = [];
      let tags: string[] = [];
      let models: string[] | undefined;
      let taskName = parsed.name;

      if (eager) {
        try {
          const result = await loadTaskModule(filePath, parsed.name);
          isLegacy = result.isLegacy;

          if (result.definition) {
            const meta = result.definition.meta;
            if (meta.name) taskName = meta.name;
            if (meta.categories) extraCategories = meta.categories;
            if (meta.tags) tags = meta.tags;
            if ("models" in meta && meta.models) {
              models = meta.models as string[];
            }
          }
        } catch (err) {
          console.warn(
            `[discovery] Failed to load task module ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
      }

      // Build the full categories list: primary category + extras
      const categories = [
        parsed.category,
        ...extraCategories.filter((c) => c !== parsed.category),
      ];

      const task: DiscoveredTask = {
        name: taskName,
        tier: parsed.tier,
        primaryCategory: parsed.category,
        categories,
        tags,
        filePath,
        isLegacy,
        models,
      };

      tasks.push(task);
      byName.set(task.name, task);

      // Index by tier
      if (!byTier.has(parsed.tier)) byTier.set(parsed.tier, []);
      byTier.get(parsed.tier)!.push(task);

      // Index by each category
      for (const cat of categories) {
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(task);
      }
    }
  }

  return { tasks, byName, byTier, byCategory };
}

/**
 * Resolve a CLI target string to a list of tasks.
 *
 * Target resolution order:
 *   1. Tier-qualified: "core:navigation" → tier=core, category=navigation
 *   2. Tier name: "core" → all tasks in that tier
 *   3. Category name: "act" → all tasks with that category (errors on ambiguity)
 *   4. Task name: "dropdown" → specific task by name
 *   5. No target: defaults to all bench tasks
 */
export function resolveTarget(
  registry: TaskRegistry,
  target?: string,
): DiscoveredTask[] {
  // No target → default to bench
  if (!target) {
    return registry.byTier.get("bench") ?? [];
  }

  // Check for tier:category qualifier
  if (target.includes(":")) {
    const [tierPart, categoryPart] = target.split(":", 2);
    const tier = tierPart as Tier;
    if (!TIERS.includes(tier)) {
      throw new Error(`Unknown tier "${tierPart}". Valid tiers: ${TIERS.join(", ")}`);
    }
    const tierTasks = registry.byTier.get(tier) ?? [];
    return tierTasks.filter((t) => t.categories.includes(categoryPart));
  }

  // Check if target is a tier name
  if (TIERS.includes(target as Tier)) {
    return registry.byTier.get(target as Tier) ?? [];
  }

  // Check if target is a category name
  const categoryTasks = registry.byCategory.get(target);
  if (categoryTasks && categoryTasks.length > 0) {
    // Check for ambiguity: does this category exist in multiple tiers?
    const tiers = new Set(categoryTasks.map((t) => t.tier));
    if (tiers.size > 1) {
      const tierList = [...tiers].map((t) => `${t}:${target}`).join(" or ");
      throw new Error(
        `"${target}" exists in both ${[...tiers].join(" and ")}. Use ${tierList}.`,
      );
    }
    return categoryTasks;
  }

  // Check if target is a specific task name
  const task = registry.byName.get(target);
  if (task) {
    return [task];
  }

  // Try partial match on task name (e.g., "dropdown" matching "act/dropdown")
  const partial = registry.tasks.filter(
    (t) => t.name.endsWith(`/${target}`) || t.name === target,
  );
  if (partial.length > 0) {
    return partial;
  }

  throw new Error(
    `No tasks found matching "${target}". Run "evals list" to see available tasks.`,
  );
}
