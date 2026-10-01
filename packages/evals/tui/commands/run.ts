/**
 * Run command — executes evals with live progress output.
 *
 * Takes a fully-resolved ResolvedRunOptions bundle from parse.ts; does not
 * re-apply precedence. Handles --dry-run (prints a deterministic JSON plan
 * and returns) and scopes env overrides per run so benchmark shorthand
 * values don't leak across REPL commands.
 */

import { bold, dim, cyan, red, yellow, separator, stripAnsi } from "../format.js";
import { ProgressRenderer, formatElapsed, rowDisplayName, type ProgressRow } from "../progress.js";
import { setActiveRun } from "../liveRun.js";
import { printCellTable, printFailures, printModelSummary, printResultsTable } from "../results.js";
import {
  type SummaryRow,
  buildRunSummaryJson,
  collectFailures,
  isDeadJudgeRun,
  summarizeCells,
  summarizeVerifier,
} from "../../framework/runSummary.js";
import { resolveVerifierModel } from "../../framework/verifierModel.js";
import { renderPreview } from "../preview.js";
import { discoverTasks, resolveTarget } from "../../framework/discovery.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import { buildBenchMatrixRow, generateBenchTestcases } from "../../framework/benchPlanner.js";
import type { StartupProfile, ToolSurface } from "../../core/contracts/tool.js";
import type { AvailableModel } from "stagehand-v3";
import type { ResolvedRunOptions } from "./parse.js";
import { withEnvOverrides } from "./parse.js";
import { getRuntimeTasksRoot } from "../../runtimePaths.js";
import type { Harness } from "../../framework/benchTypes.js";
import { formatBenchHarnessFlags, isExecutableBenchHarness } from "../../framework/benchHarness.js";
import {
  armsOverLimit,
  armsWithUngradedRuns,
  armsWithPassesWithoutBrowserUse,
  resolveUnverifiableCriteriaLimit,
  summarizeArmVerifiability,
} from "../../framework/verifierGate.js";

import type { RunEvalsResult, RunProgressEvent } from "../../framework/runner.js";
import { logToRow } from "../../framework/rowContext.js";
import { format as formatConsoleArgsRaw } from "node:util";
import {
  ProviderConcurrency,
  describeProviderWidths,
} from "../../framework/providerConcurrency.js";

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function uniqueStringValues(
  rows: Array<Record<string, unknown>>,
  key: string,
  options: { exclude?: readonly string[]; requireTruthy?: boolean } = {},
): string[] {
  const excluded = new Set(options.exclude ?? []);
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const str = String(value);
    if (options.requireTruthy && !str) continue;
    if (excluded.has(str)) continue;
    values.add(str);
  }
  return [...values];
}

function buildRunTargetLabel(options: ResolvedRunOptions): string {
  return options.target ?? options.normalizedTarget ?? "bench";
}

function buildPlanLine(
  options: ResolvedRunOptions,
  matrix: Array<Record<string, unknown>>,
): string {
  const matrixRows = matrix.length;
  const trials = options.trials;
  const taskCount = uniqueStringValues(matrix, "task").length;
  const modelCount = uniqueStringValues(matrix, "model", {
    exclude: ["none"],
  }).length;
  const harnessCount = uniqueStringValues(matrix, "harness").length;
  const toolSurfaceCount = uniqueStringValues(matrix, "toolSurface", {
    requireTruthy: true,
  }).length;
  const nonBaseFactors = [
    modelCount === 0 ? 1 : modelCount,
    harnessCount > 1 ? harnessCount : 1,
    toolSurfaceCount > 1 ? toolSurfaceCount : 1,
  ];
  const nonBaseProduct = nonBaseFactors.reduce((product, value) => product * value, 1);
  const canFactorCleanly = nonBaseProduct > 0 && matrixRows % nonBaseProduct === 0;
  const baseCount = canFactorCleanly ? matrixRows / nonBaseProduct : matrixRows;
  const hasDatasetCases =
    uniqueStringValues(matrix, "dataset", {
      requireTruthy: true,
    }).length > 0;
  const baseLabel =
    hasDatasetCases || !canFactorCleanly || baseCount !== taskCount ? "case" : "task";

  const factors = [formatCount(baseCount, baseLabel)];
  if (canFactorCleanly) {
    if (modelCount > 0) {
      factors.push(formatCount(modelCount, "model"));
    }
    if (harnessCount > 1) factors.push(formatCount(harnessCount, "harness"));
    if (toolSurfaceCount > 1) {
      factors.push(formatCount(toolSurfaceCount, "tool surface"));
    }
  }
  factors.push(formatCount(trials, "trial"));

  const runs = matrixRows * trials;
  return `${factors.join(" × ")} = ${formatCount(runs, "run")}`;
}

function buildRunContextLine(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  matrix: Array<Record<string, unknown>>,
): string {
  const parts = [`${bold("Env:")} ${cyan(options.environment)}`];
  if (tasks.some((task) => task.tier === "bench")) {
    parts.push(`${bold("Harness:")} ${options.harness}`);
  }

  const toolSurfaces = uniqueStringValues(matrix, "toolSurface", {
    requireTruthy: true,
  });
  if (toolSurfaces.length === 1) {
    parts.push(`${bold("Tool:")} ${toolSurfaces[0]}`);
  }

  parts.push(`${bold("Concurrency:")} ${describeConcurrency(options, matrix)}`);
  return parts.join("  ");
}

/**
 * `10 global · anthropic 3 · openai 3` — the per-provider widths that will
 * actually gate the run, so a 10-wide config against one provider reads as
 * what it is. Falls back to the bare number when no row has a provider.
 */
function describeConcurrency(
  options: ResolvedRunOptions,
  matrix: Array<Record<string, unknown>>,
): string {
  const global = options.concurrency;
  if (!Number.isInteger(global) || global < 1) return String(global);
  const scheduler = ProviderConcurrency.fromEnv(global, {
    configWidths: options.providerConcurrency,
  });
  const widths = describeProviderWidths(
    scheduler,
    matrix.map((row) => (typeof row.provider === "string" ? row.provider : undefined)),
  );
  return widths ? `${global} global · ${widths}` : String(global);
}

/**
 * Mirrors stagehand's `shouldPersistTrajectory(undefined)` (the rule the
 * runner applies), but over an explicit env so the header can include the
 * run's env overrides: VERIFIER_PERSIST_TRAJECTORIES wins, then "on unless CI".
 */
export function trajectoryPersistence(env: NodeJS.ProcessEnv): { on: boolean; why?: string } {
  const flag = env.VERIFIER_PERSIST_TRAJECTORIES?.toLowerCase();
  if (flag === "1" || flag === "true") return { on: true, why: "VERIFIER_PERSIST_TRAJECTORIES" };
  if (flag === "0" || flag === "false")
    return { on: false, why: "VERIFIER_PERSIST_TRAJECTORIES=0" };
  return env.CI ? { on: false, why: "CI is set" } : { on: true };
}

/**
 * `Judge: google/gemini-3.5-flash  Success: outcome  Trajectories: on (.trajectories)`
 * — the verifier settings a bench run will grade with. Resolved over the
 * run's env overrides, so `verifier.model` from config shows up here exactly
 * as the runner will see it.
 */
function buildVerifierContextLine(options: ResolvedRunOptions): string {
  const env = { ...process.env, ...options.envOverrides };
  const judge = resolveVerifierModel(env);
  const fromConfig =
    judge.source === "env" && options.envOverrides.EVAL_VERIFIER_MODEL !== undefined;
  const judgeLabel =
    judge.source === "env"
      ? `${judge.modelName} ${dim(fromConfig ? "(config)" : "(EVAL_VERIFIER_MODEL)")}`
      : judge.modelName;
  const persistence = trajectoryPersistence(env);
  const trajectories = persistence.on
    ? `on ${dim(`(${env.EVAL_TRAJECTORY_ROOT || ".trajectories"})`)}`
    : yellow(`off ${dim(`(${persistence.why})`)}`);
  return [
    `${bold("Judge:")} ${judgeLabel}`,
    `${bold("Success:")} ${options.successMode}`,
    `${bold("Trajectories:")} ${trajectories}`,
  ].join("  ");
}

/** `Running:` / `Plan:` / context / judge lines printed before the progress block. */
export function renderRunHeader(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  matrix: Array<Record<string, unknown>>,
  print: (line: string) => void = (line) => console.log(line),
): void {
  const isBenchRun = tasks.some((task) => task.tier === "bench");
  print(`\n  ${bold("Running:")} ${cyan(buildRunTargetLabel(options))}`);
  print(`  ${bold("Plan:")} ${buildPlanLine(options, matrix)}`);
  print(`  ${buildRunContextLine(options, tasks, matrix)}`);
  if (isBenchRun) print(`  ${buildVerifierContextLine(options)}`);
  print(separator());
  print("");
}

/**
 * Everything printed after the run: pass/fail totals, per-cell table,
 * verifiability + dead-judge banner, failures, experiment link — or the
 * `--json` object. Exit code side effects (dead judge, verifiability gate)
 * live here too. Exported so the summary can be rendered from fixture data.
 */
export function renderRunSummary(
  result: RunEvalsResult,
  options: Pick<ResolvedRunOptions, "harness" | "json" | "verbose" | "target" | "normalizedTarget">,
  progress: ProgressRenderer,
  { isBenchRun, elapsedMs }: { isBenchRun: boolean; elapsedMs?: number },
): void {
  const summaryJson = buildRunSummaryJson({
    results: result.results,
    harness: options.harness,
    experimentName: result.experimentName,
    experimentUrl: result.experimentUrl,
    judgeModel: result.judgeModel,
    trajectoryGroup: result.trajectoryGroup,
    logDir: result.logDir,
  });
  const deadJudge = isDeadJudgeRun(summaryJson.verifier);

  if (options.json) {
    progress.dispose();
    process.stdout.write(`${JSON.stringify(summaryJson, null, 2)}\n`);
    if (deadJudge) process.exitCode = 1;
    applyVerifiabilityGate(result.results, options.harness);
    return;
  }

  progress.printSummary({ totals: !isBenchRun });

  if (result.results.length > 0 && options.verbose) {
    printResultsTable(result.results);
  } else if (result.results.length > 0 && !isBenchRun) {
    printModelSummary(result.results);
  }
  if (isBenchRun && result.results.length > 0) {
    console.log(`  ${buildSummaryHeadline(options, summaryJson, elapsedMs)}`);
    console.log("");
    printCellTable(summarizeCells(result.results, options.harness));
    const gates = Object.entries(summaryJson.gates);
    if (gates.length > 0) {
      console.log(
        dim(
          `  gated = judge passed, a deterministic gate failed it (${gates.map(([gate, n]) => `${gate} ${n}`).join(" · ")})`,
        ),
      );
      console.log("");
    }
  }

  printVerifiabilityLines(result, deadJudge);
  if (isBenchRun) {
    // With a dead judge every row is ungraded for the same reason, which the
    // banner below states once; listing them all would bury the rest.
    const failures = collectFailures(result.results, options.harness);
    printFailures(deadJudge ? failures.filter((failure) => failure.kind !== "ungraded") : failures);
  }
  applyVerifiabilityGate(result.results, options.harness);

  if (deadJudge) {
    const verifier = summarizeVerifier(result.results);
    console.error(
      red(
        `  ✗ judge produced no grades: all ${verifier.ungraded} verifier-backed rows failed closed (${result.judgeModel ?? "judge"}). The pass rate reflects the verifier, not the agent.`,
      ),
    );
    console.log("");
    process.exitCode = 1;
  }

  console.log(
    dim(
      `  Experiment: ${result.experimentName}${result.experimentUrl ? `  ${result.experimentUrl}` : ""}`,
    ),
  );
  if (result.trajectoryGroup) {
    console.log(dim(`  Trajectories: ${result.trajectoryGroup}`));
  }
  if (result.logDir && result.results.some((row) => typeof row.output.logPath === "string")) {
    console.log(dim(`  Logs: ${result.logDir}`));
  }
  console.log("");
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** `hardbenchmark · 46 runs · 35m12s · 1.9M tokens · $4.81 (12/46 rows report cost)` */
function buildSummaryHeadline(
  options: Pick<ResolvedRunOptions, "target" | "normalizedTarget">,
  summary: ReturnType<typeof buildRunSummaryJson>,
  elapsedMs: number | undefined,
): string {
  const name = (options.target ?? options.normalizedTarget ?? "bench").replace(
    /^(?:b|benchmark):|^agent\//,
    "",
  );
  const { usage } = summary;
  const parts = [
    formatCount(summary.summary.total, "run"),
    ...(elapsedMs !== undefined ? [formatElapsed(elapsedMs)] : []),
    ...(usage.totalTokens > 0 ? [`${COMPACT.format(usage.totalTokens)} tokens`] : []),
    ...(usage.costUsd !== undefined
      ? [
          `$${usage.costUsd.toFixed(2)}${usage.costRows < summary.summary.total ? ` (${usage.costRows}/${summary.summary.total} rows report cost)` : ""}`,
        ]
      : []),
  ];
  return `${bold(name)} ${dim(`· ${parts.join(" · ")}`)}`;
}

/**
 * Per-arm verifiability line plus the judge. Dead-judge rows are called out
 * by count; the banner and exit code live in runCommand.
 */
function printVerifiabilityLines(
  result: { results: SummaryRow[]; judgeModel?: string },
  deadJudge: boolean,
): void {
  const verifier = summarizeVerifier(result.results);
  if (verifier.attempted === 0) return;
  const judge = result.judgeModel ? `judge ${result.judgeModel} · ` : "";
  const ungradedPart =
    verifier.ungraded > 0
      ? (deadJudge ? red : yellow)(`${verifier.ungraded} ungraded`)
      : dim("0 ungraded");
  console.log(
    dim(
      `  Verifiability: ${judge}${verifier.unverifiableCriteria}/${verifier.totalCriteria} criteria unverifiable across ${verifier.graded} graded runs · `,
    ) + ungradedPart,
  );
  if (verifier.passesWithoutBrowserUse > 0) {
    console.log(
      yellow(
        `  ⚠ ${verifier.passesWithoutBrowserUse} passes without browser use — not counted as browser passes in Braintrust tags`,
      ),
    );
  }
  console.log("");
}

/**
 * EVAL_MAX_UNVERIFIABLE_CRITERIA gate. Only active when the env var is set;
 * a gated batch must never publish self-reported rows as passes.
 */
function applyVerifiabilityGate(results: SummaryRow[], harness: string): void {
  const unverifiableLimit = resolveUnverifiableCriteriaLimit();
  if (unverifiableLimit === undefined) return;
  const arms = summarizeArmVerifiability(results, harness);
  const over = armsOverLimit(arms, unverifiableLimit);
  for (const arm of over) {
    console.error(
      `  ✗ verifiability gate: ${arm.arm} has ${arm.unverifiableCriteria} unverifiable criteria (limit ${unverifiableLimit})`,
    );
  }
  const ungraded = armsWithUngradedRuns(arms);
  for (const arm of ungraded) {
    console.error(
      `  ✗ verifiability gate: ${arm.arm} has ${arm.ungradedRuns} ungraded (self-reported) runs`,
    );
  }
  // A pass the agent reached without the browser surface is not a
  // browser-benchmark pass, whatever the rubric said.
  const noBrowser = armsWithPassesWithoutBrowserUse(arms);
  for (const arm of noBrowser) {
    console.error(
      `  ✗ verifiability gate: ${arm.arm} has ${arm.passesWithoutBrowserUse} passes without browser use`,
    );
  }
  if (over.length > 0 || ungraded.length > 0 || noBrowser.length > 0) {
    process.exitCode = 1;
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return formatConsoleArgsRaw(...args);
}

type LogMode = "off" | "all" | "one";

const LOG_MODE_CYCLE: Record<LogMode, LogMode> = { off: "all", all: "one", one: "off" };

/** `14:02:11 47e314cc codex   tool browser_navigate …` — one streamed log line. */
function formatStreamLine(event: RunProgressEvent): string {
  const at = new Date().toTimeString().slice(0, 8);
  const who = event.case?.shortId ?? event.taskName ?? "run";
  const entry = event.log!;
  const text = `${dim(at)} ${cyan(who)} ${dim(entry.category)}  ${entry.message}`;
  return `  ${entry.level === 0 ? red(stripAnsi(text)) : text}`;
}

function progressRow(event: RunProgressEvent): ProgressRow {
  return {
    rowKey: event.rowKey,
    taskName: event.taskName ?? "task",
    model: event.modelName,
    case: event.case,
    trial: event.trial,
  };
}

/** Canonical names of the Browserbase credentials that are absent (aliases BB_* count). */
export function missingBrowserbaseKeys(env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if (!(env.BROWSERBASE_API_KEY?.trim() || env.BB_API_KEY?.trim())) {
    missing.push("BROWSERBASE_API_KEY");
  }
  if (!(env.BROWSERBASE_PROJECT_ID?.trim() || env.BB_PROJECT_ID?.trim())) {
    missing.push("BROWSERBASE_PROJECT_ID");
  }
  return missing;
}

export async function runCommand(
  options: ResolvedRunOptions,
  registry?: TaskRegistry,
  signal?: AbortSignal,
): Promise<void> {
  const resolvedTasksRoot = getRuntimeTasksRoot();

  if (!registry) {
    registry = await discoverTasks(resolvedTasksRoot, false);
  }

  const planMode = options.dryRun || options.preview;

  let tasks: DiscoveredTask[];
  try {
    tasks = resolveTarget(registry, options.normalizedTarget);
  } catch (err) {
    if (planMode) {
      await emitDryRun(options, [], registry, (err as Error).message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (tasks.length === 0) {
    const message = options.normalizedTarget
      ? `No runnable tasks found matching "${options.normalizedTarget}".`
      : "No runnable tasks found.";
    if (planMode) {
      await emitDryRun(options, tasks, registry, message);
      process.exitCode = 1;
      return;
    }
    throw new Error(message);
  }

  const hasCoreOnly = tasks.every((task) => task.tier === "core");
  if (hasCoreOnly) {
    const { rejectAgentMountOnlyCoreTool } = await import("../../framework/context.js");
    rejectAgentMountOnlyCoreTool((options.coreToolSurface ?? "understudy_code") as ToolSurface);
  }

  if (options.useApi && options.harness !== "stagehand" && tasks.some((t) => t.tier === "bench")) {
    throw new Error(
      `Harness "${options.harness}" does not support --api. Use --harness stagehand for API-backed bench runs.`,
    );
  }

  if (planMode) {
    await emitDryRun(options, tasks, registry);
    return;
  }

  // Preflight Browserbase credentials once here instead of failing per task
  // inside session creation, N times at concurrency N.
  if (options.environment === "BROWSERBASE") {
    const missing = missingBrowserbaseKeys(process.env);
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(" and ")} missing for --env browserbase — export them or add them to packages/evals/.env`,
      );
    }
  }

  if (!canExecuteBenchHarness(options.harness) && tasks.some((t) => t.tier === "bench")) {
    throw new Error(
      `Harness "${options.harness}" is dry-run only for now. Use ${formatBenchHarnessFlags()} for executable bench runs.`,
    );
  }
  const matrix = await buildDryRunMatrix(options, tasks, registry);

  const isBenchRun = tasks.some((task) => task.tier === "bench");
  // With --json, stdout carries only the summary object: everything a human
  // reads (header, board, console output during the run) goes to stderr.
  const humanStream = options.json ? process.stderr : process.stdout;
  renderRunHeader(
    options,
    tasks,
    matrix,
    options.json ? (line) => console.error(line) : (line) => console.log(line),
  );

  // The animated board rewrites lines in place; without a TTY (CI, pipes)
  // those cursor escapes turn into garbage, so fall back to one line per event.
  const interactive = Boolean(humanStream.isTTY);
  const progress = new ProgressRenderer({
    animated: interactive,
    progressBar: options.verbose && !interactive,
    stream: humanStream,
  });

  // Log streaming: off by default (every row still writes its own file),
  // `-v` streams all rows above the board, `--follow <id>` one row. The `v`
  // key cycles off → all → one (the oldest running row) → off.
  let logMode: LogMode = options.follow ? "one" : options.verbose ? "all" : "off";
  let followedRowKey: string | undefined;
  let helpOpen = false;
  const running = new Map<string, { startedAt: number; shortId?: string }>();
  const followsRow = (event: RunProgressEvent): boolean => {
    if (followedRowKey) return event.rowKey === followedRowKey;
    const prefix = options.follow;
    if (!prefix) return false;
    return Boolean(event.case?.id?.startsWith(prefix) || event.taskName?.includes(prefix));
  };
  const streamsLog = (event: RunProgressEvent): boolean =>
    logMode === "all" || (logMode === "one" && followsRow(event));
  const refreshHints = (): void => {
    if (!interactive) return;
    const followed = followedRowKey ? running.get(followedRowKey)?.shortId : options.follow;
    const mode = logMode === "one" ? `one${followed ? ` (${followed})` : ""}` : logMode;
    progress.setKeyHints(
      helpOpen
        ? `esc stop (twice: stop now) · v logs: off → all → one → off (now ${mode}) · ? close help`
        : `esc stop · v logs: ${mode} · ? help`,
    );
  };
  refreshHints();
  // Key handlers (REPL and argv keypress listeners) reach the run through the
  // active-run registry instead of printing over the redrawn board.
  setActiveRun({
    setStopping: (mode) => progress.setStopping(mode),
    onKey: (name) => {
      if (name === "v") {
        logMode = LOG_MODE_CYCLE[logMode];
        if (logMode === "one") {
          const oldest = [...running.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
          followedRowKey = oldest?.[0];
          if (!followedRowKey && !options.follow) logMode = "off";
        } else {
          followedRowKey = undefined;
        }
        refreshHints();
        return true;
      }
      if (name === "?") {
        helpOpen = !helpOpen;
        refreshHints();
        return true;
      }
      return false;
    },
  });
  const categoryFilter = deriveCategoryFilter(registry, options.normalizedTarget);

  const runStartedAt = Date.now();
  await withEnvOverrides(options.envOverrides, async () => {
    try {
      const { runEvals } = await import("../../framework/runner.js");
      const run = async () =>
        runEvals({
          tasks,
          registry,
          concurrency: options.concurrency,
          trials: options.trials,
          environment: options.environment,
          useApi: options.useApi,
          modelOverride: options.model,
          harness: options.harness,
          categoryFilter,
          datasetFilter: options.datasetFilter,
          coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
          coreStartupProfile: options.coreStartupProfile as StartupProfile | undefined,
          providerConcurrency: options.providerConcurrency,
          verbose: options.verbose,
          signal,
          onProgress: (event: RunProgressEvent) => {
            if (event.type === "planned") {
              progress.onPlanned(event.total ?? 0);
            } else if (event.type === "log" && event.log) {
              if (streamsLog(event)) progress.logLine(formatStreamLine(event));
            } else if (event.type === "started" && event.taskName) {
              if (event.rowKey) {
                running.set(event.rowKey, { startedAt: Date.now(), shortId: event.case?.shortId });
              }
              progress.onStart(progressRow(event));
            } else if (event.type === "phase" && event.taskName && event.phase) {
              progress.onPhase(progressRow(event), event.phase, event.sessionUrl);
            } else if (event.type === "passed" && event.taskName) {
              if (event.rowKey) running.delete(event.rowKey);
              progress.onPass(progressRow(event), event.durationMs, {
                sessionUrl: event.sessionUrl,
              });
            } else if (event.type === "failed" && event.taskName) {
              if (event.rowKey) running.delete(event.rowKey);
              progress.onFail(progressRow(event), {
                error: event.error,
                outcome: event.outcome,
                durationMs: event.durationMs,
                sessionUrl: event.sessionUrl,
              });
            } else if (event.type === "queue" && event.queue) {
              progress.onQueue(event.queue);
            } else if (event.type === "throttled" && event.throttle) {
              progress.onThrottled(rowDisplayName(progressRow(event)), event.throttle);
            }
          },
        });

      const result = await withConsoleCapture(
        run,
        options.verbose ? (text) => progress.logLine(`  ${dim(text)}`) : undefined,
      );
      renderRunSummary(result, options, progress, {
        isBenchRun,
        elapsedMs: Date.now() - runStartedAt,
      });
    } catch (error) {
      progress.dispose();
      throw error;
    } finally {
      setActiveRun(undefined);
    }
  });
}

export function deriveCategoryFilter(
  registry: TaskRegistry,
  normalizedTarget?: string,
): string | undefined {
  if (!normalizedTarget) return undefined;
  if (normalizedTarget === "core" || normalizedTarget === "bench") {
    return undefined;
  }
  if (normalizedTarget.includes(":")) {
    return normalizedTarget.split(":", 2)[1];
  }
  if (normalizedTarget.includes("/")) {
    return undefined;
  }
  return registry.byCategory.has(normalizedTarget) ? normalizedTarget : undefined;
}

export function canExecuteBenchHarness(harness: Harness): boolean {
  return isExecutableBenchHarness(harness);
}

/**
 * Build the deterministic plan payload and render it.
 *
 * Mode is chosen by ResolvedRunOptions.preview:
 *   - false (default, --dry-run) → JSON.stringify to stdout. Shape is fixed:
 *     { target, normalizedTarget, tasks (sorted), envOverrides (sorted),
 *       runOptions (sorted keys), matrix, error? }. Test-support only —
 *     not part of the public CLI contract.
 *   - true (--preview) → renderPreview prints a human-readable table.
 *
 * The payload built here is the single source of truth for both renderers.
 */
async function emitDryRun(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  registry: TaskRegistry,
  error?: string,
): Promise<void> {
  const sortedTasks = tasks.map((t) => t.name).sort();

  const envOverrides: Record<string, string> = {};
  for (const key of Object.keys(options.envOverrides).sort()) {
    envOverrides[key] = options.envOverrides[key];
  }

  const runOptions = sortKeys({
    concurrency: options.concurrency,
    coreStartupProfile: options.coreStartupProfile ?? null,
    coreToolSurface: options.coreToolSurface ?? null,
    datasetFilter: options.datasetFilter ?? null,
    environment: options.environment,
    harness: options.harness,
    model: options.model ?? null,
    trials: options.trials,
    useApi: options.useApi,
    verbose: options.verbose,
  });

  let matrix: Array<Record<string, unknown>> = [];
  let planError = error;
  if (!planError) {
    try {
      matrix = await buildDryRunMatrix(options, tasks, registry);
    } catch (matrixError) {
      planError = matrixError instanceof Error ? matrixError.message : String(matrixError);
      process.exitCode = 1;
    }
  }

  const payload: Record<string, unknown> = {
    target: options.target ?? null,
    normalizedTarget: options.normalizedTarget ?? null,
    tasks: sortedTasks,
    envOverrides,
    runOptions,
    matrix,
  };
  if (planError) payload.error = planError;

  if (options.preview) {
    renderPreview(payload);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

async function buildDryRunMatrix(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  registry: TaskRegistry,
): Promise<Array<Record<string, unknown>>> {
  return withEnvOverrides(options.envOverrides, async () => {
    const rows: Array<Record<string, unknown>> = [];

    for (const task of tasks.filter((t) => t.tier === "core")) {
      rows.push(
        sortKeys({
          tier: "core",
          task: task.name,
          category: task.primaryCategory,
          model: "none",
          environment: options.environment,
        }),
      );
    }

    const benchTasks = tasks.filter((t) => t.tier === "bench");
    if (benchTasks.length > 0) {
      const categoryFilter = deriveCategoryFilter(registry, options.normalizedTarget);
      const testcases = generateBenchTestcases(benchTasks, {
        environment: options.environment,
        useApi: options.useApi,
        modelOverride: options.model,
        harness: options.harness,
        categoryFilter,
        datasetFilter: options.datasetFilter,
        coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
        coreStartupProfile: options.coreStartupProfile as StartupProfile | undefined,
      });

      for (const testcase of testcases) {
        const task =
          registry.byName.get(testcase.input.name) ??
          (testcase.input.name.includes("/")
            ? undefined
            : registry.byName.get(`agent/${testcase.input.name}`));
        const row = task
          ? buildBenchMatrixRow(
              task,
              testcase.input.modelName,
              {
                ...options,
                coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
                coreStartupProfile: options.coreStartupProfile as StartupProfile | undefined,
              },
              testcase.input.params,
            )
          : undefined;
        rows.push(
          sortKeys({
            tier: testcase.metadata.tier ?? "bench",
            task: testcase.metadata.task ?? testcase.input.name,
            category: testcase.metadata.task_category ?? testcase.metadata.category ?? null,
            dataset: testcase.metadata.dataset ?? null,
            model: testcase.input.modelName as AvailableModel,
            harness: testcase.metadata.harness ?? options.harness,
            environment: testcase.metadata.environment ?? options.environment,
            useApi: testcase.metadata.api ?? options.useApi,
            provider: testcase.metadata.provider ?? null,
            toolSurface: testcase.metadata.toolSurface ?? null,
            startupProfile: testcase.metadata.startupProfile ?? null,
            toolCommand: testcase.metadata.toolCommand ?? null,
            browseCliVersion: testcase.metadata.browseCliVersion ?? null,
            browseCliEntrypoint: testcase.metadata.browseCliEntrypoint ?? null,
            harnessConfig: row?.config ?? null,
          }),
        );
      }
    }

    return rows;
  });
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted as T;
}

/**
 * Console output during a run. Inside a row it belongs to that row: it goes
 * to the row's log file (and the live stream when enabled) instead of
 * scribbling over the board. Outside a row (Braintrust, the runner itself)
 * it's dropped unless `outside` is given.
 */
async function withConsoleCapture<T>(
  fn: () => Promise<T>,
  outside?: (text: string) => void,
): Promise<T> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const route =
    (level: number) =>
    (...args: unknown[]): void => {
      const message = formatConsoleArgs(args);
      if (!logToRow({ category: "console", message, level })) outside?.(message);
    };
  console.log = route(1);
  console.info = route(1);
  console.debug = route(2);
  console.warn = route(1);
  console.error = route(0);
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}
