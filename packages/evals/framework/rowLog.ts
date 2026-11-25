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
