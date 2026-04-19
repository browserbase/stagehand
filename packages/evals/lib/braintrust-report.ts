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
import { loginToState, init as initExperiment } from "braintrust";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExperimentInput = {
  label: string;
  /** Experiment name OR UUID — both are accepted. */
  experiment: string;
};

export type BraintrustExperimentRow = {
  id: string;
  name: string;
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
  output?:
    | {
        _success?: boolean;
        error?: unknown;
        metrics?: Record<string, EventMetric>;
        [key: string]: unknown;
      }
    | null;
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

export type ExperimentData = {
  label: string;
  experimentName: string;
  experimentId: string;
  experimentUrl: string;
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
};

export type FetchOptions = {
  /**
   * Braintrust API key. If omitted, pulled from:
   *   1. packages/evals/.env (BRAINTRUST_API_KEY)
   *   2. process.env.BRAINTRUST_API_KEY
   */
  apiKey?: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (typeof obj.avg === "number" && Number.isFinite(obj.avg))
      return obj.avg;
    if (typeof obj.p50 === "number" && Number.isFinite(obj.p50))
      return obj.p50;
  }
  return undefined;
}

export function isRootEvent(event: ExperimentEvent): boolean {
  if (event.is_root === true) return true;
  if (event.is_root === false) return false;
  return !event.span_parents || event.span_parents.length === 0;
}

/**
 * Our framework (packages/evals/runCore.ts) writes per-task timing metrics
 * onto `output.metrics`. This returns that object if present.
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
    if (values.length === 0) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    result[key] = {
      mean: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
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

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

async function fetchExperimentEventsInternal(
  project: string,
  experimentName: string,
  apiKey: string,
): Promise<ExperimentEvent[]> {
  try {
    const experiment = initExperiment(project, {
      experiment: experimentName,
      open: true,
      apiKey,
    });
    const data = await experiment.fetchedData();
    return data as unknown as ExperimentEvent[];
  } catch (err) {
    console.warn(
      `Could not fetch events for "${experimentName}": ${err instanceof Error ? err.message : err}`,
    );
    return [];
  }
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
  const state = await loginToState({ apiKey });

  let experiment: BraintrustExperimentRow;
  if (UUID_RE.test(input.experiment)) {
    const info = (await state
      .apiConn()
      .get_json(`/v1/experiment/${input.experiment}`)) as {
      id: string;
      name: string;
    };
    if (!info?.id || !info?.name) {
      throw new Error(`Experiment id "${input.experiment}" not found`);
    }
    experiment = { id: info.id, name: info.name };
  } else {
    const matches = (await state.appConn().post_json("api/experiment/get", {
      project_name: project,
      org_name: state.orgName,
      experiment_name: input.experiment,
    })) as BraintrustExperimentRow[];

    if (matches.length === 0) {
      throw new Error(
        `Experiment "${input.experiment}" not found in project "${project}"`,
      );
    }
    experiment = matches[0];
  }

  const [comparison, events] = await Promise.all([
    state.apiConn().get_json("/experiment-comparison2", {
      experiment_id: experiment.id,
    }) as Promise<ExperimentComparison>,
    fetchExperimentEventsInternal(project, experiment.name, apiKey),
  ]);

  const passScore = numberOrZero(comparison.scores.Pass?.score);
  const durationSeconds = numberOrZero(comparison.metrics.duration?.metric);
  const errorsMetric = numberOrZero(comparison.metrics.errors?.metric);

  const taskMetrics = aggregateMetrics(events);
  const tasks = extractTasks(events);
  const passedTasks = tasks.filter((t) => t.success).length;

  const experimentUrl = `${state.appPublicUrl}/app/${encodeURIComponent(
    state.orgName ?? "Browserbase",
  )}/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(
    experiment.name,
  )}`;

  return {
    label: input.label,
    experimentName: experiment.name,
    experimentId: experiment.id,
    experimentUrl,
    passScore,
    totalTasks: tasks.length,
    passedTasks,
    durationSeconds,
    errorsMetric,
    raw: comparison,
    taskMetrics,
    tasks,
  };
}

/**
 * Fetch many experiments in parallel.
 */
export async function fetchManyExperimentData(
  project: string,
  inputs: ExperimentInput[],
  options: FetchOptions = {},
): Promise<ExperimentData[]> {
  return Promise.all(inputs.map((i) => fetchExperimentData(project, i, options)));
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
