import fs from "fs";
import path from "path";
import { tasksByName } from "./taskConfig.js";
import type { SummaryResult } from "./types/evals.js";
import { getRepoRootDir } from "./runtimePaths.js";

const repoRoot = getRepoRootDir();

export const generateSummary = async (
  results: SummaryResult[],
  experimentName: string,
) => {
  const resolveCategories = (taskName: string): string[] => {
    const configured = tasksByName[taskName]?.categories;
    if (configured) return configured;
    return taskName.includes("/") ? [taskName.split("/")[0]] : [];
  };

  const passed = results
    .filter((r) => r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: resolveCategories(r.input.name),
    }));

  const failed = results
    .filter((r) => !r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: resolveCategories(r.input.name),
    }));

  const categorySuccessCounts: Record<
    string,
    { total: number; success: number }
  > = {};
  const taskNames = [...new Set(results.map((r) => r.input.name))];
  for (const taskName of taskNames) {
    const taskCategories = resolveCategories(taskName);
    const taskResults = results.filter((r) => r.input.name === taskName);
    const successCount = taskResults.filter((r) => r.output._success).length;

    for (const cat of taskCategories) {
      if (!categorySuccessCounts[cat]) {
        categorySuccessCounts[cat] = { total: 0, success: 0 };
      }
      categorySuccessCounts[cat].total += taskResults.length;
      categorySuccessCounts[cat].success += successCount;
    }
  }

  const categories: Record<string, number> = {};
  for (const [cat, counts] of Object.entries(categorySuccessCounts)) {
    categories[cat] = Math.round((counts.success / counts.total) * 100);
  }

  const models: Record<string, number> = {};
  const allModels = [...new Set(results.map((r) => r.input.modelName))];
  for (const model of allModels) {
    const modelResults = results.filter((r) => r.input.modelName === model);
    const successCount = modelResults.filter((r) => r.output._success).length;
    models[model] = Math.round((successCount / modelResults.length) * 100);
  }

  const formattedSummary = {
    experimentName,
    passed,
    failed,
    categories,
    models,
  };

  const summaryPath = `${repoRoot}/eval-summary.json`;
  fs.writeFileSync(summaryPath, JSON.stringify(formattedSummary, null, 2));
  console.log(`Summary JSON: ${path.relative(repoRoot, summaryPath)}`);
};
