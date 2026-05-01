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
import type { AvailableModel } from "@browserbasehq/stagehand";
import type { AgentToolMode } from "@browserbasehq/stagehand";
import { AssertionError } from "./assertions.js";
import { EvalLogger } from "../logger.js";
import { EvalsError } from "../errors.js";
import { exactMatch, errorMatch, passRate } from "../scoring.js";
import { generateExperimentName } from "../utils.js";
import { generateSummary } from "../summary.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import type { DiscoveredTask, TaskRegistry, TaskResult } from "./types.js";
import type { Testcase, EvalInput } from "../types/evals.js";
import { generateBenchTestcases } from "./benchPlanner.js";
import { DEFAULT_BENCH_HARNESS, type Harness } from "./benchTypes.js";
import { executeBenchTask } from "./benchRunner.js";
import { loadBraintrust, tracedSpan } from "./braintrust.js";
import { onceAsync, registerActiveRunCleanup } from "./activeRunCleanup.js";
import { loadTaskModuleFromPath } from "./taskLoader.js";

export { discoverTasks, resolveTarget } from "./discovery.js";
export {
  inferEffectiveBenchCategory,
  resolveBenchModelEntries,
} from "./benchPlanner.js";
export type { Harness } from "./benchTypes.js";
export { cleanupActiveRunResources } from "./activeRunCleanup.js";
import { resolveDefaultCoreStartupProfile } from "./context.js";

export interface RunProgressEvent {
  type: "planned" | "started" | "passed" | "failed" | "error";
  taskName?: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
  total?: number;
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
  agentMode?: AgentToolMode;
  agentModes?: AgentToolMode[];
  harness?: Harness;
  coreToolSurface?: ToolSurface;
  coreStartupProfile?: StartupProfile;
  onProgress?: (event: RunProgressEvent) => void;
  verbose?: boolean;
  /**
   * Cooperative abort. When triggered, the runner short-circuits any
   * unstarted testcases and any in-flight bench task is asked to close
   * its V3 instance early via `addEventListener('abort', …)`. The reason
   * passed to `controller.abort(reason)` is read as one of:
   *   - "cooperative" (default) — let in-flight tasks finish their current step
   *   - "aggressive" — close V3 sessions immediately to force a throw
   */
  signal?: AbortSignal;
}

/** Reason values we read from `controller.abort(reason)`. */
type AbortMode = "cooperative" | "aggressive";

function readAbortMode(signal?: AbortSignal): AbortMode {
  if (!signal?.aborted) return "cooperative";
  const reason = signal.reason;
  return reason === "aggressive" ? "aggressive" : "cooperative";
}

const silentBraintrustProgress = {
  start: (): void => {},
  increment: (): void => {},
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
        tier: "core",
        task: task.name,
        categories: task.categories,
        task_category: task.primaryCategory,
      },
      expected: true,
    });
  }

  if (benchTasks.length > 0) {
    allTestcases.push(...generateBenchTestcases(benchTasks, options));
  }

  if (options.environment === "BROWSERBASE") {
    allTestcases = allTestcases.filter(
      (tc) => !["peeler_simple", "stock_x"].includes(tc.name),
    );
  }

  return allTestcases;
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
  let cleanupMs: number;
  let result: TaskResult;
  let taskStart = 0;
  let unregisterCleanup: (() => void) | undefined;
  try {
    const startupStart = performance.now();
    const startupResult = await tracedSpan(
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
    cleanup = onceAsync(startupResult.cleanup);
    unregisterCleanup = registerActiveRunCleanup(cleanup);

    taskStart = performance.now();
    const ctxLocal = ctx!;
    result = await tracedSpan(
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
          throw new EvalsError(
            `Legacy core task exports are not supported in the adapter-backed core runner: ${task.filePath}`,
          );
        }
        throw new EvalsError(`No valid task export found in ${task.filePath}`);
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
    await tracedSpan(
      async () => {
        await cleanup();
      },
      { name: "cleanup" },
    );
    cleanupMs = performance.now() - cleanupStart;
    unregisterCleanup?.();
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
  options.onProgress?.({
    type: "planned",
    total: testcases.length,
  });
  if (testcases.length === 0) {
    console.log("No testcases to run.");
    return {
      experimentName: "empty",
      summary: { passed: 0, failed: 0, total: 0 },
      results: [],
    };
  }

  const hasCoreOnly = options.tasks.every(
    (t: DiscoveredTask) => t.tier === "core",
  );
  const effectiveCoreToolSurface = hasCoreOnly
    ? (options.coreToolSurface ?? "understudy_code")
    : undefined;
  const effectiveCoreStartupProfile =
    hasCoreOnly && effectiveCoreToolSurface
      ? (options.coreStartupProfile ??
        resolveDefaultCoreStartupProfile(effectiveCoreToolSurface, environment))
      : undefined;
  const effectiveBenchHarness = hasCoreOnly
    ? undefined
    : (options.harness ?? DEFAULT_BENCH_HARNESS);
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

  const scores = hasCoreOnly
    ? [passRate, errorMatch]
    : [exactMatch, errorMatch];

  const { Eval, flush } = await loadBraintrust();

  // Aggressive abort: when the caller flips signal.reason to "aggressive",
  // close every active session so any in-flight task throws on its next
  // page operation. The cleanup path inside executeBenchTask handles the
  // throw; finished tasks' cleanup is a no-op via onceAsync.
  const onAggressiveAbort = async (): Promise<void> => {
    if (readAbortMode(options.signal) !== "aggressive") return;
    const { cleanupActiveRunResources } = await import("./activeRunCleanup.js");
    await cleanupActiveRunResources();
  };
  options.signal?.addEventListener("abort", () => {
    void onAggressiveAbort();
  });

  const evalResult = await Eval(
    braintrustProjectName,
    {
      experimentName,
      metadata: {
        environment,
        tier: hasCoreOnly ? "core" : "bench",
        ...(effectiveCoreToolSurface && {
          toolSurface: effectiveCoreToolSurface,
        }),
        ...(effectiveCoreStartupProfile && {
          startupProfile: effectiveCoreStartupProfile,
        }),
        ...(effectiveBenchHarness && { harness: effectiveBenchHarness }),
        ...(options.provider && { provider: options.provider }),
        ...(options.modelOverride && { model: options.modelOverride }),
        ...(options.useApi && { api: true }),
      },
      data: () => testcases,
      task: async (input: EvalInput): Promise<TaskResult> => {
        // Cooperative abort: skip any testcase that hasn't started yet
        // when the signal has flipped. The in-flight task at the moment of
        // abort still finishes its current step; this stops the next one
        // from spinning up.
        if (options.signal?.aborted) {
          options.onProgress?.({
            type: "failed",
            taskName: input.name,
            modelName: input.modelName,
            error: "aborted",
          });
          return {
            _success: false,
            error: "aborted by user",
            logs: [],
          };
        }

        const resolvedTask =
          options.registry.byName.get(input.name) ??
          (input.name.includes("/")
            ? undefined
            : options.registry.byName.get(`agent/${input.name}`));

        if (!resolvedTask) {
          throw new EvalsError(`Task "${input.name}" not found in registry.`);
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
          error: result._success
            ? undefined
            : formatProgressError(result.error),
        });

        return result;
      },
      scores: scores as unknown as never,
      maxConcurrency: concurrency,
      trialCount: trials,
    },
    {
      progress: silentBraintrustProgress,
      reporter: silentBraintrustReporter,
    },
  );

  await flush();

  const summaryResults = evalResult.results.map((result) => {
    const output =
      typeof result.output === "boolean"
        ? { _success: result.output }
        : result.output;
    const categories = Array.isArray(result.metadata?.categories)
      ? result.metadata.categories.filter(
          (category): category is string => typeof category === "string",
        )
      : undefined;

    return {
      input: result.input,
      output,
      name: result.input.name,
      score: output._success ? 1 : 0,
      ...(categories && { categories }),
    };
  });

  const resolvedExperimentName =
    evalResult.summary?.experimentName ?? experimentName;
  const resolvedExperimentUrl = evalResult.summary?.experimentUrl;

  await generateSummary(
    summaryResults,
    resolvedExperimentName,
    resolvedExperimentUrl,
    evalResult.summary?.scores,
  );

  const passed = summaryResults.filter((r) => r.output._success).length;
  const failed = summaryResults.filter((r) => !r.output._success).length;

  return {
    experimentName: resolvedExperimentName,
    summary: { passed, failed, total: summaryResults.length },
    results: summaryResults,
  };
}
