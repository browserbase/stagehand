import { afterEach, expect, test } from "vitest";
import { Evaluator } from "../src/evaluator.js";
import { AISdkJudge } from "../src/client.js";
import type { Trajectory } from "../src/types.js";

function judge(modelId: string, validate: () => Promise<void>): AISdkJudge {
  const j = new AISdkJudge({ provider: "fixture", modelId } as never);
  (j as unknown as { validate: () => Promise<void> }).validate = validate;
  return j;
}

const emptyTrajectory = (precomputedRubric?: unknown): Trajectory =>
  ({
    task: {
      id: "t",
      instruction: "do it",
      precomputedRubric,
    },
    steps: [],
  }) as unknown as Trajectory;

afterEach(() => {
  delete process.env.VERIFIER_REQUIREMENTS;
});

test("a failed health check does not poison the Evaluator; the next call retries", async () => {
  let calls = 0;
  const j = judge("judge-retry", async () => {
    if (++calls === 1) throw new Error("transient");
  });
  const evaluator = new Evaluator({ client: j, rubricClient: j });
  await expect(evaluator.validate()).rejects.toThrow("transient");
  await expect(evaluator.validate()).resolves.toBeUndefined();
  expect(calls).toBe(2);
});

test("verify skips the rubric model health check when a precomputed rubric is used", async () => {
  const main = judge("judge-main", async () => {});
  const rubricModel = judge("judge-rubric-broken", async () => {
    throw new Error("bad rubric model");
  });
  const rubric = { items: [{ criterion: "c", description: "d", maxPoints: 1 }] };
  const result = await new Evaluator({ client: main, rubricClient: rubricModel }).verify(
    emptyTrajectory(rubric),
  );
  expect(result.health?.status).not.toBe("error");
  await expect(
    new Evaluator({ client: main, rubricClient: rubricModel }).verify(emptyTrajectory()),
  ).rejects.toThrow("bad rubric model");
});
