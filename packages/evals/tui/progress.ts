/**
 * Live progress rendering for eval runs.
 *
 * Two modes:
 *   - Animated (TTY): a board redrawn in place — a status bar, one row per
 *     case in flight with its phase and elapsed time, the last few finishes,
 *     and key hints. Waiting rows never take a row; they're counted in the
 *     queue line.
 *   - Streamed (non-TTY, verbose): one line per state change, safe for CI
 *     logs and pipes.
 *
 * Rows are keyed by the runner's `rowKey` (cell + case + trial). Suite rows
 * all share a task name, so keying by name would collapse a run into one row.
 */

import {
  green,
  red,
  yellow,
  blue,
  cyan,
  magenta,
  gray,
  dim,
  bold,
  formatMs,
  padRight,
  separator,
  getTerminalWidth,
  truncateText,
  visibleLength,
} from "./format.js";
import readline from "node:readline";
import {
  formatConcurrencyQueueLine,
  type ConcurrencyQueueSnapshot,
  type ThrottleRecord,
} from "../framework/providerConcurrency.js";
import type { CaseLabel } from "../framework/caseIdentity.js";
import type { RowOutcome } from "../framework/runSummary.js";
import type { RowPhase } from "../framework/rowContext.js";

/**
 * Which execution an event is about. `rowKey` (cell + case + trial) is the
 * identity; `taskName` alone is not — every suite row shares it.
 */
export interface ProgressRow {
  rowKey?: string;
  taskName: string;
  model?: string;
  case?: CaseLabel;
  trial?: number;
}

interface RowState {
  name: string;
  question?: string;
  model?: string;
  status: "running" | "passed" | "failed";
  phase: RowPhase;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
  outcome?: RowOutcome;
  sessionUrl?: string;
}

type ProgressRendererOptions = {
  animated?: boolean;
  progressBar?: boolean;
  /** Where the board is drawn. `--json` runs draw on stderr so stdout stays parseable. */
  stream?: NodeJS.WriteStream;
  /** Clock; tests inject a fake. */
  now?: () => number;
};

export type StopMode = "cooperative" | "aggressive";

const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const FALLBACK_TERMINAL_ROWS = 24;
/** Lines left for the prompt and header above the board. */
const RESERVED_TERMINAL_ROWS = 8;
const RECENT_ROWS = 3;
/** Streamed mode reprints the queue line at most this often. */
const STREAMED_QUEUE_LINE_INTERVAL_MS = 30_000;
const TICK_MS = 100;

function rowIdentity(row: ProgressRow): string {
  if (row.rowKey) return row.rowKey;
  return row.model ? `${row.taskName}:${row.model}` : row.taskName;
}

/** `47e314cc recreation.gov` for suite cases; trials after the first get `#n`. */
export function rowDisplayName(row: ProgressRow): string {
  const base =
    row.case?.shortId || row.case?.domain
      ? [row.case.shortId, row.case.domain].filter(Boolean).join(" ")
      : row.taskName;
  return row.trial ? `${base} #${row.trial + 1}` : base;
}

/** Failure kinds read as themselves; a rubric fail reads "failed". */
function outcomeLabel(outcome: RowOutcome | undefined): {
  text: string;
  tone: (s: string) => string;
} {
  switch (outcome) {
    case "pass":
      return { text: "passed", tone: green };
    case "max_turns":
    case "gated":
    case "ungraded":
      return { text: outcome, tone: yellow };
    case "sdk_error":
      return { text: "sdk_error", tone: red };
    default:
      return { text: "failed", tone: red };
  }
}

/** Same glyphs as the end-of-run failures list. */
const OUTCOME_ICON: Record<RowOutcome, string> = {
  pass: green("✓"),
  max_turns: yellow("⏱"),
  gated: yellow("◐"),
  ungraded: yellow("?"),
  sdk_error: red("✗"),
  fail: red("✗"),
};

const PHASE_TONE: Record<RowPhase, (s: string) => string> = {
  starting: gray,
  session: gray,
  agent: cyan,
  verify: magenta,
};

/** `3m12s`, `48s`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export class ProgressRenderer {
  private rows = new Map<string, RowState>();
  private passed = 0;
  private failed = 0;
  private maxTurns = 0;
  private readonly animated: boolean;
  private readonly progressBar: boolean;
  private readonly out: NodeJS.WriteStream;
  private readonly now: () => number;
  private readonly startedAt: number;
  private frame = 0;
  private timer?: NodeJS.Timeout;
  private renderedLines = 0;
  private cursorHidden = false;
  private total?: number;
  private queue?: ConcurrencyQueueSnapshot;
  private lastQueueLinePrintedAt?: number;
  private stopping?: StopMode;
  private keyHints?: string;

  constructor(options: ProgressRendererOptions = {}) {
    this.out = options.stream ?? process.stdout;
    this.animated = options.animated ?? false;
    this.progressBar = options.progressBar ?? false;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  // ─── Events ────────────────────────────────────────────────────────────

  onPlanned(total: number): void {
    this.total = total;
    if (this.progressBar && total > 0) this.printProgressBar();
  }

  onStart(row: ProgressRow): void {
    const name = rowDisplayName(row);
    this.rows.set(rowIdentity(row), {
      name,
      question: row.case?.question,
      model: row.model,
      status: "running",
      phase: "starting",
      startedAt: this.now(),
    });
    if (this.animated) {
      this.startTicker();
      this.redraw();
      return;
    }
    this.printEventLine(blue("●"), name, row.model, gray("running"));
  }

  onPhase(row: ProgressRow, phase: RowPhase, sessionUrl?: string): void {
    const state = this.rows.get(rowIdentity(row));
    if (!state || state.status !== "running") return;
    state.phase = phase;
    if (sessionUrl) state.sessionUrl = sessionUrl;
    if (this.animated) this.redraw();
  }

  onPass(row: ProgressRow, durationMs?: number, details: { sessionUrl?: string } = {}): void {
    this.finish(row, "passed", { durationMs, outcome: "pass", sessionUrl: details.sessionUrl });
    this.passed++;
    this.afterFinish();
    if (!this.animated) {
      this.printEventLine(
        green("✓"),
        rowDisplayName(row),
        row.model,
        green("passed"),
        durationMs !== undefined ? dim(formatMs(durationMs)) : undefined,
      );
    }
  }

  onFail(
    row: ProgressRow,
    details: {
      error?: string;
      outcome?: RowOutcome;
      durationMs?: number;
      sessionUrl?: string;
    } = {},
  ): void {
    this.finish(row, "failed", details);
    if (details.outcome === "max_turns") this.maxTurns++;
    else this.failed++;
    this.afterFinish();
    if (!this.animated) {
      const label = outcomeLabel(details.outcome);
      this.printEventLine(
        red("✗"),
        rowDisplayName(row),
        row.model,
        label.tone(label.text),
        details.durationMs !== undefined ? dim(formatMs(details.durationMs)) : undefined,
      );
      if (details.error) {
        const available = Math.max(24, getTerminalWidth() - 10);
        this.line(`    ${dim("→")} ${gray(truncateText(details.error, available))}`);
      }
    }
  }

  /**
   * Scheduler state (`running 6 · queued 41 · openai 3/6↓ · throttled 1`).
   * Animated mode redraws it with the board; streamed mode prints it every
   * 30 s so logs stay readable.
   */
  onQueue(snapshot: ConcurrencyQueueSnapshot): void {
    this.queue = snapshot;
    if (this.animated) {
      if (this.renderedLines > 0) this.redraw();
      return;
    }
    const now = this.now();
    if (
      this.lastQueueLinePrintedAt !== undefined &&
      now - this.lastQueueLinePrintedAt < STREAMED_QUEUE_LINE_INTERVAL_MS
    ) {
      return;
    }
    this.lastQueueLinePrintedAt = now;
    this.line(
      `  ${dim(truncateText(formatConcurrencyQueueLine(snapshot), getTerminalWidth() - 4))}`,
    );
  }

  /** Backpressure hit a row; always worth a line in streamed mode. */
  onThrottled(rowName: string, record: ThrottleRecord): void {
    if (this.animated) return;
    const what =
      record.source === "browserbase"
        ? "Browserbase session create rate-limited — retrying once in 20s"
        : record.extended
          ? `${record.semaphore} still throttled — window extended 60s, retrying`
          : `${record.semaphore} throttled — width ${record.widthBefore} → ${record.widthAfter} for 60s, retrying`;
    this.line(`  ${gray("↓")} ${dim(`${rowName}: ${what}`)}`);
  }

  /** The run is being stopped; the board says so instead of being printed over. */
  setStopping(mode: StopMode): void {
    this.stopping = mode;
    if (this.animated) this.redraw();
    else
      this.line(
        mode === "aggressive"
          ? red("  ✗ Stopping now — closing in-flight sessions")
          : yellow("  ⚠ Stopping after in-flight rows (Esc again to stop now)"),
      );
  }

  /** Key hints shown under the board (`esc stop · v logs · ? help`). */
  setKeyHints(hints: string | undefined): void {
    this.keyHints = hints;
    if (this.animated && this.renderedLines > 0) this.redraw();
  }

  /**
   * A log line that should scroll above the board: the board is cleared, the
   * line printed, and the board redrawn under it.
   */
  logLine(text: string): void {
    if (!this.animated || this.renderedLines === 0) {
      this.line(text);
      return;
    }
    this.clearBoard();
    this.line(text);
    this.draw();
  }

  /**
   * Final board, then (unless `totals: false`) the Results / Pass rate block.
   * Bench runs pass `totals: false`: their per-cell table carries the rate.
   */
  printSummary(options: { totals?: boolean } = {}): void {
    this.stopTicker();
    this.queue = undefined;
    this.keyHints = undefined;
    this.stopping = undefined;
    if (this.animated && this.renderedLines > 0) {
      // Leave the final state of the board on screen, minus live-only lines.
      this.clearBoard();
      this.draw();
      this.renderedLines = 0;
    }
    this.line("");
    if (options.totals === false) return;
    this.line(separator());
    const total = this.passed + this.failed + this.maxTurns;
    const failed = this.failed + this.maxTurns;
    this.line(
      `  ${bold("Results:")} ${green(`${this.passed} passed`)}, ${red(`${failed} failed`)} ${dim(`(${total} total)`)}`,
    );
    if (total > 0) {
      const pct = Math.round((this.passed / total) * 100);
      this.line(
        `  ${bold("Pass rate:")} ${pct >= 80 ? green(`${pct}%`) : pct >= 50 ? `${pct}%` : red(`${pct}%`)}`,
      );
    }
    this.line(separator());
    this.line("");
  }

  dispose(): void {
    this.stopTicker();
    if (this.animated && this.renderedLines > 0) {
      this.clearBoard();
      this.renderedLines = 0;
    }
  }

  // ─── Board ─────────────────────────────────────────────────────────────

  /** The animated board as lines, without trailing newline handling. */
  boardLines(): string[] {
    const width = getTerminalWidth();
    const lines: string[] = [this.statusLine(width)];
    if (this.queue)
      lines.push(`  ${dim(truncateText(formatConcurrencyQueueLine(this.queue), width - 4))}`);
    if (this.stopping) {
      lines.push(
        this.stopping === "aggressive"
          ? `  ${red("✗ stopping now — closing in-flight sessions")}`
          : `  ${yellow("⚠ stopping after in-flight rows")} ${dim("· esc again to stop now")}`,
      );
    }

    const all = [...this.rows.values()];
    const running = all
      .filter((row) => row.status === "running")
      .sort((a, b) => a.startedAt - b.startedAt);
    const finished = all
      .filter((row) => row.status !== "running")
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    const showModel = new Set(all.map((row) => row.model).filter(Boolean)).size > 1;
    const labelWidth = Math.min(
      showModel ? 48 : 30,
      Math.max(12, ...all.map((row) => visibleLength(this.rowLabel(row, showModel)))),
    );

    const budget = Math.max(6, this.terminalRows() - RESERVED_TERMINAL_ROWS - lines.length);
    const recentCount = Math.min(RECENT_ROWS, finished.length);
    const recentLines = recentCount > 0 ? recentCount + 2 : 0; // blank + "recent" + rows
    const hintLines = this.keyHints ? 2 : 0;
    const runningBudget = Math.max(1, budget - recentLines - hintLines - 1);
    const shownRunning = running.slice(0, runningBudget);

    if (shownRunning.length > 0) lines.push("");
    const p75 =
      finished.length >= 4
        ? percentile(
            finished.map((row) => row.durationMs ?? 0),
            0.75,
          )
        : undefined;
    for (const row of shownRunning)
      lines.push(this.runningLine(row, width, labelWidth, showModel, p75));
    if (running.length > shownRunning.length) {
      lines.push(`  ${dim(`+ ${running.length - shownRunning.length} more running`)}`);
    }

    if (recentCount > 0) {
      lines.push("", `  ${dim("recent")}`);
      for (const row of finished.slice(0, recentCount)) {
        lines.push(this.finishedLine(row, width, labelWidth, showModel));
      }
      if (finished.length > recentCount) {
        lines.push(`  ${dim(`… ${finished.length - recentCount} more finished`)}`);
      }
    }
    if (this.keyHints) lines.push("", `  ${dim(this.keyHints)}`);
    return lines;
  }

  private statusLine(width: number): string {
    const done = this.passed + this.failed + this.maxTurns;
    const total = this.total ?? done;
    const barWidth = Math.max(10, Math.min(30, Math.floor(width * 0.22)));
    const filled = total > 0 ? Math.min(barWidth, Math.round((done / total) * barWidth)) : 0;
    const bar = `${green("━".repeat(filled))}${dim("━".repeat(barWidth - filled))}`;
    const counts = [
      green(`✓ ${this.passed}`),
      red(`✗ ${this.failed}`),
      ...(this.maxTurns > 0 ? [yellow(`⏱ ${this.maxTurns}`)] : []),
    ].join("  ");
    const elapsed = this.now() - this.startedAt;
    const eta =
      done >= 3 && total > done
        ? ` · eta ~${Math.ceil(((elapsed / done) * (total - done)) / 60_000)}m`
        : "";
    return `  ${bar}  ${done}/${total}   ${counts}   ${dim(`${formatElapsed(elapsed)}${eta}`)}`;
  }

  private rowLabel(row: RowState, showModel: boolean): string {
    if (!showModel || !row.model) return row.name;
    return `${row.name} ${row.model.slice(row.model.indexOf("/") + 1)}`;
  }

  private runningLine(
    row: RowState,
    width: number,
    labelWidth: number,
    showModel: boolean,
    p75: number | undefined,
  ): string {
    const spinner = blue(SPINNER[this.frame % SPINNER.length]);
    const elapsedMs = this.now() - row.startedAt;
    const elapsed = formatElapsed(elapsedMs);
    const elapsedCell = p75 !== undefined && elapsedMs > p75 ? yellow(elapsed) : dim(elapsed);
    const phase = PHASE_TONE[row.phase](padRight(row.phase, 8));
    // 2 indent + spinner + space + label + 2 + question + 2 + phase(8) + space + elapsed(≤7)
    const questionWidth = width - 2 - 2 - labelWidth - 2 - 2 - 8 - 1 - 7;
    const question =
      row.question && questionWidth >= 12 ? `${gray(padRight(row.question, questionWidth))}  ` : "";
    return `  ${spinner} ${padRight(this.rowLabel(row, showModel), labelWidth)}  ${question}${phase} ${elapsedCell}`;
  }

  private finishedLine(
    row: RowState,
    width: number,
    labelWidth: number,
    showModel: boolean,
  ): string {
    const label = outcomeLabel(row.outcome);
    const icon = OUTCOME_ICON[row.outcome ?? "fail"];
    const kind = row.outcome === "pass" ? padRight("", 10) : label.tone(padRight(label.text, 10));
    const prefix = `  ${icon} ${padRight(this.rowLabel(row, showModel), labelWidth)}  ${kind} `;
    const parts = [
      row.durationMs !== undefined ? formatElapsed(row.durationMs) : undefined,
      // Failures link their session; rubric fails also carry the reason.
      row.outcome !== "pass" ? row.sessionUrl : undefined,
      row.outcome === "fail" ? row.error : undefined,
    ].filter(Boolean);
    const tail = truncateText(parts.join(" · "), Math.max(10, width - visibleLength(prefix) - 2));
    return `${prefix}${dim(tail)}`;
  }

  // ─── Rendering ─────────────────────────────────────────────────────────

  private finish(
    row: ProgressRow,
    status: "passed" | "failed",
    details: { error?: string; outcome?: RowOutcome; durationMs?: number; sessionUrl?: string },
  ): void {
    const key = rowIdentity(row);
    const previous = this.rows.get(key);
    this.rows.set(key, {
      name: rowDisplayName(row),
      question: row.case?.question,
      model: row.model,
      phase: previous?.phase ?? "starting",
      startedAt: previous?.startedAt ?? this.now(),
      status,
      finishedAt: this.now(),
      durationMs: details.durationMs,
      error: details.error,
      outcome: details.outcome,
      sessionUrl: details.sessionUrl ?? previous?.sessionUrl,
    });
  }

  private afterFinish(): void {
    if (this.progressBar) this.printProgressBar();
    if (this.animated) {
      this.redraw();
      if (![...this.rows.values()].some((row) => row.status === "running")) this.stopTicker();
    }
  }

  private redraw(): void {
    this.clearBoard();
    this.draw();
  }

  private draw(): void {
    const lines = this.boardLines();
    for (const text of lines) this.line(text);
    this.renderedLines = lines.length;
  }

  private clearBoard(): void {
    if (this.renderedLines > 0) {
      readline.moveCursor(this.out, 0, -this.renderedLines);
      readline.cursorTo(this.out, 0);
      readline.clearScreenDown(this.out);
    }
    this.renderedLines = 0;
  }

  private printEventLine(
    icon: string,
    name: string,
    model: string | undefined,
    status: string,
    duration?: string,
  ): void {
    const width = getTerminalWidth();
    const statusWidth = Math.max(9, visibleLength(status));
    const modelWidth = model ? Math.min(28, visibleLength(model)) : 0;
    const nameWidth = Math.max(18, width - 6 - statusWidth - (model ? modelWidth + 1 : 0) - 12);
    const modelCell = model ? ` ${dim(padRight(model, modelWidth))}` : "";
    this.line(
      `  ${icon} ${padRight(name, nameWidth)}${modelCell} ${padRight(status, statusWidth)}${duration ? ` ${duration}` : ""}`,
    );
  }

  private printProgressBar(): void {
    const total = this.total ?? 0;
    if (total <= 0) return;
    const completed = this.passed + this.failed + this.maxTurns;
    const barWidth = Math.max(12, Math.min(34, Math.floor(getTerminalWidth() * 0.24)));
    const filled = Math.min(barWidth, Math.round((completed / total) * barWidth));
    const pct = Math.round((completed / total) * 100);
    this.line(
      `  ${green("█".repeat(filled))}${dim("░".repeat(barWidth - filled))} ${dim("|")} ${pct}% | ${completed}/${total} datapoints`,
    );
  }

  private startTicker(): void {
    if (!this.animated || this.timer) return;
    if (!this.cursorHidden) {
      this.raw("\x1b[?25l");
      this.cursorHidden = true;
    }
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.redraw();
    }, TICK_MS);
    this.timer.unref?.();
  }

  private stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.cursorHidden) {
      this.raw("\x1b[?25h");
      this.cursorHidden = false;
    }
  }

  private terminalRows(): number {
    const rows = this.out.rows;
    if (typeof rows !== "number" || !Number.isFinite(rows) || rows <= 0)
      return FALLBACK_TERMINAL_ROWS;
    return Math.max(FALLBACK_TERMINAL_ROWS, rows);
  }

  private raw(text: string): void {
    this.out.write(text);
  }

  private line(text = ""): void {
    this.out.write(`${text}\n`);
  }
}
