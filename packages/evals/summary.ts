import fs from "fs";
import path from "path";
import { tasksByName } from "./taskConfig.js";
import type { SummaryResult } from "./types/evals.js";
import { getRepoRootDir } from "./runtimePaths.js";

const repoRoot = getRepoRootDir();

export const generateSummary = async (
  results: SummaryResult[],
  experimentName: string,
  experimentUrl?: string,
  scores?: Record<string, unknown>,
) => {
  const getTaskBasename = (taskName: string): string => {
    if (!taskName.includes("/")) return taskName;
    const parts = taskName.split("/");
    return parts[parts.length - 1] ?? taskName;
  };

  const resolveCategories = (taskName: string): string[] => {
    const configured = tasksByName[taskName]?.categories;
    if (configured) return configured;

    const taskCategory = taskName.includes("/")
      ? taskName.split("/")[0]
      : undefined;
    const basenameConfigured =
      tasksByName[getTaskBasename(taskName)]?.categories;
    if (
      basenameConfigured &&
      (!taskCategory || basenameConfigured.includes(taskCategory))
    ) {
      return basenameConfigured;
    }

    return taskName.includes("/") ? [taskName.split("/")[0]] : [];
  };

  const resolveResultCategories = (result: SummaryResult): string[] => {
    const resultCategories = result.categories ?? [];
    return resultCategories.length > 0
      ? resultCategories
      : resolveCategories(result.input.name);
  };

  // Normalize a failed task's error/message to a string so the exact failure is
  // captured in the JSON (the TUI only shows a truncated cell). Capped to keep
  // the summary bounded while still useful for debugging.
  const resolveError = (result: SummaryResult): string | undefined => {
    const raw = result.output.error ?? result.output.message;
    if (raw == null) return undefined;
    let text: string;
    if (typeof raw === "string") {
      text = raw;
    } else if (raw instanceof Error) {
      text = raw.stack ?? raw.message;
    } else if (
      typeof raw === "object" &&
      typeof (raw as { message?: unknown }).message === "string"
    ) {
      text = (raw as { message: string }).message;
    } else {
      try {
        text = JSON.stringify(raw);
      } catch {
        text = String(raw);
      }
    }
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  };

  const passed = results
    .filter((r) => r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: resolveResultCategories(r),
    }));

  const failed = results
    .filter((r) => !r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: resolveResultCategories(r),
      error: resolveError(r),
    }));

  const categorySuccessCounts: Record<
    string,
    { total: number; success: number }
  > = {};
  for (const result of results) {
    for (const cat of resolveResultCategories(result)) {
      if (!categorySuccessCounts[cat]) {
        categorySuccessCounts[cat] = { total: 0, success: 0 };
      }
      categorySuccessCounts[cat].total += 1;
      categorySuccessCounts[cat].success += result.output._success ? 1 : 0;
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
    ...(experimentUrl && { experimentUrl }),
    ...(scores && { scores }),
    passed,
    failed,
    categories,
    models,
  };

  const summaryPath = `${repoRoot}/eval-summary.json`;
  fs.writeFileSync(summaryPath, JSON.stringify(formattedSummary, null, 2));
  console.log(`Summary JSON: ${path.relative(repoRoot, summaryPath)}`);
};
