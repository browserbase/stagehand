/**
 * Task and model configuration.
 *
 * This module now builds the task registry from the filesystem (auto-discovery)
 * instead of reading a static tasks array from evals.config.json.
 * Model configuration logic is preserved as-is.
 */

import fs from "fs";
import path from "path";
import {
  AgentProvider,
  AVAILABLE_CUA_MODELS,
  type AgentToolMode,
  type AvailableCuaModel,
  type AvailableModel,
  providerEnvVarMap,
} from "stagehand-v3";
import { AgentModelEntry } from "./types/evals.js";
import { getCurrentDirPath } from "./runtimePaths.js";

// ---------------------------------------------------------------------------
// Auto-discover tasks from filesystem
// ---------------------------------------------------------------------------

const moduleDir = getCurrentDirPath();
const tasksRoot = path.join(moduleDir, "tasks");

type TaskConfig = {
  name: string;
  categories: string[];
};

/**
 * Walk a directory to find .ts/.js task files (non-recursive for leaf dirs).
 */
function findTaskFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTaskFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Cross-cutting categories that tasks may belong to in addition to their
 * primary directory-based category. These were previously stored in
 * evals.config.json and are preserved here as a static mapping so that
 * commands like `evals run regression` or `evals run targeted_extract`
 * continue to work after the migration to filesystem-based discovery.
 */
/**
 * Extra categories to ADD to a task's directory-derived category.
 */
const EXTRA_CATEGORIES: Record<string, string[]> = {
  instructions: ["regression"],
  ionwave: ["regression"],
  wichita: ["regression"],
  extract_memorial_healthcare: ["regression"],
  observe_github: ["regression"],
  observe_main_frame_element_ids: ["regression"],
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
 * Build tasksConfig from filesystem structure (bench tier only).
 *
 * Only scans tasks/bench/ — core tier tasks are not exposed to the legacy
 * runner because index.eval.ts cannot execute them yet.
 *
 * Cross-cutting categories (regression and targeted_extract) are merged
 * from the static mapping above.
 */
function buildTasksConfigFromFS(): TaskConfig[] {
  const configs: TaskConfig[] = [];
  const benchDir = path.join(tasksRoot, "bench");

  if (!fs.existsSync(benchDir)) return configs;

  const categories = fs
    .readdirSync(benchDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const category of categories) {
    const catDir = path.join(benchDir, category);
    const files = findTaskFiles(catDir);

    for (const filePath of files) {
      const baseName = path.basename(filePath).replace(/\.(ts|js)$/, "");
      const name = category === "agent" ? `agent/${baseName}` : baseName;

      // Start with the primary directory category, then merge extras
      const taskCategories = [category];
      const extras = EXTRA_CATEGORIES[name];
      if (extras) {
        for (const extra of extras) {
          if (!taskCategories.includes(extra)) {
            taskCategories.push(extra);
          }
        }
      }

      configs.push({ name, categories: taskCategories });
    }
  }

  return configs;
}

const tasksConfig = buildTasksConfigFromFS();

const tasksByName = tasksConfig.reduce<Record<string, { categories: string[] }>>((acc, task) => {
  acc[task.name] = {
    categories: task.categories,
  };
  return acc;
}, {});

/**
 * Validate a specific eval name against the discovered tasks.
 * Called lazily (not at import time) to avoid side effects in bundled builds.
 */
export function validateEvalName(evalName: string): void {
  if (evalName && !tasksByName[evalName]) {
    console.error(`Error: Evaluation "${evalName}" does not exist.`);
    console.error(`Available tasks: ${Object.keys(tasksByName).slice(0, 20).join(", ")}...`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Model configuration (preserved from original)
// ---------------------------------------------------------------------------

const DEFAULT_EVAL_MODELS = process.env.EVAL_MODELS
  ? process.env.EVAL_MODELS.split(",")
  : ["google/gemini-2.5-flash", "openai/gpt-4.1-mini", "anthropic/claude-haiku-4-5"];

const DEFAULT_AGENT_MODELS_STANDARD = [
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.4-mini",
  "google/gemini-3-flash-preview",
];

const DEFAULT_AGENT_MODELS_CUA = [
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.4-mini",
  "google/gemini-3-flash-preview",
] satisfies readonly AvailableCuaModel[];

const DEFAULT_AGENT_MODEL_MODES = ["dom", "hybrid"] as const satisfies readonly AgentToolMode[];

const isCuaModel = (modelName: string): boolean =>
  (AVAILABLE_CUA_MODELS as readonly string[]).includes(modelName);

function parseModelList(raw: string): string[] {
  return raw
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function hasProviderEnvSupport(modelName: string): boolean {
  try {
    const provider = AgentProvider.getAgentProvider(modelName);
    return provider in providerEnvVarMap;
  } catch {
    return false;
  }
}

function getConfiguredAgentModels(): string[] {
  return process.env.EVAL_AGENT_MODELS
    ? parseModelList(process.env.EVAL_AGENT_MODELS)
    : [...DEFAULT_AGENT_MODELS_STANDARD];
}

function getConfiguredCuaAgentModels(): string[] {
  return process.env.EVAL_AGENT_MODELS_CUA
    ? parseModelList(process.env.EVAL_AGENT_MODELS_CUA)
    : DEFAULT_AGENT_MODELS_CUA.filter(hasProviderEnvSupport);
}

function uniqueAgentEntries(entries: AgentModelEntry[]): AgentModelEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.modelName}:${entry.mode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAgentModelEntries(): AgentModelEntry[] {
  return uniqueAgentEntries([
    ...getConfiguredAgentModels().flatMap((modelName) =>
      DEFAULT_AGENT_MODEL_MODES.map((mode) => ({
        modelName,
        mode,
        cua: false,
      })),
    ),
    ...getConfiguredCuaAgentModels()
      .filter(isCuaModel)
      .map((modelName) => ({
        modelName,
        mode: "cua" as const,
        cua: true,
      })),
  ]);
}

function getDefaultAgentModels(): string[] {
  return [...new Set(buildAgentModelEntries().map((entry) => entry.modelName))];
}

const getModelList = (category?: string): string[] => {
  const provider = process.env.EVAL_PROVIDER?.toLowerCase();

  if (category === "agent" || category === "external_agent_benchmarks") {
    return getDefaultAgentModels();
  }

  if (provider) {
    return DEFAULT_EVAL_MODELS.filter((model) => model.toLowerCase().startsWith(`${provider}/`));
  }

  return DEFAULT_EVAL_MODELS;
};

const MODELS: AvailableModel[] = getModelList().map((model) => {
  return model as AvailableModel;
});

const getAgentModelEntries = (): AgentModelEntry[] => buildAgentModelEntries();

export { tasksByName, MODELS, tasksConfig, getModelList, getAgentModelEntries };
export type { AgentModelEntry };
