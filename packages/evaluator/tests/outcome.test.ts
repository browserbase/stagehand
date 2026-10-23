import { unresolvedChecks } from "../src/outcomeChecks.js";
import { expect, test } from "vitest";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AISdkJudge, type LLMClient, type CompletionRequest } from "../src/client.js";
import { Evaluator } from "../src/evaluator.js";
import type { Trajectory } from "../src/types.js";

const trajectory: Trajectory = {
  task: {
    id: "widget",
    instruction: "Add blue widget to cart",
    precomputedRubric: {
      items: [{ criterion: "cart", description: "Blue widget is in cart", maxPoints: 1 }],
    },
  },
  steps: [
    {
      actionName: "stagehand.run",
      actionArgs: {},
      reasoning: "",
      agentEvidence: { modalities: [] },
      probeEvidence: { ariaTree: "Cart: blue widget, quantity 1" },
      toolOutput: { ok: true, result: "Cart: blue widget, quantity 1" },
    },
    {
      actionName: "snapshot",
      actionArgs: {},
      reasoning: "",
      agentEvidence: { modalities: [] },
      probeEvidence: {},
      toolOutput: {
        ok: false,
        result: null,
        error: "Browser session lost (CDP connection closed 1006)",
      },
    },
  ],
  finalAnswer: "Added blue widget",
  status: "error",
  usage: { input_tokens: 0, output_tokens: 0 },
};

function client(state?: string): LLMClient {
  return {
    async createChatCompletion<T>(): Promise<T> {
      return {
        data: {
          outcome: {
            checks: Object.fromEntries(
              Object.keys(unresolvedChecks()).map((k) => [
                k,
                { state: "supported", requirement: "cart", evidence: "step 0" },
              ]),
            ),
            state,
            output_success: true,
            primary_intent: "Add widget",
            reasoning: "Cart observed",
            findings: [],
          },
          per_criterion: [
            {
              criterion_idx: 0,
              earned_points: 1,
              evidence_sufficient: true,
              justification: "cart step 0",
            },
          ],
        },
      } as T;
    },
  };
}

test.each(["supported", "contradicted", "unresolved", undefined])(
  "only supported passes, even with a confident boolean: %s",
  async (state) => {
    const result = await new Evaluator({ client: client(state) }).verify(trajectory);
    expect(result.outcomeSuccess).toBe(state === "supported");
    expect(result.outcomeState).toBe(state ?? "unresolved");
    expect(result.health?.status).toBe("healthy");
    expect(result.failureClass).toBe("browser_session_lost");
    expect(result.execution?.issues[0].stepIndex).toBe(1);
  },
);

test("judge failure is structured health, never an ordinary negative reward", async () => {
  const broken: LLMClient = {
    async createChatCompletion() {
      throw new Error("judge unavailable");
    },
  };
  const result = await new Evaluator({ client: broken }).verify(trajectory);
  expect(result.health).toMatchObject({
    schemaVersion: 1,
    status: "error",
    errors: [{ stage: "FusedJudgment", message: "judge unavailable" }],
  });
  expect(result.outcomeState).toBe("unresolved");
  expect(result.outcomeSuccess).toBe(false);
});

test("dead model startup fails loudly before grading", async () => {
  const model = createGoogleGenerativeAI({
    apiKey: "test",
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: { code: 404, message: "Model does not exist", status: "NOT_FOUND" },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
  })("missing-model");
  await expect(new Evaluator({ client: new AISdkJudge(model) }).validate()).rejects.toThrow(
    "Model does not exist",
  );
});

test("outcome-only mode preserves supported completion after a disconnect", async () => {
  const result = await new Evaluator({
    client: client("supported"),
    config: { approach: "outcome-only" },
  }).verify(trajectory);
  expect(result).toMatchObject({
    outcomeSuccess: true,
    outcomeState: "supported",
    health: { status: "healthy" },
  });
});

test("labels final and earlier images beside their payloads instead of relying on attachment order", async () => {
  const requests: CompletionRequest[] = [];
  const fake = client("supported");
  const judge: LLMClient = {
    async createChatCompletion<T>(request: CompletionRequest): Promise<T> {
      requests.push(request);
      return fake.createChatCompletion<T>(request);
    },
  };
  const earlier = Buffer.from([255, 216, 255, 1]);
  const terminal = Buffer.from([255, 216, 255, 2]);
  await new Evaluator({ client: judge, config: { approach: "outcome-only" } }).verify({
    ...trajectory,
    steps: trajectory.steps.map((step, i) =>
      i
        ? step
        : {
            ...step,
            probeEvidence: { ...step.probeEvidence, screenshot: earlier },
          },
    ),
    finalObservation: { screenshot: terminal },
  });
  const message = requests
    .find((r) => r.options.response_model.name === "FusedOutcome")!
    .options.messages.find((m) => m.role === "user")!.content;
  if (typeof message === "string") throw new Error("Expected a multimodal request");
  const labels = message.flatMap((part, i) => (part.type === "image_url" ? [message[i - 1]] : []));
  expect(labels).toEqual([
    { type: "text", text: "Screenshot: trajectory final observation" },
    { type: "text", text: "Screenshot: step 0 probe screenshot" },
  ]);
  const images = message.filter((p) => p.type === "image_url");
  expect(images.map((p) => p.image_url.url)).toEqual([
    `data:image/jpeg;base64,${terminal.toString("base64")}`,
    `data:image/jpeg;base64,${earlier.toString("base64")}`,
  ]);
});
