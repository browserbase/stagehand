// @ts-nocheck
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
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { AssertionError } from "./assertions.js";
import { EvalLogger } from "../logger.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { exactMatch, errorMatch, passRate } from "../scoring.js";
import { generateExperimentName } from "../utils.js";
import { generateSummary } from "../summary.js";
import {
  getModelList,
  getAgentModelEntries,
} from "../taskConfig.js";

export { discoverTasks, resolveTarget } from "./discovery.js";

import { buildGAIATestcases } from "../suites/gaia.js";
import { buildWebVoyagerTestcases } from "../suites/webvoyager.js";
import { buildOnlineMind2WebTestcases } from "../suites/onlineMind2Web.js";
import { buildWebTailBenchTestcases } from "../suites/webtailbench.js";
import { resolveDefaultCoreStartupProfile } from "./context.js";

export function inferEffectiveBenchCategory(benchTasks, categoryFilter) {
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

export function resolveBenchModelEntries(benchTasks, options) {
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

function generateTestcases(tasks, options) {
  const coreTasks = tasks.filter((t) => t.tier === "core");
  const benchTasks = tasks.filter((t) => t.tier === "bench");
  let allTestcases = [];

  for (const task of coreTasks) {
    allTestcases.push({
      input: {
        name: task.name,
        modelName: "none",
      },
      name: task.name,
      tags: ["core", task.primaryCategory, ...task.tags],
      metadata: {
        model: "none",
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
            modelName: entry.modelName,
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
            model: entry.modelName,
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

function generateSuiteTestcases(benchTasks, options, modelEntries) {
  const testcases = [];
  const remaining = [...benchTasks];
  const datasetFilter = options.datasetFilter;

  const suiteMap = {
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

async function executeTask(input, task, options) {
  if (task.tier === "core") {
    return executeCoreTask(input, task, options);
  }
  return executeBenchTask(input, task, options);
}

async function executeCoreTask(input, task, options) {
  const logger = new EvalLogger();
  const { buildCoreContext: buildCtx } = await import("./context.js");
  let ctx;
  let cleanup = async () => {};
  let startupMs = 0;
  let taskMs = 0;
  let cleanupMs = 0;
  let result;
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
    result = await traced(
      async () => {
        const taskModule = await loadTaskModuleFromPath(task.filePath, task.name);
        if (taskModule.definition) {
          await taskModule.definition.fn(ctx);
          return {
            _success: true,
            logs: logger.getLogs(),
            metrics: ctx.metrics.getSummary(),
            rawMetrics: await ctx.tool.getRawMetrics(),
            adapter: ctx.adapter,
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
      ...(result?.metrics ?? {}),
    },
  };
}

async function executeBenchTask(input, task, options) {
  const logger = new EvalLogger();
  const useApi = options.useApi ?? false;
  let v3Result;

  try {
    const isAgentTask =
      task.primaryCategory === "agent" ||
      task.categories.includes("agent") ||
      task.categories.includes("external_agent_benchmarks");

    v3Result = await traced(
      async () => {
        if (useApi) {
          let provider;
          if (input.modelName.includes("/")) {
            provider = input.modelName.split("/")[0];
          } else {
            try {
              provider = AgentProvider.getAgentProvider(input.modelName);
            } catch {
              provider = undefined;
            }
          }
          const logFn = (line) => logger.log(line);
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
          });
        }

        let llmClient;
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
        });
      },
      { name: "session.startup" },
    );

    const result = await traced(
      async () => {
        const taskModule = await loadTaskModuleFromPath(task.filePath, task.name);
        if (taskModule.definition) {
          const ctx = {
            v3: v3Result.v3,
            agent: v3Result.agent,
            page: v3Result.v3.context.pages()[0],
            logger,
            input,
            modelName: input.modelName,
            debugUrl: v3Result.debugUrl ?? "",
            sessionUrl: v3Result.sessionUrl ?? "",
          };
          return taskModule.definition.fn(ctx);
        }
        if (taskModule.legacyFn) {
          return taskModule.legacyFn({
            v3: v3Result.v3,
            logger,
            debugUrl: v3Result.debugUrl ?? "",
            sessionUrl: v3Result.sessionUrl ?? "",
            modelName: input.modelName,
            agent: v3Result.agent,
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

async function loadTaskModuleFromPath(filePath, taskName) {
  if (!fs.existsSync(filePath)) {
    throw new StagehandEvalError(`Task module not found: ${filePath}`);
  }

  const moduleUrl = pathToFileURL(filePath).href;
  const taskModule = await import(moduleUrl);

  const defaultExport = taskModule.default;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return { definition: defaultExport };
  }

  const baseName = taskName.includes("/") ? taskName.split("/").pop() : taskName;
  if (typeof taskModule[baseName] === "function") {
    return { legacyFn: taskModule[baseName] };
  }

  throw new StagehandEvalError(
    `No task function found for "${taskName}" in ${filePath}. ` +
      `Expected either a default defineTask() export or a named export "${baseName}".`,
  );
}

export async function runEvals(options) {
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

  console.log(
    `Running ${testcases.length} testcase(s) with concurrency=${concurrency}, trials=${trials}`,
  );

  const hasCoreOnly = options.tasks.every((t) => t.tier === "core");
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
    task: async (input) => {
      const task = options.registry.byName.get(input.name);
      if (!task) {
        const baseName = input.name.includes("/") ? input.name : `agent/${input.name}`;
        const suiteTask = options.registry.byName.get(baseName);
        if (!suiteTask) {
          throw new StagehandEvalError(`Task "${input.name}" not found in registry.`);
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
    scores,
    maxConcurrency: concurrency,
    trialCount: trials,
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
