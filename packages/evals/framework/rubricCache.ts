/**
 * Rubric cache — persists AI-generated rubrics so we run Step 0a once per
 * task id and hydrate from disk thereafter. Honors plan §10 Q3 (resolved:
 * generate per-task on first run + cache).
 *
 * Used for any task whose dataset doesn't ship a precomputed_rubric
 * (Mind2Web, ad-hoc bench tasks, etc.). WebTailBench is exempt — its
 * upstream dataset already carries rubrics.
 *
 * Cache layout:
 *   packages/evals/.rubric-cache/<dataset>/<task-id>.json
 *
 * The cache key includes the task instruction hash to detect drift — if the
 * instruction changes for the same task id, the rubric is regenerated rather
 * than served from a stale cache.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { Rubric, TaskSpec, V3Evaluator } from "@browserbasehq/stagehand";

export interface RubricCacheOptions {
  /**
   * Root directory for cached rubrics. Defaults to
   * `<packages/evals>/.rubric-cache`.
   */
  cacheRoot?: string;
  /**
   * Dataset name, used as a subdirectory under cacheRoot to keep different
   * datasets' rubrics separate (e.g., "onlineMind2Web").
   */
  dataset: string;
}

interface CacheEntry {
  taskId: string;
  instructionHash: string;
  generatedAt: string;
  rubric: Rubric;
}

function hashInstruction(instruction: string): string {
  return crypto
    .createHash("sha256")
    .update(instruction)
    .digest("hex")
    .slice(0, 16);
}

export class RubricCache {
  private readonly cacheDir: string;

  constructor(opts: RubricCacheOptions) {
    const root =
      opts.cacheRoot ??
      path.join(process.cwd(), "packages/evals/.rubric-cache");
    this.cacheDir = path.join(root, opts.dataset);
  }

  /**
   * Get or generate a rubric for the task. If a fresh cache entry exists
   * (same instruction hash), returns it. Otherwise runs Step 0a and persists.
   */
  async getOrGenerate(
    taskSpec: TaskSpec,
    evaluator: V3Evaluator,
  ): Promise<Rubric> {
    const cached = await this.read(taskSpec);
    if (cached) return cached;

    const rubric = await evaluator.generateRubric(taskSpec);
    await this.write(taskSpec, rubric);
    return rubric;
  }

  /**
   * Read a cached rubric. Returns undefined on miss or instruction-hash drift.
   */
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
    const expectedHash = hashInstruction(taskSpec.instruction);
    if (parsed.instructionHash !== expectedHash) {
      // Drift detected — surface a clear log and miss.
      console.warn(
        `[rubric-cache] instruction-hash drift for ${taskSpec.id}; regenerating`,
      );
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
    await fs.writeFile(
      this.entryPath(taskSpec.id),
      JSON.stringify(entry, null, 2),
    );
  }

  /** Wipe the cache directory (used by tests / `bench cache clear`). */
  async clear(): Promise<void> {
    await fs.rm(this.cacheDir, { recursive: true, force: true });
  }

  private entryPath(taskId: string): string {
    // Sanitize task id for filesystem safety.
    const safe = taskId.replace(/[^A-Za-z0-9._-]/g, "_");
    return path.join(this.cacheDir, `${safe}.json`);
  }
}
