/**
 * Entry point for running core tier (deterministic) tasks.
 *
 * Invoked by cli.ts when the target resolves to core tasks.
 * Delegates to the shared framework runner so core and bench use the same
 * Braintrust execution path.
 */

import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { discoverTasks, resolveTarget, runEvals } from "./framework/runner.js";
import { resolveDefaultCoreStartupProfile } from "./framework/context.js";
import { env } from "./env.js";
import { getCurrentDirPath } from "./runtimePaths.js";
import type { StartupProfile, ToolSurface } from "./core/contracts/tool.js";

const moduleDir = getCurrentDirPath();
const tasksRoot = path.join(moduleDir, "tasks");

const target = process.env.EVAL_CORE_TARGET || "core";
const MAX_CONCURRENCY = process.env.EVAL_MAX_CONCURRENCY
  ? parseInt(process.env.EVAL_MAX_CONCURRENCY, 10)
  : 3;
const TRIAL_COUNT = process.env.EVAL_TRIAL_COUNT
  ? parseInt(process.env.EVAL_TRIAL_COUNT, 10)
  : 3;
const TOOL_SURFACE =
  (process.env.EVAL_TOOL_SURFACE as ToolSurface | undefined) ??
  "understudy_code";
const STARTUP_PROFILE = (process.env.EVAL_STARTUP_PROFILE as
  | StartupProfile
  | undefined) ?? resolveDefaultCoreStartupProfile(TOOL_SURFACE, env);

function resolveCoreCategoryFilter(coreTarget: string): string | undefined {
  if (coreTarget === "core") return undefined;
  if (coreTarget.startsWith("core:")) {
    return coreTarget.split(":", 2)[1];
  }
  return coreTarget.includes("/") ? undefined : coreTarget;
}

(async () => {
  const registry = await discoverTasks(tasksRoot, false);

  let tasks;
  try {
    tasks = resolveTarget(registry, target).filter((task) => task.tier === "core");
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }

  if (tasks.length === 0) {
    console.log("No core tasks match the given target.");
    process.exit(0);
  }

  try {
    const result = await runEvals({
      tasks,
      registry,
      concurrency: MAX_CONCURRENCY,
      trials: TRIAL_COUNT,
      environment: env,
      categoryFilter: resolveCoreCategoryFilter(target),
      coreToolSurface: TOOL_SURFACE,
      coreStartupProfile: STARTUP_PROFILE,
    });

    console.log(
      `\nResults: ${result.summary.passed} passed, ${result.summary.failed} failed (${result.summary.total} total)`,
    );
    console.log(`Experiment: ${result.experimentName}`);
  } catch (error) {
    console.error("Error during core eval run:", error);
    process.exit(1);
  }
})();
