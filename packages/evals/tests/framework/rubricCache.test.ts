import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rubric, TaskSpec } from "@browserbasehq/stagehand";

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
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("misses when sanitized task ids collide but the stored task id differs", async () => {
    const cache = new RubricCache({ cacheRoot: tmpRoot, dataset: "test" });
    const taskA: TaskSpec = { id: "task/a", instruction: "same instruction" };
    const taskB: TaskSpec = { id: "task:a", instruction: "same instruction" };

    await cache.write(taskA, rubric);

    await expect(cache.read(taskB)).resolves.toBeUndefined();
    await expect(cache.read(taskA)).resolves.toEqual(rubric);
    expect(warn).toHaveBeenCalledWith(
      "[rubric-cache] task-id mismatch for task:a; regenerating",
    );
  });
});
