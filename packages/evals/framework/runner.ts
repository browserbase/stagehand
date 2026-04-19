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
import { pathToFileURL } from "node:url";
import { Eval, flush, traced } from "braintrust";
import {
  StagehandEvalError,
  AgentProvider,
  loadApiKeyFromEnv,
  getAISDKLanguageModel,
  type AvailableModel,
  type LLMClient,
  type LogLine,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { AssertionError } from "./assertions.js";
import { EvalLogger } from "../logger.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { exactMatch, errorMatch, passRate } from "../scoring.js";
import { generateExperimentName } from "../utils.js";
import { generateSummary } from "../summary.js";
import type { V3InitResult } from "../initV3.js";
import {
  getModelList,
  getAgentModelEntries,
  type AgentModelEntry,
} from "../taskConfig.js";
import type {
  StartupProfile,
  ToolSurface,
} from "../core/contracts/tool.js";
import type {
  DiscoveredTask,
  TaskRegistry,
  TaskResult,
} from "./types.js";
import type { Testcase, EvalInput } from "../types/evals.js";

export { discoverTasks, resolveTarget } from "./discovery.js";

import { buildGAIATestcases } from "../suites/gaia.js";
import { buildWebVoyagerTestcases } from "../suites/webvoyager.js";
import { buildOnlineMind2WebTestcases } from "../suites/onlineMind2Web.js";
import { buildWebTailBenchTestcases } from "../suites/webtailbench.js";
import { resolveDefaultCoreStartupProfile } from "./context.js";

export interface RunProgressEvent {
  type: "started" | "passed" | "failed" | "error";
  taskName: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
}

export interface RunEvalsOptions {
  tasks: DiscoveredTask[];
  registry: TaskRegistry;
  concurrency?: number;
  trials?: number;
  environment?: "LOCAL" | "BROWSERBASE";
  useApi?: boolean;
  modelOverride?: string;
  provider?: string;
  categoryFilter?: string;
  datasetFilter?: string;
  coreToolSurface?: ToolSurface;
  coreStartupProfile?: StartupProfile;
  onProgress?: (event: RunProgressEvent) => void;
  verbose?: boolean;
}

const silentBraintrustProgress = {
  start: (_name: string, _total: number): void => {},
  increment: (_name: string): void => {},
  stop: (): void => {},
};

const silentBraintrustReporter = {
  name: "stagehand-evals-silent-reporter",
  async reportEval(): Promise<boolean> {
    return true;
  },
  async reportRun(): Promise<boolean> {
    return true;
  },
};


export function inferEffectiveBenchCategory(
  benchTasks: DiscoveredTask[],
  categoryFilter?: string | null,
): string | null {
  let effectiveCategory = categoryFilter ?? null;
  if (
    !effectiveCategory &&
    benchTasks.length === 1 &&
    benchTasks[0].categories.length === 1 &&
    (benchTasks[0].categories[0] === "agent" ||
      benchTasks[0].categories[0] === "external_agent_benchmarks")
  ) {
    effectiveCategory = benchTasks[0].categories[0];
  }

  return effectiveCategory;
}

export function resolveBenchModelEntries(
  benchTasks: DiscoveredTask[],
  options: RunEvalsOptions,
): {
  effectiveCategory: string | null;
  isAgentCategory: boolean;
  modelEntries: AgentModelEntry[];
} {
  const effectiveCategory = inferEffectiveBenchCategory(
    benchTasks,
    options.categoryFilter,
  );
  const isAgentCategory =
    effectiveCategory === "agent" ||
    effectiveCategory === "external_agent_benchmarks";

  if (options.modelOverride) {
    return {
      effectiveCategory,
      isAgentCategory,
      modelEntries: [{ modelName: options.modelOverride, cua: false }],
    };
  }

  return {
    effectiveCategory,
    isAgentCategory,
    modelEntries: isAgentCategory
      ? getAgentModelEntries()
      : getModelList(effectiveCategory).map((m) => ({
          modelName: m,
          cua: false,
        })),
  };
}

function generateTestcases(
  tasks: DiscoveredTask[],
  options: RunEvalsOptions,
): Testcase[] {
  const coreTasks = tasks.filter((t) => t.tier === "core");
  const benchTasks = tasks.filter((t) => t.tier === "bench");
  let allTestcases: Testcase[] = [];

  for (const task of coreTasks) {
    allTestcases.push({
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
        task_category: task.primaryCategory,
      },
      expected: true,
    });
  }

  if (benchTasks.length > 0) {
    const { effectiveCategory, isAgentCategory, modelEntries } =
      resolveBenchModelEntries(benchTasks, options);

    const suiteTestcases = generateSuiteTestcases(
      benchTasks,
      options,
      modelEntries,
    );
    allTestcases.push(...suiteTestcases.testcases);
    const remainingBenchTasks = suiteTestcases.remainingTasks;

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

  if (options.environment === "BROWSERBASE") {
    allTestcases = allTestcases.filter(
      (tc) => !["peeler_simple", "stock_x"].includes(tc.name),
    );
  }

  return allTestcases;
}

function generateSuiteTestcases(
  benchTasks: DiscoveredTask[],
  options: RunEvalsOptions,
  modelEntries: AgentModelEntry[],
): { testcases: Testcase[]; remainingTasks: DiscoveredTask[] } {
  const testcases: Testcase[] = [];
  const remaining = [...benchTasks];
  const datasetFilter = options.datasetFilter;

  const suiteMap: Record<string, (models: AgentModelEntry[]) => Testcase[]> = {
    "agent/gaia": (models) => buildGAIATestcases(models),
    "agent/webvoyager": (models) => buildWebVoyagerTestcases(models),
    "agent/onlineMind2Web": (models) => buildOnlineMind2WebTestcases(models),
    "agent/webtailbench": (models) => buildWebTailBenchTestcases(models),
  };

  for (const [suiteName, builder] of Object.entries(suiteMap)) {
    const idx = remaining.findIndex((t) => t.name === suiteName);
    if (idx === -1) continue;
    const datasetName = suiteName.split("/").pop();
    if (!datasetFilter || datasetFilter === datasetName) {
      testcases.push(...builder(modelEntries));
    }
    remaining.splice(idx, 1);
  }

  return { testcases, remainingTasks: remaining };
}

async function executeTask(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunEvalsOptions,
): Promise<TaskResult> {
  if (task.tier === "core") {
    return executeCoreTask(input, task, options);
  }
  return executeBenchTask(input, task, options);
}

async function executeCoreTask(
  _input: EvalInput,
  task: DiscoveredTask,
  options: RunEvalsOptions,
): Promise<TaskResult> {
  const logger = new EvalLogger(Boolean(options.verbose));
  const { buildCoreContext: buildCtx } = await import("./context.js");
  let ctx: Awaited<ReturnType<typeof buildCtx>>["ctx"] | undefined;
  let cleanup: () => Promise<void> = async () => {};
  let startupMs = 0;
  let taskMs = 0;
  let cleanupMs = 0;
  let result: TaskResult;
  let taskStart = 0;
  try {
    const startupStart = performance.now();
    const startupResult = await traced(
      async () =>
        buildCtx({
          logger,
          environment: options.environment,
          toolSurface: options.coreToolSurface,
          startupProfile: options.coreStartupProfile,
        }),
      {
        name: "session.startup",
      },
    );
    startupMs = performance.now() - startupStart;
    ctx = startupResult.ctx;
    cleanup = startupResult.cleanup;

    taskStart = performance.now();
    const ctxLocal = ctx!;
    result = await traced(
      async (): Promise<TaskResult> => {
        const taskModule = await loadTaskModuleFromPath(
          task.filePath,
          task.name,
        );
        if (taskModule.definition) {
          await taskModule.definition.fn(ctxLocal);
          return {
            _success: true,
            logs: logger.getLogs(),
            metrics: ctxLocal.metrics.getSummary(),
            rawMetrics: await ctxLocal.tool.getRawMetrics(),
            adapter: ctxLocal.adapter,
          };
        }
        if (taskModule.legacyFn) {
          throw new StagehandEvalError(
            `Legacy core task exports are not supported in the adapter-backed core runner: ${task.filePath}`,
          );
        }
        throw new StagehandEvalError(
          `No valid task export found in ${task.filePath}`,
        );
      },
      { name: "task" },
    );
    taskMs = performance.now() - taskStart;
  } catch (error) {
    if (taskMs === 0 && taskStart > 0) {
      // The task threw before the success path captured a duration.
      taskMs = performance.now() - taskStart;
    }
    if (error instanceof AssertionError) {
      result = {
        _success: false,
        error: error.message,
        logs: logger.getLogs(),
        metrics: ctx ? ctx.metrics.getSummary() : {},
        rawMetrics: ctx ? await ctx.tool.getRawMetrics() : {},
        adapter: ctx?.adapter,
      };
    } else {
      result = {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        metrics: ctx ? ctx.metrics.getSummary() : {},
        rawMetrics: ctx ? await ctx.tool.getRawMetrics() : {},
        adapter: ctx?.adapter,
      };
    }
  } finally {
    const cleanupStart = performance.now();
    await traced(
      async () => {
        await cleanup();
      },
      { name: "cleanup" },
    );
    cleanupMs = performance.now() - cleanupStart;
    logger.clear();
  }

  return {
    ...result,
    metrics: {
      startup_ms: {
        count: 1,
        value: startupMs,
      },
      task_ms: {
        count: 1,
        value: taskMs,
      },
      cleanup_ms: {
        count: 1,
        value: cleanupMs,
      },
      total_ms: {
        count: 1,
        value: startupMs + taskMs + cleanupMs,
      },
      ...((result.metrics ?? {}) as Record<string, unknown>),
    },
  };
}

async function executeBenchTask(
  input: EvalInput,
  task: DiscoveredTask,
  options: RunEvalsOptions,
): Promise<TaskResult> {
  const logger = new EvalLogger(Boolean(options.verbose));
  const useApi = options.useApi ?? false;
  let v3Result: V3InitResult | undefined;

  try {
    const isAgentTask =
      task.primaryCategory === "agent" ||
      task.categories.includes("agent") ||
      task.categories.includes("external_agent_benchmarks");

    v3Result = await traced(
      async () => {
        if (useApi) {
          let provider: string | undefined;
          if (input.modelName.includes("/")) {
            provider = input.modelName.split("/")[0];
          } else {
            try {
              provider = AgentProvider.getAgentProvider(input.modelName);
            } catch {
              provider = undefined;
            }
          }
          const logFn = (line: LogLine) => logger.log(line);
          const apiKey = loadApiKeyFromEnv(provider, logFn);
          if (!apiKey) {
            throw new StagehandEvalError(
              `USE_API=true but no API key found for provider "${provider}".`,
            );
          }
          const { initV3 } = await import("../initV3.js");
          return initV3({
            logger,
            modelName: input.modelName,
            modelClientOptions: { apiKey },
            createAgent: isAgentTask,
            isCUA: input.isCUA,
            verbose: options.verbose,
            configOverrides: { env: options.environment ?? "LOCAL" },
          });
        }

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
        return initV3({
          logger,
          llmClient,
          modelName: input.modelName,
          createAgent: isAgentTask,
          isCUA: input.isCUA,
          verbose: options.verbose,
          configOverrides: { env: options.environment ?? "LOCAL" },
        });
      },
      { name: "session.startup" },
    );

    const v3 = v3Result;
    const result = await traced(
      async (): Promise<TaskResult> => {
        const taskModule = await loadTaskModuleFromPath(
          task.filePath,
          task.name,
        );
        if (taskModule.definition) {
          const ctx = {
            v3: v3.v3,
            agent: v3.agent,
            page: v3.v3.context.pages()[0],
            logger,
            input,
            modelName: input.modelName,
            debugUrl: v3.debugUrl ?? "",
            sessionUrl: v3.sessionUrl ?? "",
          };
          return (await taskModule.definition.fn(ctx)) as TaskResult;
        }
        if (taskModule.legacyFn) {
          return taskModule.legacyFn({
            v3: v3.v3,
            logger,
            debugUrl: v3.debugUrl ?? "",
            sessionUrl: v3.sessionUrl ?? "",
            modelName: input.modelName,
            agent: v3.agent,
            input,
          });
        }
        throw new StagehandEvalError(
          `No valid task export found in ${task.filePath}`,
        );
      },
      { name: "task" },
    );

    return result;
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
          value: error instanceof Error ? error.stack ?? "" : "",
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
    await traced(
      async () => {
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
      },
      { name: "cleanup" },
    );
    logger.clear();
  }
}

interface LoadedTaskDefinition {
  __taskDefinition: true;
  meta: unknown;
  fn: (ctx: unknown) => Promise<unknown>;
}

type LegacyTaskFn = (ctx: unknown) => Promise<TaskResult>;

interface LoadedTaskModule {
  definition?: LoadedTaskDefinition;
  legacyFn?: LegacyTaskFn;
}

async function loadTaskModuleFromPath(
  filePath: string,
  taskName: string,
): Promise<LoadedTaskModule> {
  if (!fs.existsSync(filePath)) {
    throw new StagehandEvalError(`Task module not found: ${filePath}`);
  }

  const moduleUrl = pathToFileURL(filePath).href;
  const taskModule = (await import(moduleUrl)) as Record<string, unknown>;

  const defaultExport = taskModule.default as
    | Partial<LoadedTaskDefinition>
    | undefined;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return { definition: defaultExport as LoadedTaskDefinition };
  }

  const baseName = taskName.includes("/")
    ? (taskName.split("/").pop() as string)
    : taskName;
  if (typeof taskModule[baseName] === "function") {
    return { legacyFn: taskModule[baseName] as LegacyTaskFn };
  }

  throw new StagehandEvalError(
    `No task function found for "${taskName}" in ${filePath}. ` +
      `Expected either a default defineTask() export or a named export "${baseName}".`,
  );
}

export interface RunEvalsResult {
  experimentName: string;
  summary: { passed: number; failed: number; total: number };
  results: Array<{
    input: EvalInput;
    output: { _success: boolean; [key: string]: unknown };
    name: string;
    score: number;
  }>;
}

function formatProgressError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function runEvals(
  options: RunEvalsOptions,
): Promise<RunEvalsResult> {
  const concurrency = options.concurrency ?? 3;
  const trials = options.trials ?? 3;
  const environment = options.environment ?? "LOCAL";

  const testcases = generateTestcases(options.tasks, options);
  if (testcases.length === 0) {
    console.log("No testcases to run.");
    return {
      experimentName: "empty",
      summary: { passed: 0, failed: 0, total: 0 },
      results: [],
    };
  }

  const hasCoreOnly = options.tasks.every((t: DiscoveredTask) => t.tier === "core");
  const effectiveCoreToolSurface = hasCoreOnly
    ? options.coreToolSurface ?? "understudy_code"
    : undefined;
  const effectiveCoreStartupProfile =
    hasCoreOnly && effectiveCoreToolSurface
      ? options.coreStartupProfile ??
        resolveDefaultCoreStartupProfile(effectiveCoreToolSurface, environment)
      : undefined;
  const experimentName = generateExperimentName({
    evalName: options.tasks.length === 1 ? options.tasks[0].name : undefined,
    category: options.categoryFilter ?? undefined,
    environment,
    toolSurface: effectiveCoreToolSurface,
    startupProfile: effectiveCoreStartupProfile,
  });

  const braintrustProjectName = hasCoreOnly
    ? process.env.CI === "true"
      ? "stagehand-core"
      : "stagehand-core-dev"
    : process.env.CI === "true"
      ? "stagehand"
      : "stagehand-dev";

  const scores = hasCoreOnly ? [passRate, errorMatch] : [exactMatch, errorMatch];

  const evalResult = await Eval(braintrustProjectName, {
    experimentName,
    metadata: {
      environment,
      tier: hasCoreOnly ? "core" : "bench",
      ...(effectiveCoreToolSurface && { toolSurface: effectiveCoreToolSurface }),
      ...(effectiveCoreStartupProfile && { startupProfile: effectiveCoreStartupProfile }),
      ...(options.provider && { provider: options.provider }),
      ...(options.modelOverride && { model: options.modelOverride }),
      ...(options.useApi && { api: true }),
    },
    data: () => testcases,
    task: async (input: EvalInput): Promise<TaskResult> => {
      const resolvedTask =
        options.registry.byName.get(input.name) ??
        (input.name.includes("/")
          ? undefined
          : options.registry.byName.get(`agent/${input.name}`));

      if (!resolvedTask) {
        throw new StagehandEvalError(
          `Task "${input.name}" not found in registry.`,
        );
      }

      options.onProgress?.({
        type: "started",
        taskName: input.name,
        modelName: input.modelName,
      });

      const result = await executeTask(input, resolvedTask, options);

      options.onProgress?.({
        type: result._success ? "passed" : "failed",
        taskName: input.name,
        modelName: input.modelName,
        error: result._success ? undefined : formatProgressError(result.error),
      });

      return result;
    },
    scores: scores as unknown as never,
    maxConcurrency: concurrency,
    trialCount: trials,
  }, {
    progress: silentBraintrustProgress,
    reporter: silentBraintrustReporter,
  });

  await flush();

  const summaryResults = evalResult.results.map((result) => {
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

  await generateSummary(summaryResults, experimentName);

  const passed = summaryResults.filter((r) => r.output._success).length;
  const failed = summaryResults.filter((r) => !r.output._success).length;

  return {
    experimentName,
    summary: { passed, failed, total: summaryResults.length },
    results: summaryResults,
  };
}
