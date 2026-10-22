import { afterEach, expect, test } from "vitest";
import { Evaluator } from "../src/evaluator.js";
import { AISdkJudge, type CompletionRequest } from "../src/client.js";
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

const rubric = { items: [{ criterion: "c", description: "d", maxPoints: 1 }] };
const answered = (precomputedRubric?: unknown): Trajectory =>
  ({
    task: { id: "t", instruction: "do it", precomputedRubric },
    steps: [],
    finalAnswer: "done",
  }) as unknown as Trajectory;

test("a malformed truthy precomputed rubric returns a health error instead of throwing", async () => {
  const client = {
    async createChatCompletion<T>(): Promise<T> {
      throw new Error("judge should not be called");
    },
  };
  const result = await new Evaluator({ client, rubricClient: client }).verify(answered({}));
  expect(result.health?.status).toBe("error");
  expect(result.outcomeState).toBe("unresolved");
});

test("a failed fused judgment surfaces as a health error, not as graded scores", async () => {
  const client = {
    async createChatCompletion<T>(): Promise<T> {
      throw new Error("judge down");
    },
  };
  const result = await new Evaluator({ client, rubricClient: client }).verify(answered(rubric));
  expect(result.health?.status).toBe("error");
  expect(result.health?.errors.map((e) => e.stage)).toContain("FusedJudgment");
  expect(result.outcomeState).toBe("unresolved");
});

test("a rubric-generation attempt that a retry recovers is not recorded as an error", async () => {
  let rubricCalls = 0;
  const client = {
    async createChatCompletion<T>(request: CompletionRequest): Promise<T> {
      if (request.options.response_model.name !== "Rubric") throw new Error("judge down");
      if (++rubricCalls === 1) throw new Error("transient");
      return { data: rubric } as T;
    },
  };
  const result = await new Evaluator({ client, rubricClient: client }).verify(answered());
  expect(rubricCalls).toBe(2);
  expect(result.health?.errors.map((e) => e.stage)).not.toContain("Rubric");
});
