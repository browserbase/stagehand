/**
 * Formatted results table for post-run display.
 */

import {
  bold,
  green,
  red,
  dim,
  cyan,
  gray,
  yellow,
  separator,
  padRight,
  getTerminalWidth,
  truncateText,
  visibleLength,
} from "./format.js";
import type { SummaryResult } from "../types/evals.js";
import type { CellSummary, FailureRow } from "../framework/runSummary.js";

/** How many failures the human summary lists before pointing at `--json`. */
export const DEFAULT_FAILURE_LIMIT = 10;

function padLeft(value: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(value));
  return `${" ".repeat(pad)}${value}`;
}

function passRateColor(pct: number): (s: string) => string {
  return pct >= 80 ? green : pct >= 50 ? cyan : red;
}

/**
 * Per-cell table (harness × tool × model):
 *
 *   cell                                   pass        max_turns  sdk_error  gated
 *   claude_code × stagehand_facade × …     72% 33/46   2          0          1
 *
 * The pass rate is over rows that ran (stopped rows are left out), and a
 * count column only appears when some cell has a non-zero count in it.
 */
export function printCellTable(cells: CellSummary[]): void {
  if (cells.length === 0) return;
  const allColumns = [
    ["max_turns", (cell: CellSummary) => cell.maxTurns],
    ["sdk_error", (cell: CellSummary) => cell.sdkError],
    ["gated", (cell: CellSummary) => cell.gated],
    ["ungraded", (cell: CellSummary) => cell.ungraded],
    ["retried", (cell: CellSummary) => cell.retried],
    ["stopped", (cell: CellSummary) => cell.stopped ?? 0],
  ] as const;
  const columns = allColumns.filter(([, read]) => cells.some((cell) => read(cell) > 0));
  const width = getTerminalWidth();
  const passWidth = 12;
  const numericWidth = columns.reduce((sum, [name]) => sum + name.length + 2, 0);
  const longestCell = Math.max(...cells.map((cell) => visibleLength(cell.cell)), 4);
  const available = width - 4 - passWidth - numericWidth - 1;
  // The cell name is the row's identity; when the terminal cannot fit it next
  // to the counts, the name gets its own line instead of being truncated.
  const stacked = longestCell > available;
  const cellWidth = stacked ? 0 : longestCell;
  const indent = stacked ? "    " : `  ${" ".repeat(cellWidth)} `;

  const headerRow = [
    ...(stacked ? [] : [bold(padRight("cell", cellWidth))]),
    bold(padRight("pass", passWidth)),
    ...columns.map(([name]) => bold(padRight(name, name.length + 2))),
  ].join(" ");
  console.log(`${stacked ? "    " : "  "}${headerRow.trimEnd()}`);

  for (const cell of cells) {
    const ran = cell.total - (cell.stopped ?? 0);
    const pct = ran === 0 ? 0 : Math.round((cell.passed / ran) * 100);
    const passCell = `${passRateColor(pct)(padLeft(`${pct}%`, 4))} ${gray(`${cell.passed}/${ran}`)}`;
    const numeric = columns.map(([name, read]) => {
      const count = read(cell);
      const text = padRight(String(count), name.length + 2);
      if (count === 0) return dim(text);
      return name === "gated" || name === "ungraded" ? yellow(text) : text;
    });
    // padRight strips ANSI; pad the colored pass cell by hand.
    const passPadded = `${passCell}${" ".repeat(Math.max(0, passWidth - visibleLength(passCell)))}`;
    const row = `${passPadded} ${numeric.join(" ")}`.trimEnd();
    if (stacked) {
      console.log(`  ${cell.cell}`);
      console.log(`${indent}${row}`);
    } else {
      console.log(`  ${padRight(cell.cell, cellWidth)} ${row}`);
    }
  }
  console.log("");
}

const FAILURE_ICON: Record<FailureRow["kind"], string> = {
  sdk_error: red("✗"),
  max_turns: yellow("⏱"),
  ungraded: yellow("?"),
  gated: yellow("◐"),
  fail: red("✗"),
  stopped: dim("⊘"),
};

/** Reasons that mean a credential, not the agent, failed the row. */
const AUTH_REASON = /api[ _-]?key|unauthori[sz]ed|\b401\b|\b403\b|authentication|permission denied/i;

const shortModel = (model: string): string => model.slice(model.indexOf("/") + 1);

/**
 * Failures, grouped by kind and reason so a shared cause reads as one line:
 *
 *   ✗ 40×  fail       invalid x-api-key   claude-haiku-4-5 → check the key: evals doctor --probe
 *   ✗ act/iframe_scroll gpt-4.1-mini  fail  No actionable element returned  https://…
 *
 * Groups print largest first; one-off failures keep their case, model and
 * session URL. Stopped rows are left to the caller (they aren't failures).
 */
export function printFailures(failures: FailureRow[], limit = DEFAULT_FAILURE_LIMIT): void {
  const real = failures.filter((failure) => failure.kind !== "stopped");
  if (real.length === 0) return;
  console.log(`  ${bold(`Failures (${real.length})`)}`);
  const width = getTerminalWidth();
  const showHarness = new Set(real.map((failure) => failure.harness)).size > 1;

  const groups = new Map<string, FailureRow[]>();
  for (const failure of real) {
    // Multi-line SDK errors would break the row; one line, whitespace collapsed.
    const reason = failure.reason?.replace(/\s+/g, " ").trim() ?? "";
    const key = `${failure.kind}\u0000${reason}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...failure, reason }]);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => b.length - a.length || FAILURE_RANK[a[0].kind] - FAILURE_RANK[b[0].kind],
  );

  let printed = 0;
  let shownRows = 0;
  for (const group of ordered) {
    if (printed >= limit) break;
    const first = group[0];
    const icon = FAILURE_ICON[first.kind];
    const kind = padRight(first.kind, 10);
    const hint = first.reason && AUTH_REASON.test(first.reason)
      ? ` ${yellow("→ check the key: evals doctor --probe")}`
      : "";
    if (group.length > 1) {
      const models = [...new Set(group.map((failure) => shortModel(failure.model)))];
      const who =
        models.length <= 2
          ? models.join(", ")
          : `${models.length} models`;
      const count = padRight(`${group.length}×`, 5);
      const fixed = 4 + 5 + 1 + 10 + 1 + who.length + 2 + visibleLength(hint);
      const reason = first.reason
        ? gray(truncateText(first.reason, Math.max(16, width - fixed)))
        : dim("(no reason recorded)");
      console.log(`  ${icon} ${count} ${kind} ${reason}  ${cyan(who)}${hint}`);
    } else {
      const harness = showHarness ? `${first.harness} ` : "";
      const label = `${harness}${first.task} ${shortModel(first.model)}`;
      const fixed = 4 + visibleLength(label) + 2 + 10 + 1 + visibleLength(hint);
      const urlInline =
        first.sessionUrl !== undefined && width - fixed - first.sessionUrl.length - 2 >= 16;
      const reasonWidth = Math.max(16, width - fixed - (urlInline ? first.sessionUrl!.length + 2 : 0));
      const reason = first.reason
        ? gray(truncateText(first.reason, reasonWidth))
        : dim("(no reason recorded)");
      console.log(
        `  ${icon} ${label}  ${kind} ${reason}${urlInline ? `  ${dim(first.sessionUrl!)}` : ""}${hint}`,
      );
      if (first.sessionUrl && !urlInline) console.log(`      ${dim(first.sessionUrl)}`);
    }
    printed += 1;
    shownRows += group.length;
  }
  if (real.length > shownRows) {
    console.log(dim(`  … ${real.length - shownRows} more — --json has the full list`));
  }
  console.log("");
}

/** Infra first, then budget, then self-reported, then rubric. */
const FAILURE_RANK: Record<FailureRow["kind"], number> = {
  sdk_error: 0,
  max_turns: 1,
  ungraded: 2,
  gated: 3,
  fail: 4,
  stopped: 5,
};

export function printResultsTable(results: SummaryResult[]): void {
  if (results.length === 0) {
    console.log(dim("  No results to display."));
    return;
  }

  // Group by task name
  const byTask = new Map<string, SummaryResult[]>();
  for (const r of results) {
    const existing = byTask.get(r.name) ?? [];
    existing.push(r);
    byTask.set(r.name, existing);
  }

  const { taskWidth, modelWidth, resultWidth } = getResultsLayout();

  console.log(separator());
  console.log(
    `  ${bold(padRight("Task", taskWidth))} ${bold(padRight("Model", modelWidth))} ${bold(
      padRight("Result", resultWidth),
    )}`,
  );
  console.log(separator());

  for (const [name, taskResults] of byTask) {
    for (const r of taskResults) {
      const resultLabel = padRight(r.output._success ? "✓ pass" : "✗ fail", resultWidth);
      const result = r.output._success ? green(resultLabel) : red(resultLabel);
      console.log(
        `  ${padRight(name, taskWidth)} ${dim(padRight(r.input.modelName, modelWidth))} ${result}`,
      );
    }
  }

  console.log(separator());

  printModelSummary(results, true);
}

export function printModelSummary(results: SummaryResult[], leadingBlankLine = false): void {
  const { summaryWidth } = getResultsLayout();
  const modelStats = getModelStats(results);

  if (modelStats.size <= 1) {
    return;
  }

  if (leadingBlankLine) {
    console.log("");
  }

  console.log(`  ${bold("By model:")}`);
  for (const [model, stats] of modelStats) {
    const pct = Math.round((stats.passed / stats.total) * 100);
    const color = pct >= 80 ? green : pct >= 50 ? cyan : red;
    console.log(
      `    ${padRight(model, summaryWidth)} ${color(`${pct}%`)} ${gray(`(${stats.passed}/${stats.total})`)}`,
    );
  }
  console.log("");
}

function getResultsLayout(): {
  taskWidth: number;
  modelWidth: number;
  resultWidth: number;
  summaryWidth: number;
} {
  const width = getTerminalWidth();
  const contentWidth = Math.max(44, width - 6);
  const resultWidth = 10;
  let taskWidth = Math.max(18, Math.floor(contentWidth * 0.45));
  let modelWidth = contentWidth - taskWidth - resultWidth - 2;

  if (modelWidth < 16) {
    modelWidth = 16;
    taskWidth = Math.max(18, contentWidth - modelWidth - resultWidth - 2);
  }

  return {
    taskWidth,
    modelWidth,
    resultWidth,
    summaryWidth: Math.max(18, contentWidth - 12),
  };
}

function getModelStats(results: SummaryResult[]): Map<string, { passed: number; total: number }> {
  const modelStats = new Map<string, { passed: number; total: number }>();

  for (const r of results) {
    const stats = modelStats.get(r.input.modelName) ?? { passed: 0, total: 0 };
    stats.total++;
    if (r.output._success) {
      stats.passed++;
    }
    modelStats.set(r.input.modelName, stats);
  }

  return modelStats;
}
