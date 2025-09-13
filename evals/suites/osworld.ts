import type { Testcase, EvalInput } from "@/types/evals";
import type { AvailableModel } from "@/types/model";
import { tasksConfig } from "../taskConfig";
import { applySampling } from "../utils";
import { osworldDataset } from "../datasets/osworld";

export const buildOSWorldTestcases = (models: string[]): Testcase[] => {
  /**
   * Environment Variables:
   *
   * EVAL_OSWORLD_SOURCE - Filter tasks by source
   *   Options: "Mind2Web" | "test_task_1" | any specific source from dataset
   *   Example: EVAL_OSWORLD_SOURCE=Mind2Web
   *
   * EVAL_OSWORLD_EVALUATION_TYPE - Filter tasks by evaluation type
   *   Options: "url_match" | "string_match" | "dom_state" | "custom"
   *   Example: EVAL_OSWORLD_EVALUATION_TYPE=url_match
   *
   * EVAL_OSWORLD_LIMIT - Maximum number of tasks to run
   *   Default: 25
   *   Example: EVAL_OSWORLD_LIMIT=10
   *
   * EVAL_OSWORLD_SAMPLE - Random sample size before applying limit
   *   Optional: If set, randomly samples this many tasks before applying limit
   *   Example: EVAL_OSWORLD_SAMPLE=50 EVAL_OSWORLD_LIMIT=10
   *
   * EVAL_OSWORLD_TIMEOUT - Timeout per task in milliseconds
   *   Default: 60000 (60 seconds)
   *   Example: EVAL_OSWORLD_TIMEOUT=120000
   *
   * EVAL_MAX_K - Global override for all benchmark limits
   *   Overrides EVAL_OSWORLD_LIMIT if set
   *   Example: EVAL_MAX_K=5
   */

  // Read environment variables
  const sourceFilter = process.env.EVAL_OSWORLD_SOURCE;
  const evaluationTypeFilter = process.env.EVAL_OSWORLD_EVALUATION_TYPE as
    | "url_match"
    | "string_match"
    | "dom_state"
    | "custom"
    | undefined;
  const maxCases = process.env.EVAL_MAX_K
    ? Number(process.env.EVAL_MAX_K)
    : process.env.EVAL_OSWORLD_LIMIT
      ? Number(process.env.EVAL_OSWORLD_LIMIT)
      : 25;
  const sampleCount = process.env.EVAL_OSWORLD_SAMPLE
    ? Number(process.env.EVAL_OSWORLD_SAMPLE)
    : undefined;
  const timeout = process.env.EVAL_OSWORLD_TIMEOUT
    ? Number(process.env.EVAL_OSWORLD_TIMEOUT)
    : 60000;

  // Apply filters
  let filteredTasks = [...osworldDataset];

  if (sourceFilter) {
    filteredTasks = filteredTasks.filter((task) =>
      task.source.toLowerCase().includes(sourceFilter.toLowerCase()),
    );
  }

  if (evaluationTypeFilter) {
    filteredTasks = filteredTasks.filter(
      (task) => task.evaluationType === evaluationTypeFilter,
    );
  }

  // Override timeout if specified
  if (timeout !== 60000) {
    filteredTasks = filteredTasks.map((task) => ({
      ...task,
      timeout,
    }));
  }

  // Apply sampling
  const sampledTasks = applySampling(filteredTasks, sampleCount, maxCases);

  console.log(
    `OSWorld Suite: Using ${sampledTasks.length} tasks from ${osworldDataset.length} total`,
  );
  console.log("Task distribution:", {
    byEvaluationType: sampledTasks.reduce(
      (acc, task) => {
        acc[task.evaluationType] = (acc[task.evaluationType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    bySource: sampledTasks.reduce(
      (acc, task) => {
        acc[task.source] = (acc[task.source] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  });

  // Generate testcases
  const allTestcases: Testcase[] = [];
  for (const model of models) {
    for (const task of sampledTasks) {
      const input: EvalInput = {
        name: "agent/osworld",
        modelName: model as AvailableModel,
        params: task as unknown as Record<string, unknown>,
      };

      // Extract domain from start URL for tagging
      let domain = "unknown";
      if (task.startUrl) {
        try {
          domain = new URL(task.startUrl).hostname.replace("www.", "");
        } catch {
          // Keep as unknown if URL parsing fails
        }
      }

      allTestcases.push({
        input,
        name: input.name,
        tags: [
          model,
          input.name,
          ...(
            tasksConfig.find((t) => t.name === input.name)?.categories || []
          ).map((x) => `category/${x}`),
          `osworld/id/${task.id}`,
          `osworld/source/${task.source}`,
          `osworld/evaluation_type/${task.evaluationType}`,
          `osworld/domain/${domain}`,
          task.requiresProxy
            ? "osworld/proxy/required"
            : "osworld/proxy/not_required",
        ],
        metadata: {
          model: model as AvailableModel,
          test: `${input.name}:${task.id}`,
        },
        expected: true,
      });
    }
  }

  return allTestcases;
};
