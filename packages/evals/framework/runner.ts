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
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AvailableModel } from "@browserbasehq/stagehand";
import type { AgentToolMode } from "@browserbasehq/stagehand";
import { shouldPersistTrajectory } from "@browserbasehq/stagehand";
import { AssertionError } from "./assertions.js";
import { EvalLogger } from "../logger.js";
import { EvalsError } from "../errors.js";
import { exactMatch, errorMatch, passRate } from "../scoring.js";
import { generateExperimentName } from "../utils.js";
import {
  buildTrajectoryGroupSlug,
  generateRunToken,
  resolveUnambiguousModel,
  resolveTrajectoryRoot,
  writeExperimentLink,
} from "./trajectoryGroup.js";
import { generateSummary } from "../summary.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import type { DiscoveredTask, TaskRegistry, TaskResult } from "./types.js";
import type { Testcase, EvalInput } from "../types/evals.js";
import { generateBenchTestcases } from "./benchPlanner.js";
import { DEFAULT_BENCH_HARNESS, type Harness } from "./benchTypes.js";
import {
  benchmarkRunMetadata,
  buildBenchmarkExperimentName,
  type BenchmarkRunDescriptor,
} from "../benchmarks/braintrust.js";
import { executeBenchTask } from "./benchRunner.js";
import {
  hasBraintrustApiKey,
  loadBraintrust,
  tracedSpan,
} from "./braintrust.js";
import { onceAsync, registerActiveRunCleanup } from "./activeRunCleanup.js";
import { loadTaskModuleFromPath } from "./taskLoader.js";
import { resolveV4SdkPath } from "../v4SdkLoader.js";

export { discoverTasks, resolveTarget } from "./discovery.js";
export {
  inferEffectiveBenchCategory,
  resolveBenchModelEntries,
} from "./benchPlanner.js";
export type { Harness } from "./benchTypes.js";
export { cleanupActiveRunResources } from "./activeRunCleanup.js";
import { resolveDefaultCoreStartupProfile } from "./context.js";

/**
 * Experiment name for SDK-comparison runs:
 *   <target>__<sdk>__<env>__<model>__<YYYY-MM-DD>
 * e.g. act__v4__local__gpt-5.4-mini__2026-07-22. Matched pairs differ only
 * in the sdk segment; never diff across environments.
 */
function buildSdkComparisonExperimentName(input: {
  base: string;
  sdk: "v3" | "v4";
  environment: string;
  model?: string;
}): string {
  const model = input.model
    ? input.model.includes("/")
      ? input.model.split("/").slice(1).join("/")
      : input.model
    : "multi";
  const date = new Date().toISOString().slice(0, 10);
  return [
    input.base,
    input.sdk,
    input.environment.toLowerCase(),
    model,
    date,
  ].join("__");
}

/**
 * Braintrust project routing for v4 work:
 * - deterministic suite (direct a/e/o method-call tasks, pass-rate /
 *   exact-match scored) → stagehand-v4-deterministic
 * - nondeterministic suite (longer-horizon / LLMJ-scored: external-harness
 *   and benchmark-matrix runs) → stagehand-v4
 */
const SDK_COMPARISON_PROJECT = "stagehand-v4";
const DETERMINISTIC_COMPARISON_PROJECT = "stagehand-v4-deterministic";

/**
 * Fail fast before spending money: verify the configured Braintrust key can
 * see the target project. An org-less or wrong-org key still authenticates
 * (HTTP 200) but sees no projects — Eval() would then run the whole matrix
 * and silently drop every log batch.
 *
 * This guard exists so that every SDK-comparison eval run is verifiable and
 * traceable in Braintrust: a run whose logs silently drop leaves no record
 * and its claimed results can't be audited. Blocking un-loggable runs up
 * front guarantees that any reported v3/v4 score has a corresponding
 * Braintrust experiment backing its plausibility.
 */
async function assertBraintrustProjectReachable(
  projectName: string,
): Promise<void> {
  const apiUrl = process.env.BRAINTRUST_API_URL ?? "https://api.braintrust.dev";
  let body: { objects?: unknown[] };
  try {
    const response = await fetch(
      `${apiUrl}/v1/project?project_name=${encodeURIComponent(projectName)}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BRAINTRUST_API_KEY}`,
        },
      },
    );
    if (!response.ok) {
      throw new EvalsError(
        `Braintrust preflight failed (HTTP ${response.status}). ` +
          `Check BRAINTRUST_API_KEY before running an SDK comparison.`,
      );
    }
    body = (await response.json()) as { objects?: unknown[] };
  } catch (error) {
    if (error instanceof EvalsError) throw error;
    throw new EvalsError(
      `Braintrust preflight request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!body.objects?.length) {
    throw new EvalsError(
      `Braintrust preflight: the configured BRAINTRUST_API_KEY cannot see ` +
        `project "${projectName}" (the key may belong to the wrong org). ` +
        `Aborting before any tasks run.`,
    );
  }
}

/**
 * Resolve the commit SHA of the linked v4-spike checkout so v4 experiments
 * stay reproducible against a moving SDK. Follows the pnpm link symlink to
 * the real checkout. Best-effort: returns "unknown" on any failure.
 */
function resolveV4SpikeSha(): string {
  try {
    const sdkEntry = resolveV4SdkPath();
    if (!sdkEntry) return "unknown";
    // <checkout>/packages/sdk-ts/src/index.ts → checkout root
    const sdkPackageRoot = fs.realpathSync(
      path.dirname(path.dirname(sdkEntry)),
    );
    const repoRoot = path.dirname(path.dirname(sdkPackageRoot));
    return execSync("git rev-parse --short HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

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
  /**
   * Run each bench task in its own child process so a hard crash (OOM,
   * hung SDK, unhandled rejection) fails only that task. Set by --isolate.
   */
  isolateTasks?: boolean;
  /**
   * Which Stagehand SDK drives bench tasks. When set explicitly (v3 or v4),
   * the run is treated as part of an SDK comparison: the Braintrust
   * experiment name gains sdk/env/model/date segments and metadata carries
   * `sdk` (plus the v4-spike commit SHA for v4 runs) so matched pairs can
   * be diffed per task.
   */
  sdk?: "v3" | "v4";
  /**
   * Benchmark-matrix run descriptor (see benchmarks/). When set, the
   * Braintrust experiment name becomes
   * `<benchmark>__<harness>__<toolSurface>__<env>__<model>__<date>` and
   * metadata carries the full (benchmark, harness, toolSurface) triple, so
   * any two points of a matrix are diffable. Produced by
   * `benchmarkRunnerOptions()` — spread that into this call rather than
   * assembling by hand.
   */
  benchmark?: BenchmarkRunDescriptor;
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
  if (options.isolateTasks) {
    const { executeBenchTaskIsolated } = await import(
      "./benchTaskIsolation.js"
    );
    return executeBenchTaskIsolated(input, task, options);
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
  // Core runs default to understudy; bench runs under an external harness
  // carry the requested surface (the comparison arm) into metadata/naming.
  const effectiveCoreToolSurface = hasCoreOnly
    ? (options.coreToolSurface ?? "understudy_code")
    : options.coreToolSurface;
  const effectiveCoreStartupProfile =
    hasCoreOnly && effectiveCoreToolSurface
      ? (options.coreStartupProfile ??
        resolveDefaultCoreStartupProfile(effectiveCoreToolSurface, environment))
      : undefined;
  const effectiveBenchHarness = hasCoreOnly
    ? undefined
    : (options.harness ?? DEFAULT_BENCH_HARNESS);
  const runModel = resolveUnambiguousModel(
    testcases.map((testcase) => testcase.input?.modelName),
  );
  const baseExperimentName = generateExperimentName({
    evalName: options.tasks.length === 1 ? options.tasks[0].name : undefined,
    category: options.categoryFilter ?? undefined,
    environment,
    toolSurface: effectiveCoreToolSurface,
    startupProfile: effectiveCoreStartupProfile,
  });
  // SDK-comparison runs (--sdk passed explicitly) get self-describing names
  // so matched v3/v4 pairs are unmistakable in the Braintrust experiment
  // list; default runs keep the plain target-label naming.
  const experimentName = options.benchmark
    ? buildBenchmarkExperimentName({
        benchmark: options.benchmark,
        environment,
        model: runModel ?? options.modelOverride,
      })
    : options.sdk
      ? buildSdkComparisonExperimentName({
          base: baseExperimentName,
          sdk: options.sdk,
          environment,
          model: runModel ?? options.modelOverride,
        })
      : baseExperimentName;

  // Stamp the run-scoped trajectory group; the token is generated once here and
  // reused for the completion-time experiment link. Local persistence only.
  const trajectoryGroup = buildTrajectoryGroupSlug({
    experimentName,
    model: runModel,
    runToken: generateRunToken(),
  });
  process.env.EVAL_EXPERIMENT_NAME = experimentName;
  process.env.EVAL_TRAJECTORY_GROUP = trajectoryGroup;
  if (runModel) process.env.EVAL_TRAJECTORY_MODEL = runModel;
  else delete process.env.EVAL_TRAJECTORY_MODEL;
  if (options.modelOverride)
    process.env.EVAL_MODEL_OVERRIDE = options.modelOverride;
  if (options.provider) process.env.EVAL_PROVIDER = options.provider;

  // v4-work routing: benchmark-matrix runs and the replay (nondeterministic)
  // suite land in stagehand-v4; plain --sdk comparison runs of deterministic
  // a/e/o tasks land in stagehand-v4-deterministic. Default runs keep the
  // existing project routing.
  // External coding harnesses (claude_code, codex) only drive the
  // longer-horizon LLMJ-graded suite — always nondeterministic.
  const isExternalHarnessRun =
    !hasCoreOnly &&
    effectiveBenchHarness !== undefined &&
    effectiveBenchHarness !== "stagehand";
  const braintrustProjectName =
    options.benchmark || isExternalHarnessRun
      ? SDK_COMPARISON_PROJECT
      : options.sdk
        ? DETERMINISTIC_COMPARISON_PROJECT
        : hasCoreOnly
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
  const sendLogs = hasBraintrustApiKey();

  // Comparison runs cost real money; verify Braintrust is reachable before
  // any task starts rather than discovering dropped log batches afterwards.
  // Every comparison run must be verifiable and traceable in Braintrust —
  // results without a backing experiment record can't be audited.
  if ((options.sdk || options.benchmark || isExternalHarnessRun) && sendLogs) {
    await assertBraintrustProjectReachable(braintrustProjectName);
  }

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
        // External-harness runs aren't driven by a Stagehand SDK unless the
        // tool surface IS one; don't let the legacy v3 default mislabel them.
        ...(options.sdk
          ? { sdk: options.sdk }
          : isExternalHarnessRun
            ? options.coreToolSurface === "v4_code"
              ? { sdk: "v4" }
              : options.coreToolSurface === "understudy_code"
                ? { sdk: "v3" }
                : {}
            : { sdk: "v3" }),
        ...(options.sdk === "v4" && { v4Sha: resolveV4SpikeSha() }),
        tier: hasCoreOnly ? "core" : "bench",
        ...(effectiveCoreToolSurface && {
          toolSurface: effectiveCoreToolSurface,
        }),
        ...(effectiveCoreStartupProfile && {
          startupProfile: effectiveCoreStartupProfile,
        }),
        ...(effectiveBenchHarness && { harness: effectiveBenchHarness }),
        // Benchmark-matrix runs: stamp the full triple last so it is
        // authoritative over the tier-derived harness/toolSurface fields.
        ...(options.benchmark && benchmarkRunMetadata(options.benchmark)),
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
      ...(sendLogs ? {} : { noSendLogs: true }),
    },
  );

  if (sendLogs) {
    await flush();
  }

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

  // Cross-link local trajectories to the resolved Braintrust experiment. The
  // hashed name (e.g. `agent/onlineMind2Web-92918006`) is only known now, after
  // Eval() resolves — so write it once at the group-dir root of the group this
  // run recorded into.
  await writeExperimentLink(
    resolveTrajectoryRoot(),
    trajectoryGroup,
    {
      braintrustExperiment: resolvedExperimentName,
      braintrustExperimentId: evalResult.summary?.experimentId ?? null,
      braintrustExperimentUrl: resolvedExperimentUrl ?? null,
      braintrustProject:
        evalResult.summary?.projectName ?? braintrustProjectName,
      braintrustProjectUrl: evalResult.summary?.projectUrl ?? null,
      requestedExperimentName: experimentName,
    },
    { persist: !hasCoreOnly && shouldPersistTrajectory(undefined) },
  );

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
