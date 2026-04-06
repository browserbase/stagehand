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

  console.log(separator());
  console.log(
    `  ${bold(padRight("Task", 35))} ${bold(padRight("Model", 30))} ${bold("Result")}`,
  );
  console.log(separator());

  for (const [name, taskResults] of byTask) {
    for (const r of taskResults) {
      const result = r.output._success ? green("✓ pass") : red("✗ fail");
      console.log(
        `  ${padRight(name, 35)} ${padRight(dim(r.input.modelName), 30)} ${result}`,
      );
    }
  }

  console.log(separator());

  // Model summary
  const modelStats = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const stats = modelStats.get(r.input.modelName) ?? { passed: 0, total: 0 };
    stats.total++;
    if (r.output._success) stats.passed++;
    modelStats.set(r.input.modelName, stats);
  }

  if (modelStats.size > 1) {
    console.log(`\n  ${bold("By model:")}`);
    for (const [model, stats] of modelStats) {
      const pct = Math.round((stats.passed / stats.total) * 100);
      const color = pct >= 80 ? green : pct >= 50 ? cyan : red;
      console.log(
        `    ${padRight(model, 40)} ${color(`${pct}%`)} ${gray(`(${stats.passed}/${stats.total})`)}`,
      );
    }
    console.log("");
  }
}
