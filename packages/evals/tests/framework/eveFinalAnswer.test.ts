/* eslint-disable require-yield */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EveClientLike, EveEvent } from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { AvailableModel, Rubric } from "stagehand-v3";
import { runEveAgent } from "../../framework/eveRunner.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

vi.mock("stagehand-v3", async (importOriginal) => {
  const mod = await importOriginal<typeof import("stagehand-v3")>();
  class FakeV3Evaluator {
    async verify() {
      // A judge that credits narration, so the test isolates the gates.
      return { outcomeSuccess: true, processScore: 1 };
    }
    async generateRubric() {
      throw new Error("rubric is precomputed");
    }
  }
  return { ...mod, V3Evaluator: FakeV3Evaluator as unknown as typeof mod.V3Evaluator };
});

const plan: ExternalHarnessTaskPlan = {
  dataset: "hardbenchmark",
  taskId: "hb-1",
  startUrl: "https://www.google.com",
  instruction: "Compare the Target and Walmart prices",
};

const rubric: Rubric = {
  items: [{ criterion: "prices", description: "reports both prices", maxPoints: 1 }],
};

function fakeClient(events: EveEvent[]): EveClientLike {
  return {
    health: async () => ({}),
    session: () => ({
      cancel: async () => ({}),
      send: async () =>
        Object.assign(
          {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
          },
          { sessionId: "eve-session" },
        ),
    }),
  };
}

function toolStep(index: number, narration: string): EveEvent[] {
  const callId = `c${index}`;
  return [
    { type: "reasoning.completed", data: { stepIndex: index, reasoning: `plan ${index}` } },
    {
      type: "message.completed",
      data: { stepIndex: index, finishReason: "tool-calls", message: narration },
    },
    {
      type: "actions.requested",
      data: {
        stepIndex: index,
        actions: [{ kind: "tool-call", callId, toolName: "stagehand__run", input: {} }],
      },
    },
    {
      type: "action.result",
      data: {
        stepIndex: index,
        status: "completed",
        result: { kind: "tool-result", callId, toolName: "stagehand__run", output: "ok" },
      },
    },
    { type: "step.completed", data: { stepIndex: index, finishReason: "tool-calls" } },
  ];
}

describe("eve final answer", () => {
  const roots: string[] = [];
  afterEach(async () => {
    delete process.env.EVAL_EVE_MAX_STEPS;
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("leaves a budget-exhausted run without an answer so the no_final_answer gate fires", async () => {
    process.env.EVAL_EVE_MAX_STEPS = "2";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eve-final-answer-"));
    roots.push(root);
    const narration =
      "Got Target Ultimate Strongheart specs. Now let me get Walmart's price for comparison...";
    const result = await runEveAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      client: fakeClient([
        ...toolStep(0, "Let me start by opening Target."),
        ...toolStep(1, narration),
        ...toolStep(2, "Now let me do a complete scan of Walmart."),
      ]),
      serverUrl: "http://eve",
      verifier: {
        v3: {} as never,
        taskSpec: { id: "hb-1", instruction: plan.instruction, precomputedRubric: rubric },
        dataset: "hardbenchmark",
        trajectoryRoot: root,
      },
    });

    expect(result.harnessStatus).toBe("max_turns");
    expect(result.terminationReason).toBe("step_budget");
    expect(result.finalAnswer).toBeUndefined();
    expect(result._success).toBe(false);
    expect(result.judgeOutcomeSuccess).toBe(true);
    expect(result.outcomeGates).toContain("no_final_answer");
    expect(result.outcomeGates).toContain("trajectory_error");
    const messages = (result.logs ?? []).map((line) => line.message);
    expect(messages.some((message) => message.startsWith("answer · Got Target"))).toBe(false);
    expect(messages).toContain("step 2 · think · plan 1");

    const trajectoryDir = result.trajectoryDir as string;
    const persisted = JSON.parse(
      await fs.readFile(path.join(trajectoryDir, "trajectory.json"), "utf8"),
    );
    expect(persisted).toMatchObject({ status: "error", terminationReason: "step_budget" });
    const metadata = JSON.parse(
      await fs.readFile(path.join(trajectoryDir, "metadata.json"), "utf8"),
    );
    expect(metadata).toMatchObject({ status: "error", terminationReason: "step_budget" });
  });

  it("grades a terminal reply, not the narration that preceded it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eve-final-answer-"));
    roots.push(root);
    const result = await runEveAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      client: fakeClient([
        ...toolStep(0, "Let me open both stores."),
        {
          type: "message.completed",
          data: {
            stepIndex: 1,
            finishReason: "stop",
            message:
              '{"success":true,"summary":"Compared.","finalAnswer":"Target $12, Walmart $11"}',
          },
        },
        { type: "step.completed", data: { stepIndex: 1, finishReason: "stop" } },
        { type: "turn.completed" },
      ]),
      serverUrl: "http://eve",
      verifier: {
        v3: {} as never,
        taskSpec: { id: "hb-1", instruction: plan.instruction, precomputedRubric: rubric },
        dataset: "hardbenchmark",
        trajectoryRoot: root,
      },
    });

    expect(result.harnessStatus).toBe("completed");
    expect(result.finalAnswer).toBe("Target $12, Walmart $11");
    expect(result.outcomeGates).toEqual([]);
    expect(result._success).toBe(true);
  });
});
