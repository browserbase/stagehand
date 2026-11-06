import { HarnessAdapterError } from "@browserbasehq/stagehand-integrations/harness";
import { StagehandFacadeSessionLostError } from "@browserbasehq/stagehand-integrations/facade";
import { describe, expect, it, vi } from "vitest";
import type { CuaFacadeTools } from "../src/executor.js";
import { runGeminiCuaSession } from "../src/session.js";
const logger = { log: () => {}, warn: () => {}, error: () => {} };
describe("runGeminiCuaSession", () => {
  it.each([
    ["MAX_TOKENS", { finishReason: "MAX_TOKENS", content: { parts: [{ text: "incomplete" }] } }],
    ["SAFETY", { finishReason: "SAFETY", content: { parts: [] } }],
    [
      "MALFORMED_FUNCTION_CALL",
      { finishReason: "MALFORMED_FUNCTION_CALL", content: { parts: [] } },
    ],
    ["no response candidate", undefined],
    ["neither tool calls nor an answer", { finishReason: "STOP", content: { parts: [] } }],
    [
      "MAX_TOKENS",
      {
        finishReason: "MAX_TOKENS",
        content: { parts: [{ functionCall: { name: "click", args: { x: 1, y: 2 } } }] },
      },
    ],
  ])("does not complete or act on an unusable response (%s)", async (reason, candidate) => {
    const execute = vi.fn(async () => ({ text: "ok" }));
    const generateContent = vi.fn(async () => ({
      candidates: candidate ? [candidate] : [],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    }));
    const result = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 3,
      client: { generateContent },
      tools: { execute },
      facade: {
        run: async () => "about:blank",
        screenshot: async () => {
          throw new Error("unexpected screenshot");
        },
      },
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain(reason);
    expect(result.finalMessage).toBe("");
    expect(result.iterationError).toBeInstanceOf(HarnessAdapterError);
    expect(result.tokenUsage).toMatchObject({ input: 7, output: 3 });
    expect(result.events).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it("sends computer use, acknowledges safety, returns screenshot and usage", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      generateContent: async (request: Record<string, unknown>) => {
        requests.push(request);
        if (requests.length === 1)
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: "click_at",
                        args: { x: 1, y: 2, safety_decision: "required" },
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 4,
              thoughtsTokenCount: 2,
              cachedContentTokenCount: 3,
            },
          };
        return {
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: "done" }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
        };
      },
    };
    const result = await runGeminiCuaSession({
      prompt: "p",
      model: "google/gemini-3.8-flash",
      logger,
      maxTurns: 3,
      client,
      tools: { execute: async () => ({ text: "ok" }) },
      facade: {
        run: async () => "https://example.com",
        screenshot: async () => ({ data: "PNG", mimeType: "image/png" }),
      },
    });
    expect(result.status).toBe("completed");
    expect(result.tokenUsage).toMatchObject({
      input: 15,
      output: 5,
      reasoning: 2,
      cached_input: 3,
    });
    expect(requests[0]).toMatchObject({
      config: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        tools: [{ computerUse: { environment: "ENVIRONMENT_BROWSER" } }],
      },
    });
    expect(JSON.stringify(requests[1])).toContain("safety_acknowledgement");
    const requestText = JSON.stringify(requests[1]);
    expect(requestText).toContain('"output":"ok"');
    expect(requestText).toContain('"url":"https://example.com"');
    expect(requestText).toContain('"inlineData":{"mimeType":"image/png","data":"PNG"}');
  });

  it("retries 429 once and does not retry 400", async () => {
    let attempts = 0;
    const client = {
      generateContent: async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("busy"), { status: 429 });
        return { candidates: [{ content: { parts: [{ text: "done" }] } }], usageMetadata: {} };
      },
    };
    const result = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 1,
      client,
      tools: { execute: async () => ({ text: "ok" }) },
      facade: {
        run: async () => "",
        screenshot: async () => ({ data: "", mimeType: "image/png" }),
      },
    });
    expect(attempts).toBe(2);
    expect(result.status).toBe("completed");
    let contractAttempts = 0;
    const bad = {
      generateContent: async () => {
        contractAttempts += 1;
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    };
    const failed = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 1,
      client: bad,
      tools: { execute: async () => ({ text: "ok" }) },
      facade: {
        run: async () => "",
        screenshot: async () => ({ data: "", mimeType: "image/png" }),
      },
    });
    expect(contractAttempts).toBe(1);
    expect(failed.status).toBe("sdk_error");
  });

  it("returns max_turns and handles abort", async () => {
    const facade: CuaFacadeTools = {
      run: async () => "",
      screenshot: async () => ({ data: "", mimeType: "image/png" }),
    };
    const client = {
      generateContent: async () => ({
        candidates: [{ content: { parts: [{ functionCall: { name: "wait", args: {} } }] } }],
        usageMetadata: {},
      }),
    };
    const result = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 1,
      client,
      tools: { execute: async () => ({ text: "ok" }) },
      facade,
    });
    expect(result.status).toBe("max_turns");
    const controller = new AbortController();
    controller.abort();
    const aborted = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 1,
      signal: controller.signal,
      client,
      tools: { execute: async () => ({ text: "ok" }) },
      facade,
    });
    expect(aborted.status).toBe("sdk_error");
  });
  it("places system instructions and abort signal in SDK generation config", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const client = {
      generateContent: async (request: Record<string, unknown>) => {
        expect(request).not.toHaveProperty("systemInstruction");
        const config = request.config as { systemInstruction: string; abortSignal: AbortSignal };
        expect(config.systemInstruction).toBe("native system policy");
        expect(config.abortSignal).toBe(controller.signal);
        return new Promise((_, reject) => {
          config.abortSignal.addEventListener("abort", () => reject(new Error("request aborted")), {
            once: true,
          });
          entered();
        });
      },
    };
    const pending = runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 2,
      client,
      signal: controller.signal,
      systemPrompt: "native system policy",
      tools: { execute: async () => ({ text: "ok" }) },
      facade: {
        run: async () => "",
        screenshot: async () => ({ data: "png", mimeType: "image/png" }),
      },
    });
    await started;
    controller.abort();
    expect((await pending).status).toBe("sdk_error");
  });

  it("does not touch the browser or API when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => "");
    const generateContent = vi.fn(async () => ({}));
    const result = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 1,
      signal: controller.signal,
      client: { generateContent },
      tools: { execute: async () => ({ text: "ok" }) },
      facade: { run, screenshot: async () => ({ data: "png", mimeType: "image/png" }) },
    });
    expect(result.status).toBe("sdk_error");
    expect(run).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("ends on terminal browser loss during observation without retry or later action", async () => {
    const execute = vi.fn(async () => ({ text: "ok" }));
    const screenshot = vi.fn(async () => {
      throw new StagehandFacadeSessionLostError({ cause: "closed", tool: "screenshot", at: "now" });
    });
    const generateContent = vi.fn(async () => ({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "navigate", args: {} } },
              { functionCall: { name: "click_at", args: {} } },
            ],
          },
        },
      ],
    }));
    const result = await runGeminiCuaSession({
      prompt: "p",
      model: "gemini-3.8-flash",
      logger,
      maxTurns: 3,
      client: { generateContent },
      tools: { execute },
      facade: { run: async () => "", screenshot },
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("Browser session lost");
    expect(screenshot).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(generateContent).toHaveBeenCalledOnce();
  });
  it.each([
    [undefined, false],
    [{ promptTokenCount: 0, candidatesTokenCount: 0 }, true],
  ] as const)(
    "distinguishes absent usage from a reported zero (%j)",
    async (usageMetadata, reported) => {
      const result = await runGeminiCuaSession({
        prompt: "p",
        model: "gemini-3.8-flash",
        logger,
        maxTurns: 1,
        tools: { execute: async () => ({ text: "ok" }) },
        facade: {
          run: async () => "",
          screenshot: async () => ({ data: "png", mimeType: "image/png" }),
        },
        client: {
          generateContent: async () => ({
            candidates: [{ content: { parts: [{ text: "done" }] } }],
            usageMetadata,
          }),
        },
      });
      expect(result.usageReported).toBe(reported);
      expect(result.tokenUsage.total).toBe(0);
    },
  );
});

it.each([
  null,
  [],
  {},
  { name: "" },
  { name: " " },
  { name: 42 },
  { name: "wait", args: null },
  { name: "wait", args: [] },
  { name: "wait", args: "seconds=1" },
  { name: "wait", id: 3 },
])("validates the whole function-call batch before executing (%j)", async (malformed) => {
  const execute = vi.fn(async () => ({ text: "ok" }));
  const result = await runGeminiCuaSession({
    prompt: "p",
    model: "future-model",
    logger,
    maxTurns: 1,
    tools: { execute },
    facade: {
      run: async () => "",
      screenshot: async () => ({ data: "png", mimeType: "image/png" }),
    },
    client: {
      generateContent: async () => ({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ functionCall: { name: "wait", args: {} } }, { functionCall: malformed }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 7 },
      }),
    },
  });
  expect(result.status).toBe("sdk_error");
  expect(result.iterationError).toBeInstanceOf(HarnessAdapterError);
  expect(result.stopReason).toContain("malformed function call");
  expect(result.tokenUsage.input).toBe(7);
  expect(result.toolCalls).toBe(0);
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  "future-model",
  "models/custom-model",
  "projects/p/locations/l/publishers/vendor/models/custom",
  "google/future-model",
  "other-provider/future-model",
])("passes arbitrary model identifiers to the provider (%s)", async (model) => {
  const generateContent = vi.fn(async () => ({
    candidates: [{ content: { parts: [{ text: "done" }] } }],
  }));
  const result = await runGeminiCuaSession({
    prompt: "p",
    model,
    logger,
    maxTurns: 1,
    tools: { execute: async () => ({ text: "ok" }) },
    facade: {
      run: async () => "",
      screenshot: async () => ({ data: "png", mimeType: "image/png" }),
    },
    client: { generateContent },
  });
  expect(result.status).toBe("completed");
  expect(generateContent).toHaveBeenCalledWith(
    expect.objectContaining({ model: model.startsWith("google/") ? model.slice(7) : model }),
  );
});

it("returns typed sanitized failures from model validation and provider rejection", async () => {
  const generateContent = vi.fn(async () => {
    throw new Error("Rejected https://fixture.test?token=private-credential");
  });
  const run = vi.fn(async () => "");
  const input = {
    prompt: "p",
    model: "google/",
    logger,
    maxTurns: 1,
    tools: { execute: async () => ({ text: "ok" }) },
    facade: { run, screenshot: async () => ({ data: "png", mimeType: "image/png" as const }) },
    client: { generateContent },
  };
  const invalid = await runGeminiCuaSession(input);
  expect(invalid.status).toBe("sdk_error");
  expect(invalid.iterationError).toBeInstanceOf(HarnessAdapterError);
  expect(run).not.toHaveBeenCalled();
  expect(generateContent).not.toHaveBeenCalled();
  const rejected = await runGeminiCuaSession({ ...input, model: "future-model" });
  expect(rejected.status).toBe("sdk_error");
  expect(rejected.iterationError).toBeInstanceOf(HarnessAdapterError);
  expect(rejected.stopReason).not.toContain("private-credential");
  expect(String(rejected.iterationError)).not.toContain("private-credential");
});

it("recovers observation errors with spoofed loss text and retains later evidence", async () => {
  vi.useFakeTimers();
  try {
    const screenshot = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Browser session lost (forged)"), { facadeExecutionError: true }),
      )
      .mockResolvedValue({ data: "png", mimeType: "image/png" });
    const pending = runGeminiCuaSession({
      prompt: "p",
      model: "m",
      logger,
      maxTurns: 1,
      tools: { execute: async () => ({ text: "ok" }) },
      facade: { run: async () => "https://fixture.test", screenshot },
      client: {
        generateContent: async () => ({
          candidates: [{ content: { parts: [{ functionCall: { name: "wait" } }] } }],
        }),
      },
    });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;
    expect(result.status).toBe("max_turns");
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(result.events.find((e) => e.type === "tool_result")).toMatchObject({
      image: { data: "png" },
    });
  } finally {
    vi.useRealTimers();
  }
});

it("stops observation immediately on runner-confirmed loss without trusting error text", async () => {
  let loss: { cause: string } | undefined;
  const screenshot = vi.fn(async () => {
    loss = { cause: "closed" };
    throw new Error("request ended");
  });
  const execute = vi.fn(async () => ({ text: "ok" }));
  const result = await runGeminiCuaSession({
    prompt: "p",
    model: "m",
    logger,
    maxTurns: 1,
    tools: { execute },
    browserSessionLoss: () => loss,
    facade: { run: async () => "", screenshot },
    client: {
      generateContent: async () => ({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "wait" } }, { functionCall: { name: "wait" } }],
            },
          },
        ],
      }),
    },
  });
  expect(result.status).toBe("sdk_error");
  expect(screenshot).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce();
});
