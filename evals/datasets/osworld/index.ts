import { osworldAdapter } from "./adapter";
import type { OSWorldStagehandTask } from "./types";

// Load and convert all OSWorld Chrome tasks
export const osworldDataset: OSWorldStagehandTask[] =
  osworldAdapter.convertAllTasks();

// Export types and utilities
export * from "./types";
export { osworldAdapter } from "./adapter";

// Dataset stats
export const osworldStats = {
  totalTasks: osworldDataset.length,
  tasksByEvaluationType: osworldDataset.reduce(
    (acc, task) => {
      acc[task.evaluationType] = (acc[task.evaluationType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  ),
  tasksBySource: osworldDataset.reduce(
    (acc, task) => {
      acc[task.source] = (acc[task.source] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  ),
};
