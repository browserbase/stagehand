import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rubric, TaskSpec } from "@browserbasehq/stagehand";

import { resolveRubricTraced } from "../../framework/verifierAdapter.js";

describe("resolveRubricTraced", () => {
  let tmpRoot = "";
  let savedDisableCache: string | undefined;
  let savedBraintrustKey: string | undefined;

  const generatedRubric: Rubric = {
    items: [
      {
        criterion: "generated criterion",
        description: "generated description",
        maxPoints: 2,
      },
    ],
  };

  const taskSpec: TaskSpec = {
    id: "task/resolve",
    instruction: "do the thing",
  };

  function fakeEvaluator() {
    return { generateRubric: vi.fn(async () => generatedRubric) };
  }

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubric-resolve-test-"));
    savedDisableCache = process.env.VERIFIER_DISABLE_RUBRIC_CACHE;
    savedBraintrustKey = process.env.BRAINTRUST_API_KEY;
    delete process.env.VERIFIER_DISABLE_RUBRIC_CACHE;
    // Keep tracedSpan on its no-op path so tests never touch Braintrust.
    delete process.env.BRAINTRUST_API_KEY;
  });

  afterEach(async () => {
    if (savedDisableCache === undefined) {
      delete process.env.VERIFIER_DISABLE_RUBRIC_CACHE;
    } else {
      process.env.VERIFIER_DISABLE_RUBRIC_CACHE = savedDisableCache;
    }
    if (savedBraintrustKey === undefined) {
      delete process.env.BRAINTRUST_API_KEY;
    } else {
      process.env.BRAINTRUST_API_KEY = savedBraintrustKey;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("uses the precomputed rubric without generating", async () => {
    const evaluator = fakeEvaluator();
    const precomputed: Rubric = {
      items: [
        {
          criterion: "precomputed criterion",
          description: "precomputed description",
          maxPoints: 1,
        },
      ],
    };

    const result = await resolveRubricTraced(evaluator, {
      taskSpec: { ...taskSpec, precomputedRubric: precomputed },
      dataset: "test",
      cacheRoot: tmpRoot,
    });

    expect(result.source).toBe("precomputed");
    expect(result.rubric).toEqual(precomputed);
    expect(evaluator.generateRubric).not.toHaveBeenCalled();
  });

  it("normalizes snake_case precomputed rubric fields", async () => {
    const evaluator = fakeEvaluator();
    const rawPrecomputed = {
      items: [
        {
          criterion: "raw criterion",
          description: "raw description",
          max_points: 3,
        },
      ],
    };

    const result = await resolveRubricTraced(evaluator, {
      taskSpec: {
        ...taskSpec,
        precomputedRubric: rawPrecomputed as unknown as Rubric,
      },
      dataset: "test",
      cacheRoot: tmpRoot,
    });

    expect(result.source).toBe("precomputed");
    expect(result.rubric.items[0].maxPoints).toBe(3);
    expect(evaluator.generateRubric).not.toHaveBeenCalled();
  });

  it("reports a cache miss as generated and writes the cache", async () => {
    const evaluator = fakeEvaluator();

    const result = await resolveRubricTraced(evaluator, {
      taskSpec,
      dataset: "test",
      cacheRoot: tmpRoot,
    });

    expect(result.source).toBe("generated");
    expect(result.rubric).toEqual(generatedRubric);
    expect(evaluator.generateRubric).toHaveBeenCalledTimes(1);

    const entries = await fs.readdir(path.join(tmpRoot, "test"));
    expect(entries).toHaveLength(1);
  });

  it("reports a cache hit as cached without generating", async () => {
    await resolveRubricTraced(fakeEvaluator(), {
      taskSpec,
      dataset: "test",
      cacheRoot: tmpRoot,
    });

    const evaluator = fakeEvaluator();
    const result = await resolveRubricTraced(evaluator, {
      taskSpec,
      dataset: "test",
      cacheRoot: tmpRoot,
    });

    expect(result.source).toBe("cached");
    expect(result.rubric).toEqual(generatedRubric);
    expect(evaluator.generateRubric).not.toHaveBeenCalled();
  });

  it("regenerates when the instruction drifts from the cached entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await resolveRubricTraced(fakeEvaluator(), {
        taskSpec,
        dataset: "test",
        cacheRoot: tmpRoot,
      });

      const evaluator = fakeEvaluator();
      const result = await resolveRubricTraced(evaluator, {
        taskSpec: { ...taskSpec, instruction: "do a different thing" },
        dataset: "test",
        cacheRoot: tmpRoot,
      });

      expect(result.source).toBe("generated");
      expect(evaluator.generateRubric).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("always generates and never touches the cache when caching is disabled", async () => {
    process.env.VERIFIER_DISABLE_RUBRIC_CACHE = "1";
    const evaluator = fakeEvaluator();

    const result = await resolveRubricTraced(evaluator, {
      taskSpec,
      dataset: "test",
      cacheRoot: tmpRoot,
    });

    expect(result.source).toBe("generated");
    expect(evaluator.generateRubric).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.join(tmpRoot, "test"))).rejects.toThrow();
  });
});
