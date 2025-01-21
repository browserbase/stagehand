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
import { AvailableModel, AvailableModelSchema } from "@/dist";
import { filterByEvalName } from "./args";

// The configuration file `evals.config.json` contains a list of tasks and their associated categories.
const configPath = path.join(__dirname, "evals.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

/**
 * The `tasksConfig` defines all tasks from the config file. Each task has a name and categories.
 * We create a mapping `tasksByName` from task name to its categories for quick lookup.
 */
type TaskConfig = { name: string; categories: string[] };
const tasksConfig = config.tasks as TaskConfig[];

const tasksByName = tasksConfig.reduce<
  Record<string, { categories: string[] }>
>((acc, task) => {
  acc[task.name] = { categories: task.categories };
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
 * EXPERIMENTAL_EVAL_MODELS: Additional models included if the category is "experimental".
 */
const DEFAULT_EVAL_MODELS = process.env.EVAL_MODELS
  ? process.env.EVAL_MODELS.split(",")
  : ["gpt-4o", "claude-3-5-sonnet-latest"];

/**
 * getModelList:
 * Returns a list of models to be used for the given category.
 * If category is "experimental", it merges DEFAULT_EVAL_MODELS and EXPERIMENTAL_EVAL_MODELS.
 * Otherwise, returns DEFAULT_EVAL_MODELS.
 */
const getModelList = (): string[] => {
  return DEFAULT_EVAL_MODELS;
};
const MODELS: AvailableModel[] = getModelList().map((model) => {
  if (!AvailableModelSchema.safeParse(model).success) {
    throw new Error(`Model ${model} is not a supported model`);
  }
  return model as AvailableModel;
});

export { tasksByName, MODELS, config };
