import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGatewayContext, createGatewayLanguageModel } from "../llm/gatewayClient.js";
import * as llmService from "../services/llmService.js";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => schema),
  Output: {
    object: vi.fn((options: unknown) => options),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const initParams = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "test", version: "1" },
  logLevel: "info",
  model: { modelName: "openai/gpt-5" },
  browserbase: "client",
  browser: { sessionId: "session-123", region: "eu-central-1" },
} satisfies StagehandInitParams;

describe("buildGatewayContext", () => {
  it("builds a context from the client marker, session, and request adapter", () => {
    const request = vi.fn();
    expect(buildGatewayContext(initParams, request)).toEqual({
      request,
    });
  });

  it("requires the client marker and a session", () => {
    expect(buildGatewayContext({ ...initParams, browserbase: undefined })).toBeUndefined();
    expect(buildGatewayContext({ ...initParams, browser: undefined })).toBeUndefined();
  });
});

describe("createGatewayLanguageModel", () => {
  it("creates a Responses API model against the gateway endpoint with the full model slug", () => {
    const model = createGatewayLanguageModel({ modelName: "openai/gpt-5" }, {});

    expect(model).toMatchObject({
      provider: "openai.responses",
      modelId: "openai/gpt-5",
    });
  });

  it("uses an internal placeholder when Browserbase will select the model", () => {
    const model = createGatewayLanguageModel(undefined, {});

    expect(model).toMatchObject({
      provider: "openai.responses",
      modelId: "auto",
    });
  });
});

describe("llmService.generate gateway routing", () => {
  const input = {
    messages: [{ role: "user" as const, content: { type: "text" as const, text: "Hi" } }],
  };

  it("routes key-less model configurations through the Browserbase gateway", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Hello",
      output: undefined,
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    await llmService.generate({ modelName: "openai/future-model-v1" }, input, vi.fn(), {});

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "openai/future-model-v1",
        }),
      }),
    );
  });

  it("routes missing model configurations through the Browserbase gateway", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Hello",
      output: undefined,
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    await llmService.generate(undefined, input, vi.fn(), {});

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "auto",
        }),
      }),
    );
  });

  it("rejects key-less model configurations when no gateway context is available", async () => {
    await expect(
      llmService.generate({ modelName: "openai/gpt-5" }, input, vi.fn()),
    ).rejects.toThrow(/requires a provider API key or a Browserbase session/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects missing model configurations when no gateway context is available", async () => {
    await expect(llmService.generate(undefined, input, vi.fn())).rejects.toThrow(
      /requires a provider API key or a Browserbase session/,
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("rejects stop sequences instead of silently ignoring them", async () => {
    await expect(
      llmService.generate(
        { modelName: "openai/gpt-5" },
        { ...input, stopSequences: ["STOP"] },
        vi.fn(),
        {},
      ),
    ).rejects.toThrow(/does not support stop sequences/);
    expect(generateText).not.toHaveBeenCalled();
  });
});
