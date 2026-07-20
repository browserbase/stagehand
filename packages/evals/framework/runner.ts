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
import { hasBraintrustApiKey, tracedSpan } from "./braintrust.js";
import { BraintrustEvalRunner, type EvalRunner } from "./evalRunner.js";
import { onceAsync, registerActiveRunCleanup } from "./activeRunCleanup.js";
import { loadTaskModuleFromPath } from "./taskLoader.js";
import { resolveTraceTransport } from "./langsmith.js";
import { buildTracerProvider, shutdownTracing } from "./otel.js";

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

/**
 * Upper bound on the JSON size of a span payload. Measured against the live
 * LangSmith OTLP endpoint: 300KB/700KB/1MB/3MB payloads all round-trip intact
 * (it offloads large values to S3), and real agent runs land around 600KB. 2MB
 * keeps ~3x headroom over observed runs while staying under the proven ceiling
 * — a single oversized span can fail its whole OTLP export batch and silently
 * take every other span in that batch with it.
 */
const MAX_SPAN_PAYLOAD_BYTES = 2_000_000;

/**
 * Keep `value` whole when it serializes small enough. Otherwise progressively
 * drop the oldest `logs` entries (the only unbounded field) until it fits, so a
 * huge run still yields a useful tail rather than nothing, and record what was
 * dropped. `.trajectories` remains the complete record either way.
 */
function capForSpan(value: Record<string, unknown>): Record<string, unknown> {
  const sizeOf = (v: unknown): number | undefined => {
    try {
      return JSON.stringify(v)?.length;
    } catch {
      return undefined;
    }
  };
  const size = sizeOf(value);
  if (size === undefined) return { _truncated: "payload not serializable" };
  if (size <= MAX_SPAN_PAYLOAD_BYTES) return value;

  const logs = value.logs;
  if (!Array.isArray(logs)) {
    const rest = { ...value };
    delete rest.logs;
    return {
      ...rest,
      _truncated: `payload ${size}B exceeded cap; logs omitted`,
    };
  }

  // Halve the retained tail until the payload fits (or nothing is left).
  let kept = logs;
  while (kept.length > 0) {
    kept = kept.slice(Math.ceil(kept.length / 2));
    const probe = sizeOf({ ...value, logs: kept });
    if (probe !== undefined && probe <= MAX_SPAN_PAYLOAD_BYTES) break;
  }
  return {
    ...value,
    logs: kept,
    _truncated: `kept the last ${kept.length} of ${logs.length} log entries: full payload was ${size}B (cap ${MAX_SPAN_PAYLOAD_BYTES}B) — see .trajectories for the complete record`,
  };
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
  const traceTransport = resolveTraceTransport();
  const hasCoreOnly = options.tasks.every(
    (t: DiscoveredTask) => t.tier === "core",
  );
  const braintrustProjectName = hasCoreOnly
    ? process.env.CI === "true"
      ? "stagehand-core"
      : "stagehand-core-dev"
    : process.env.CI === "true"
      ? "stagehand"
      : "stagehand-dev";

  if (traceTransport === "otel") {
    await buildTracerProvider({
      braintrustParent: `project_name:${braintrustProjectName}`,
    });
  }

  try {
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

    const effectiveCoreToolSurface = hasCoreOnly
      ? (options.coreToolSurface ?? "understudy_code")
      : undefined;
    const effectiveCoreStartupProfile =
      hasCoreOnly && effectiveCoreToolSurface
        ? (options.coreStartupProfile ??
          resolveDefaultCoreStartupProfile(
            effectiveCoreToolSurface,
            environment,
          ))
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

    // LangSmith addresses threads by URL path segment (/v2/threads/<id>/...),
    // and its gateway rejects percent-encoded slashes with a 403 HTML page —
    // which the browser reports as a CORS preflight failure, breaking the whole
    // thread/peek view. Experiment names contain "/" (e.g. "agent/onlineMind2Web"),
    // so the id must be sanitized to a path-safe form. The timestamp suffix scopes
    // the thread to this invocation, so one eval run groups as one thread instead
    // of every run of the same eval piling into a single thread forever.
    const traceThreadId = `${experimentName.replace(
      /[^A-Za-z0-9._-]+/g,
      "__",
    )}-${Date.now().toString(36)}`;

    const scores = hasCoreOnly
      ? [passRate, errorMatch]
      : [exactMatch, errorMatch];

    const sendLogs = hasBraintrustApiKey();

    // Aggressive abort: when the caller flips signal.reason to "aggressive",
    // close every active session so any in-flight task throws on its next
    // page operation. The cleanup path inside executeBenchTask handles the
    // throw; finished tasks' cleanup is a no-op via onceAsync.
    const onAggressiveAbort = async (): Promise<void> => {
      if (readAbortMode(options.signal) !== "aggressive") return;
      const { cleanupActiveRunResources } = await import(
        "./activeRunCleanup.js"
      );
      await cleanupActiveRunResources();
    };
    options.signal?.addEventListener("abort", () => {
      void onAggressiveAbort();
    });

    const evalRunner: EvalRunner = new BraintrustEvalRunner();
    const evalResult = await evalRunner.run({
      projectName: braintrustProjectName,
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

        // Task-root span for the OTEL transport only: it gives LangSmith a
        // per-task trace root (agent/verifier spans nest beneath) and carries
        // the thread_id that groups one eval run in the Threads view. Gated
        // off in native mode so the Braintrust span tree stays byte-identical.
        const result =
          traceTransport === "otel"
            ? await tracedSpan(
                async (span) => {
                  const taskResult = await executeTask(
                    input,
                    resolvedTask,
                    options,
                  );
                  // Mirror the whole TaskResult onto the root span so the
                  // trace carries the agent's trajectory. Braintrust gets this
                  // for free: its Eval() framework hands the TaskResult to the
                  // scorers, so the logs show up in the scorer spans (~400KB).
                  // OTEL has no equivalent, so we attach it explicitly here.
                  // `logs` is the Stagehand logger output — i.e. what the
                  // agent actually did — and is already screenshot-redacted by
                  // EvalLogger. Capped so a pathological run can't blow up the
                  // OTLP payload.
                  span?.log({
                    output: capForSpan({
                      _success: taskResult._success,
                      ...(taskResult.error !== undefined && {
                        error: taskResult.error,
                      }),
                      ...(taskResult.metrics !== undefined && {
                        metrics: taskResult.metrics,
                      }),
                      ...(taskResult.logs !== undefined && {
                        logs: taskResult.logs,
                      }),
                    }),
                    metadata: {
                      experiment_name: experimentName,
                      thread_id: traceThreadId,
                      model: input.modelName,
                      task: input.name,
                    },
                  });
                  return taskResult;
                },
                {
                  name: input.name,
                  type: "task",
                  event: {
                    input: { task: input.name, model: input.modelName },
                  },
                },
              )
            : await executeTask(input, resolvedTask, options);

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
      scores,
      maxConcurrency: concurrency,
      trialCount: trials,
      sendLogs,
    });

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
  } finally {
    if (traceTransport === "otel") {
      try {
        await shutdownTracing();
      } catch {
        // Tracing shutdown must not mask the eval result or its exception.
      }
    }
  }
}
