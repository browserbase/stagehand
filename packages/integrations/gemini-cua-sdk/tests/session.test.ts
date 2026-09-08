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
    expect(result.iterationError).toBeInstanceOf(Error);
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
      throw new Error("Browser session lost (closed). Stop.");
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
