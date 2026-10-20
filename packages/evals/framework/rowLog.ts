/**
 * One log file per row execution.
 *
 * Before this, default (non-verbose) runs dropped every console line and
 * EvalLogger line on the floor; verbose runs interleaved six concurrent rows
 * with no way to tell them apart. Each row now writes its own file, so a
 * failure can point at exactly what happened in it.
 *
 * Location: `<trajectory root>/<group>/logs/` when trajectories persist (so
 * logs sit next to the trajectories they explain), else a temp dir.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RowLogEntry } from "./rowContext.js";

export function resolveRunLogDir(options: {
  trajectoryRoot: string;
  trajectoryGroup: string;
  persist: boolean;
}): string {
  return options.persist
    ? path.join(options.trajectoryRoot, options.trajectoryGroup, "logs")
    : path.join(os.tmpdir(), "stagehand-evals", options.trajectoryGroup, "logs");
}

const UNSAFE = /[^A-Za-z0-9._-]+/g;

/**
 * `47e314cc-recreation.gov__openai-gpt-5.4-mini.log`, `-t2` for later trials.
 * The provider stays in the name: `openai/foo` and `anthropic/foo` are
 * different rows.
 */
export function rowLogFileName(input: {
  name: string;
  domain?: string;
  model?: string;
  trial?: number;
}): string {
  const model = input.model?.replaceAll("/", "-");
  const base = [input.name, input.domain].filter(Boolean).join("-");
  const trial = input.trial ? `-t${input.trial + 1}` : "";
  return `${`${base}${trial}${model ? `__${model}` : ""}`.replace(UNSAFE, "_")}.log`;
}

function formatEntry(entry: RowLogEntry, at: Date): string {
  const level = entry.level === 0 ? " ERROR" : "";
  return `${at.toISOString()} [${entry.category}]${level} ${entry.message}\n`;
}

/**
 * Hands out one file name per row within a run. Two rows whose names would
 * collide (the same case id in two suites, or two tool surfaces of one cell)
 * get `~2`, `~3`, … instead of interleaving in one append-only file. The same
 * row key always gets the same name back.
 */
export class RowLogNames {
  private readonly owners = new Map<string, string>();

  claim(fileName: string, rowKey: string): string {
    const stem = fileName.replace(/\.log$/, "");
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? fileName : `${stem}~${n}.log`;
      const owner = this.owners.get(candidate);
      if (owner === undefined) {
        this.owners.set(candidate, rowKey);
        return candidate;
      }
      if (owner === rowKey) return candidate;
    }
  }
}

/**
 * Appends a row's lines to its file. The file is only created on the first
 * line, so rows that log nothing leave nothing behind. Logging is best
 * effort: a filesystem error disables this row's file and never fails the row.
 */
export class RowLogWriter {
  private stream?: fs.WriteStream;
  private wrote = false;
  private disabled = false;

  constructor(readonly filePath: string) {}

  get hasContent(): boolean {
    return this.wrote;
  }

  write(entry: RowLogEntry, at: Date = new Date()): void {
    if (this.disabled) return;
    try {
      if (!this.stream) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
        this.stream.on("error", () => {
          this.disabled = true;
        });
      }
      this.stream.write(formatEntry(entry, at));
      this.wrote = true;
    } catch {
      this.disabled = true;
    }
  }

  /** Marks a retry so the second attempt is distinguishable in the file. */
  attempt(n: number): void {
    if (n > 1) this.write({ category: "runner", message: `──── attempt ${n} ────` });
  }

  close(): Promise<void> {
    const stream = this.stream;
    if (!stream) return Promise.resolve();
    this.stream = undefined;
    return new Promise((resolve) => stream.end(() => resolve()));
  }
}
