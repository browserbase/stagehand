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
 * Per-cell table (harness × tool × model), always printed for bench runs:
 *
 *   cell                                   pass        max_turns  sdk_error  gated  ungraded  retried
 *   claude_code × stagehand_facade × …     72% 33/46   2          0          1      0         0
 */
export function printCellTable(cells: CellSummary[]): void {
  if (cells.length === 0) return;
  const columns = ["max_turns", "sdk_error", "gated", "ungraded", "retried"] as const;
  const width = getTerminalWidth();
  const passWidth = 12;
  const numericWidth = columns.reduce((sum, column) => sum + column.length + 2, 0);
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
    ...columns.map((column) => bold(padRight(column, column.length + 2))),
  ].join(" ");
  console.log(`${stacked ? "    " : "  "}${headerRow}`);

  for (const cell of cells) {
    const pct = cell.total === 0 ? 0 : Math.round((cell.passed / cell.total) * 100);
    const passCell = `${passRateColor(pct)(padLeft(`${pct}%`, 4))} ${gray(`${cell.passed}/${cell.total}`)}`;
    const counts = [cell.maxTurns, cell.sdkError, cell.gated, cell.ungraded, cell.retried];
    const numeric = counts.map((count, index) => {
      const text = padRight(String(count), columns[index].length + 2);
      if (count === 0) return dim(text);
      return columns[index] === "gated" || columns[index] === "ungraded" ? yellow(text) : text;
    });
    // padRight strips ANSI; pad the colored pass cell by hand.
    const passPadded = `${passCell}${" ".repeat(Math.max(0, passWidth - visibleLength(passCell)))}`;
    if (stacked) {
      console.log(`  ${cell.cell}`);
      console.log(`${indent}${passPadded} ${numeric.join(" ")}`);
    } else {
      console.log(`  ${padRight(cell.cell, cellWidth)} ${passPadded} ${numeric.join(" ")}`);
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
};

/**
 * Failures, infra first (sdk_error → max_turns → ungraded → gated), one line
 * each with the reason and session URL. Rubric fails — the expected kind of
 * failure — are listed by case id on one line; `--json` has their reasons.
 */
export function printFailures(failures: FailureRow[], limit = DEFAULT_FAILURE_LIMIT): void {
  if (failures.length === 0) return;
  const infra = failures.filter((failure) => failure.kind !== "fail");
  const rubric = failures.filter((failure) => failure.kind === "fail");
  const shown = infra.slice(0, limit);
  const kinds = [...new Set(shown.map((failure) => failure.kind))];
  console.log(
    `  ${bold(`Failures (${failures.length}${kinds.length > 0 ? ` · ${kinds.join(" + ")} first` : ""})`)}`,
  );

  const width = getTerminalWidth();
  // A harness column only earns its space when the run spans several.
  const showHarness = new Set(failures.map((failure) => failure.harness)).size > 1;
  const harnessWidth = showHarness
    ? Math.max(...shown.map((failure) => failure.harness.length), 6)
    : 0;
  const taskWidth = Math.min(34, Math.max(4, ...shown.map((failure) => failure.task.length)));
  const kindWidth = Math.max(4, ...shown.map((failure) => failure.kind.length));
  for (const failure of shown) {
    const harness = showHarness ? `${padRight(failure.harness, harnessWidth)} ` : "";
    const fixed = 4 + (showHarness ? harnessWidth + 1 : 0) + taskWidth + 1 + kindWidth + 1;
    // The URL shares the line when a readable reason still fits beside it;
    // on a narrow terminal it moves to its own line instead of wrapping.
    const urlInline =
      failure.sessionUrl !== undefined && width - fixed - failure.sessionUrl.length - 1 >= 12;
    const reasonWidth = Math.max(
      12,
      width - fixed - (urlInline ? failure.sessionUrl!.length + 1 : 0),
    );
    // Multi-line SDK errors would break the row; one line, whitespace collapsed.
    const reasonText = failure.reason?.replace(/\s+/g, " ").trim();
    const reason = reasonText ? gray(truncateText(reasonText, reasonWidth)) : "";
    console.log(
      `  ${FAILURE_ICON[failure.kind]} ${harness}${padRight(truncateText(failure.task, taskWidth), taskWidth)} ${padRight(failure.kind, kindWidth)} ${reason}${urlInline ? ` ${dim(failure.sessionUrl!)}` : ""}`,
    );
    if (failure.sessionUrl && !urlInline) console.log(`    ${dim(failure.sessionUrl)}`);
  }
  if (infra.length > shown.length) {
    console.log(dim(`  … ${infra.length - shown.length} more — --json has the full list`));
  }
  if (rubric.length > 0) {
    const ids = rubric.map((failure) => failure.task.split(" ")[0]).join(" ");
    const label = `${rubric.length} rubric fail${rubric.length === 1 ? "" : "s"}: `;
    console.log(
      `  ${red("✗")} ${label}${dim(truncateText(ids, Math.max(12, width - label.length - 6)))}`,
    );
  }
  console.log("");
}

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
