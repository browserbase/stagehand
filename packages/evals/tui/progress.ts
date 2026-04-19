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
  getTerminalWidth,
  truncateText,
  visibleLength,
  writeLine,
  writeRaw,
  type TaskStatus,
} from "./format.js";
import readline from "node:readline";

interface TaskProgress {
  name: string;
  model?: string;
  status: TaskStatus;
  durationMs?: number;
  error?: string;
}

type ProgressRendererOptions = {
  animated?: boolean;
};

const DOTS2_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

export class ProgressRenderer {
  private tasks = new Map<string, TaskProgress>();
  private started = 0;
  private passed = 0;
  private failed = 0;
  private animated: boolean;
  private frameIndex = 0;
  private timer?: NodeJS.Timeout;
  private renderedLines = 0;
  private cursorHidden = false;
  private blockInitialized = false;

  constructor(options: ProgressRendererOptions = {}) {
    this.animated = options.animated ?? false;
  }

  onStart(taskName: string, model?: string): void {
    const key = model ? `${taskName}:${model}` : taskName;
    this.tasks.set(key, { name: taskName, model, status: "running" });
    this.started++;
    if (this.animated) {
      this.startTicker();
      this.renderAnimated();
      return;
    }
    this.printRow(blue("●"), taskName, model, gray("running"));
  }

  onPass(taskName: string, model?: string, durationMs?: number): void {
    const key = model ? `${taskName}:${model}` : taskName;
    this.tasks.set(key, { name: taskName, model, status: "passed", durationMs });
    this.passed++;
    if (this.animated) {
      this.renderAnimated();
      this.stopTickerIfIdle();
      return;
    }
    this.printRow(
      green("✓"),
      taskName,
      model,
      green("passed"),
      durationMs !== undefined ? dim(formatMs(durationMs)) : undefined,
    );
  }

  onFail(taskName: string, model?: string, error?: string): void {
    const key = model ? `${taskName}:${model}` : taskName;
    this.tasks.set(key, { name: taskName, model, status: "failed", error });
    this.failed++;
    if (this.animated) {
      this.renderAnimated();
      this.stopTickerIfIdle();
      return;
    }
    this.printRow(red("✗"), taskName, model, red("failed"));
    if (error) {
      const available = Math.max(24, getTerminalWidth() - 10);
      writeLine(`    ${dim("→")} ${gray(truncateText(error, available))}`);
    }
  }

  printSummary(): void {
    this.stopTicker();
    if (this.animated) {
      this.flushAnimatedBlock();
      writeLine("");
    } else {
      writeLine("");
    }
    writeLine(separator());
    const total = this.passed + this.failed;
    writeLine(
      `  ${bold("Results:")} ${green(`${this.passed} passed`)}, ${red(`${this.failed} failed`)} ${dim(`(${total} total)`)}`,
    );
    if (total > 0) {
      const pct = Math.round((this.passed / total) * 100);
      writeLine(`  ${bold("Pass rate:")} ${pct >= 80 ? green(`${pct}%`) : pct >= 50 ? `${pct}%` : red(`${pct}%`)}`);
    }
    writeLine(separator());
    writeLine("");
  }

  dispose(): void {
    this.stopTicker();
    if (this.animated && this.blockInitialized) {
      this.moveToBlockStart();
      readline.clearScreenDown(process.stdout);
      this.blockInitialized = false;
    }
    if (this.animated && this.renderedLines > 0) {
      writeLine("");
    }
  }

  private printRow(
    icon: string,
    taskName: string,
    model: string | undefined,
    status: string,
    duration?: string,
  ): void {
    const width = getTerminalWidth();
    const contentWidth = Math.max(32, width - 6);
    const hasModel = Boolean(model);
    const statusWidth = Math.max(7, visibleLength(status));
    const durationWidth = duration ? visibleLength(duration) + 1 : 0;
    let modelWidth = hasModel
      ? Math.min(30, Math.max(12, Math.floor(contentWidth * 0.28)))
      : 0;
    let taskWidth =
      contentWidth -
      statusWidth -
      durationWidth -
      (hasModel ? modelWidth + 1 : 0) -
      1;

    if (hasModel && taskWidth < 18) {
      const deficit = 18 - taskWidth;
      modelWidth = Math.max(10, modelWidth - deficit);
      taskWidth =
        contentWidth -
        statusWidth -
        durationWidth -
        modelWidth -
        2;
    }

    if (hasModel && taskWidth < 18) {
      modelWidth = 0;
      taskWidth = contentWidth - statusWidth - durationWidth - 1;
    }

    const taskCell = padRight(taskName, Math.max(18, taskWidth));
    const modelCell =
      modelWidth > 0 && model ? ` ${dim(padRight(model, modelWidth))}` : "";
    const durationCell = duration ? ` ${duration}` : "";
    writeLine(`  ${icon} ${taskCell}${modelCell} ${status}${durationCell}`);
  }

  private renderAnimated(): void {
    const rows = this.getAnimatedRows();
    if (rows.length === 0) {
      return;
    }

    if (!this.blockInitialized) {
      for (let i = 0; i < rows.length; i++) {
        writeLine("");
      }
      this.blockInitialized = true;
      this.renderedLines = rows.length;
    }

    this.moveToBlockStart();
    readline.clearScreenDown(process.stdout);

    for (const row of rows) {
      writeLine(row);
    }
    this.renderedLines = rows.length;
  }

  private flushAnimatedBlock(): void {
    if (!this.blockInitialized) {
      this.renderAnimated();
      return;
    }

    this.moveToBlockStart();
    readline.clearScreenDown(process.stdout);
    const rows = this.getAnimatedRows();
    for (const row of rows) {
      writeLine(row);
    }
    this.blockInitialized = false;
    this.renderedLines = rows.length;
  }

  private getAnimatedRows(): string[] {
    const tasks = [...this.tasks.values()];
    if (tasks.length === 0) {
      return [];
    }
    return [this.buildHeaderRow(), ...tasks.map((task) => this.formatAnimatedRow(task))];
  }

  private formatAnimatedRow(task: TaskProgress): string {
    switch (task.status) {
      case "running":
        return this.buildRow(
          blue(DOTS2_FRAMES[this.frameIndex % DOTS2_FRAMES.length]),
          task.name,
          task.model,
          gray("running"),
        );
      case "passed":
        return this.buildRow(
          green("✓"),
          task.name,
          task.model,
          green("passed"),
          task.durationMs !== undefined ? dim(formatMs(task.durationMs)) : undefined,
        );
      case "failed":
      case "error":
        return this.buildRow(
          red("✗"),
          task.name,
          task.model,
          red("failed"),
          task.error ? gray(truncateText(task.error, 18)) : undefined,
        );
      case "pending":
      default:
        return this.buildRow(gray("⠁"), task.name, task.model, gray("pending"));
    }
  }

  private buildRow(
    icon: string,
    taskName: string,
    model: string | undefined,
    status: string,
    duration?: string,
  ): string {
    const { taskWidth, modelWidth } = this.getRowLayout(
      Boolean(model),
      status,
      duration,
    );

    const taskCell = padRight(taskName, Math.max(18, taskWidth));
    const modelCell =
      modelWidth > 0 && model ? ` ${dim(padRight(model, modelWidth))}` : "";
    const durationCell = duration ? ` ${duration}` : "";
    return `  ${icon} ${taskCell}${modelCell} ${status}${durationCell}`;
  }

  private buildHeaderRow(): string {
    const { taskWidth, modelWidth, statusWidth } = this.getRowLayout(
      true,
      "Result",
    );
    const taskCell = bold(padRight("Task", Math.max(18, taskWidth)));
    const modelCell = ` ${bold(padRight("Model", modelWidth))}`;
    const statusCell = bold(padRight("Result", statusWidth));
    return `    ${taskCell}${modelCell} ${statusCell}`;
  }

  private getRowLayout(
    hasModel: boolean,
    status: string,
    duration?: string,
  ): { taskWidth: number; modelWidth: number; statusWidth: number } {
    const width = getTerminalWidth();
    const contentWidth = Math.max(32, width - 6);
    const statusWidth = Math.max(7, visibleLength(status));
    const durationWidth = duration ? visibleLength(duration) + 1 : 0;
    let modelWidth = hasModel
      ? Math.min(30, Math.max(12, Math.floor(contentWidth * 0.28)))
      : 0;
    let taskWidth =
      contentWidth -
      statusWidth -
      durationWidth -
      (hasModel ? modelWidth + 1 : 0) -
      1;

    if (hasModel && taskWidth < 18) {
      const deficit = 18 - taskWidth;
      modelWidth = Math.max(10, modelWidth - deficit);
      taskWidth =
        contentWidth -
        statusWidth -
        durationWidth -
        modelWidth -
        2;
    }

    if (hasModel && taskWidth < 18) {
      modelWidth = 0;
      taskWidth = contentWidth - statusWidth - durationWidth - 1;
    }

    return { taskWidth, modelWidth, statusWidth };
  }

  private startTicker(): void {
    if (!this.animated || this.timer) return;
    if (!this.cursorHidden) {
      writeRaw("\x1b[?25l");
      this.cursorHidden = true;
    }
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % DOTS2_FRAMES.length;
      this.renderAnimated();
    }, 80);
  }

  private stopTickerIfIdle(): void {
    if ([...this.tasks.values()].some((task) => task.status === "running")) {
      return;
    }
    this.stopTicker();
  }

  private stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.cursorHidden) {
      writeRaw("\x1b[?25h");
      this.cursorHidden = false;
    }
  }

  private moveToBlockStart(): void {
    if (this.renderedLines > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLines);
      readline.cursorTo(process.stdout, 0);
    }
  }
}
