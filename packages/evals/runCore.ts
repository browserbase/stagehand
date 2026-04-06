/**
 * Entry point for running core tier (deterministic) tasks.
 *
 * Invoked by cli.ts when the target resolves to core tasks.
 * Uses the framework runner with Braintrust for tracing.
 *
 * Usage: tsx runCore.ts [options as env vars]
 *
 * Env vars read:
 *   EVAL_CORE_TARGET  — target string (e.g., "core", "core:navigation", "navigation")
 *   EVAL_ENV          — "LOCAL" or "BROWSERBASE"
 *   EVAL_TRIAL_COUNT  — number of trials
 *   EVAL_MAX_CONCURRENCY — max parallel sessions
 */

import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

import { discoverTasks, resolveTarget } from "./framework/discovery.js";
import { buildCoreContext } from "./framework/context.js";
import { AssertionError } from "./framework/assertions.js";
import { EvalLogger } from "./logger.js";
import { endBrowserbaseSession } from "./browserbaseCleanup.js";
import { generateExperimentName } from "./utils.js";
import { env } from "./env.js";
import { getCurrentDirPath } from "./runtimePaths.js";
import type { CoreTaskContext, TaskDefinition, DiscoveredTask } from "./framework/types.js";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { Eval } from "braintrust";
import { pathToFileURL } from "node:url";

const moduleDir = getCurrentDirPath();
const tasksRoot = path.join(moduleDir, "tasks");

const target = process.env.EVAL_CORE_TARGET || "core";
const MAX_CONCURRENCY = process.env.EVAL_MAX_CONCURRENCY
  ? parseInt(process.env.EVAL_MAX_CONCURRENCY, 10)
  : 3;
const TRIAL_COUNT = process.env.EVAL_TRIAL_COUNT
  ? parseInt(process.env.EVAL_TRIAL_COUNT, 10)
  : 3;

interface CoreTestcase {
  input: { name: string; modelName: AvailableModel };
  name: string;
  tags: string[];
  metadata: { model: AvailableModel; test: string; categories?: string[] };
  expected: unknown;
}

async function loadCoreTaskFn(
  task: DiscoveredTask,
): Promise<TaskDefinition["fn"] | null> {
  const moduleUrl = pathToFileURL(task.filePath).href;
  const mod = await import(moduleUrl);

  const defaultExport = mod.default;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return defaultExport.fn;
  }

  // Legacy named export fallback
  const baseName = task.name.includes("/")
    ? task.name.split("/").pop()!
    : task.name;
  if (typeof mod[baseName] === "function") {
    return mod[baseName];
  }

  return null;
}

(async () => {
  const registry = await discoverTasks(tasksRoot, false);

  let tasks: DiscoveredTask[];
  try {
    tasks = resolveTarget(registry, target);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Filter to core tier only
  tasks = tasks.filter((t) => t.tier === "core");

  if (tasks.length === 0) {
    console.log("No core tasks match the given target.");
    process.exit(0);
  }

  console.log(`Running ${tasks.length} core task(s) with concurrency=${MAX_CONCURRENCY}, trials=${TRIAL_COUNT}`);

  const experimentName = generateExperimentName({
    evalName: tasks.length === 1 ? tasks[0].name : undefined,
    category: target !== "core" ? target : undefined,
    environment: env,
  });

  const braintrustProjectName =
    process.env.CI === "true" ? "stagehand" : "stagehand-dev";

  const testcases: CoreTestcase[] = tasks.map((task) => ({
    input: {
      name: task.name,
      modelName: "none" as AvailableModel,
    },
    name: task.name,
    tags: ["core", task.primaryCategory, ...task.tags],
    metadata: {
      model: "none" as AvailableModel,
      test: task.name,
      categories: task.categories,
    },
    expected: true,
  }));

  try {
    const evalResult = await Eval(braintrustProjectName, {
      experimentName,
      data: () => testcases,
      task: async (input: { name: string; modelName: AvailableModel }) => {
        const task = registry.byName.get(input.name);
        if (!task) {
          return { _success: false, error: `Task "${input.name}" not found` };
        }

        const logger = new EvalLogger();
        const { ctx, v3Result } = await buildCoreContext({ logger });

        try {
          const fn = await loadCoreTaskFn(task);
          if (!fn) {
            return {
              _success: false,
              error: `No task function found in ${task.filePath}`,
              logs: logger.getLogs(),
            };
          }

          await (fn as (ctx: CoreTaskContext) => Promise<void>)(ctx);

          // If we get here without throwing, the task passed
          console.log(`✅ ${input.name}: Passed`);
          return {
            _success: true,
            logs: logger.getLogs(),
            metrics: ctx.metrics.getSummary(),
          };
        } catch (error) {
          const message =
            error instanceof AssertionError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error);

          console.log(`❌ ${input.name}: Failed — ${message}`);
          return {
            _success: false,
            error: message,
            logs: logger.getLogs(),
          };
        } finally {
          try {
            await v3Result.v3.close();
          } catch {
            // best-effort
          }
          await endBrowserbaseSession(v3Result.v3);
          logger.clear();
        }
      },
      scores: [
        (args: { output: any }) => ({
          name: "Pass",
          score: args.output?._success ? 1 : 0,
        }),
      ],
      maxConcurrency: MAX_CONCURRENCY,
      trialCount: TRIAL_COUNT,
    });

    const passed = evalResult.results.filter(
      (r: any) => r.output?._success,
    ).length;
    const failed = evalResult.results.length - passed;
    console.log(
      `\nResults: ${passed} passed, ${failed} failed (${evalResult.results.length} total)`,
    );
    console.log(`Experiment: ${experimentName}`);
  } catch (error) {
    console.error("Error during core eval run:", error);
    process.exit(1);
  }
})();
