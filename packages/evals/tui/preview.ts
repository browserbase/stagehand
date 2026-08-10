/**
 * Human-readable rendering of the --dry-run plan payload.
 *
 * Consumes the same payload built in commands/run.ts:emitDryRun so the
 * preview and JSON outputs stay in lockstep — anything `renderPreview`
 * shows is something `--dry-run` would emit too.
 *
 * Column-pruning rule: group matrix rows by every field except `task` and
 * `harnessConfig`, count occurrences, then drop any column whose values are
 * all equal (those constants get summarized in the header instead). The
 * combinations table shows only the dimensions that actually vary across
 * the run.
 */

import {
  bold,
  cyan,
  dim,
  gray,
  padRight,
  separator,
  getTerminalWidth,
  red,
  yellow,
} from "./format.js";

type MatrixRow = Record<string, unknown>;

interface PreviewPayload {
  target: string | null;
  normalizedTarget: string | null;
  tasks: string[];
  skippedTasks: string[];
  envOverrides: Record<string, string>;
  runOptions: Record<string, unknown>;
  matrix: MatrixRow[];
  error?: string;
}

/**
 * Display order for combinations-table columns. Fields not listed are
 * appended in alphabetical order at the end. `task` and `harnessConfig` are
 * never shown; `tier` is summarized in the header.
 */
const COLUMN_ORDER = [
  "model",
  "agentMode",
  "harness",
  "dataset",
  "category",
  "environment",
  "useApi",
  "provider",
  "toolSurface",
  "startupProfile",
  "toolCommand",
  "browseCliVersion",
  "browseCliEntrypoint",
];

const HIDDEN_COLUMNS = new Set(["task", "harnessConfig", "tier"]);

const COLUMN_HEADERS: Record<string, string> = {
  model: "Model",
  agentMode: "Agent mode",
  harness: "Harness",
  dataset: "Dataset",
  category: "Category",
  environment: "Env",
  useApi: "API",
  provider: "Provider",
  toolSurface: "Tool surface",
  startupProfile: "Startup",
  toolCommand: "Tool cmd",
  browseCliVersion: "browse CLI",
  browseCliEntrypoint: "browse entry",
};

export function renderPreview(payload: unknown): void {
  const p = payload as PreviewPayload;

  console.log("");

  if (p.error) {
    console.log(`  ${red(bold("error:"))} ${p.error}`);
    console.log("");
    return;
  }

  renderHeader(p);
  renderSkipped(p);
  renderCombinations(p);
  renderTasks(p);
  renderFooter(p);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader(p: PreviewPayload): void {
  const target = p.target ?? p.normalizedTarget ?? "(default)";
  const tierLabel = uniqueTiers(p.matrix).join(", ") || "no tasks";

  console.log(
    `  ${bold("Target:")} ${cyan(String(target))}  ${dim("→")}  ${tierLabel} (${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"})`,
  );

  // Header line 2: run options that aren't already shown column-by-column.
  // Always-show: env, concurrency, trials, harness. Conditional: model
  // override, useApi, provider — only if non-default.
  const opts = p.runOptions;
  const headerBits: string[] = [];
  const env = String(opts.environment ?? "");
  if (env) headerBits.push(`${bold("Env:")} ${cyan(env)}`);
  if (opts.concurrency !== undefined)
    headerBits.push(`${bold("Concurrency:")} ${opts.concurrency}`);
  if (opts.trials !== undefined)
    headerBits.push(`${bold("Trials:")} ${opts.trials}`);
  if (opts.harness !== undefined && opts.harness !== null)
    headerBits.push(`${bold("Harness:")} ${opts.harness}`);
  if (opts.useApi === true) headerBits.push(`${bold("API:")} ${yellow("on")}`);
  if (opts.model) headerBits.push(`${bold("Model override:")} ${opts.model}`);
  if (opts.provider) headerBits.push(`${bold("Provider:")} ${opts.provider}`);

  if (headerBits.length > 0) {
    console.log(`  ${headerBits.join("  ")}`);
  }

  const envOverrideKeys = Object.keys(p.envOverrides ?? {}).filter(
    // These are echoes of resolved options, not user-supplied overrides
    // worth surfacing again. Hide to keep the header tight.
    (k) =>
      ![
        "EVAL_ENV",
        "USE_API",
        "EVAL_TRIAL_COUNT",
        "EVAL_MAX_CONCURRENCY",
      ].includes(k),
  );
  if (envOverrideKeys.length > 0) {
    const fragments = envOverrideKeys.map((k) => `${k}=${p.envOverrides[k]}`);
    console.log(`  ${dim(`Env overrides: ${fragments.join(", ")}`)}`);
  }

  console.log("");
}

function uniqueTiers(matrix: MatrixRow[]): string[] {
  const seen = new Set<string>();
  for (const row of matrix) seen.add(String(row.tier ?? "?"));
  return [...seen];
}

// ---------------------------------------------------------------------------
// Skipped tasks
// ---------------------------------------------------------------------------

function renderSkipped(p: PreviewPayload): void {
  if (p.skippedTasks.length === 0) return;
  console.log(
    `  ${bold("Skipped:")} ${p.skippedTasks.length} legacy-only task(s) ${dim(p.skippedTasks.join(", "))}`,
  );
  console.log("");
}

// ---------------------------------------------------------------------------
// Combinations table
// ---------------------------------------------------------------------------

interface CombinationRow {
  values: Record<string, unknown>;
  runs: number;
}

export function buildCombinations(matrix: MatrixRow[]): {
  columns: string[];
  rows: CombinationRow[];
} {
  if (matrix.length === 0) return { columns: [], rows: [] };

  // 1. Build per-row "shape key" excluding hidden fields.
  const shapeMap = new Map<string, CombinationRow>();
  for (const row of matrix) {
    const shape: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (HIDDEN_COLUMNS.has(key)) continue;
      shape[key] = row[key];
    }
    const key = stableJson(shape);
    const existing = shapeMap.get(key);
    if (existing) {
      existing.runs += 1;
    } else {
      shapeMap.set(key, { values: shape, runs: 1 });
    }
  }

  const groups = [...shapeMap.values()];

  // 2. Determine which columns vary. A column is dropped if every group has
  //    the same value (after coercion to JSON-stringified form so null
  //    compares equal to null).
  const allColumns = new Set<string>();
  for (const g of groups) {
    for (const key of Object.keys(g.values)) allColumns.add(key);
  }

  const varying: string[] = [];
  for (const col of allColumns) {
    const sample = stableJson(groups[0]?.values[col] ?? null);
    const allSame = groups.every(
      (g) => stableJson(g.values[col] ?? null) === sample,
    );
    if (!allSame) varying.push(col);
  }

  // 3. Order columns: COLUMN_ORDER first, then alphabetical for the rest.
  const ordered = [
    ...COLUMN_ORDER.filter((c) => varying.includes(c)),
    ...varying.filter((c) => !COLUMN_ORDER.includes(c)).sort(),
  ];

  return { columns: ordered, rows: groups };
}

function renderCombinations(p: PreviewPayload): void {
  if (p.matrix.length === 0) {
    console.log(`  ${dim("No combinations to run.")}`);
    console.log("");
    return;
  }

  const { columns, rows } = buildCombinations(p.matrix);

  console.log(
    `  ${bold(`Combinations (${rows.length})`)} ${dim(`× tasks → runs`)}`,
  );

  if (columns.length === 0) {
    // Single combination — just say so. The task list does the work.
    console.log(`  ${dim("1 combination (default), all tasks identical")}`);
    console.log("");
    return;
  }

  // Compute per-column widths (clipped to terminal). Always include a
  // trailing "runs" column.
  const RUNS_HEADER = "runs";
  const headerCells = columns.map((c) => COLUMN_HEADERS[c] ?? c);

  const colWidths = columns.map((col, i) =>
    Math.max(
      headerCells[i].length,
      ...rows.map((r) => formatCell(r.values[col]).length),
    ),
  );
  const runsWidth = Math.max(
    RUNS_HEADER.length,
    ...rows.map((r) => String(r.runs).length),
  );

  // Trim if total width blows past terminal.
  const termWidth = getTerminalWidth();
  const padding = (columns.length + 1) * 2; // 2 spaces between columns
  const availableWidth = termWidth - 4 - padding - runsWidth; // 4 = leading "  " + safety
  const totalContent = colWidths.reduce((a, b) => a + b, 0);
  if (totalContent > availableWidth && availableWidth > 0) {
    // Shrink the widest column until we fit.
    while (colWidths.reduce((a, b) => a + b, 0) > availableWidth) {
      const max = Math.max(...colWidths);
      const idx = colWidths.indexOf(max);
      if (max <= 8) break;
      colWidths[idx] = max - 1;
    }
  }

  const sepLine = gray(
    "─".repeat(colWidths.reduce((a, b) => a + b, 0) + runsWidth + padding - 2),
  );

  // Header row
  const headerLine = headerCells
    .map((h, i) => bold(padRight(h, colWidths[i])))
    .concat(bold(padRight(RUNS_HEADER, runsWidth)))
    .join("  ");
  console.log(`  ${headerLine}`);
  console.log(`  ${sepLine}`);

  // Data rows — order rows for stable output: ascending by each column.
  const sortedRows = [...rows].sort(
    (a, b) =>
      columns
        .map((col) =>
          formatCell(a.values[col]).localeCompare(formatCell(b.values[col])),
        )
        .find((v) => v !== 0) ?? 0,
  );

  for (const row of sortedRows) {
    const cells = columns.map((col, i) =>
      padRight(formatCell(row.values[col]), colWidths[i]),
    );
    cells.push(dim(padRight(String(row.runs), runsWidth)));
    console.log(`  ${cells.join("  ")}`);
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Task list
// ---------------------------------------------------------------------------

function renderTasks(p: PreviewPayload): void {
  if (p.tasks.length === 0) return;

  console.log(`  ${bold(`Tasks (${p.tasks.length})`)}`);

  // Strip a common category prefix (e.g. "agent/") so the list reads cleanly
  // when every task shares the same category. If categories are mixed,
  // leave the names alone.
  const display = stripCommonPrefix(p.tasks);

  const termWidth = getTerminalWidth();
  const maxName = Math.max(...display.map((n) => n.length));
  const colWidth = maxName + 2;
  const cols = Math.max(1, Math.floor((termWidth - 4) / colWidth));

  for (let i = 0; i < display.length; i += cols) {
    const slice = display.slice(i, i + cols);
    const line = slice.map((n) => padRight(n, colWidth)).join("");
    console.log(`  ${dim(line.trimEnd())}`);
  }

  console.log("");
}

function stripCommonPrefix(names: string[]): string[] {
  if (names.length === 0) return names;
  const firstSlash = names[0].indexOf("/");
  if (firstSlash < 0) return names;
  const prefix = names[0].slice(0, firstSlash + 1);
  if (!names.every((n) => n.startsWith(prefix))) return names;
  return names.map((n) => n.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function renderFooter(p: PreviewPayload): void {
  const total = p.matrix.length;
  const taskCount = p.tasks.length;
  const combos = new Set(
    p.matrix.map((row) => {
      const shape: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        if (HIDDEN_COLUMNS.has(key)) continue;
        shape[key] = row[key];
      }
      return stableJson(shape);
    }),
  ).size;

  console.log(separator());
  if (total === 0) {
    console.log(`  ${bold("Total:")} 0 runs`);
  } else if (combos > 1 && taskCount > 0 && total === taskCount * combos) {
    // Full cross-product: every task runs every combination.
    const taskLabel = `${taskCount} task${taskCount === 1 ? "" : "s"}`;
    const comboLabel = `${combos} combination${combos === 1 ? "" : "s"}`;
    console.log(
      `  ${bold("Total:")} ${total} runs ${dim(`(${taskLabel} × ${comboLabel})`)}`,
    );
  } else {
    console.log(`  ${bold("Total:")} ${total} run${total === 1 ? "" : "s"}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value === false) return "false";
  if (value === true) return "true";
  if (typeof value === "string") {
    if (value === "") return "—";
    return value;
  }
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}
