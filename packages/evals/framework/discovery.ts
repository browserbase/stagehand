/**
 * Auto-discovery: scans task directories and builds an in-memory TaskRegistry.
 *
 * Convention:
 *   core/tasks/<category>/<taskName>.ts
 *   tasks/bench/<category>/<taskName>.ts
 *
 * Discovery checks for:
 *   1. Default export from defineTask() (new API)
 *   2. Named export matching the filename (legacy EvalFunction pattern)
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BenchTaskMeta,
  DiscoveredTask,
  TaskDefinition,
  TaskRegistry,
  Tier,
} from "./types.js";

const TIERS = ["core", "bench"] as const satisfies readonly Tier[];

/**
 * Category tags applied to specific bench tasks during non-eager discovery
 * so filters like `evals run regression` work without importing every task
 * module. Sourced from the legacy cli.ts. Long-term these belong in each
 * task's `meta.tags` — that migration is a separate cleanup.
 */
const EXTRA_CATEGORIES: Record<string, string[]> = {
  instructions: ["regression"],
  ionwave: ["regression"],
  wichita: ["regression"],
  extract_memorial_healthcare: ["regression"],
  observe_github: ["regression"],
  observe_vantechjournal: ["regression"],
  observe_iframes1: ["regression"],
  observe_iframes2: ["regression"],
  extract_hamilton_weather: ["regression", "targeted_extract"],
  scroll_50: ["regression"],
  scroll_75: ["regression"],
  next_chunk: ["regression"],
  prev_chunk: ["regression"],
  login: ["regression"],
  no_js_click: ["regression"],
  heal_simple_google_search: ["regression"],
  extract_aigrant_companies: ["regression"],
  extract_regulations_table: ["targeted_extract"],
  extract_recipe: ["targeted_extract"],
  extract_aigrant_targeted: ["targeted_extract"],
  extract_aigrant_targeted_2: ["targeted_extract"],
  extract_geniusee: ["targeted_extract"],
  extract_geniusee_2: ["targeted_extract"],
};

/**
 * Tasks whose primary category should be replaced entirely (not
 * augmented) during discovery. External agent benchmarks are grouped here.
 */
const CATEGORY_OVERRIDES: Record<string, string[]> = {
  "agent/gaia": ["external_agent_benchmarks"],
  "agent/webvoyager": ["external_agent_benchmarks"],
  "agent/onlineMind2Web": ["external_agent_benchmarks"],
  "agent/webtailbench": ["external_agent_benchmarks"],
};

function getTaskBasename(taskName: string): string {
  if (!taskName.includes("/")) return taskName;
  const parts = taskName.split("/");
  return parts[parts.length - 1] ?? taskName;
}

function getExtraCategories(taskName: string): string[] {
  return (
    EXTRA_CATEGORIES[taskName] ??
    EXTRA_CATEGORIES[getTaskBasename(taskName)] ??
    []
  );
}

type ParsedTaskPath = {
  tier: Tier;
  category: string;
  name: string;
};

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

function getTierRoots(tasksRoot: string, tier: Tier): string[] {
  if (tier === "bench") {
    return [path.join(tasksRoot, "bench")];
  }

  const packageRoot = path.dirname(tasksRoot);
  return [path.join(packageRoot, "core", "tasks")];
}

/**
 * Extract category and task name from a file path rooted at a tier directory.
 *
 * Given core/tasks/navigation/open.ts or tasks/bench/act/dropdown.ts:
 * Returns tier/category/name using the provided tier.
 */
function parseTaskPath(
  filePath: string,
  tierRoot: string,
  tier: Tier,
): ParsedTaskPath | null {
  const relative = path.relative(tierRoot, filePath);
  const parts = relative.replace(/\\/g, "/").split("/");

  // Minimum: <category>/<file>.ts
  if (parts.length < 2) return null;

  const category = parts[0];
  const fileName = parts[parts.length - 1].replace(/\.(ts|js)$/, "");

  // For deeper nesting (e.g., bench/agent/subfolder/task.ts), include the
  // intermediate path in the name for uniqueness.
  const nameParts = parts.slice(0, -1);
  const name =
    nameParts.length > 1
      ? `${nameParts.join("/")}/${fileName}`
      : `${category}/${fileName}`;

  const simpleName = category === fileName ? fileName : name;

  return {
    tier,
    category,
    name: simpleName,
  };
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

  const defaultExport = taskModule.default;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return { isLegacy: false, definition: defaultExport as TaskDefinition };
  }

  const baseName = expectedName.includes("/")
    ? expectedName.split("/").pop()
    : expectedName;

  if (baseName && typeof taskModule[baseName] === "function") {
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
  eager = false,
): Promise<TaskRegistry> {
  const tasks: DiscoveredTask[] = [];
  const byName = new Map<string, DiscoveredTask>();
  const byTier = new Map<Tier, DiscoveredTask[]>();
  const byCategory = new Map<string, DiscoveredTask[]>();

  for (const tier of TIERS) {
    const tierRoots = getTierRoots(tasksRoot, tier);

    for (const tierRoot of tierRoots) {
      const files = walkDir(tierRoot);

      for (const filePath of files) {
        const parsed = parseTaskPath(filePath, tierRoot, tier);
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
              if ("models" in meta && (meta as BenchTaskMeta).models) {
                models = (meta as BenchTaskMeta).models;
              }
            }
          } catch (err) {
            console.warn(
              `[discovery] Failed to load task module ${filePath}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            continue;
          }
        }

        const override = CATEGORY_OVERRIDES[taskName];
        const baseCategories = override
          ? [...override]
          : [
              parsed.category,
              ...extraCategories.filter((c) => c !== parsed.category),
            ];

        const hardcodedExtras = getExtraCategories(taskName);
        const categories = [...baseCategories];
        for (const extra of hardcodedExtras) {
          if (!categories.includes(extra)) categories.push(extra);
        }

        const task: DiscoveredTask = {
          name: taskName,
          tier: parsed.tier,
          primaryCategory: override ? override[0] : parsed.category,
          categories,
          tags,
          filePath,
          isLegacy,
          models,
        };

        tasks.push(task);
        byName.set(task.name, task);

        if (!byTier.has(parsed.tier)) byTier.set(parsed.tier, []);
        byTier.get(parsed.tier)!.push(task);

        for (const cat of categories) {
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat)!.push(task);
        }
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
  if (!target) {
    return registry.byTier.get("bench") ?? [];
  }

  if (target.includes(":")) {
    const [tierPart, categoryPart] = target.split(":", 2);
    const tier = tierPart as Tier;

    if (!TIERS.includes(tier)) {
      throw new Error(
        `Unknown tier "${tierPart}". Valid tiers: ${TIERS.join(", ")}`,
      );
    }

    const tierTasks = registry.byTier.get(tier) ?? [];
    const matches = tierTasks.filter((t) =>
      t.categories.includes(categoryPart),
    );
    if (matches.length === 0) {
      throw new Error(
        `No tasks found matching "${target}". Run "evals list" to see available tasks.`,
      );
    }
    return matches;
  }

  if (TIERS.includes(target as Tier)) {
    return registry.byTier.get(target as Tier) ?? [];
  }

  const categoryTasks = registry.byCategory.get(target);
  if (categoryTasks && categoryTasks.length > 0) {
    const tiers = new Set(categoryTasks.map((t) => t.tier));
    if (tiers.size > 1) {
      const tierList = [...tiers].map((t) => `${t}:${target}`).join(" or ");
      throw new Error(
        `"${target}" exists in both ${[...tiers].join(" and ")}. Use ${tierList}.`,
      );
    }
    return categoryTasks;
  }

  const task = registry.byName.get(target);
  if (task) {
    return [task];
  }

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
