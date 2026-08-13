import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rubric, TaskSpec } from "stagehand-v3";

import { RubricCache } from "../../framework/rubricCache.js";

describe("RubricCache", () => {
  let tmpRoot = "";
  let warn: ReturnType<typeof vi.spyOn>;

  const rubric: Rubric = {
    items: [
      {
        criterion: "criterion",
        description: "description",
        maxPoints: 1,
      },
    ],
  };

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubric-cache-test-"));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    delete process.env.EVAL_RUBRIC_CACHE_ROOT;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("misses when sanitized task ids collide but the stored task id differs", async () => {
    const cache = new RubricCache({ cacheRoot: tmpRoot, dataset: "test" });
    const taskA: TaskSpec = { id: "task/a", instruction: "same instruction" };
    const taskB: TaskSpec = { id: "task:a", instruction: "same instruction" };

    await cache.write(taskA, rubric);

    await expect(cache.read(taskB)).resolves.toBeUndefined();
    await expect(cache.read(taskA)).resolves.toEqual(rubric);
    expect(warn).toHaveBeenCalledWith("[rubric-cache] task-id mismatch for task:a; regenerating");
  });

  it("uses one explicit durable cache root across separate cache instances", async () => {
    process.env.EVAL_RUBRIC_CACHE_ROOT = tmpRoot;
    const task: TaskSpec = { id: "task-1", instruction: "frozen instruction" };

    await new RubricCache({ dataset: "onlineMind2Web" }).write(task, rubric);

    await expect(new RubricCache({ dataset: "onlineMind2Web" }).read(task)).resolves.toEqual(
      rubric,
    );
  });
});
