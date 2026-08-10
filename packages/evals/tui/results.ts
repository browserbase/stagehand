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
  separator,
  padRight,
  getTerminalWidth,
} from "./format.js";
import type { SummaryResult } from "../types/evals.js";

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
      const resultLabel = padRight(
        r.output._success ? "✓ pass" : "✗ fail",
        resultWidth,
      );
      const result = r.output._success ? green(resultLabel) : red(resultLabel);
      console.log(
        `  ${padRight(name, taskWidth)} ${dim(padRight(r.input.modelName, modelWidth))} ${result}`,
      );
    }
  }

  console.log(separator());

  printModelSummary(results, true);
}

export function printModelSummary(
  results: SummaryResult[],
  leadingBlankLine = false,
): void {
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

function getModelStats(
  results: SummaryResult[],
): Map<string, { passed: number; total: number }> {
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
