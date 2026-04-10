/**
 * Entry point for running bench tier tasks via the framework runner.
 *
 * Invoked by cli.ts when --new-runner flag is passed.
 * Replaces the legacy index.eval.ts execution path.
 *
 * Env vars read:
 *   EVAL_BENCH_TARGET     — target string (category, eval name, or "all")
 *   EVAL_ENV              — "LOCAL" or "BROWSERBASE"
 *   EVAL_TRIAL_COUNT      — number of trials
 *   EVAL_MAX_CONCURRENCY  — max parallel sessions
 *   USE_API               — use Stagehand API mode
 *   EVAL_PROVIDER         — LLM provider filter
 *   EVAL_MODEL_OVERRIDE   — single model override
 *   EVAL_DATASET          — dataset filter for benchmarks
 */

import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { discoverTasks, resolveTarget } from "./framework/discovery.js";
import { runEvals } from "./framework/runner.js";
import { env } from "./env.js";
import { getCurrentDirPath } from "./runtimePaths.js";

const moduleDir = getCurrentDirPath();
const tasksRoot = path.join(moduleDir, "tasks");

const target = process.env.EVAL_BENCH_TARGET || undefined;
const MAX_CONCURRENCY = process.env.EVAL_MAX_CONCURRENCY
  ? parseInt(process.env.EVAL_MAX_CONCURRENCY, 10)
  : 3;
const TRIAL_COUNT = process.env.EVAL_TRIAL_COUNT
  ? parseInt(process.env.EVAL_TRIAL_COUNT, 10)
  : 3;
const USE_API = (process.env.USE_API ?? "").toLowerCase() === "true";

function resolveBenchCategoryFilter(
  benchTarget?: string,
): string | undefined {
  if (!benchTarget || benchTarget === "all") return undefined;
  if (benchTarget.includes("/") || benchTarget.includes("*")) return undefined;
  return benchTarget;
}

(async () => {
  const registry = await discoverTasks(tasksRoot, false);

  let tasks;
  try {
    tasks = resolveTarget(registry, target);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Filter to bench tier only
  tasks = tasks.filter((t) => t.tier === "bench");

  if (tasks.length === 0) {
    console.log("No bench tasks match the given target.");
    process.exit(0);
  }

  console.log(`Running ${tasks.length} bench task(s) with concurrency=${MAX_CONCURRENCY}, trials=${TRIAL_COUNT}`);

  try {
    const result = await runEvals({
      tasks,
      registry,
      concurrency: MAX_CONCURRENCY,
      trials: TRIAL_COUNT,
      environment: env,
      useApi: USE_API,
      provider: process.env.EVAL_PROVIDER,
      modelOverride: process.env.EVAL_MODEL_OVERRIDE,
      datasetFilter: process.env.EVAL_DATASET,
      categoryFilter: resolveBenchCategoryFilter(target),
    });

    console.log(
      `\nResults: ${result.summary.passed} passed, ${result.summary.failed} failed (${result.summary.total} total)`,
    );
    console.log(`Experiment: ${result.experimentName}`);
  } catch (error) {
    console.error("Error during bench eval run:", error);
    process.exit(1);
  }
})();
