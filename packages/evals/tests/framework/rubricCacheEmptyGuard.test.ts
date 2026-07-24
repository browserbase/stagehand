import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RubricCache } from "../../framework/rubricCache.js";
import type { TaskSpec } from "@browserbasehq/stagehand";

const taskSpec: TaskSpec = {
  id: "row-1",
  instruction: "find the thing",
};

let root: string;
let cache: RubricCache;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "rubric-cache-test-"));
  cache = new RubricCache({ dataset: "testset", cacheRoot: root });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("rubric cache empty-rubric guards", () => {
  it("refuses to persist an empty rubric", async () => {
    await cache.write(taskSpec, { items: [] });
    expect(await cache.read(taskSpec)).toBeUndefined();
  });

  it("treats a pre-existing empty cached rubric as a miss", async () => {
    // Simulate the poisoned-cache state observed on Allrecipes--2: an empty
    // rubric written by an older version of the cache.
    const dir = path.join(root, "testset");
    await fs.mkdir(dir, { recursive: true });
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256")
      .update(taskSpec.instruction)
      .digest("hex")
      .slice(0, 16);
    await fs.writeFile(
      path.join(dir, "row-1.json"),
      JSON.stringify({
        taskId: "row-1",
        instructionHash: hash,
        generatedAt: new Date().toISOString(),
        rubric: { items: [] },
      }),
    );
    expect(await cache.read(taskSpec)).toBeUndefined();
  });

  it("round-trips a real rubric untouched", async () => {
    const rubric = {
      items: [
        {
          criterion: "did the thing",
          description: "full credit if the thing was done",
          maxPoints: 3,
        },
      ],
    };
    await cache.write(taskSpec, rubric);
    expect(await cache.read(taskSpec)).toEqual(rubric);
  });
});
