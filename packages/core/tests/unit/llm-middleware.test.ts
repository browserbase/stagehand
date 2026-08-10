import { describe, expect, it, vi } from "vitest";
import type {
  LanguageModelV2,
  LanguageModelV2Middleware,
} from "@ai-sdk/provider";
import {
  getAISDKLanguageModel,
  LLMProvider,
} from "../../lib/v3/llm/LLMProvider.js";
import { resolveModelConfiguration } from "../../lib/v3/v3.js";

/**
 * Creates a recording middleware that captures every doGenerate / doStream
 * invocation along with the model identity and returned usage data.
 */
function createRecordingMiddleware() {
  const calls: {
    type: "generate" | "stream";
    modelId: string;
    provider: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }[] = [];

  const middleware: LanguageModelV2Middleware = {
    wrapGenerate: async ({ doGenerate, model }) => {
      const result = await doGenerate();
      calls.push({
        type: "generate",
        modelId: model.modelId,
        provider: model.provider,
        usage: {
          inputTokens: result.usage.inputTokens ?? undefined,
          outputTokens: result.usage.outputTokens ?? undefined,
        },
      });
      return result;
    },
    wrapStream: async ({ doStream, model }) => {
      const result = await doStream();
      calls.push({
        type: "stream",
        modelId: model.modelId,
        provider: model.provider,
      });
      return result;
    },
  };

  return { middleware, calls };
}

/**
 * Creates a minimal mock LanguageModelV2 that returns canned results
 * without hitting any real provider. Useful for testing the wrapping
 * mechanics in isolation.
 */
function createMockLanguageModel(
  modelId: string,
  provider: string,
): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider,
    modelId,
    defaultObjectGenerationMode: "json",
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "mock response" }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: [],
    }),
    doStream: vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
          });
          controller.close();
        },
      }),
    }),
  } as unknown as LanguageModelV2;
}

// ---------------------------------------------------------------------------
// getAISDKLanguageModel with middleware
// ---------------------------------------------------------------------------

describe("getAISDKLanguageModel with middleware", () => {
  it("returns a model when no middleware is provided", () => {
    const model = getAISDKLanguageModel("ollama", "llama3.2");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("llama3.2");
  });

  it("returns a wrapped model when middleware is provided", () => {
    const { middleware } = createRecordingMiddleware();
    const model = getAISDKLanguageModel(
      "ollama",
      "llama3.2",
      undefined,
      middleware,
    );
    expect(model).toBeDefined();
    // wrapLanguageModel preserves modelId
    expect(model.modelId).toBe("llama3.2");
  });

  it("wrapped model preserves doGenerate and doStream methods", () => {
    const { middleware } = createRecordingMiddleware();
    const model = getAISDKLanguageModel(
      "ollama",
      "llama3.2",
      undefined,
      middleware,
    );

    expect(typeof model.doGenerate).toBe("function");
    expect(typeof model.doStream).toBe("function");
    expect(model.provider).toContain("ollama");
  });
});

// ---------------------------------------------------------------------------
// LLMProvider with middleware
// ---------------------------------------------------------------------------

describe("LLMProvider with middleware", () => {
  const noop = () => {};

  it("creates an AISdkClient without middleware", () => {
    const provider = new LLMProvider(noop);
    const client = provider.getClient("openai/gpt-4o" as never);
    expect(client).toBeDefined();
    expect(client.type).toBe("aisdk");
  });

  it("creates an AISdkClient that carries middleware-wrapped model", () => {
    const { middleware } = createRecordingMiddleware();
    const provider = new LLMProvider(noop, middleware);
    const client = provider.getClient("ollama/llama3.2" as never);
    expect(client).toBeDefined();
    expect(client.type).toBe("aisdk");

    const languageModel = client.getLanguageModel();
    expect(languageModel).toBeDefined();
    // Wrapped models should still expose the original modelId
    expect(languageModel.modelId).toBe("llama3.2");
  });

  it("applies the same middleware to different models from getClient", () => {
    const { middleware } = createRecordingMiddleware();
    const provider = new LLMProvider(noop, middleware);

    const clientA = provider.getClient("ollama/llama3.2" as never);
    const clientB = provider.getClient("ollama/mistral" as never);

    expect(clientA.getLanguageModel()).toBeDefined();
    expect(clientB.getLanguageModel()).toBeDefined();
    expect(clientA.getLanguageModel().modelId).toBe("llama3.2");
    expect(clientB.getLanguageModel().modelId).toBe("mistral");
  });
});

// ---------------------------------------------------------------------------
// Middleware captures usage across act/extract/observe/agent code paths
// ---------------------------------------------------------------------------

describe("middleware captures usage from doGenerate and doStream", () => {
  it("wrapGenerate fires and captures usage on doGenerate", async () => {
    const { middleware, calls } = createRecordingMiddleware();
    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");

    // Simulate what wrapLanguageModel does: import and wrap
    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({ model: mockModel, middleware });

    await wrapped.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "act: click button" }],
        },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("generate");
    expect(calls[0].modelId).toBe("gpt-4o");
    expect(calls[0].usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("wrapStream fires on doStream", async () => {
    const { middleware, calls } = createRecordingMiddleware();
    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");

    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({ model: mockModel, middleware });

    const result = await wrapped.doStream({
      prompt: [
        { role: "user", content: [{ type: "text", text: "stream this" }] },
      ],
    });

    // Consume the stream to trigger the finish chunk
    const reader = result.stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("stream");
    expect(calls[0].modelId).toBe("gpt-4o");
  });

  it("middleware fires for each separate doGenerate call (simulates act + extract + observe)", async () => {
    const { middleware, calls } = createRecordingMiddleware();
    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");

    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({ model: mockModel, middleware });

    const callOpts = {
      prompt: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "test" }],
        },
      ],
    };

    // Simulate act call
    await wrapped.doGenerate(callOpts);
    // Simulate extract call
    await wrapped.doGenerate(callOpts);
    // Simulate observe call
    await wrapped.doGenerate(callOpts);

    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.type === "generate")).toBe(true);
    expect(calls.every((c) => c.modelId === "gpt-4o")).toBe(true);
  });

  it("middleware fires for agent multi-step calls (sequential doGenerate)", async () => {
    const { middleware, calls } = createRecordingMiddleware();
    const mockModel = createMockLanguageModel(
      "openai/gpt-4.1",
      "gateway.openai",
    );

    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({ model: mockModel, middleware });

    const callOpts = {
      prompt: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "agent step" }],
        },
      ],
    };

    // Simulate multiple agent reasoning steps
    await wrapped.doGenerate(callOpts);
    await wrapped.doGenerate(callOpts);
    await wrapped.doGenerate(callOpts);
    await wrapped.doGenerate(callOpts);
    await wrapped.doGenerate(callOpts);

    expect(calls).toHaveLength(5);
    calls.forEach((c) => {
      expect(c.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });
  });
});

// ---------------------------------------------------------------------------
// ModelConfiguration-level middleware (the user-facing shape)
// ---------------------------------------------------------------------------

describe("middleware inside ModelConfiguration", () => {
  it("resolveModelConfiguration extracts middleware from object config", () => {
    const { middleware: mw } = createRecordingMiddleware();
    const result = resolveModelConfiguration({
      modelName: "openai/gpt-4o",
      apiKey: "sk-test",
      middleware: mw,
    });

    expect(result.modelName).toBe("openai/gpt-4o");
    expect(result.middleware).toBe(mw);
    expect(result.clientOptions).toEqual({ apiKey: "sk-test" });
    expect(result.clientOptions && "middleware" in result.clientOptions).toBe(
      false,
    );
  });

  it("string ModelConfiguration has no middleware", () => {
    const result = resolveModelConfiguration("openai/gpt-4o");
    expect(result.modelName).toBe("openai/gpt-4o");
    expect(result.middleware).toBeUndefined();
    expect(result.clientOptions).toBeUndefined();
  });

  it("middleware is separated from clientOptions when resolving per-method overrides", () => {
    const { middleware: mw } = createRecordingMiddleware();
    const result = resolveModelConfiguration({
      modelName: "anthropic/claude-sonnet-4-20250514",
      apiKey: "sk-ant-test",
      middleware: mw,
    });

    expect(result.modelName).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.middleware).toBe(mw);
    expect(result.clientOptions).toEqual({ apiKey: "sk-ant-test" });
    expect(result.clientOptions && "middleware" in result.clientOptions).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Practical middleware behaviors
// ---------------------------------------------------------------------------

describe("middleware that tracks duration", () => {
  it("measures wall-clock time of doGenerate", async () => {
    const durations: number[] = [];

    const timingMiddleware: LanguageModelV2Middleware = {
      wrapGenerate: async ({ doGenerate }) => {
        const start = performance.now();
        const result = await doGenerate();
        durations.push(performance.now() - start);
        return result;
      },
    };

    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");
    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({
      model: mockModel,
      middleware: timingMiddleware,
    });

    await wrapped.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "time me" }] }],
    });

    expect(durations).toHaveLength(1);
    expect(durations[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("middleware that aggregates token usage", () => {
  it("sums tokens across multiple calls like a billing tracker", async () => {
    let totalInput = 0;
    let totalOutput = 0;

    const billingMiddleware: LanguageModelV2Middleware = {
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        totalInput += result.usage.inputTokens ?? 0;
        totalOutput += result.usage.outputTokens ?? 0;
        return result;
      },
    };

    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");
    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({
      model: mockModel,
      middleware: billingMiddleware,
    });

    const callOpts = {
      prompt: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "go" }],
        },
      ],
    };

    // act
    await wrapped.doGenerate(callOpts);
    // extract
    await wrapped.doGenerate(callOpts);
    // observe
    await wrapped.doGenerate(callOpts);

    expect(totalInput).toBe(30);
    expect(totalOutput).toBe(15);
  });
});

describe("middleware that logs per-model call counts", () => {
  it("tracks which models were called and how many times", async () => {
    const modelCallCounts = new Map<string, number>();

    const countingMiddleware: LanguageModelV2Middleware = {
      wrapGenerate: async ({ doGenerate, model }) => {
        const key = `${model.provider}/${model.modelId}`;
        modelCallCounts.set(key, (modelCallCounts.get(key) ?? 0) + 1);
        return doGenerate();
      },
    };

    const modelA = createMockLanguageModel("gpt-4o", "openai.chat");
    const modelB = createMockLanguageModel(
      "claude-sonnet-4-20250514",
      "anthropic.messages",
    );

    const { wrapLanguageModel } = await import("ai");
    const wrappedA = wrapLanguageModel({
      model: modelA,
      middleware: countingMiddleware,
    });
    const wrappedB = wrapLanguageModel({
      model: modelB,
      middleware: countingMiddleware,
    });

    const callOpts = {
      prompt: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "go" }],
        },
      ],
    };

    await wrappedA.doGenerate(callOpts);
    await wrappedA.doGenerate(callOpts);
    await wrappedB.doGenerate(callOpts);

    expect(modelCallCounts.get("openai.chat/gpt-4o")).toBe(2);
    expect(
      modelCallCounts.get("anthropic.messages/claude-sonnet-4-20250514"),
    ).toBe(1);
    expect(modelCallCounts.size).toBe(2);
  });
});

describe("middleware that detects errors", () => {
  it("catches and re-throws errors from doGenerate while still recording the failure", async () => {
    const errors: Error[] = [];

    const errorTrackingMiddleware: LanguageModelV2Middleware = {
      wrapGenerate: async ({ doGenerate }) => {
        try {
          return await doGenerate();
        } catch (err) {
          errors.push(err as Error);
          throw err;
        }
      },
    };

    const failingModel: LanguageModelV2 = {
      specificationVersion: "v2",
      provider: "openai.chat",
      modelId: "gpt-4o",
      defaultObjectGenerationMode: "json",
      doGenerate: vi.fn().mockRejectedValue(new Error("rate limit exceeded")),
      doStream: vi.fn(),
    } as unknown as LanguageModelV2;

    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({
      model: failingModel,
      middleware: errorTrackingMiddleware,
    });

    await expect(
      wrapped.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "fail" }] }],
      }),
    ).rejects.toThrow("rate limit exceeded");

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("rate limit exceeded");
  });
});

describe("chaining middleware across multiple wrapped models", () => {
  it("same middleware instance sees calls from different models", async () => {
    const seen: string[] = [];

    const spyMiddleware: LanguageModelV2Middleware = {
      wrapGenerate: async ({ doGenerate, model }) => {
        seen.push(model.modelId);
        return doGenerate();
      },
    };

    const mockA = createMockLanguageModel("gpt-4o", "openai.chat");
    const mockB = createMockLanguageModel(
      "claude-sonnet-4-20250514",
      "anthropic.messages",
    );

    const { wrapLanguageModel } = await import("ai");
    const wrappedA = wrapLanguageModel({
      model: mockA,
      middleware: spyMiddleware,
    });
    const wrappedB = wrapLanguageModel({
      model: mockB,
      middleware: spyMiddleware,
    });

    const callOpts = {
      prompt: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "go" }],
        },
      ],
    };

    await wrappedA.doGenerate(callOpts);
    await wrappedB.doGenerate(callOpts);
    await wrappedA.doGenerate(callOpts);

    expect(seen).toEqual(["gpt-4o", "claude-sonnet-4-20250514", "gpt-4o"]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("middleware edge cases", () => {
  it("middleware that only implements wrapGenerate still works for doStream", async () => {
    const generateCalls: string[] = [];
    const partialMiddleware: LanguageModelV2Middleware = {
      wrapGenerate: async ({ doGenerate, model }) => {
        generateCalls.push(model.modelId);
        return doGenerate();
      },
    };

    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");
    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({
      model: mockModel,
      middleware: partialMiddleware,
    });

    const result = await wrapped.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "stream" }] }],
    });
    expect(result.stream).toBeDefined();

    expect(generateCalls).toHaveLength(0);
  });

  it("middleware does not alter the response data", async () => {
    const { middleware } = createRecordingMiddleware();
    const mockModel = createMockLanguageModel("gpt-4o", "openai.chat");

    const { wrapLanguageModel } = await import("ai");
    const wrapped = wrapLanguageModel({ model: mockModel, middleware });

    const result = await wrapped.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    });

    expect(result.content).toEqual([{ type: "text", text: "mock response" }]);
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(result.finishReason).toBe("stop");
  });
});
