import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StagehandAPIClient } from "../../lib/v3/api.js";
import { V3 as Stagehand } from "../../lib/v3/v3.js";
import { AgentCache } from "../../lib/v3/cache/AgentCache.js";
import type { CacheStorage } from "../../lib/v3/cache/CacheStorage.js";
import { StagehandInvalidArgumentError } from "../../lib/v3/types/public/sdkErrors.js";
import type { ModelConfiguration } from "../../lib/v3/types/public/model.js";

/**
 * Tests for modelName "auto", which delegates model selection to the
 * Stagehand API. "auto" is only valid when running through the API
 * (env: "BROWSERBASE" with disableAPI: false and experimental: false):
 * no local LLM client is created and no provider API key is loaded.
 */

function createClientWithExecuteMock() {
  const client = new StagehandAPIClient({
    apiKey: "bb-test",
    logger: vi.fn(),
  });
  const executeMock = vi.fn().mockResolvedValue({});

  (
    client as unknown as {
      execute: typeof executeMock;
    }
  ).execute = executeMock;

  return { client, executeMock };
}

describe("Stagehand constructor with model 'auto'", () => {
  it("does not throw and does not look up a provider API key in API mode", () => {
    const logger = vi.fn();

    expect(
      () =>
        new Stagehand({
          env: "BROWSERBASE",
          model: "auto",
          logger,
        }),
    ).not.toThrow();

    expect(logger).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("No known environment variable"),
      }),
    );
  });

  it("accepts the object form { modelName: 'auto' } in API mode", () => {
    expect(
      () =>
        new Stagehand({
          env: "BROWSERBASE",
          model: { modelName: "auto" },
        }),
    ).not.toThrow();
  });

  it("throws when env is LOCAL", () => {
    expect(
      () =>
        new Stagehand({
          env: "LOCAL",
          model: "auto",
        }),
    ).toThrow(StagehandInvalidArgumentError);
  });

  it("throws when the API is disabled", () => {
    expect(
      () =>
        new Stagehand({
          env: "BROWSERBASE",
          model: "auto",
          disableAPI: true,
        }),
    ).toThrow(StagehandInvalidArgumentError);
  });

  it("throws when experimental mode bypasses the API", () => {
    expect(
      () =>
        new Stagehand({
          env: "BROWSERBASE",
          model: "auto",
          experimental: true,
        }),
    ).toThrow(StagehandInvalidArgumentError);
  });

  it("throws when a custom llmClient bypasses the API", () => {
    expect(
      () =>
        new Stagehand({
          env: "BROWSERBASE",
          model: "auto",
          llmClient: {} as never,
        }),
    ).toThrow(StagehandInvalidArgumentError);
  });
});

describe("per-call model 'auto' local resolution", () => {
  it("throws when resolving 'auto' without an API client", () => {
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      model: "openai/gpt-4.1-mini",
      disableAPI: true,
    });
    const privateStagehand = stagehand as unknown as {
      resolveLlmClient(model: ModelConfiguration): unknown;
    };

    expect(() => privateStagehand.resolveLlmClient("auto")).toThrow(
      StagehandInvalidArgumentError,
    );
  });

  it("reuses the default client when resolving 'auto' with an API client", () => {
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      model: "openai/gpt-4.1-mini",
    });
    const privateStagehand = stagehand as unknown as {
      apiClient: unknown;
      llmClient: unknown;
      resolveLlmClient(model: ModelConfiguration): unknown;
    };
    privateStagehand.apiClient = {};

    expect(privateStagehand.resolveLlmClient("auto")).toBe(
      privateStagehand.llmClient,
    );
  });
});

describe("agent cache with model 'auto'", () => {
  function createAgentCache(baseModelName: string) {
    return new AgentCache({
      storage: { enabled: true } as unknown as CacheStorage,
      logger: vi.fn(),
      getActHandler: () => null,
      getContext: () => null,
      getDefaultLlmClient: () => undefined as never,
      getBaseModelName: () => baseModelName,
      getSystemPrompt: () => undefined,
      domSettleTimeoutMs: undefined,
      act: vi.fn(),
    });
  }

  it("skips local replay for 'auto' sessions (no local client for self-heal)", () => {
    expect(createAgentCache("auto").shouldAttemptCache("do the thing")).toBe(
      false,
    );
  });

  it("still replays for concrete-model sessions", () => {
    expect(
      createAgentCache("openai/gpt-4.1-mini").shouldAttemptCache(
        "do the thing",
      ),
    ).toBe(true);
  });
});

describe("StagehandAPIClient with model 'auto'", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { sessionId: "sess-auto-model", available: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends per-call model 'auto' without inheriting the session model API key", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "openai/gpt-4.1-mini",
      modelApiKey: "sk-default",
    });

    await client.act({
      input: "click the login button",
      options: { model: "auto" },
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "act",
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: { modelName: "auto" },
          }),
        }),
      }),
    );
  });

  it("passes explicit per-call options through for the object form of 'auto'", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "openai/gpt-4.1-mini",
      modelApiKey: "sk-default",
    });

    await client.observe({
      instruction: "find the login button",
      options: {
        model: { modelName: "auto", temperature: 0.5 } as ModelConfiguration,
      },
    });

    const model = executeMock.mock.calls[0][0].args.options.model as Record<
      string,
      unknown
    >;
    expect(model).toEqual({ modelName: "auto", temperature: 0.5 });
    expect(model).not.toHaveProperty("apiKey");
  });

  it("initializes a session with modelName 'auto' and no model API key", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "auto",
    });

    await client.extract({ instruction: "extract the headline" });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "extract",
        args: expect.objectContaining({
          options: undefined,
        }),
      }),
    );
  });
});
