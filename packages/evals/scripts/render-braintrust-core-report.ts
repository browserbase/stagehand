import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loginToState, init as initExperiment } from "braintrust";

type ExperimentInput = {
  label: string;
  experiment: string;
};

type ParsedArgs = {
  project: string;
  outputPath: string;
  title: string;
  experiments: ExperimentInput[];
  openAfter: boolean;
};

type BraintrustExperimentRow = {
  id: string;
  name: string;
};

type ScoreSummary = {
  name: string;
  score: number;
  diff?: number;
  improvements: number;
  regressions: number;
};

type MetricSummary = {
  name: string;
  metric: number;
  unit: string;
  diff?: number;
  improvements: number;
  regressions: number;
};

type ExperimentComparison = {
  scores: Record<string, ScoreSummary>;
  metrics: Record<string, MetricSummary>;
};

type EventMetric =
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

type ExperimentEvent = {
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

type MetricAggregate = {
  mean: number;
  min: number;
  max: number;
  count: number;
};

type TaskRow = {
  name: string;
  success: boolean;
  totalMs?: number;
};

type ExperimentData = {
  label: string;
  experimentName: string;
  experimentId: string;
  experimentUrl: string;
  passScore: number;
  totalTasks: number;
  passedTasks: number;
  durationSeconds: number;
  errorsMetric: number;
  raw: ExperimentComparison;
  taskMetrics: Record<string, MetricAggregate>;
  tasks: TaskRow[];
};

const DEFAULT_PROJECT = "stagehand-core-dev";
const DEFAULT_TITLE = "Experiment Comparison";
const PHASE_METRICS = ["startup_ms", "task_ms", "cleanup_ms"] as const;
const MAX_EXPERIMENTS = 8; // practical layout limit
const SIDE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function scriptDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function packageRoot(): string {
  return path.resolve(scriptDir(), "..");
}

function defaultOutputPath(): string {
  return "/tmp/stagehand-core-braintrust-report.html";
}

function usage(): string {
  return [
    "Usage:",
    "  render-braintrust-core-report.ts <exp1> <exp2> [exp3 ...] [options]",
    "",
    "Positional arguments:",
    "  Each experiment is either a bare id: <experiment-id>",
    "  Or with an inline label:           <experiment-id>=<label>",
    "  Or:                                 <label>=<experiment-id>",
    "",
    "  Minimum 2 experiments, up to " + MAX_EXPERIMENTS + ".",
    "",
    "Options:",
    "  --project <name>       Braintrust project (default: stagehand-core-dev)",
    "  --title <text>         Report title (default: \"Experiment Comparison\")",
    "  --out <path>           Output HTML path",
    "  --label-a <text>       Label for position A (shortcut)",
    "  --label-b <text>       Label for position B (shortcut)",
    "  --label-c <text>       Label for position C (shortcut)",
    "  --label-d <text>       Label for position D (shortcut)",
    "  --no-open              Do not open the report in a browser",
    "",
    "Examples:",
    "  # 2-way comparison with inline labels:",
    "  render-report all-5354b9b5='Playwright MCP' all-c8edaf28='Chrome DevTools MCP'",
    "",
    "  # 4-way comparison:",
    "  render-report \\",
    "    'Local / Understudy'=all-aaa \\",
    "    'Local / Playwright'=all-bbb \\",
    "    'BB / Understudy'=all-ccc \\",
    "    'BB / Playwright'=all-ddd",
  ].join("\n");
}

function parseExperimentSpec(raw: string): ExperimentInput {
  const eqIdx = raw.indexOf("=");
  if (eqIdx === -1) {
    return { label: raw, experiment: raw };
  }
  const left = raw.slice(0, eqIdx).trim();
  const right = raw.slice(eqIdx + 1).trim();
  if (!left || !right) {
    throw new Error(`Invalid experiment spec "${raw}". Use <id> or <label>=<id>.`);
  }
  // Heuristic: UUIDs, or ids that look like "all-abc123", start with "eval-", etc.
  const looksLikeId = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
    /^[a-z][a-z0-9_-]*-[a-f0-9]{4,}$/i.test(s);
  if (looksLikeId(right) && !looksLikeId(left)) return { label: left, experiment: right };
  if (looksLikeId(left) && !looksLikeId(right)) return { label: right, experiment: left };
  // Default: treat left as id, right as label (common `id=label` form)
  return { label: right, experiment: left };
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let project = DEFAULT_PROJECT;
  let outputPath = defaultOutputPath();
  let title = DEFAULT_TITLE;
  let openAfter = true;
  const positional: string[] = [];
  const labelOverrides: Record<number, string> = {};

  while (args.length > 0) {
    const arg = args.shift()!;
    const matchLabel = arg.match(/^--label-([a-h])$/i);
    if (matchLabel) {
      const idx = matchLabel[1].toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
      const value = args.shift();
      if (!value) throw new Error(`Missing value for ${arg}`);
      labelOverrides[idx] = value;
      continue;
    }
    switch (arg) {
      case "--project":
        project = args.shift() ?? (() => { throw new Error("Missing value for --project"); })();
        break;
      case "--out":
        outputPath = path.resolve(args.shift() ?? (() => { throw new Error("Missing value for --out"); })());
        break;
      case "--title":
        title = args.shift() ?? (() => { throw new Error("Missing value for --title"); })();
        break;
      case "--no-open":
        openAfter = false;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  if (positional.length < 2) {
    console.error("Error: at least two experiments are required.\n");
    console.error(usage());
    process.exit(1);
  }
  if (positional.length > MAX_EXPERIMENTS) {
    console.error(`Error: up to ${MAX_EXPERIMENTS} experiments are supported (got ${positional.length}).`);
    process.exit(1);
  }

  const experiments = positional.map((raw, i) => {
    const spec = parseExperimentSpec(raw);
    if (labelOverrides[i]) spec.label = labelOverrides[i];
    return spec;
  });

  return { project, outputPath, title, experiments, openAfter };
}

function openInBrowser(filePath: string): void {
  if (process.env.CI === "true") return;
  if ((process.env.BROWSER ?? "").toLowerCase() === "none") return;

  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", filePath] : [filePath];

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // best-effort
  }
}

function loadBraintrustApiKey(): string {
  const envPath = path.join(packageRoot(), ".env");
  const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
  const apiKey = parsed.BRAINTRUST_API_KEY;
  if (!apiKey) throw new Error(`BRAINTRUST_API_KEY is missing from ${envPath}`);
  return apiKey;
}

function numberOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${Math.round(ms)}ms`;
  return `${ms.toFixed(1)}ms`;
}

function formatSeconds(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  if (seconds >= 10) return `${seconds.toFixed(1)}s`;
  return `${seconds.toFixed(2)}s`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function extractMetricValue(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, number | undefined>;
    if (typeof obj.value === "number" && Number.isFinite(obj.value)) return obj.value;
    if (typeof obj.avg === "number" && Number.isFinite(obj.avg)) return obj.avg;
    if (typeof obj.p50 === "number" && Number.isFinite(obj.p50)) return obj.p50;
  }
  return undefined;
}

function isRootEvent(event: ExperimentEvent): boolean {
  if (event.is_root === true) return true;
  if (event.is_root === false) return false;
  return !event.span_parents || event.span_parents.length === 0;
}

function getTaskMetrics(event: ExperimentEvent): Record<string, EventMetric> | undefined {
  const output = event.output;
  if (output && typeof output === "object" && output.metrics && typeof output.metrics === "object") {
    return output.metrics;
  }
  return undefined;
}

function aggregateMetrics(events: ExperimentEvent[]): Record<string, MetricAggregate> {
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

function extractTasks(events: ExperimentEvent[]): TaskRow[] {
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
    const totalMs = taskMetrics ? extractMetricValue(taskMetrics.total_ms) : undefined;
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

async function fetchExperimentEvents(
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchExperimentData(
  project: string,
  input: ExperimentInput,
): Promise<ExperimentData> {
  const apiKey = loadBraintrustApiKey();
  const state = await loginToState({ apiKey });

  let experiment: BraintrustExperimentRow;
  if (UUID_RE.test(input.experiment)) {
    // Lookup by ID via the REST API
    const info = (await state
      .apiConn()
      .get_json(`/v1/experiment/${input.experiment}`)) as { id: string; name: string };
    if (!info?.id || !info?.name) {
      throw new Error(`Experiment id "${input.experiment}" not found`);
    }
    experiment = { id: info.id, name: info.name };
  } else {
    // Lookup by name via the app API
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
    state.apiConn().get_json("/experiment-comparison2", { experiment_id: experiment.id }) as Promise<ExperimentComparison>,
    fetchExperimentEvents(project, experiment.name, apiKey),
  ]);

  const passScore = numberOrZero(comparison.scores.Pass?.score);
  const durationSeconds = numberOrZero(comparison.metrics.duration?.metric);
  const errorsMetric = numberOrZero(comparison.metrics.errors?.metric);

  const taskMetrics = aggregateMetrics(events);
  const tasks = extractTasks(events);
  const passedTasks = tasks.filter((t) => t.success).length;

  const experimentUrl = `${state.appPublicUrl}/app/${encodeURIComponent(
    state.orgName ?? "Browserbase",
  )}/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(experiment.name)}`;

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

// ---------------------------------------------------------------------------
// Comparison helpers (N-way)
// ---------------------------------------------------------------------------

function sharedTaskNames(rows: ExperimentData[]): string[] {
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

function sharedMetricKeys(rows: ExperimentData[]): string[] {
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

// ---------------------------------------------------------------------------
// HTML rendering — N-way comparison, shadcn-inspired
// ---------------------------------------------------------------------------

function sideLetter(i: number): string {
  return SIDE_LETTERS[i] ?? `#${i + 1}`;
}

function findLeaderIndex(rows: ExperimentData[]): number {
  let best = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const b = rows[best];
    if (r.passScore > b.passScore) best = i;
    else if (r.passScore === b.passScore && r.durationSeconds < b.durationSeconds) best = i;
  }
  return best;
}

function buildSummary(rows: ExperimentData[], shared: number, sharedTimers: number): string {
  const leader = findLeaderIndex(rows);

  const cards = rows
    .map((row, i) => {
      const isLeader = i === leader;
      return `
        <article class="summary__card ${isLeader ? "is-leader" : ""}" data-side="${i}">
          <header class="summary__head">
            <span class="side side--${i}">${sideLetter(i)}</span>
            ${isLeader ? `<span class="badge badge--success">Leader</span>` : ""}
          </header>
          <h2 class="summary__label">${escapeHtml(row.label)}</h2>
          <div class="summary__figure">${formatPct(row.passScore)}</div>
          <div class="summary__detail">
            <span class="summary__fraction">${row.passedTasks} of ${row.totalTasks} passed</span>
          </div>
          <footer class="summary__foot">
            <code class="summary__id">${escapeHtml(row.experimentName)}</code>
            <a class="summary__link" href="${row.experimentUrl}" target="_blank" rel="noreferrer">Open ↗</a>
          </footer>
        </article>
      `;
    })
    .join("\n");

  return `
    <section class="summary" data-count="${rows.length}">
      ${cards}
    </section>
    <p class="overlap">
      <strong>${shared}</strong> shared ${shared === 1 ? "task" : "tasks"} ·
      <strong>${sharedTimers}</strong> shared ${sharedTimers === 1 ? "timer" : "timers"} ·
      all comparisons below use the overlap only
    </p>
  `;
}

function buildPhaseBreakdown(rows: ExperimentData[]): string {
  const totals = rows.map((r) =>
    PHASE_METRICS.reduce((s, k) => s + (r.taskMetrics[k]?.mean ?? 0), 0),
  );
  const maxTotal = Math.max(...totals, 1);
  const minTotal = Math.min(...totals);

  const rowsHtml = rows
    .map((row, i) => {
      const startup = row.taskMetrics.startup_ms?.mean ?? 0;
      const task = row.taskMetrics.task_ms?.mean ?? 0;
      const cleanup = row.taskMetrics.cleanup_ms?.mean ?? 0;
      const total = startup + task + cleanup;
      const pctWidth = (total / maxTotal) * 100;
      const startupPct = total > 0 ? (startup / total) * 100 : 0;
      const taskPct = total > 0 ? (task / total) * 100 : 0;
      const cleanupPct = total > 0 ? (cleanup / total) * 100 : 0;
      const isFastest = total === minTotal && rows.length > 1;

      return `
        <div class="phase">
          <div class="phase__ident">
            <span class="side side--${i}">${sideLetter(i)}</span>
            <span class="phase__label">${escapeHtml(row.label)}</span>
          </div>
          <div class="phase__track-row">
            <div class="phase__track" style="width: ${pctWidth.toFixed(2)}%">
              <div class="phase__seg phase--startup" style="width: ${startupPct.toFixed(2)}%" title="Startup · ${formatMs(startup)}"></div>
              <div class="phase__seg phase--task" style="width: ${taskPct.toFixed(2)}%" title="Task · ${formatMs(task)}"></div>
              <div class="phase__seg phase--cleanup" style="width: ${cleanupPct.toFixed(2)}%" title="Cleanup · ${formatMs(cleanup)}"></div>
            </div>
            <span class="phase__total${isFastest ? " is-fastest" : ""}">${formatMs(total)}</span>
          </div>
          <div class="phase__legend">
            <span><i class="sw sw--startup"></i> startup <code>${formatMs(startup)}</code></span>
            <span><i class="sw sw--task"></i> task <code>${formatMs(task)}</code></span>
            <span><i class="sw sw--cleanup"></i> cleanup <code>${formatMs(cleanup)}</code></span>
          </div>
        </div>
      `;
    })
    .join("\n");

  return `
    <section class="card">
      <header class="card__head">
        <div>
          <h2 class="card__title">Phase breakdown</h2>
          <p class="card__desc">Mean time per task — <code>startup_ms + task_ms + cleanup_ms</code>.</p>
        </div>
      </header>
      <div class="phases">${rowsHtml}</div>
    </section>
  `;
}

function buildTimerGrid(rows: ExperimentData[], keys: string[]): string {
  const timerKeys = keys.filter(
    (k) => !PHASE_METRICS.includes(k as (typeof PHASE_METRICS)[number]) && k !== "total_ms",
  );
  if (timerKeys.length === 0) return "";

  // Sort by spread (max - min across experiments)
  const ordered = [...timerKeys].sort((x, y) => {
    const xs = rows.map((r) => r.taskMetrics[x]?.mean ?? 0);
    const ys = rows.map((r) => r.taskMetrics[y]?.mean ?? 0);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);
    return ySpread - xSpread;
  });

  const cards = ordered
    .map((key) => {
      const values = rows.map((r) => r.taskMetrics[key]?.mean ?? 0);
      const max = Math.max(...values, 1);
      const min = Math.min(...values.filter((v) => v > 0));
      const hasData = values.some((v) => v > 0);

      const bars = rows
        .map((row, i) => {
          const mean = row.taskMetrics[key]?.mean ?? 0;
          const count = row.taskMetrics[key]?.count ?? 0;
          const height = max > 0 ? (mean / max) * 100 : 0;
          const isWinner = hasData && mean > 0 && mean === min && rows.length > 1;
          return `
            <div class="timer__col">
              <div class="timer__bar ${isWinner ? "is-winner" : ""}" style="height: ${height.toFixed(2)}%" title="${escapeHtml(row.label)} · ${formatMs(mean)}${count > 1 ? ` · n=${count}` : ""}">
                <span class="timer__val">${mean > 0 ? formatMs(mean) : "—"}</span>
              </div>
              <span class="timer__axis side--${i}">${sideLetter(i)}</span>
            </div>
          `;
        })
        .join("");

      // Best vs worst delta footer
      let footer = "";
      if (hasData && rows.length > 1) {
        const positives = values.filter((v) => v > 0);
        if (positives.length >= 2) {
          const winnerIdx = values.indexOf(min);
          const maxValue = Math.max(...values);
          const pct = maxValue > 0 ? ((maxValue - min) / maxValue) * 100 : 0;
          footer = `<div class="timer__foot">${sideLetter(winnerIdx)} is <strong>${pct.toFixed(0)}%</strong> faster than the slowest</div>`;
        }
      }

      return `
        <article class="timer">
          <header class="timer__head">
            <h3 class="timer__title"><code>${escapeHtml(key)}</code></h3>
          </header>
          <div class="timer__plot">${bars}</div>
          ${footer}
        </article>
      `;
    })
    .join("\n");

  return `
    <section class="card">
      <header class="card__head">
        <div>
          <h2 class="card__title">Operation timers</h2>
          <p class="card__desc">Per-operation means across ${rows.length} experiments, sorted by largest spread.</p>
        </div>
        <div class="legend">
          <span class="legend__item"><i class="sw sw--winner"></i>Fastest</span>
          <span class="legend__item"><i class="sw sw--loser"></i>Rest</span>
        </div>
      </header>
      <div class="timers">${cards}</div>
    </section>
  `;
}

function buildTaskTable(rows: ExperimentData[], taskNames: string[]): string {
  if (taskNames.length === 0) return "";

  const perRow = taskNames.map((name) => {
    const cells = rows.map((r) => r.tasks.find((t) => t.name === name));
    const anyFail = cells.some((c) => c && !c.success);
    const timings = cells.map((c) => c?.totalMs).filter((v): v is number => v !== undefined);
    const minT = timings.length > 0 ? Math.min(...timings) : 0;
    const maxT = timings.length > 0 ? Math.max(...timings) : 0;
    const spread = maxT - minT;
    return { name, cells, anyFail, spread };
  });

  perRow.sort((a, b) => {
    if (a.anyFail !== b.anyFail) return a.anyFail ? -1 : 1;
    return b.spread - a.spread;
  });

  const headerCells = rows
    .map((r, i) => `<th class="xcol"><span class="side side--${i} side--sm">${sideLetter(i)}</span> ${escapeHtml(r.label)}</th>`)
    .join("");

  const body = perRow
    .map((r) => {
      const cellsHtml = r.cells
        .map((cell, i) => {
          if (!cell) {
            return `<td class="xcol muted">—</td>`;
          }
          const glyph = cell.success
            ? `<span class="dot dot--ok"></span>`
            : `<span class="dot dot--fail"></span>`;
          const time = cell.totalMs !== undefined ? formatMs(cell.totalMs) : "";
          const minT = Math.min(
            ...r.cells.filter((c): c is TaskRow => !!c && c.totalMs !== undefined).map((c) => c.totalMs!),
          );
          const isFastest = cell.totalMs === minT && r.cells.filter((c) => c?.totalMs !== undefined).length > 1;
          return `
            <td class="xcol">
              <div class="xcell">
                ${glyph}
                <span class="xcell__time ${isFastest ? "is-fastest" : ""}">${time}</span>
              </div>
            </td>
          `;
        })
        .join("");

      return `
        <tr${r.anyFail ? ' class="row--alert"' : ""}>
          <th class="task"><code>${escapeHtml(r.name)}</code></th>
          ${cellsHtml}
        </tr>
      `;
    })
    .join("\n");

  return `
    <section class="card">
      <header class="card__head">
        <div>
          <h2 class="card__title">Tasks</h2>
          <p class="card__desc">${taskNames.length} shared ${taskNames.length === 1 ? "task" : "tasks"}. Any row with a failure is flagged and sorted first, then by time spread.</p>
        </div>
      </header>
      <div class="task-table-wrap">
        <table class="task-table" data-cols="${rows.length}">
          <thead>
            <tr>
              <th>Task</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}

function buildHtml(title: string, rows: ExperimentData[]): string {
  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const taskNames = sharedTaskNames(rows);
  const metricKeys = sharedMetricKeys(rows);
  const hasPerTaskData = rows.every((r) => r.totalTasks > 0);

  const subtitle = rows.map((r) => escapeHtml(r.label)).join(" <span style=\"opacity: 0.4;\">vs</span> ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" />
    <style>
      :root {
        --background: #ffffff;
        --foreground: #0a0a0a;
        --card: #ffffff;
        --muted: #f4f4f5;
        --muted-foreground: #71717a;
        --border: #e4e4e7;
        --border-strong: #d4d4d8;

        --primary: #01c851;
        --primary-dim: rgba(1, 200, 81, 0.08);
        --destructive: #dc2626;
        --destructive-dim: rgba(220, 38, 38, 0.08);

        /* Side palette — up to 8 experiments, each with a distinct identity color */
        --side-0: #09090b;
        --side-1: #2563eb;
        --side-2: #d97706;
        --side-3: #9333ea;
        --side-4: #0891b2;
        --side-5: #db2777;
        --side-6: #16a34a;
        --side-7: #e11d48;

        --phase-startup: #18181b;
        --phase-task: #01c851;
        --phase-cleanup: #a1a1aa;

        --radius: 0.625rem;
        --radius-sm: 0.375rem;

        --font-sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --font-mono: "Geist Mono", ui-monospace, "SF Mono", monospace;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --background: #0a0a0a;
          --foreground: #fafafa;
          --card: #0f0f10;
          --muted: #1a1a1b;
          --muted-foreground: #a1a1aa;
          --border: #27272a;
          --border-strong: #3f3f46;
          --primary-dim: rgba(1, 200, 81, 0.14);
          --destructive-dim: rgba(220, 38, 38, 0.15);
          --side-0: #fafafa;
          --side-1: #60a5fa;
          --side-2: #fbbf24;
          --side-3: #c084fc;
          --side-4: #22d3ee;
          --side-5: #f472b6;
          --side-6: #4ade80;
          --side-7: #fb7185;
          --phase-startup: #fafafa;
          --phase-cleanup: #52525b;
        }
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 14px;
        line-height: 1.5;
        color: var(--foreground);
        background: var(--background);
        -webkit-font-smoothing: antialiased;
      }

      code { font-family: var(--font-mono); font-size: 0.92em; }

      ::selection { background: var(--foreground); color: var(--background); }

      .shell { max-width: 1320px; margin: 0 auto; padding: 40px 32px 64px; }
      @media (max-width: 640px) { .shell { padding: 24px 16px 40px; } }

      /* Header */
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 24px;
        padding-bottom: 20px;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--border);
      }
      .header__title { margin: 0 0 4px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
      .header__sub { margin: 0; color: var(--muted-foreground); font-size: 13px; overflow-wrap: anywhere; }
      .header__time {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        flex-shrink: 0;
      }

      /* Side letter swatches */
      .side {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        color: #ffffff;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        background: var(--side-0);
      }
      .side--0 { background: var(--side-0); }
      .side--1 { background: var(--side-1); }
      .side--2 { background: var(--side-2); }
      .side--3 { background: var(--side-3); }
      .side--4 { background: var(--side-4); }
      .side--5 { background: var(--side-5); }
      .side--6 { background: var(--side-6); }
      .side--7 { background: var(--side-7); }

      .side--sm {
        width: 18px;
        height: 18px;
        font-size: 10px;
        border-radius: 4px;
        vertical-align: middle;
      }

      /* Summary cards */
      .summary {
        display: grid;
        gap: 12px;
        margin-bottom: 12px;
      }
      .summary[data-count="2"] { grid-template-columns: 1fr 1fr; }
      .summary[data-count="3"] { grid-template-columns: repeat(3, 1fr); }
      .summary[data-count="4"] { grid-template-columns: repeat(4, 1fr); }
      .summary[data-count="5"],
      .summary[data-count="6"],
      .summary[data-count="7"],
      .summary[data-count="8"] { grid-template-columns: repeat(4, 1fr); }

      @media (max-width: 1100px) {
        .summary[data-count="3"],
        .summary[data-count="4"],
        .summary[data-count="5"],
        .summary[data-count="6"],
        .summary[data-count="7"],
        .summary[data-count="8"] { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 600px) {
        .summary { grid-template-columns: 1fr !important; }
      }

      .summary__card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 20px;
        position: relative;
      }
      .summary__card.is-leader {
        border-color: var(--primary);
        box-shadow: 0 0 0 1px var(--primary-dim);
      }

      .summary__head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .summary__label {
        margin: 0 0 14px;
        font-size: 14px;
        font-weight: 500;
        letter-spacing: -0.005em;
        min-height: 42px;
      }

      .summary__figure {
        font-size: 38px;
        font-weight: 600;
        letter-spacing: -0.025em;
        line-height: 1.05;
        font-variant-numeric: tabular-nums;
      }

      .summary__detail {
        margin-top: 4px;
        color: var(--muted-foreground);
        font-size: 12px;
        font-family: var(--font-mono);
      }

      .summary__foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid var(--border);
      }

      .summary__id {
        font-size: 11px;
        color: var(--muted-foreground);
        max-width: 65%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .summary__link {
        color: var(--muted-foreground);
        text-decoration: none;
        font-size: 11px;
        padding: 3px 6px;
        border-radius: var(--radius-sm);
      }
      .summary__link:hover {
        color: var(--foreground);
        background: var(--muted);
      }

      /* Overlap notice */
      .overlap {
        margin: 0 0 24px;
        padding: 10px 16px;
        background: var(--muted);
        border-radius: var(--radius-sm);
        color: var(--muted-foreground);
        font-size: 12.5px;
      }
      .overlap strong { color: var(--foreground); font-weight: 600; font-family: var(--font-mono); }

      /* Cards */
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 24px;
        margin-bottom: 16px;
      }

      .card__head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        margin-bottom: 20px;
      }

      .card__title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: -0.005em;
      }

      .card__desc {
        margin: 4px 0 0;
        color: var(--muted-foreground);
        font-size: 12.5px;
      }

      /* Legend */
      .legend { display: flex; gap: 14px; }
      .legend__item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground);
      }
      .sw {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 3px;
      }
      .sw--startup { background: var(--phase-startup); }
      .sw--task { background: var(--phase-task); }
      .sw--cleanup { background: var(--phase-cleanup); }
      .sw--winner { background: var(--primary); }
      .sw--loser { background: var(--border-strong); }

      /* Badges */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        font-size: 10.5px;
        font-weight: 500;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .badge--success { color: var(--primary); background: var(--primary-dim); }

      /* Phase breakdown */
      .phases { display: flex; flex-direction: column; gap: 18px; }

      .phase__ident {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
      }

      .phase__label {
        font-size: 13px;
        font-weight: 500;
      }

      .phase__track-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .phase__track {
        display: flex;
        height: 14px;
        border-radius: 4px;
        overflow: hidden;
        background: var(--muted);
        min-width: 20px;
      }

      .phase__seg { height: 100%; transition: width 0.4s ease; }
      .phase--startup { background: var(--phase-startup); }
      .phase--task { background: var(--phase-task); }
      .phase--cleanup { background: var(--phase-cleanup); }

      .phase__total {
        min-width: 80px;
        text-align: right;
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .phase__total.is-fastest { color: var(--primary); font-weight: 600; }

      .phase__legend {
        display: flex;
        gap: 20px;
        margin-top: 8px;
        margin-left: 32px;
        font-size: 11.5px;
        color: var(--muted-foreground);
        flex-wrap: wrap;
      }
      .phase__legend span { display: inline-flex; align-items: center; gap: 6px; }
      .phase__legend i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        display: inline-block;
      }
      .phase__legend code { font-size: 11px; color: var(--foreground); }

      /* Timer grid */
      .timers {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
      }

      .timer {
        background: var(--background);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 16px 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .timer__head { min-height: 20px; }

      .timer__title {
        margin: 0;
        font-size: 12.5px;
        font-weight: 500;
      }

      .timer__plot {
        display: flex;
        justify-content: center;
        align-items: flex-end;
        gap: 10px;
        height: 130px;
        padding-top: 22px;
        position: relative;
      }

      .timer__col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        flex: 1 1 0;
        min-width: 0;
        height: 100%;
        justify-content: flex-end;
      }

      .timer__bar {
        position: relative;
        width: 100%;
        min-height: 4px;
        background: var(--border-strong);
        border-radius: 3px 3px 0 0;
        transition: height 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .timer__bar.is-winner { background: var(--primary); }

      .timer__val {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 500;
        color: var(--muted-foreground);
        white-space: nowrap;
      }

      .timer__bar.is-winner .timer__val { color: var(--primary); }

      .timer__axis {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        display: inline-grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        color: #ffffff;
      }

      .timer__foot {
        font-size: 11px;
        color: var(--muted-foreground);
        text-align: center;
        padding-top: 8px;
        border-top: 1px solid var(--border);
      }

      .timer__foot strong { color: var(--primary); font-weight: 600; }

      /* Task table */
      .task-table-wrap { overflow-x: auto; }

      .task-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      .task-table thead th {
        text-align: left;
        font-size: 11px;
        font-weight: 500;
        color: var(--muted-foreground);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 0 10px 10px;
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
      }

      .task-table thead th.xcol {
        font-weight: 500;
      }

      .task-table tbody tr { border-bottom: 1px solid var(--border); }
      .task-table tbody tr:last-child { border-bottom: none; }
      .task-table tbody tr:hover { background: var(--muted); }
      .task-table tbody tr.row--alert { background: var(--destructive-dim); }

      .task-table th.task {
        text-align: left;
        padding: 10px 10px;
        font-weight: 400;
      }

      .task-table td.xcol {
        padding: 10px 10px;
        vertical-align: middle;
      }

      .task-table td.muted {
        color: var(--muted-foreground);
        text-align: center;
      }

      .xcell {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .xcell__time {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--muted-foreground);
      }

      .xcell__time.is-fastest {
        color: var(--primary);
        font-weight: 500;
      }

      .dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .dot--ok { background: var(--primary); box-shadow: 0 0 0 3px var(--primary-dim); }
      .dot--fail { background: var(--destructive); box-shadow: 0 0 0 3px var(--destructive-dim); }

      /* Footer */
      .footer {
        margin-top: 32px;
        padding-top: 16px;
        border-top: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        gap: 16px;
        color: var(--muted-foreground);
        font-size: 11.5px;
        flex-wrap: wrap;
      }
      .footer code { font-size: 11px; }

      .empty {
        padding: 32px;
        text-align: center;
        color: var(--muted-foreground);
        font-size: 13px;
      }

      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; animation: none !important; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="header">
        <div>
          <h1 class="header__title">${escapeHtml(title)}</h1>
          <p class="header__sub">${subtitle}</p>
        </div>
        <span class="header__time">${escapeHtml(generatedAt)}</span>
      </header>

      ${buildSummary(rows, taskNames.length, metricKeys.length)}

      ${hasPerTaskData ? buildPhaseBreakdown(rows) : ""}
      ${hasPerTaskData ? buildTimerGrid(rows, metricKeys) : ""}
      ${hasPerTaskData ? buildTaskTable(rows, taskNames) : `<section class="card"><div class="empty">Per-task event data not available for all experiments.</div></section>`}

      <footer class="footer">
        <span>${rows.length}-way comparison · Braintrust</span>
        <span>${rows.reduce((s, r) => s + r.totalTasks, 0)} events analyzed</span>
      </footer>
    </div>
  </body>
</html>`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const rows = await Promise.all(
    options.experiments.map((e) => fetchExperimentData(options.project, e)),
  );

  const html = buildHtml(options.title, rows);
  const jsonPath = options.outputPath.replace(/\.html?$/i, ".json");

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");

  console.log(`Wrote report: ${options.outputPath}`);
  console.log(`Wrote data:   ${jsonPath}`);

  if (options.openAfter) {
    openInBrowser(options.outputPath);
  }
}

await main();
