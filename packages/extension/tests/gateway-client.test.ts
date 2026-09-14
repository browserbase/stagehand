import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGatewayContext,
  createGatewayLanguageModel,
  fetchWithoutModel,
} from "../llm/gatewayClient.js";
import * as llmService from "../services/llmService.js";
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
  model: { modelName: "openai/gpt-5" },
  apiKey: "bb-api-key",
  browser: { sessionId: "session-123", region: "eu-central-1" },
} as StagehandInitParams;

describe("buildGatewayContext", () => {
  it("builds the context from the Browserbase API key, session, and region", () => {
    expect(buildGatewayContext(initParams)).toEqual({
      apiUrl: "https://api.euc1.stagehand.browserbase.com/v1",
      apiKey: "bb-api-key",
      sessionId: "session-123",
    });
  });

  it("returns undefined without a Browserbase API key or session", () => {
    expect(buildGatewayContext({ ...initParams, apiKey: undefined })).toBeUndefined();
    expect(buildGatewayContext({ ...initParams, browser: undefined })).toBeUndefined();
  });

  it("uses an explicit Stagehand API URL instead of the regional default", () => {
    expect(
      buildGatewayContext({
        ...initParams,
        apiUrl: "https://api.stagehand.dev.browserbase.com/",
      }),
    ).toEqual({
      apiUrl: "https://api.stagehand.dev.browserbase.com/v1",
      apiKey: "bb-api-key",
      sessionId: "session-123",
    });
  });
});

describe("createGatewayLanguageModel", () => {
  it("creates a Responses API model against the gateway endpoint with the full model slug", () => {
    const model = createGatewayLanguageModel(
      { modelName: "openai/gpt-5" },
      {
        apiUrl: "https://api.stagehand.browserbase.com/v1",
        apiKey: "bb-api-key",
        sessionId: "session-123",
      },
    );

    expect(model).toMatchObject({
      provider: "openai.responses",
      modelId: "openai/gpt-5",
    });
  });

  it("uses an internal placeholder when Browserbase will select the model", () => {
    const model = createGatewayLanguageModel(undefined, {
      apiUrl: "https://api.stagehand.browserbase.com/v1",
      apiKey: "bb-api-key",
      sessionId: "session-123",
    });

    expect(model).toMatchObject({
      provider: "openai.responses",
      modelId: "auto",
    });
  });
});

describe("fetchWithoutModel", () => {
  it("passes non-JSON string bodies through unchanged", async () => {
    const response = {} as Response;
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const init = { method: "POST", body: "not-json" };

    await expect(fetchWithoutModel("https://gateway.example/request", init)).resolves.toBe(
      response,
    );
    expect(fetch).toHaveBeenCalledWith("https://gateway.example/request", init);
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

    await llmService.generate({ modelName: "openai/gpt-5" }, input, vi.fn(), {
      apiUrl: "https://api.stagehand.browserbase.com/v1",
      apiKey: "bb-api-key",
      sessionId: "session-123",
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "openai/gpt-5",
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

    await llmService.generate(undefined, input, vi.fn(), {
      apiUrl: "https://api.stagehand.browserbase.com/v1",
      apiKey: "bb-api-key",
      sessionId: "session-123",
    });

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
        {
          apiUrl: "https://api.stagehand.browserbase.com/v1",
          apiKey: "bb-api-key",
          sessionId: "session-123",
        },
      ),
    ).rejects.toThrow(/does not support stop sequences/);
    expect(generateText).not.toHaveBeenCalled();
  });
});
