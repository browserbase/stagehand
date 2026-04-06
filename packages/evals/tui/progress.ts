/**
 * Live progress rendering for eval runs.
 *
 * Streams per-task status updates to the terminal.
 */

import {
  green,
  red,
  blue,
  gray,
  dim,
  bold,
  formatMs,
  padRight,
  separator,
  type TaskStatus,
} from "./format.js";

interface TaskProgress {
  name: string;
  model?: string;
  status: TaskStatus;
  durationMs?: number;
  error?: string;
}

export class ProgressRenderer {
  private tasks = new Map<string, TaskProgress>();
  private started = 0;
  private passed = 0;
  private failed = 0;

  onStart(taskName: string, model?: string): void {
    const key = model ? `${taskName}:${model}` : taskName;
    this.tasks.set(key, { name: taskName, model, status: "running" });
    this.started++;
    console.log(`  ${blue("●")} ${padRight(taskName, 40)} ${dim(model ?? "")}  ${gray("running...")}`);
  }

  onPass(taskName: string, model?: string, durationMs?: number): void {
    const key = model ? `${taskName}:${model}` : taskName;
    this.tasks.set(key, { name: taskName, model, status: "passed", durationMs });
    this.passed++;
    const ms = durationMs !== undefined ? dim(formatMs(durationMs)) : "";
    console.log(`  ${green("✓")} ${padRight(taskName, 40)} ${dim(model ?? "")}  ${green("passed")}  ${ms}`);
  }

  onFail(taskName: string, model?: string, error?: string): void {
    const key = model ? `${taskName}:${model}` : taskName;
    this.tasks.set(key, { name: taskName, model, status: "failed", error });
    this.failed++;
    console.log(`  ${red("✗")} ${padRight(taskName, 40)} ${dim(model ?? "")}  ${red("failed")}`);
    if (error) {
      console.log(`    ${dim("→")} ${gray(error.slice(0, 120))}`);
    }
  }

  printSummary(): void {
    console.log("");
    console.log(separator());
    const total = this.passed + this.failed;
    console.log(
      `  ${bold("Results:")} ${green(`${this.passed} passed`)}, ${red(`${this.failed} failed`)} ${dim(`(${total} total)`)}`,
    );
    if (total > 0) {
      const pct = Math.round((this.passed / total) * 100);
      console.log(`  ${bold("Pass rate:")} ${pct >= 80 ? green(`${pct}%`) : pct >= 50 ? `${pct}%` : red(`${pct}%`)}`);
    }
    console.log(separator());
    console.log("");
  }
}
