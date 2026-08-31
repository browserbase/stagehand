import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rubric, TaskSpec, Trajectory, TrajectoryStep } from "stagehand-v3";

import { gradeExternalTrajectory } from "../../framework/verifierAdapter.js";
import { EvalLogger } from "../../logger.js";

const mockState = vi.hoisted(() => ({
  evaluationResult: {
    outcomeSuccess: true,
    processScore: 0.92,
  } as Record<string, unknown>,
}));

vi.mock("stagehand-v3", async (importOriginal) => {
  const mod = await importOriginal<typeof import("stagehand-v3")>();
  class FakeV3Evaluator {
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

  beforeEach(() => {
    savedSuccessMode = process.env.EVAL_SUCCESS_MODE;
    savedPersist = process.env.VERIFIER_PERSIST_TRAJECTORIES;
    delete process.env.EVAL_SUCCESS_MODE;
    // Keep persistAdapterTrajectory on its no-write path (it defaults to
    // persisting outside CI).
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
  });

  afterEach(() => {
    if (savedSuccessMode === undefined) delete process.env.EVAL_SUCCESS_MODE;
    else process.env.EVAL_SUCCESS_MODE = savedSuccessMode;
    if (savedPersist === undefined) delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
    else process.env.VERIFIER_PERSIST_TRAJECTORIES = savedPersist;
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

  it("surfaces the judge verdict, gate list and gate metrics on the result", async () => {
    const result = await grade({ metrics: { harness_total_tokens: { count: 1, value: 10 } } });

    expect(result.judgeOutcomeSuccess).toBe(true);
    expect(result.outcomeGates).toEqual([]);
    expect(result.processScoreLenient).toBe(0.92);
    expect(result.processScoreStrict).toBe(0.92);
    expect(result.scoringIncomplete).toBe(true);
    const metrics = result.metrics as Record<string, { count: number; value: number }>;
    expect(metrics.harness_total_tokens).toEqual({ count: 1, value: 10 });
    expect(metrics.outcome_gated).toEqual({ count: 1, value: 0 });
    expect(metrics.scoring_incomplete).toEqual({ count: 1, value: 1 });
    expect(metrics.answer_grounded).toBeUndefined();
  });

  it("gates a judge pass that never touched the browser and fails _success", async () => {
    const result = await gradeExternalTrajectory({
      buildTrajectory: () =>
        ({
          ...trajectory,
          steps: [
            { actionName: "web_fetch", actionArgs: {}, toolOutput: { ok: true, result: "" } },
          ],
        }) as unknown as Trajectory,
      verifier: { v3: {} as never, taskSpec, dataset: "test" },
      baseResult: { _success: true },
      errorMessage: "agent reported failure",
      category: "fx",
      logger: new EvalLogger(false),
      isFacadeTool: (name) => name.startsWith("stagehand"),
    });

    expect(result.judgeOutcomeSuccess).toBe(true);
    expect(result.outcomeSuccess).toBe(false);
    expect(result.outcomeGates).toEqual(["no_browser_use"]);
    expect(result._success).toBe(false);
    // A gate that overrides a judge pass names itself in the row error so the
    // reason is visible where the row is read, with the agent's claim attached.
    expect(result.error).toMatch(
      /^gated: no_browser_use — no browser tool calls \(judge passed; agent said: agent reported failure\)$/,
    );
    expect((result.metrics as Record<string, { value: number }>).outcome_gated.value).toBe(1);
  });

  it("gates an ungrounded numeric answer when the dataset ships precomputed rubrics", async () => {
    const searchOnly = {
      ...trajectory,
      finalAnswer: "The seat costs SGD 5.",
      steps: [
        {
          actionName: "stagehand__run",
          actionArgs: { code: "await page.goto('https://www.google.com/search?q=seat')" },
          probeEvidence: { url: "https://www.google.com/search?q=seat" },
          toolOutput: { ok: true, result: "AirAsia seat SGD 5" },
        },
      ],
    } as unknown as Trajectory;
    const run = (dataset: string) =>
      gradeExternalTrajectory({
        buildTrajectory: () => searchOnly,
        verifier: { v3: {} as never, taskSpec, dataset },
        baseResult: { _success: true },
        errorMessage: "agent reported failure",
        category: "eve",
        logger: new EvalLogger(false),
      });

    const gated = await run("hardbenchmark");
    expect(gated.outcomeGates).toEqual(["ungrounded_answer"]);
    expect(gated._success).toBe(false);
    expect((gated.metrics as Record<string, { value: number }>).answer_grounded.value).toBe(0);
    expect((gated.grounding as { ungrounded: Array<{ text: string }> }).ungrounded[0]?.text).toBe(
      "SGD 5",
    );

    process.env.EVAL_REQUIRE_GROUNDING = "0";
    try {
      const advisory = await run("hardbenchmark");
      expect(advisory.outcomeGates).toEqual([]);
      expect(advisory._success).toBe(true);
      expect((advisory.metrics as Record<string, { value: number }>).answer_grounded.value).toBe(0);
    } finally {
      delete process.env.EVAL_REQUIRE_GROUNDING;
    }
  });
});
