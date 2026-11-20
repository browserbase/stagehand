import { afterEach, expect, it, vi } from "vitest";
import {
  DECISION_PROVIDERS,
  DecisionRequestError,
  decide,
  type DecisionQuestion,
} from "../services/decisions/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const question = { type: "noul", instructions: "Does the evidence match?" } as const;

function requestBody(init: RequestInit) {
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body);
}

it.each(DECISION_PROVIDERS)(
  "%s preserves colliding aliases and object-property question IDs",
  async (provider) => {
    const questions = Object.fromEntries(
      ["unsafe:key", "q0", "q1", "__proto__", "constructor", "toString"].map((key) => [
        key,
        { ...question, instructions: key },
      ]),
    );
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = requestBody(init) as {
        questions: Record<string, DecisionQuestion>;
      };
      expect(Object.keys(body.questions)).toHaveLength(Object.keys(questions).length);
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([key, value]) => [
          key,
          { type: "noul", noul: value.instructions === "unsafe:key" ? 0.9 : 0.1 },
        ]),
      );
      return Response.json(provider === "cloudflare" ? { result: { answers } } : { answers });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await decide(
      { provider, apiKey: `aliases-${provider}`, accountId: "test-account" },
      "evidence",
      questions,
    );
    expect(Object.keys(result.answers).sort()).toEqual(Object.keys(questions).sort());
    expect(result.answers["unsafe:key"]).toEqual({ type: "noul", noul: 0.9 });
    expect(result.answers.q0).toEqual({ type: "noul", noul: 0.1 });
    expect(result.answers.__proto__).toEqual({ type: "noul", noul: 0.1 });
  },
);

it("preserves object-property option IDs in choices", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = requestBody(init);
      expect(Object.keys(body.questions.pick.criteria)).toEqual(["__proto__", "constructor"]);
      return Response.json({
        answers: {
          pick: {
            type: "choice",
            choice: "__proto__",
            probabilities: { ["__proto__"]: 0.9, constructor: 0.1 },
          },
        },
      });
    }),
  );
  const result = await decide({ apiKey: "option-properties" }, "evidence", {
    pick: {
      type: "choice",
      instructions: "Pick the field",
      criteria: { ["__proto__"]: "First field", constructor: "Second field" },
    },
  });
  expect(result.answers.pick).toMatchObject({ choice: "__proto__", confidence: 0.9 });
});

it.each(["__proto__", "constructor", "toString"])(
  "rejects the unsupported provider %s before making a request",
  async (provider) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      decide({ apiKey: "invalid-provider", provider: provider as never }, {}, { question }),
    ).rejects.toThrow(`unknown provider "${provider}"`);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("cancels retry backoff without another request", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetchMock = vi.fn(
    async () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const pending = decide({ apiKey: "cancel-backoff", signal: controller.signal }, {}, { question });
  const reason = new Error("Operation cancelled");
  const rejected = expect(pending).rejects.toBe(reason);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(reason);
  await rejected;
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps cancellation while reading the response body", async () => {
  const controller = new AbortController();
  const reason = new Error("Operation cancelled during response");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const response = new Response("{}");
      vi.spyOn(response, "text").mockImplementation(async () => {
        controller.abort(reason);
        throw reason;
      });
      return response;
    }),
  );
  await expect(
    decide({ apiKey: "cancel-body", signal: controller.signal }, {}, { question }),
  ).rejects.toBe(reason);
});

it("records all in-flight batches before reporting a failed request", async () => {
  let release!: () => void;
  const secondBatch = new Promise<void>((resolve) => {
    release = resolve;
  });
  const recordUsage = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = requestBody(init);
      if (Object.hasOwn(body.questions, "q128")) {
        await secondBatch;
        return Response.json({
          answers: { q128: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 11 },
        });
      }
      return Response.json({ answers: {}, usage: { input_tokens: 7 } });
    }),
  );
  let settled = false;
  const pending = decide(
    { apiKey: "batch-accounting", recordDecisionUsage: recordUsage },
    {},
    Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`q${index}`, question])),
  ).finally(() => {
    settled = true;
  });
  const rejected = expect(pending).rejects.toBeInstanceOf(DecisionRequestError);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const settledBeforeSecondBatch = settled;
  release();
  await rejected;
  expect(settledBeforeSecondBatch).toBe(false);
  expect(recordUsage).toHaveBeenCalledTimes(2);
  expect(recordUsage.mock.calls.reduce((total, [usage]) => total + usage.inputTokens, 0)).toBe(18);
});

it("reports response body failures without leaking the body error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const response = new Response("{}");
      vi.spyOn(response, "text").mockRejectedValue(new Error("sensitive body detail"));
      return response;
    }),
  );
  await expect(decide({ apiKey: "broken-body" }, {}, { question })).rejects.toEqual(
    new DecisionRequestError("Perplexity decision request failed (Error)"),
  );
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  "does not aggregate invalid provider token counts (%s)",
  async (tokens) => {
    const usage = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          answers: { question: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: tokens, output_tokens: 2 },
        }),
      ),
    );
    const result = await decide(
      { apiKey: `invalid-usage-${tokens}`, recordDecisionUsage: usage },
      {},
      { question },
    );
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 2 });
    expect(usage).toHaveBeenCalledWith(expect.objectContaining(result.usage));
  },
);
