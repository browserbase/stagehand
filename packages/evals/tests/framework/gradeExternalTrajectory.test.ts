import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rubric, TaskSpec, Trajectory, TrajectoryStep } from "stagehand-v3";

import { gradeExternalTrajectory } from "../../framework/verifierAdapter.js";
import { EvalLogger } from "../../logger.js";

const mockState = vi.hoisted(() => ({
  evaluationResult: {
    outcomeSuccess: true,
    processScore: 0.92,
  } as Record<string, unknown>,
  evaluatorOptions: undefined as unknown,
}));

vi.mock("stagehand-v3", async (importOriginal) => {
  const mod = await importOriginal<typeof import("stagehand-v3")>();
  class FakeV3Evaluator {
    constructor(_v3: unknown, options: unknown) {
      mockState.evaluatorOptions = options;
    }
    async verify() {
      return mockState.evaluationResult;
    }
    async generateRubric() {
      throw new Error("generateRubric must not be called for this rubric");
    }
  }
  return {
    ...mod,
    V3Evaluator: FakeV3Evaluator as unknown as typeof mod.V3Evaluator,
  };
});

describe("gradeExternalTrajectory", () => {
  const rubric: Rubric = {
    items: [
      { criterion: "step one", description: "does step one", maxPoints: 1 },
      { criterion: "step two", description: "does step two", maxPoints: 2 },
    ],
  };

  const taskSpec: TaskSpec = {
    id: "task-1",
    instruction: "do the thing",
    precomputedRubric: rubric,
  };

  const trajectory = {
    task: taskSpec,
    steps: [{}, {}, {}] as TrajectoryStep[],
    status: "complete",
    finalAnswer: "done",
    usage: {},
  } as Trajectory;

  function grade(baseResult: Record<string, unknown>) {
    return gradeExternalTrajectory({
      buildTrajectory: () => trajectory,
      verifier: { v3: {} as never, taskSpec, dataset: "test" },
      baseResult: { _success: false, ...baseResult },
      errorMessage: "agent reported failure",
      category: "claude_code",
      logger: new EvalLogger(false),
    });
  }

  let savedSuccessMode: string | undefined;
  let savedPersist: string | undefined;
  let savedVerifierModel: string | undefined;
  let savedGroqApiKey: string | undefined;

  beforeEach(() => {
    savedSuccessMode = process.env.EVAL_SUCCESS_MODE;
    savedPersist = process.env.VERIFIER_PERSIST_TRAJECTORIES;
    savedVerifierModel = process.env.EVAL_VERIFIER_MODEL;
    savedGroqApiKey = process.env.GROQ_API_KEY;
    delete process.env.EVAL_SUCCESS_MODE;
    delete process.env.EVAL_VERIFIER_MODEL;
    // Keep persistAdapterTrajectory on its no-write path (it defaults to
    // persisting outside CI).
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
    mockState.evaluatorOptions = undefined;
  });

  afterEach(() => {
    if (savedSuccessMode === undefined) delete process.env.EVAL_SUCCESS_MODE;
    else process.env.EVAL_SUCCESS_MODE = savedSuccessMode;
    if (savedPersist === undefined) delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
    else process.env.VERIFIER_PERSIST_TRAJECTORIES = savedPersist;
    if (savedVerifierModel === undefined) delete process.env.EVAL_VERIFIER_MODEL;
    else process.env.EVAL_VERIFIER_MODEL = savedVerifierModel;
    if (savedGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = savedGroqApiKey;
    mockState.evaluationResult = { outcomeSuccess: true, processScore: 0.92 };
  });

  it("folds a successful verdict into the task result", async () => {
    const result = await grade({ error: "self-reported failure" });

    expect(result._success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.outcomeSuccess).toBe(true);
    expect(result.processScore).toBe(0.92);
    expect(result.criterionCount).toBe(2);
    expect(result.stepCount).toBe(3);
    expect(typeof result.trajectoryDir).toBe("string");
    expect(result.verifierError).toBeUndefined();
  });

  it("keeps the error and fails the result when the verdict is negative", async () => {
    mockState.evaluationResult = { outcomeSuccess: false, processScore: 0.1 };

    const result = await grade({});

    expect(result._success).toBe(false);
    expect(result.error).toBe("agent reported failure");
    expect(result.outcomeSuccess).toBe(false);
    expect(result.verifierError).toBeUndefined();
  });

  it("honors EVAL_SUCCESS_MODE=process for the folded _success", async () => {
    process.env.EVAL_SUCCESS_MODE = "process";
    mockState.evaluationResult = { outcomeSuccess: false, processScore: 0.95 };

    const result = await grade({});

    expect(result._success).toBe(true);
    expect(result.processScore).toBe(0.95);
  });

  it("selects the verifier model independently from the harness model", async () => {
    process.env.EVAL_VERIFIER_MODEL = " groq/llama-3.3-70b-versatile ";
    process.env.GROQ_API_KEY = "test-groq-key";

    await grade({});

    expect(mockState.evaluatorOptions).toEqual({
      backend: "verifier",
      modelName: "groq/llama-3.3-70b-versatile",
      modelClientOptions: { apiKey: "test-groq-key" },
    });
  });
});
