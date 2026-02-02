import fs from "fs";
import { tasksByName } from "./taskConfig";
import type { SummaryResult, EvalMetrics } from "./types/evals";

export const generateSummary = async (
  results: SummaryResult[],
  experimentName: string,
) => {
  const passed = results
    .filter((r) => r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: tasksByName[r.input.name]?.categories ?? [],
      metrics: r.output.metrics,
    }));

  const failed = results
    .filter((r) => !r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: tasksByName[r.input.name]?.categories ?? [],
      metrics: r.output.metrics,
    }));

  const categorySuccessCounts: Record<
    string,
    { total: number; success: number }
  > = {};
  for (const taskName of Object.keys(tasksByName)) {
    const taskCategories = tasksByName[taskName].categories;
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

  // Aggregate token and runtime metrics
  const aggregateMetrics = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    totalRuntimeMs: 0,
    totalEvalRuntimeMs: 0,
    evalCount: 0,
  };

  for (const result of results) {
    const metrics = result.output.metrics;
    if (metrics) {
      aggregateMetrics.totalInputTokens += metrics.inputTokens ?? 0;
      aggregateMetrics.totalOutputTokens += metrics.outputTokens ?? 0;
      aggregateMetrics.totalCostUsd += metrics.costUsd ?? 0;
      aggregateMetrics.totalRuntimeMs += metrics.durationMs ?? 0;
      aggregateMetrics.totalEvalRuntimeMs += metrics.totalEvalRuntimeMs ?? 0;
      aggregateMetrics.evalCount++;
    }
  }
  aggregateMetrics.totalTokens = aggregateMetrics.totalInputTokens + aggregateMetrics.totalOutputTokens;

  // Log aggregate metrics to console
  if (aggregateMetrics.evalCount > 0) {
    console.log("\n=== Aggregate Metrics ===");
    console.log(`Total evals with metrics: ${aggregateMetrics.evalCount}`);
    console.log(`Total input tokens: ${aggregateMetrics.totalInputTokens.toLocaleString()}`);
    console.log(`Total output tokens: ${aggregateMetrics.totalOutputTokens.toLocaleString()}`);
    console.log(`Total tokens: ${aggregateMetrics.totalTokens.toLocaleString()}`);
    console.log(`Total cost: $${aggregateMetrics.totalCostUsd.toFixed(4)}`);
    console.log(`Total agent runtime: ${(aggregateMetrics.totalRuntimeMs / 1000).toFixed(2)}s`);
    console.log(`Total eval runtime: ${(aggregateMetrics.totalEvalRuntimeMs / 1000).toFixed(2)}s`);
    console.log("=========================\n");
  }

  const formattedSummary = {
    experimentName,
    passed,
    failed,
    categories,
    models,
    aggregateMetrics,
  };

  fs.writeFileSync(
    "../../eval-summary.json",
    JSON.stringify(formattedSummary, null, 2),
  );
  console.log("Evaluation summary written to ../../eval-summary.json");
};
