/**
 * Data layer for Braintrust core experiment comparisons.
 *
 * Pure functions — no filesystem writes, no DOM, no process.exit, no CLI.
 * Use this from scripts, CI checks, custom reports, or any tool that needs
 * typed access to Braintrust experiment data + per-task metric aggregations.
 *
 * Example:
 *   import { fetchManyExperimentData, sharedMetricKeys } from "./lib/braintrust-report.js";
 *
 *   const rows = await fetchManyExperimentData("stagehand-core-dev", [
 *     { label: "Understudy", experiment: "051af398-..." },
 *     { label: "Playwright", experiment: "7c8cc2af-..." },
 *   ]);
 *   const keys = sharedMetricKeys(rows);
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

type BraintrustModule = typeof import("braintrust");
type BraintrustState = Awaited<ReturnType<BraintrustModule["loginToState"]>>;

let braintrustPromise: Promise<BraintrustModule> | undefined;

function loadBraintrust(): Promise<BraintrustModule> {
  braintrustPromise ??= import("braintrust");
  return braintrustPromise;
}

async function loginBraintrust(apiKey: string): Promise<BraintrustState> {
  const { loginToState } = await loadBraintrust();
  return loginToState({ apiKey });
}

const stateCache = new Map<string, Promise<BraintrustState>>();
const lookupCache = new Map<string, Promise<BraintrustExperimentRow | null>>();
const comparisonCache = new Map<string, Promise<ExperimentComparison>>();
const eventsCache = new Map<string, Promise<ExperimentEvent[]>>();
const recentRowsCache = new Map<string, Promise<BraintrustExperimentRow[]>>();

export function clearBraintrustReportCache(): void {
  stateCache.clear();
  lookupCache.clear();
  comparisonCache.clear();
  eventsCache.clear();
  recentRowsCache.clear();
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExperimentInput = {
  label: string;
  /** Experiment name OR UUID — both are accepted. */
  experiment: string;
  /** Optional per-experiment project for cross-project comparisons. */
  project?: string;
};

export type BraintrustExperimentRow = {
  id: string;
  name: string;
  project_id?: string;
  created?: string;
};

export type BraintrustExperimentListItem = BraintrustExperimentRow & {
  project: string;
};

export type ScoreSummary = {
  name: string;
  score: number;
  diff?: number;
  improvements: number;
  regressions: number;
};

export type MetricSummary = {
  name: string;
  metric: number;
  unit: string;
  diff?: number;
  improvements: number;
  regressions: number;
};

export type ExperimentComparison = {
  scores: Record<string, ScoreSummary>;
  metrics: Record<string, MetricSummary>;
};

export type EventMetric =
  | number
  | {
      value?: number;
      count?: number;
      avg?: number;
      min?: number;
      max?: number;
      p50?: number;
      p99?: number;
    }
  | null
  | undefined;

/**
 * A Braintrust event row. Root events (no span parents) carry the per-task
 * summary; child events (`session.startup`, `task`, `cleanup`, scorer spans)
 * are intermediate spans.
 */
export type ExperimentEvent = {
  id?: string;
  span_parents?: string[] | null;
  is_root?: boolean;
  input?: { name?: string; [key: string]: unknown } | string | null;
  output?: {
    _success?: boolean;
    error?: unknown;
    metrics?: Record<string, EventMetric>;
    [key: string]: unknown;
  } | null;
  scores?: Record<string, number | null | undefined>;
  metrics?: Record<string, EventMetric>;
  metadata?: Record<string, unknown>;
};

export type MetricAggregate = {
  mean: number;
  min: number;
  max: number;
  count: number;
};

export type TaskRow = {
  name: string;
  success: boolean;
  totalMs?: number;
};

export type ExperimentMode = "core" | "bench";

export type BenchCaseRow = {
  key: string;
  suite: string;
  dataset?: string;
  taskId?: string;
  taskName: string;
  harness?: string;
  model?: string;
  provider?: string;
  environment?: string;
  api?: boolean;
  toolSurface?: string;
  startupProfile?: string;
  agentMode?: string;
  trial: number;
  success: boolean;
  durationMs?: number;
  metrics: Record<string, number>;
  website?: string;
  category?: string;
  error?: unknown;
};

export type BenchCaseDiff = {
  key: string;
  suite: string;
  dataset?: string;
  taskId?: string;
  taskName: string;
  model?: string;
  agentMode?: string;
  website?: string;
  category?: string;
  outcomes: Array<{
    label: string;
    project: string;
    passed: boolean | null;
    durationMs: number | null;
  }>;
  differs: boolean;
  missing: boolean;
};

export type ExperimentData = {
  label: string;
  experimentName: string;
  experimentId: string;
  experimentUrl: string;
  projectName: string;
  mode: ExperimentMode;
  createdAt?: string;
  passScore: number;
  totalTasks: number;
  passedTasks: number;
  durationSeconds: number;
  errorsMetric: number;
  /** Aggregate scores and metrics from Braintrust's experiment-comparison2 API. */
  raw: ExperimentComparison;
  /** Per-task metrics (e.g. startup_ms, task_ms, click_ms) aggregated across all tasks. */
  taskMetrics: Record<string, MetricAggregate>;
  /** Individual task runs with pass/fail + total duration. */
  tasks: TaskRow[];
  /** Individual bench suite cases, keyed by dataset/task/model/agent mode/trial. */
  benchCases: BenchCaseRow[];
};

export type BenchGroupSummary = {
  name: string;
  total: number;
  passed: number;
  passScore: number;
  meanDurationMs?: number;
};

export type BenchAgentConfigSummary = {
  key: string;
  label: string;
  harness?: string;
  provider?: string;
  environment?: string;
  api?: boolean;
  toolSurface?: string;
  startupProfile?: string;
  agentMode?: string;
  models: string[];
  total: number;
  passed: number;
  passScore: number;
  meanDurationMs?: number;
  metrics: Record<string, MetricAggregate>;
};

export type ExperimentMetricRow = {
  key: string;
  label: string;
  unit: string;
  values: Array<number | null>;
};

export type RecentExperimentData = {
  experimentName: string;
  experimentId: string;
  experimentUrl: string;
  projectName: string;
  createdAt?: string;
  passScore?: number;
  durationSeconds?: number;
};

export type ResolvedExperimentProject = {
  projectName: string;
  experimentId: string;
  experimentName: string;
};

export type FetchOptions = {
  /**
   * Braintrust API key. If omitted, pulled from:
   *   1. packages/evals/.env (BRAINTRUST_API_KEY)
   *   2. process.env.BRAINTRUST_API_KEY
   */
  apiKey?: string;
  /**
   * Max concurrent Braintrust fetches for fan-out helpers. Defaults to 1
   * because report commands are interactive and Braintrust rate limits are
   * easier to hit than local CPU limits.
   */
  fetchConcurrency?: number;
  /** Reuse in-process Braintrust lookups and payloads. Defaults to true. */
  cache?: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shouldCache(options: FetchOptions): boolean {
  return options.cache !== false;
}

function cachePromise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  enabled: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  let promise = cache.get(key);
  if (!promise) {
    promise = fn().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, promise);
  }
  return promise;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number | undefined,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit =
    Number.isSafeInteger(concurrency) && concurrency && concurrency > 0
      ? concurrency
      : 1;
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function cacheKey(...parts: string[]): string {
  return parts.join("\0");
}

function braintrustCacheScope(apiKey: string, state: BraintrustState): string {
  return cacheKey(apiKey, state.orgName ?? "", state.appPublicUrl ?? "");
}

async function getBraintrustState(
  apiKey: string,
  options: FetchOptions,
): Promise<BraintrustState> {
  return cachePromise(stateCache, apiKey, shouldCache(options), () =>
    loginBraintrust(apiKey),
  );
}

function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // this file lives at packages/evals/lib/braintrust-report.ts
  return path.resolve(here, "..");
}

/**
 * Resolve a Braintrust API key from (in order):
 *   1. explicit apiKey parameter
 *   2. packages/evals/.env
 *   3. process.env.BRAINTRUST_API_KEY
 */
export function resolveApiKey(apiKey?: string): string {
  if (apiKey) return apiKey;

  const envPath = path.join(packageRoot(), ".env");
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
    if (parsed.BRAINTRUST_API_KEY) return parsed.BRAINTRUST_API_KEY;
  }

  const fromEnv = process.env.BRAINTRUST_API_KEY;
  if (fromEnv) return fromEnv;

  throw new Error(
    "BRAINTRUST_API_KEY is not set. Provide it via options, .env, or process.env.",
  );
}

function numberOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return stringValue(record?.[key]);
}

function readBoolean(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function metricAggregate(values: number[]): MetricAggregate | undefined {
  if (values.length === 0) return undefined;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    mean: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  };
}

function extractNumericMetrics(
  record: Record<string, EventMetric> | undefined,
): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (!record) return metrics;
  for (const [key, payload] of Object.entries(record)) {
    const value = extractMetricValue(payload);
    if (value !== undefined) metrics[key] = value;
  }
  return metrics;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

function stripCaseSuffix(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const idx = value.indexOf(":");
  return idx === -1 ? value : value.slice(0, idx);
}

function suffixAfterColon(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const idx = value.lastIndexOf(":");
  if (idx === -1 || idx === value.length - 1) return undefined;
  return value.slice(idx + 1);
}

function getInputRecord(
  event: ExperimentEvent,
): Record<string, unknown> | undefined {
  return asRecord(event.input);
}

function getOutputRecord(
  event: ExperimentEvent,
): Record<string, unknown> | undefined {
  return asRecord(event.output);
}

function deriveDataset(
  explicit: string | undefined,
  suite: string | undefined,
  taskName: string | undefined,
): string | undefined {
  if (explicit) return explicit;
  const combined = `${suite ?? ""} ${taskName ?? ""}`.toLowerCase();
  if (combined.includes("webvoyager")) return "webvoyager";
  if (combined.includes("onlinemind2web")) return "onlineMind2Web";
  if (combined.includes("webtailbench")) return "webtailbench";
  if (combined.includes("gaia")) return "gaia";
  if (suite?.startsWith("agent/")) return suite.slice("agent/".length);
  return undefined;
}

function extractPrimaryScore(
  comparison: ExperimentComparison,
): number | undefined {
  for (const key of ["Pass", "Exact match", "Corrected"]) {
    const score = comparison.scores[key]?.score;
    if (typeof score === "number" && Number.isFinite(score)) {
      return score;
    }
  }
  return undefined;
}

/**
 * Pull a representative scalar from a Braintrust metric payload.
 * Metrics can be:
 *   - a plain number
 *   - { count: 1, value: N } (single measurement, from our framework)
 *   - { count: N, min, max, avg, p50, p99 } (multi-measurement)
 */
export function extractMetricValue(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, number | undefined>;
    if (typeof obj.value === "number" && Number.isFinite(obj.value))
      return obj.value;
    if (typeof obj.avg === "number" && Number.isFinite(obj.avg)) return obj.avg;
    if (typeof obj.p50 === "number" && Number.isFinite(obj.p50)) return obj.p50;
  }
  return undefined;
}

export function isRootEvent(event: ExperimentEvent): boolean {
  if (event.is_root === true) return true;
  if (event.is_root === false) return false;
  return !event.span_parents || event.span_parents.length === 0;
}

/**
 * Our framework (packages/evals/framework/runner.ts, core path) writes
 * per-task timing metrics onto `output.metrics`. This returns that object
 * if present.
 */
export function getTaskMetrics(
  event: ExperimentEvent,
): Record<string, EventMetric> | undefined {
  const output = event.output;
  if (
    output &&
    typeof output === "object" &&
    output.metrics &&
    typeof output.metrics === "object"
  ) {
    return output.metrics;
  }
  return undefined;
}

/**
 * Aggregate per-task metrics across root events in an experiment.
 * Skips non-root events so scorer/subspan metrics do not pollute the aggregate.
 */
export function aggregateMetrics(
  events: ExperimentEvent[],
): Record<string, MetricAggregate> {
  const buckets: Record<string, number[]> = {};
  for (const event of events) {
    if (!isRootEvent(event)) continue;
    const metrics = getTaskMetrics(event);
    if (!metrics) continue;
    for (const [key, payload] of Object.entries(metrics)) {
      const value = extractMetricValue(payload);
      if (value === undefined) continue;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(value);
    }
  }
  const result: Record<string, MetricAggregate> = {};
  for (const [key, values] of Object.entries(buckets)) {
    const aggregate = metricAggregate(values);
    if (aggregate) result[key] = aggregate;
  }
  return result;
}

/**
 * Extract one TaskRow per unique task name from root events.
 */
export function extractTasks(events: ExperimentEvent[]): TaskRow[] {
  const tasks: TaskRow[] = [];
  for (const event of events) {
    if (!isRootEvent(event)) continue;
    let name = "";
    if (typeof event.input === "string") {
      name = event.input;
    } else if (event.input && typeof event.input === "object") {
      const rec = event.input as Record<string, unknown>;
      if (typeof rec.name === "string") name = rec.name;
    }
    if (!name && event.metadata && typeof event.metadata.test === "string") {
      name = event.metadata.test as string;
    }
    if (!name) continue;

    const out = event.output as Record<string, unknown> | null | undefined;
    const success = !!(out && out._success === true);
    const taskMetrics = getTaskMetrics(event);
    const totalMs = taskMetrics
      ? extractMetricValue(taskMetrics.total_ms)
      : undefined;
    tasks.push({ name, success, totalMs });
  }
  const seen = new Set<string>();
  const deduped: TaskRow[] = [];
  for (const t of tasks) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    deduped.push(t);
  }
  deduped.sort((a, b) => a.name.localeCompare(b.name));
  return deduped;
}

export function inferExperimentMode(
  project: string,
  events: ExperimentEvent[],
): ExperimentMode {
  for (const event of events) {
    if (!isRootEvent(event)) continue;
    const metadata = event.metadata;
    const input = getInputRecord(event);
    const taskName = firstString(
      readString(metadata, "task"),
      readString(metadata, "test"),
      readString(input, "name"),
      typeof event.input === "string" ? event.input : undefined,
    );
    const tier = readString(metadata, "tier");

    if (tier === "core") return "core";
    if (tier === "bench") return "bench";
    if (readString(metadata, "dataset")) return "bench";
    if (readString(metadata, "harness")) return "bench";
    if (readString(input, "agentMode")) return "bench";
    const modelName = readString(input, "modelName");
    if (modelName && modelName !== "none") return "bench";
    if (taskName?.startsWith("agent/")) return "bench";
  }

  return project.toLowerCase().includes("core") ? "core" : "bench";
}

export function extractBenchCases(events: ExperimentEvent[]): BenchCaseRow[] {
  const cases: BenchCaseRow[] = [];
  const trialCounts = new Map<string, number>();

  for (const event of events) {
    if (!isRootEvent(event)) continue;

    const metadata = event.metadata;
    const input = getInputRecord(event);
    const params = asRecord(input?.params);
    const output = getOutputRecord(event);
    const inputName = firstString(
      readString(input, "name"),
      typeof event.input === "string" ? event.input : undefined,
    );
    const metadataTest = readString(metadata, "test");
    const metadataTask = readString(metadata, "task");
    const suite = firstString(
      metadataTask,
      stripCaseSuffix(metadataTest),
      stripCaseSuffix(inputName),
      "bench",
    )!;
    const taskName = firstString(metadataTest, inputName, suite)!;
    const dataset = deriveDataset(
      readString(metadata, "dataset"),
      suite,
      taskName,
    );
    const taskId = firstString(
      readString(metadata, "task_id"),
      readString(params, "task_id"),
      readString(params, "id"),
      readString(input, "task_id"),
      readString(input, "id"),
      suffixAfterColon(metadataTest),
      suffixAfterColon(inputName),
    );
    const model = firstString(
      readString(metadata, "model"),
      readString(input, "modelName"),
      readString(input, "model"),
    );
    const harness = readString(metadata, "harness");
    const provider = firstString(
      readString(metadata, "provider"),
      readString(input, "provider"),
    );
    const environment = readString(metadata, "environment");
    const api = readBoolean(metadata, "api");
    const toolSurface = readString(metadata, "toolSurface");
    const startupProfile = readString(metadata, "startupProfile");
    const agentMode = firstString(
      readString(metadata, "agentMode"),
      readString(input, "agentMode"),
      readBoolean(input, "isCUA") === true ? "cua" : undefined,
    );
    const website = firstString(
      readString(metadata, "website"),
      readString(params, "web_name"),
      readString(params, "website"),
      readString(params, "web"),
    );
    const category = firstString(
      readString(metadata, "task_category"),
      readString(metadata, "category"),
      readString(params, "category"),
    );

    const trialIdentity = [
      dataset ?? suite,
      taskId ?? taskName,
      model ?? "unknown-model",
      agentMode ?? "default",
    ].join("\0");
    const explicitTrial = firstString(
      readString(metadata, "trial"),
      readString(input, "trial"),
      readString(params, "trial"),
    );
    let trial = explicitTrial ? numberValue(explicitTrial) : undefined;
    if (trial === undefined) {
      trial = (trialCounts.get(trialIdentity) ?? 0) + 1;
      trialCounts.set(trialIdentity, trial);
    }

    const key = [
      dataset ?? suite,
      taskId ?? taskName,
      model ?? "unknown-model",
      agentMode ?? "default",
      String(trial),
    ].join("::");
    const taskMetrics = getTaskMetrics(event);
    const durationMs =
      extractMetricValue(taskMetrics?.total_ms) ??
      extractMetricValue(taskMetrics?.duration_ms) ??
      extractMetricValue(taskMetrics?.task_ms);
    const metrics = {
      ...extractNumericMetrics(event.metrics),
      ...extractNumericMetrics(taskMetrics),
    };

    cases.push({
      key,
      suite,
      dataset,
      taskId,
      taskName,
      harness,
      model,
      provider,
      environment,
      api,
      toolSurface,
      startupProfile,
      agentMode,
      trial,
      success: readBoolean(output, "_success") === true,
      durationMs,
      metrics,
      website,
      category,
      error: output?.error,
    });
  }

  cases.sort(
    (a, b) =>
      [
        a.suite.localeCompare(b.suite),
        (a.dataset ?? "").localeCompare(b.dataset ?? ""),
        (a.taskId ?? "").localeCompare(b.taskId ?? ""),
        (a.model ?? "").localeCompare(b.model ?? ""),
        (a.agentMode ?? "").localeCompare(b.agentMode ?? ""),
        a.trial - b.trial,
      ].find((value) => value !== 0) ?? 0,
  );
  return cases;
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

async function fetchExperimentEventsInternal(
  project: string,
  experimentName: string,
  apiKey: string,
  cacheScope: string,
  options: FetchOptions,
): Promise<ExperimentEvent[]> {
  return cachePromise(
    eventsCache,
    cacheKey(cacheScope, project, experimentName),
    shouldCache(options),
    async () => {
      try {
        const { init: initExperiment } = await loadBraintrust();
        const experiment = initExperiment(project, {
          experiment: experimentName,
          open: true,
          apiKey,
        });
        const data = await experiment.fetchedData();
        return data as unknown as ExperimentEvent[];
      } catch (err) {
        console.warn(
          `Could not fetch events for "${experimentName}" in "${project}": ${err instanceof Error ? err.message : err}`,
        );
        return [];
      }
    },
  );
}

function buildExperimentUrl(
  appPublicUrl: string,
  orgName: string,
  project: string,
  experimentName: string,
): string {
  return `${appPublicUrl}/app/${encodeURIComponent(
    orgName ?? "Browserbase",
  )}/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(
    experimentName,
  )}`;
}

async function lookupExperiment(
  state: BraintrustState,
  project: string,
  input: string,
  cacheScope: string,
  options: FetchOptions = {},
): Promise<BraintrustExperimentRow | null> {
  return cachePromise(
    lookupCache,
    cacheKey(cacheScope, project, input),
    shouldCache(options),
    async () => {
      const response = (await state.apiConn().get_json("/v1/experiment", {
        project_name: project,
        org_name: state.orgName,
        limit: "1",
        ...(UUID_RE.test(input)
          ? { ids: [input] }
          : { experiment_name: input }),
      })) as { objects?: BraintrustExperimentRow[] };

      return response.objects?.[0] ?? null;
    },
  );
}

async function fetchExperimentComparison(
  state: BraintrustState,
  experimentId: string,
  cacheScope: string,
  options: FetchOptions,
): Promise<ExperimentComparison> {
  return cachePromise(
    comparisonCache,
    cacheKey(cacheScope, experimentId),
    shouldCache(options),
    () =>
      state.apiConn().get_json("/experiment-comparison2", {
        experiment_id: experimentId,
      }) as Promise<ExperimentComparison>,
  );
}

async function fetchExperimentDataForRow(
  state: BraintrustState,
  project: string,
  experiment: BraintrustExperimentRow,
  label: string,
  apiKey: string,
  cacheScope: string,
  options: FetchOptions,
): Promise<ExperimentData> {
  const comparison = await fetchExperimentComparison(
    state,
    experiment.id,
    cacheScope,
    options,
  );
  const events = await fetchExperimentEventsInternal(
    project,
    experiment.name,
    apiKey,
    cacheScope,
    options,
  );

  const passScore = numberOrZero(extractPrimaryScore(comparison));
  const durationSeconds = numberOrZero(comparison.metrics.duration?.metric);
  const errorsMetric = numberOrZero(comparison.metrics.errors?.metric);

  const mode = inferExperimentMode(project, events);
  const taskMetrics = aggregateMetrics(events);
  const tasks = mode === "core" ? extractTasks(events) : [];
  const benchCases = mode === "bench" ? extractBenchCases(events) : [];
  const passedTasks =
    mode === "bench"
      ? benchCases.filter((benchCase) => benchCase.success).length
      : tasks.filter((task) => task.success).length;
  const totalTasks = mode === "bench" ? benchCases.length : tasks.length;
  const computedPassScore =
    totalTasks > 0 ? passedTasks / totalTasks : passScore;

  const experimentUrl = buildExperimentUrl(
    state.appPublicUrl,
    state.orgName ?? "Browserbase",
    project,
    experiment.name,
  );

  return {
    label,
    experimentName: experiment.name,
    experimentId: experiment.id,
    experimentUrl,
    projectName: project,
    mode,
    createdAt: experiment.created,
    passScore: computedPassScore,
    totalTasks,
    passedTasks,
    durationSeconds,
    errorsMetric,
    raw: comparison,
    taskMetrics,
    tasks,
    benchCases,
  };
}

async function fetchRecentExperimentDataForRow(
  state: BraintrustState,
  project: string,
  experiment: BraintrustExperimentRow,
  cacheScope: string,
  options: FetchOptions,
): Promise<RecentExperimentData> {
  const comparison = await fetchExperimentComparison(
    state,
    experiment.id,
    cacheScope,
    options,
  ).catch((): ExperimentComparison | null => null);

  return {
    experimentName: experiment.name,
    experimentId: experiment.id,
    experimentUrl: buildExperimentUrl(
      state.appPublicUrl,
      state.orgName ?? "Browserbase",
      project,
      experiment.name,
    ),
    projectName: project,
    createdAt: experiment.created,
    passScore:
      comparison !== null
        ? numberOrZero(extractPrimaryScore(comparison))
        : undefined,
    durationSeconds:
      comparison !== null
        ? numberOrZero(comparison.metrics.duration?.metric)
        : undefined,
  };
}

/**
 * Fetch a single experiment's aggregate scores, per-task events, and computed
 * metric aggregates. Accepts either a Braintrust experiment name or UUID.
 */
export async function fetchExperimentData(
  project: string,
  input: ExperimentInput,
  options: FetchOptions = {},
): Promise<ExperimentData> {
  const apiKey = resolveApiKey(options.apiKey);
  const state = await getBraintrustState(apiKey, options);
  const cacheScope = braintrustCacheScope(apiKey, state);
  const resolvedProject = input.project ?? project;
  const experiment = await lookupExperiment(
    state,
    resolvedProject,
    input.experiment,
    cacheScope,
    options,
  );
  if (!experiment) {
    throw new Error(
      `Experiment "${input.experiment}" not found in project "${resolvedProject}"`,
    );
  }
  return fetchExperimentDataForRow(
    state,
    resolvedProject,
    experiment,
    input.label,
    apiKey,
    cacheScope,
    options,
  );
}

/**
 * Fetch many experiments with conservative concurrency and in-process caching.
 */
export async function fetchManyExperimentData(
  project: string,
  inputs: ExperimentInput[],
  options: FetchOptions = {},
): Promise<ExperimentData[]> {
  const apiKey = resolveApiKey(options.apiKey);
  const state = await getBraintrustState(apiKey, options);
  const cacheScope = braintrustCacheScope(apiKey, state);
  return mapWithConcurrency(inputs, options.fetchConcurrency, async (input) => {
    const resolvedProject = input.project ?? project;
    const experiment = await lookupExperiment(
      state,
      resolvedProject,
      input.experiment,
      cacheScope,
      options,
    );
    if (!experiment) {
      throw new Error(
        `Experiment "${input.experiment}" not found in project "${resolvedProject}"`,
      );
    }
    return fetchExperimentDataForRow(
      state,
      resolvedProject,
      experiment,
      input.label,
      apiKey,
      cacheScope,
      options,
    );
  });
}

export async function listRecentExperiments(
  project: string,
  limit = 5,
  options: FetchOptions = {},
): Promise<RecentExperimentData[]> {
  const apiKey = resolveApiKey(options.apiKey);
  const state = await getBraintrustState(apiKey, options);
  const cacheScope = braintrustCacheScope(apiKey, state);
  const rows = await cachePromise(
    recentRowsCache,
    cacheKey(cacheScope, project, String(limit)),
    shouldCache(options),
    async () => {
      const response = (await state.apiConn().get_json("/v1/experiment", {
        project_name: project,
        org_name: state.orgName,
        limit: String(limit),
      })) as { objects?: BraintrustExperimentRow[] };
      return (response.objects ?? []).slice(0, limit);
    },
  );

  return mapWithConcurrency(rows, options.fetchConcurrency, (experiment) =>
    fetchRecentExperimentDataForRow(
      state,
      project,
      experiment,
      cacheScope,
      options,
    ),
  );
}

export async function resolveExperimentAcrossProjects(
  projects: string[],
  experiment: string,
  options: FetchOptions = {},
): Promise<ExperimentData> {
  const apiKey = resolveApiKey(options.apiKey);
  const state = await getBraintrustState(apiKey, options);
  const cacheScope = braintrustCacheScope(apiKey, state);
  const matches: ExperimentData[] = [];

  for (const project of projects) {
    const found = await lookupExperiment(
      state,
      project,
      experiment,
      cacheScope,
      options,
    );
    if (!found) continue;
    matches.push(
      await fetchExperimentDataForRow(
        state,
        project,
        found,
        found.name,
        apiKey,
        cacheScope,
        options,
      ),
    );
  }

  if (matches.length === 0) {
    throw new Error(
      `Experiment "${experiment}" not found in ${projects.join(", ")}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Experiment "${experiment}" is ambiguous across ${projects.join(", ")}. Pass --project.`,
    );
  }
  return matches[0];
}

export async function resolveExperimentProjectAcrossProjects(
  projects: string[],
  experiment: string,
  options: FetchOptions = {},
): Promise<ResolvedExperimentProject> {
  const apiKey = resolveApiKey(options.apiKey);
  const state = await getBraintrustState(apiKey, options);
  const cacheScope = braintrustCacheScope(apiKey, state);
  const matches: ResolvedExperimentProject[] = [];

  for (const project of projects) {
    const found = await lookupExperiment(
      state,
      project,
      experiment,
      cacheScope,
      options,
    );
    if (!found) continue;
    matches.push({
      projectName: project,
      experimentId: found.id,
      experimentName: found.name,
    });
  }

  if (matches.length === 0) {
    throw new Error(
      `Experiment "${experiment}" not found in ${projects.join(", ")}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Experiment "${experiment}" is ambiguous across ${projects.join(", ")}. Pass --project.`,
    );
  }

  return matches[0];
}

export async function resolveExperimentProjectsAcrossProjects(
  projects: string[],
  inputs: ExperimentInput[],
  options: FetchOptions = {},
): Promise<ResolvedExperimentProject[]> {
  const apiKey = resolveApiKey(options.apiKey);
  const state = await getBraintrustState(apiKey, options);
  const cacheScope = braintrustCacheScope(apiKey, state);

  return mapWithConcurrency(inputs, options.fetchConcurrency, async (input) => {
    const searchProjects = input.project ? [input.project] : projects;
    const matches: ResolvedExperimentProject[] = [];

    for (const project of searchProjects) {
      const found = await lookupExperiment(
        state,
        project,
        input.experiment,
        cacheScope,
        options,
      );
      if (!found) continue;
      matches.push({
        projectName: project,
        experimentId: found.id,
        experimentName: found.name,
      });
    }

    if (matches.length === 0) {
      throw new Error(
        `Experiment "${input.experiment}" not found in ${searchProjects.join(", ")}.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Experiment "${input.experiment}" is ambiguous across ${searchProjects.join(", ")}. Add --project or use an unambiguous experiment id.`,
      );
    }

    return matches[0];
  });
}

// ---------------------------------------------------------------------------
// Comparison helpers — useful for N-way analysis
// ---------------------------------------------------------------------------

/**
 * Task names present in every row (the comparable overlap).
 */
export function sharedTaskNames(rows: ExperimentData[]): string[] {
  if (rows.length === 0) return [];
  const [first, ...rest] = rows;
  const initial = new Set(first.tasks.map((t) => t.name));
  for (const r of rest) {
    const names = new Set(r.tasks.map((t) => t.name));
    for (const name of [...initial]) {
      if (!names.has(name)) initial.delete(name);
    }
  }
  return [...initial].sort();
}

/**
 * Metric keys present in every row's taskMetrics (the comparable overlap).
 */
export function sharedMetricKeys(rows: ExperimentData[]): string[] {
  if (rows.length === 0) return [];
  const [first, ...rest] = rows;
  const initial = new Set(Object.keys(first.taskMetrics));
  for (const r of rest) {
    const keys = new Set(Object.keys(r.taskMetrics));
    for (const k of [...initial]) {
      if (!keys.has(k)) initial.delete(k);
    }
  }
  return [...initial].sort();
}

export function experimentModeForRow(row: ExperimentData): ExperimentMode {
  const mode = (row as { mode?: unknown }).mode;
  if (mode === "core" || mode === "bench") return mode;
  const benchCases = (row as { benchCases?: unknown }).benchCases;
  if (Array.isArray(benchCases) && benchCases.length > 0) return "bench";
  if (row.tasks.some((task) => task.name.startsWith("agent/"))) return "bench";
  return row.projectName.toLowerCase().includes("core") ? "core" : "bench";
}

export function detectCompareMode(rows: ExperimentData[]): ExperimentMode {
  if (rows.length === 0) return "core";
  const modes = new Set(rows.map((row) => experimentModeForRow(row)));
  if (modes.size > 1) {
    throw new Error(
      "Cannot compare core and bench experiments together yet. Compare only core experiments or only bench experiments.",
    );
  }
  return [...modes][0] ?? "core";
}

export function sharedBenchCaseKeys(rows: ExperimentData[]): string[] {
  if (rows.length === 0) return [];
  const [first, ...rest] = rows;
  const initial = new Set(
    (first.benchCases ?? []).map((benchCase) => benchCase.key),
  );
  for (const row of rest) {
    const keys = new Set(
      (row.benchCases ?? []).map((benchCase) => benchCase.key),
    );
    for (const key of [...initial]) {
      if (!keys.has(key)) initial.delete(key);
    }
  }
  return [...initial].sort();
}

export function benchCaseDiffs(rows: ExperimentData[]): BenchCaseDiff[] {
  const caseByKey = new Map<string, BenchCaseRow>();
  const keys = new Set<string>();

  for (const row of rows) {
    for (const benchCase of row.benchCases ?? []) {
      keys.add(benchCase.key);
      if (!caseByKey.has(benchCase.key)) {
        caseByKey.set(benchCase.key, benchCase);
      }
    }
  }

  return [...keys].sort().map((key) => {
    const template = caseByKey.get(key)!;
    const outcomes = rows.map((row) => {
      const benchCase = (row.benchCases ?? []).find(
        (candidate) => candidate.key === key,
      );
      return {
        label: row.label,
        project: row.projectName,
        passed: benchCase ? benchCase.success : null,
        durationMs: benchCase?.durationMs ?? null,
      };
    });
    const availableOutcomes = outcomes
      .map((outcome) => outcome.passed)
      .filter((value): value is boolean => value !== null);
    return {
      key,
      suite: template.suite,
      dataset: template.dataset,
      taskId: template.taskId,
      taskName: template.taskName,
      model: template.model,
      agentMode: template.agentMode,
      website: template.website,
      category: template.category,
      outcomes,
      differs: new Set(availableOutcomes).size > 1,
      missing: outcomes.some((outcome) => outcome.passed === null),
    };
  });
}

export function summarizeBenchCases(
  cases: BenchCaseRow[],
  groupBy: (benchCase: BenchCaseRow) => string | undefined,
): BenchGroupSummary[] {
  const groups = new Map<string, BenchCaseRow[]>();
  for (const benchCase of cases) {
    const name = groupBy(benchCase) ?? "unknown";
    const group = groups.get(name) ?? [];
    group.push(benchCase);
    groups.set(name, group);
  }

  return [...groups.entries()]
    .map(([name, group]) => {
      const durations = group
        .map((benchCase) => benchCase.durationMs)
        .filter((value): value is number => typeof value === "number");
      const passed = group.filter((benchCase) => benchCase.success).length;
      return {
        name,
        total: group.length,
        passed,
        passScore: group.length > 0 ? passed / group.length : 0,
        meanDurationMs:
          durations.length > 0
            ? durations.reduce((sum, value) => sum + value, 0) /
              durations.length
            : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function agentConfigKey(benchCase: BenchCaseRow): string {
  return [
    benchCase.harness ?? "stagehand",
    benchCase.provider ?? "",
    benchCase.environment ?? "",
    benchCase.api === undefined ? "" : benchCase.api ? "api" : "local",
    benchCase.toolSurface ?? "",
    benchCase.startupProfile ?? "",
    benchCase.agentMode ?? "default",
  ].join("::");
}

function agentConfigLabel(benchCase: BenchCaseRow): string {
  const parts = [
    benchCase.harness ?? "stagehand",
    benchCase.agentMode,
    benchCase.provider,
    benchCase.environment,
    benchCase.api === undefined ? undefined : benchCase.api ? "api" : "direct",
    benchCase.toolSurface,
    benchCase.startupProfile,
  ].filter((value): value is string => !!value);
  return parts.length > 0 ? parts.join(" / ") : "default";
}

function aggregateCaseMetrics(
  cases: BenchCaseRow[],
): Record<string, MetricAggregate> {
  const buckets: Record<string, number[]> = {};
  for (const benchCase of cases) {
    for (const [key, value] of Object.entries(benchCase.metrics)) {
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(value);
    }
  }

  const result: Record<string, MetricAggregate> = {};
  for (const [key, values] of Object.entries(buckets)) {
    const aggregate = metricAggregate(values);
    if (aggregate) result[key] = aggregate;
  }
  return result;
}

export function summarizeBenchAgentConfigs(
  cases: BenchCaseRow[],
): BenchAgentConfigSummary[] {
  const groups = new Map<string, BenchCaseRow[]>();
  for (const benchCase of cases) {
    const key = agentConfigKey(benchCase);
    const group = groups.get(key) ?? [];
    group.push(benchCase);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const first = group[0];
      const durations = group
        .map((benchCase) => benchCase.durationMs)
        .filter((value): value is number => typeof value === "number");
      const durationAggregate = metricAggregate(durations);
      const passed = group.filter((benchCase) => benchCase.success).length;

      return {
        key,
        label: agentConfigLabel(first),
        harness: first.harness,
        provider: first.provider,
        environment: first.environment,
        api: first.api,
        toolSurface: first.toolSurface,
        startupProfile: first.startupProfile,
        agentMode: first.agentMode,
        models: [
          ...new Set(
            group
              .map((benchCase) => benchCase.model)
              .filter((value): value is string => !!value),
          ),
        ].sort(),
        total: group.length,
        passed,
        passScore: group.length > 0 ? passed / group.length : 0,
        meanDurationMs: durationAggregate?.mean,
        metrics: aggregateCaseMetrics(group),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function addMetricRow(
  rowsByKey: Map<string, ExperimentMetricRow>,
  rowIndex: number,
  rowCount: number,
  key: string,
  label: string,
  unit: string,
  value: number | undefined,
): void {
  if (value === undefined || !Number.isFinite(value)) return;
  const existing =
    rowsByKey.get(key) ??
    ({
      key,
      label,
      unit,
      values: Array.from({ length: rowCount }, (): number | null => null),
    } satisfies ExperimentMetricRow);
  existing.values[rowIndex] = value;
  rowsByKey.set(key, existing);
}

function metricSortPriority(metric: ExperimentMetricRow): number {
  const key = `${metric.key} ${metric.label}`.toLowerCase();
  if (metric.key.startsWith("derived:")) return 0;
  if (/(cost|price|usd|dollar)/.test(key)) return 10;
  if (/(token|usage)/.test(key)) return 20;
  if (/(duration|latency|time|speed|_ms|seconds|total_ms)/.test(key)) {
    return 30;
  }
  if (/(error|fail)/.test(key)) return 40;
  return 100;
}

function inferMetricUnit(key: string, fallback = ""): string {
  const normalized = key.toLowerCase();
  if (/(^|_)ms$|_ms$/.test(normalized)) return "ms";
  if (/(duration|seconds|_s$)/.test(normalized)) return fallback || "s";
  if (/(cost|price|usd|dollar)/.test(normalized)) return fallback || "usd";
  if (/(token|usage)/.test(normalized)) return fallback || "count";
  if (/(count|errors|failures|cases|tasks)/.test(normalized)) return "count";
  return fallback;
}

export function collectExperimentMetrics(
  rows: ExperimentData[],
): ExperimentMetricRow[] {
  const metricsByKey = new Map<string, ExperimentMetricRow>();

  rows.forEach((row, rowIndex) => {
    const benchDurations = row.benchCases
      .map((benchCase) => benchCase.durationMs)
      .filter((value): value is number => typeof value === "number");
    const meanCaseDurationMs = metricAggregate(benchDurations)?.mean;

    addMetricRow(
      metricsByKey,
      rowIndex,
      rows.length,
      "derived:pass_rate",
      "Pass rate",
      "ratio",
      row.passScore,
    );
    addMetricRow(
      metricsByKey,
      rowIndex,
      rows.length,
      "derived:passed",
      "Passed",
      "count",
      row.passedTasks,
    );
    addMetricRow(
      metricsByKey,
      rowIndex,
      rows.length,
      "derived:total",
      row.mode === "bench" ? "Cases" : "Tasks",
      "count",
      row.totalTasks,
    );
    addMetricRow(
      metricsByKey,
      rowIndex,
      rows.length,
      "derived:duration",
      "Braintrust duration",
      "s",
      row.durationSeconds,
    );
    addMetricRow(
      metricsByKey,
      rowIndex,
      rows.length,
      "derived:errors",
      "Errors",
      "count",
      row.errorsMetric,
    );
    addMetricRow(
      metricsByKey,
      rowIndex,
      rows.length,
      "derived:mean_case_duration",
      "Mean case duration",
      "ms",
      meanCaseDurationMs,
    );

    for (const [key, metric] of Object.entries(row.raw.metrics ?? {})) {
      addMetricRow(
        metricsByKey,
        rowIndex,
        rows.length,
        `braintrust:${key}`,
        metric.name || key,
        inferMetricUnit(key, metric.unit),
        metric.metric,
      );
    }

    for (const [key, aggregate] of Object.entries(row.taskMetrics)) {
      addMetricRow(
        metricsByKey,
        rowIndex,
        rows.length,
        `task:${key}:mean`,
        `Mean ${key}`,
        inferMetricUnit(key),
        aggregate.mean,
      );
    }
  });

  return [...metricsByKey.values()]
    .filter((metric) => metric.values.some((value) => value !== null))
    .sort((a, b) => {
      const priority = metricSortPriority(a) - metricSortPriority(b);
      if (priority !== 0) return priority;
      return a.label.localeCompare(b.label);
    });
}

/**
 * Index of the row with the best pass rate (ties broken by shortest duration).
 */
export function findLeaderIndex(rows: ExperimentData[]): number {
  let best = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const b = rows[best];
    if (r.passScore > b.passScore) best = i;
    else if (
      r.passScore === b.passScore &&
      r.durationSeconds < b.durationSeconds
    )
      best = i;
  }
  return best;
}
