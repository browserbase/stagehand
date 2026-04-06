/**
 * Unified multi-tier eval runner.
 *
 * Wraps Braintrust Eval() to support both:
 *   - Core tier: deterministic tasks, no model matrix, assertion-based scoring
 *   - Bench tier: agent benchmarks, model × task matrix, exactMatch scoring
 *
 * This module replaces the monolithic task execution logic in index.eval.ts
 * while preserving backward compatibility with legacy EvalFunction tasks.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Eval } from "braintrust";
import type {
  AvailableModel,
  LLMClient,
  LogLine,
} from "@browserbasehq/stagehand";
import {
  StagehandEvalError,
  AgentProvider,
  loadApiKeyFromEnv,
  getAISDKLanguageModel,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import type {
  DiscoveredTask,
  TaskRegistry,
  Tier,
  TaskDefinition,
  TaskResult,
  CoreTaskContext,
  BenchTaskContext,
} from "./types.js";
import {
  buildCoreContext,
  buildBenchContext,
} from "./context.js";
import { AssertionError } from "./assertions.js";
import { EvalLogger } from "../logger.js";
import { env } from "../env.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { exactMatch, errorMatch } from "../scoring.js";
import { generateExperimentName } from "../utils.js";
import { generateSummary } from "../summary.js";
import {
  getModelList,
  getAgentModelEntries,
} from "../taskConfig.js";
import type { SummaryResult, EvalInput, Testcase } from "../types/evals.js";

// Re-export for convenience
export { discoverTasks, resolveTarget } from "./discovery.js";

// ---------------------------------------------------------------------------
// Suite builders (existing benchmarks)
// ---------------------------------------------------------------------------

import { buildGAIATestcases } from "../suites/gaia.js";
import { buildWebVoyagerTestcases } from "../suites/webvoyager.js";
import { buildOnlineMind2WebTestcases } from "../suites/onlineMind2Web.js";
import { buildWebTailBenchTestcases } from "../suites/webtailbench.js";

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Tasks to run (from resolveTarget). */
  tasks: DiscoveredTask[];
  /** The full registry (for summary generation). */
  registry: TaskRegistry;
  /** Max parallel browser sessions. */
  concurrency?: number;
  /** Number of trials per task. */
  trials?: number;
  /** Target environment. */
  environment?: "LOCAL" | "BROWSERBASE";
  /** Use Stagehand API mode. */
  useApi?: boolean;
  /** Provider filter. */
  provider?: string;
  /** Model override (single model). */
  modelOverride?: string;
  /** Category filter (for model selection). */
  categoryFilter?: string;
  /** Dataset filter for benchmarks. */
  datasetFilter?: string;
  /** Callback for real-time progress updates. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  type: "started" | "passed" | "failed" | "error";
  taskName: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
}

export interface RunResult {
  experimentName: string;
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  results: SummaryResult[];
}

// ---------------------------------------------------------------------------
// Testcase generation
// ---------------------------------------------------------------------------

function generateTestcases(
  tasks: DiscoveredTask[],
  options: RunOptions,
): Testcase[] {
  const coreTasks = tasks.filter((t) => t.tier === "core");
  const benchTasks = tasks.filter((t) => t.tier === "bench");

  let allTestcases: Testcase[] = [];

  // Core tier: no model matrix, single testcase per task
  for (const task of coreTasks) {
    allTestcases.push({
      input: {
        name: task.name,
        modelName: "none" as AvailableModel, // core tasks don't use a model
      },
      name: task.name,
      tags: ["core", task.primaryCategory, ...task.tags],
      metadata: {
        model: "none" as AvailableModel,
        test: task.name,
        categories: task.categories,
        task_category: task.primaryCategory,
      },
      expected: true,
    });
  }

  // Bench tier: model × task matrix
  if (benchTasks.length > 0) {
    // Determine effective category for model selection
    const effectiveCategory = options.categoryFilter ?? null;

    // Handle suite/benchmark tasks that fan out from datasets
    const suiteTestcases = generateSuiteTestcases(benchTasks, options);
    allTestcases.push(...suiteTestcases.testcases);
    const remainingBenchTasks = suiteTestcases.remainingTasks;

    // Determine models
    const isAgentCategory =
      effectiveCategory === "agent" ||
      effectiveCategory === "external_agent_benchmarks";

    const currentModels = options.modelOverride
      ? [options.modelOverride]
      : getModelList(effectiveCategory);

    const modelEntries = isAgentCategory
      ? getAgentModelEntries()
      : currentModels.map((m) => ({ modelName: m, cua: false }));

    for (const entry of modelEntries) {
      for (const task of remainingBenchTasks) {
        allTestcases.push({
          input: {
            name: task.name,
            modelName: entry.modelName as AvailableModel,
            ...(isAgentCategory && { isCUA: entry.cua }),
          },
          name: task.name,
          tags: [
            entry.modelName,
            ...(isAgentCategory ? [entry.cua ? "cua" : "agent"] : []),
            task.name,
            ...task.categories.map((x) => `category/${x}`),
          ],
          metadata: {
            model: entry.modelName as AvailableModel,
            test: task.name,
            categories: task.categories,
            task_category: task.primaryCategory,
          },
          expected: true,
        });
      }
    }
  }

  // Filter out tasks not suitable for Browserbase
  if (options.environment === "BROWSERBASE") {
    allTestcases = allTestcases.filter(
      (tc) => !["peeler_simple", "stock_x"].includes(tc.name),
    );
  }

  return allTestcases;
}

/**
 * Handle suite/benchmark tasks that fan out from datasets (GAIA, WebVoyager, etc.)
 */
function generateSuiteTestcases(
  benchTasks: DiscoveredTask[],
  options: RunOptions,
): { testcases: Testcase[]; remainingTasks: DiscoveredTask[] } {
  const testcases: Testcase[] = [];
  const remaining = [...benchTasks];
  const datasetFilter = options.datasetFilter;

  const currentModels = options.modelOverride
    ? [options.modelOverride]
    : getModelList(options.categoryFilter ?? undefined);

  const suiteMap: Record<string, (models: string[]) => Testcase[]> = {
    "agent/gaia": (models) => buildGAIATestcases(models),
    "agent/webvoyager": (models) => buildWebVoyagerTestcases(models),
    "agent/onlineMind2Web": (models) => buildOnlineMind2WebTestcases(models),
    "agent/webtailbench": (models) => buildWebTailBenchTestcases(models),
  };

  for (const [suiteName, builder] of Object.entries(suiteMap)) {
    const idx = remaining.findIndex((t) => t.name === suiteName);
    if (idx === -1) continue;

    const datasetName = suiteName.split("/").pop()!;
    if (!datasetFilter || datasetFilter === datasetName) {
      testcases.push(...builder(currentModels));
    }
    remaining.splice(idx, 1);
  }

  return { testcases, remainingTasks: remaining };
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

async function executeTask(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunOptions,
): Promise<TaskResult> {
  if (task.tier === "core") {
    return executeCoreTask(input, task, options);
  } else {
    return executeBenchTask(input, task, options);
  }
}

async function executeCoreTask(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunOptions,
): Promise<TaskResult> {
  const logger = new EvalLogger();
  const { buildCoreContext: buildCtx } = await import("./context.js");
  const { ctx, v3Result } = await buildCtx({ logger });

  try {
    // Load the task module
    const taskModule = await loadTaskModuleFromPath(task.filePath, task.name);

    if (taskModule.definition) {
      // New defineTask API
      await (taskModule.definition.fn as (ctx: CoreTaskContext) => Promise<void>)(ctx);

      // If we get here without throwing, the task passed
      return {
        _success: true,
        logs: logger.getLogs(),
      };
    } else if (taskModule.legacyFn) {
      // Legacy EvalFunction — shouldn't normally be in core/, but handle gracefully
      const result = await taskModule.legacyFn({
        v3: v3Result.v3,
        logger,
        debugUrl: v3Result.debugUrl ?? "",
        sessionUrl: v3Result.sessionUrl ?? "",
        modelName: input.modelName,
        agent: v3Result.agent,
        input,
      });
      return result;
    }

    throw new StagehandEvalError(`No valid task export found in ${task.filePath}`);
  } catch (error) {
    if (error instanceof AssertionError) {
      return {
        _success: false,
        error: error.message,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      error: error instanceof Error ? error.message : String(error),
      logs: logger.getLogs(),
    };
  } finally {
    try {
      await v3Result.v3.close();
    } catch {
      // best-effort cleanup
    }
    await endBrowserbaseSession(v3Result.v3);
    logger.clear();
  }
}

async function executeBenchTask(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunOptions,
): Promise<TaskResult> {
  const logger = new EvalLogger();
  const useApi = options.useApi ?? false;
  let v3Result: Awaited<ReturnType<typeof import("../initV3.js").initV3>> | undefined;

  try {
    const isAgentTask =
      task.primaryCategory === "agent" ||
      task.categories.includes("agent") ||
      task.categories.includes("external_agent_benchmarks");

    // Build context (same logic as existing index.eval.ts)
    if (useApi) {
      let provider: string;
      if (input.modelName.includes("/")) {
        provider = input.modelName.split("/")[0];
      } else {
        try {
          provider = AgentProvider.getAgentProvider(input.modelName);
        } catch {
          provider = undefined as unknown as string;
        }
      }

      const logFn = (line: LogLine): void => logger.log(line);
      const apiKey = loadApiKeyFromEnv(provider, logFn);

      if (!apiKey) {
        throw new StagehandEvalError(
          `USE_API=true but no API key found for provider "${provider}".`,
        );
      }

      const { initV3 } = await import("../initV3.js");
      v3Result = await initV3({
        logger,
        modelName: input.modelName,
        modelClientOptions: { apiKey },
        createAgent: isAgentTask,
        isCUA: input.isCUA,
      });
    } else {
      let llmClient: LLMClient | undefined;
      if (input.modelName.includes("/")) {
        const firstSlashIndex = input.modelName.indexOf("/");
        llmClient = new AISdkClientWrapped({
          model: getAISDKLanguageModel(
            input.modelName.substring(0, firstSlashIndex),
            input.modelName.substring(firstSlashIndex + 1),
          ),
        });
      }

      const { initV3 } = await import("../initV3.js");
      v3Result = await initV3({
        logger,
        llmClient,
        modelName: input.modelName,
        createAgent: isAgentTask,
        isCUA: input.isCUA,
      });
    }

    // Load and execute the task
    const taskModule = await loadTaskModuleFromPath(task.filePath, task.name);

    if (taskModule.definition) {
      // New defineTask API for bench tasks
      const ctx: BenchTaskContext = {
        v3: v3Result.v3,
        agent: v3Result.agent,
        page: v3Result.v3.context.pages()[0],
        logger,
        input,
        modelName: input.modelName,
        debugUrl: v3Result.debugUrl ?? "",
        sessionUrl: v3Result.sessionUrl ?? "",
      };

      const result = await (
        taskModule.definition.fn as (ctx: BenchTaskContext) => Promise<TaskResult>
      )(ctx);
      return result;
    } else if (taskModule.legacyFn) {
      // Legacy EvalFunction
      const result = await taskModule.legacyFn({
        v3: v3Result.v3,
        logger,
        debugUrl: v3Result.debugUrl ?? "",
        sessionUrl: v3Result.sessionUrl ?? "",
        modelName: input.modelName,
        agent: v3Result.agent,
        input,
      });
      return result;
    }

    throw new StagehandEvalError(`No valid task export found in ${task.filePath}`);
  } catch (error) {
    console.error(`Error in ${input.name}: ${error}`);
    logger.error({
      message: `Error in task ${input.name}`,
      level: 0,
      auxiliary: {
        error: {
          value: error instanceof Error ? error.message : String(error),
          type: "string",
        },
        trace: {
          value: error instanceof Error ? (error.stack ?? "") : "",
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error:
        error instanceof Error
          ? JSON.parse(JSON.stringify(error, null, 2))
          : String(error),
      logs: logger.getLogs(),
    };
  } finally {
    if (v3Result?.v3) {
      try {
        await v3Result.v3.close();
      } catch (closeError) {
        console.error(
          `Warning: Error closing V3 instance for ${input.name}:`,
          closeError,
        );
      }
    }
    await endBrowserbaseSession(v3Result?.v3);
    logger.clear();
  }
}

// ---------------------------------------------------------------------------
// Module loading helper
// ---------------------------------------------------------------------------

interface LoadedTaskModule {
  definition?: TaskDefinition;
  legacyFn?: (...args: unknown[]) => Promise<TaskResult>;
}

async function loadTaskModuleFromPath(
  filePath: string,
  taskName: string,
): Promise<LoadedTaskModule> {
  if (!fs.existsSync(filePath)) {
    throw new StagehandEvalError(`Task module not found: ${filePath}`);
  }

  const moduleUrl = pathToFileURL(filePath).href;
  const taskModule = await import(moduleUrl);

  // New defineTask API
  const defaultExport = taskModule.default;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return { definition: defaultExport };
  }

  // Legacy named export
  const baseName = taskName.includes("/")
    ? taskName.split("/").pop()!
    : taskName;

  if (typeof taskModule[baseName] === "function") {
    return { legacyFn: taskModule[baseName] };
  }

  throw new StagehandEvalError(
    `No task function found for "${taskName}" in ${filePath}. ` +
      `Expected either a default defineTask() export or a named export "${baseName}".`,
  );
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runEvals(options: RunOptions): Promise<RunResult> {
  const concurrency = options.concurrency ?? 3;
  const trials = options.trials ?? 3;
  const environment = options.environment ?? "LOCAL";

  // Generate testcases
  const testcases = generateTestcases(options.tasks, options);

  if (testcases.length === 0) {
    console.log("No testcases to run.");
    return {
      experimentName: "empty",
      summary: { passed: 0, failed: 0, total: 0 },
      results: [],
    };
  }

  console.log(`Running ${testcases.length} testcase(s) with concurrency=${concurrency}, trials=${trials}`);

  // Determine experiment name
  const experimentName = generateExperimentName({
    evalName: options.tasks.length === 1 ? options.tasks[0].name : undefined,
    category: options.categoryFilter ?? undefined,
    environment,
  });

  const braintrustProjectName =
    process.env.CI === "true" ? "stagehand" : "stagehand-dev";

  // Run via Braintrust
  const evalResult = await Eval(braintrustProjectName, {
    experimentName,
    data: () => testcases,
    task: async (input: EvalInput) => {
      const task = options.registry.byName.get(input.name);
      if (!task) {
        // For suite-generated testcases (GAIA, WebVoyager, etc.),
        // the name might be the original suite task name
        const baseName = input.name.includes("/")
          ? input.name
          : `agent/${input.name}`;
        const suiteTask = options.registry.byName.get(baseName);
        if (!suiteTask) {
          throw new StagehandEvalError(
            `Task "${input.name}" not found in registry.`,
          );
        }
        const result = await executeTask(input, suiteTask, options);
        options.onProgress?.({
          type: result._success ? "passed" : "failed",
          taskName: input.name,
          modelName: input.modelName,
        });
        return result;
      }

      const result = await executeTask(input, task, options);

      // Progress callback
      options.onProgress?.({
        type: result._success ? "passed" : "failed",
        taskName: input.name,
        modelName: input.modelName,
      });

      if (result._success) {
        console.log(`✅ ${input.name}: Passed`);
      } else {
        console.log(`❌ ${input.name}: Failed`);
      }

      return result;
    },
    scores: [exactMatch, errorMatch],
    maxConcurrency: concurrency,
    trialCount: trials,
  });

  // Map results to summary format
  const summaryResults: SummaryResult[] = evalResult.results.map((result) => {
    const output =
      typeof result.output === "boolean"
        ? { _success: result.output }
        : result.output;

    return {
      input: result.input,
      output,
      name: result.input.name,
      score: output._success ? 1 : 0,
    };
  });

  // Generate and write summary
  await generateSummary(summaryResults, experimentName);

  const passed = summaryResults.filter((r) => r.output._success).length;
  const failed = summaryResults.filter((r) => !r.output._success).length;

  return {
    experimentName,
    summary: { passed, failed, total: summaryResults.length },
    results: summaryResults,
  };
}
