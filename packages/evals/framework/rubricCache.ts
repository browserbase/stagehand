import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { Rubric, TaskSpec } from "stagehand-v3";

export interface RubricCacheOptions {
  cacheRoot?: string;
  dataset: string;
}

interface CacheEntry {
  taskId: string;
  instructionHash: string;
  generatedAt: string;
  rubric: Rubric;
}

function hashInstruction(instruction: string): string {
  return crypto.createHash("sha256").update(instruction).digest("hex").slice(0, 16);
}

export class RubricCache {
  private readonly cacheDir: string;

  constructor(opts: RubricCacheOptions) {
    const root = opts.cacheRoot ?? path.join(process.cwd(), "packages/evals/.rubric-cache");
    this.cacheDir = path.join(root, opts.dataset);
  }

  async read(taskSpec: TaskSpec): Promise<Rubric | undefined> {
    const file = this.entryPath(taskSpec.id);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return undefined;
    }
    let parsed: CacheEntry;
    try {
      parsed = JSON.parse(raw) as CacheEntry;
    } catch {
      return undefined;
    }
    if (parsed.taskId !== taskSpec.id) {
      console.warn(`[rubric-cache] task-id mismatch for ${taskSpec.id}; regenerating`);
      return undefined;
    }
    const expectedHash = hashInstruction(taskSpec.instruction);
    if (parsed.instructionHash !== expectedHash) {
      console.warn(`[rubric-cache] instruction-hash drift for ${taskSpec.id}; regenerating`);
      return undefined;
    }
    return parsed.rubric;
  }

  async write(taskSpec: TaskSpec, rubric: Rubric): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const entry: CacheEntry = {
      taskId: taskSpec.id,
      instructionHash: hashInstruction(taskSpec.instruction),
      generatedAt: new Date().toISOString(),
      rubric,
    };
    await fs.writeFile(this.entryPath(taskSpec.id), JSON.stringify(entry, null, 2));
  }

  async clear(): Promise<void> {
    await fs.rm(this.cacheDir, { recursive: true, force: true });
  }

  private entryPath(taskId: string): string {
    const safe = taskId.replace(/[^A-Za-z0-9._-]/g, "_");
    return path.join(this.cacheDir, `${safe}.json`);
  }
}
