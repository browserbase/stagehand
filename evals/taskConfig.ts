/**
 * This file is responsible for:
 * - Loading and parsing the `evals.config.json` file, which defines tasks (evaluations) and their associated categories.
 * - Building a lookup structure (`tasksByName`) to map each task name to its categories.
 * - Filtering tasks based on command-line arguments (e.g., `filterByEvalName`) and ensuring that requested tasks exist.
 * - Determining which models to use for evaluations, depending on the category and environment variables.
 * - Validating that the chosen models are supported.
 *
 * The exported objects (`tasksByName`, `MODELS`, `config`) are used by the main evaluation script and other modules
 * to know which tasks and models are available, and to configure the evaluations accordingly.
 */

import fs from "fs";
import path from "path";
import { AvailableModel } from "@browserbasehq/stagehand";
import { filterByEvalName } from "./args";
import dotenv from "dotenv";

dotenv.config();

const ALL_EVAL_MODELS = [
  // GOOGLE
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-2.5-pro-exp-03-25",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b",
  "gemini-2.5-flash-preview-04-17",
  "gemini-2.5-pro-preview-03-25",
  // ANTHROPIC
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-latest",
  // OPENAI
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.5-preview",
  "o3",
  "o3-mini",
  "o4-mini",
  // TOGETHER - META
  "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
  // TOGETHER - DEEPSEEK
  "deepseek-ai/DeepSeek-V3",
  "Qwen/Qwen2.5-7B-Instruct-Turbo",
  // GROQ
  "groq/meta-llama/llama-4-scout-17b-16e-instruct",
  "groq/llama-3.3-70b-versatile",
  "groq/llama3-70b-8192",
  "groq/qwen-qwq-32b",
  "groq/qwen-2.5-32b",
  "groq/deepseek-r1-distill-qwen-32b",
  "groq/deepseek-r1-distill-llama-70b",
  // CEREBRAS
  "cerebras/llama3.3-70b",
];

// The configuration file `evals.config.json` contains a list of tasks and their associated categories.
const configPath = path.join(__dirname, "evals.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) satisfies {
  tasks: {
    name: string;
    categories: string[];
  }[];
};

/**
 * The `tasksConfig` defines all tasks from the config file. Each task has a name and categories.
 * We create a mapping `tasksByName` from task name to its categories for quick lookup.
 */
type TaskConfig = {
  name: string;
  categories: string[];
};
const tasksConfig = config.tasks as TaskConfig[];

const tasksByName = tasksConfig.reduce<
  Record<string, { categories: string[] }>
>((acc, task) => {
  acc[task.name] = {
    categories: task.categories,
  };
  return acc;
}, {});

/**
 * If filtering by a specific eval name (task), ensure that this task actually exists.
 */
if (filterByEvalName && !tasksByName[filterByEvalName]) {
  console.error(`Error: Evaluation "${filterByEvalName}" does not exist.`);
  process.exit(1);
}

/**
 * Determine which models to run the evaluations against.
 *
 * DEFAULT_EVAL_MODELS: The default set of models used for most categories.
 */
const DEFAULT_EVAL_MODELS = process.env.EVAL_MODELS
  ? process.env.EVAL_MODELS.split(",")
  : [
      "google/gemini-2.0-flash",
      "openai/gpt-4.1-mini",
      "anthropic/claude-3-5-sonnet-latest",
    ];

const DEFAULT_AGENT_MODELS = process.env.EVAL_AGENT_MODELS
  ? process.env.EVAL_AGENT_MODELS.split(",")
  : [
      "computer-use-preview-2025-03-11",
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "gemini-2.5-computer-use-preview-10-2025",
      // "anthropic/claude-sonnet-4-20250514",
    ];

/**
 * getModelList:
 * Returns a list of models to be used for the given category.
 * If category is "experimental", it merges DEFAULT_EVAL_MODELS and EXPERIMENTAL_EVAL_MODELS.
 * Otherwise, returns DEFAULT_EVAL_MODELS filtered by provider if specified.
 */
const getModelList = (category?: string): string[] => {
  const provider = process.env.EVAL_PROVIDER?.toLowerCase();

  if (category === "agent" || category === "external_agent_benchmarks") {
    return DEFAULT_AGENT_MODELS;
  }

  if (provider) {
    return ALL_EVAL_MODELS.filter((model) =>
      filterModelByProvider(model, provider),
    );
  }

  // If no agent category and no provider, return default eval models
  return DEFAULT_EVAL_MODELS;
};

// Helper function to contain the provider filtering logic
const filterModelByProvider = (model: string, provider: string): boolean => {
  const modelLower = model.toLowerCase();
  if (provider === "openai") {
    return modelLower.startsWith("gpt");
  } else if (provider === "anthropic") {
    return modelLower.startsWith("claude");
  } else if (provider === "google") {
    return modelLower.startsWith("gemini");
  } else if (provider === "together") {
    return (
      modelLower.startsWith("meta-llama") ||
      modelLower.startsWith("llama") ||
      modelLower.startsWith("deepseek") ||
      modelLower.startsWith("qwen")
    );
  } else if (provider === "groq") {
    return modelLower.startsWith("groq");
  } else if (provider === "cerebras") {
    return modelLower.startsWith("cerebras");
  }
  console.warn(
    `Unknown provider specified or model doesn't match: ${provider}`,
  );
  return false;
};

const MODELS: AvailableModel[] = getModelList().map((model) => {
  return model as AvailableModel;
});

export { tasksByName, MODELS, tasksConfig, getModelList };
