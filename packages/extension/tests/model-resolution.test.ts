import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicModelIdSchema,
  CerebrasModelIdSchema,
  GoogleModelIdSchema,
  GroqModelIdSchema,
  ModelConfigSchema,
  ModelNameSchema,
  OpenAIModelIdSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type {
  StagehandInitParams,
  StagehandResultMetadata,
} from "@browserbasehq/stagehand-protocol/types";
import { createStagehandController } from "../controllers/stagehandController.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";
import * as actService from "../services/actService.js";
import * as extractService from "../services/extractService.js";
import * as observeService from "../services/observeService.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const metadata: StagehandResultMetadata = {
  cache: { status: "DISABLED" },
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    inferenceTimeMs: 0,
  },
};

const testLogger = {
  debug: vi.fn(),
  span: vi.fn(
    async (_name: string, _data: unknown, run: (logger: unknown) => unknown) =>
      await run(testLogger),
  ),
};
const handlerContext = {
  logger: testLogger,
  telemetryScope: Symbol("model-resolution-test"),
} as unknown as HandlerContext;

function runtimeWith(initParams: StagehandInitParams): StagehandRuntime {
  return {
    state: { getState: () => ({ status: "initialized", initParams }) },
    resolveUnderstudyPage: vi.fn(() => ({})),
    resolvePage: vi.fn(() => ({})),
    adapters: { clientLLMGenerate: vi.fn() },
    metrics: { record: vi.fn() },
    runWithTelemetryContext: async (_scope: symbol, _logger: unknown, run: () => unknown) =>
      await run(),
  } as unknown as StagehandRuntime;
}

describe("model configuration", () => {
  describe("supported models", () => {
    it("accepts every explicitly supported model", () => {
      const providers = [
        ["openai", OpenAIModelIdSchema.options],
        ["anthropic", AnthropicModelIdSchema.options],
        ["google", GoogleModelIdSchema.options],
        ["groq", GroqModelIdSchema.options],
        ["cerebras", CerebrasModelIdSchema.options],
      ] as const;

      for (const [provider, modelIds] of providers) {
        for (const modelId of modelIds) {
          expect(ModelNameSchema.safeParse(`${provider}/${modelId}`).success).toBe(true);
        }
      }
    });

    it("accepts a provider model ID that contains additional slashes", () => {
      expect(ModelNameSchema.safeParse("groq/openai/gpt-oss-120b").success).toBe(true);
    });

    it("rejects a model from an unsupported provider", () => {
      expect(ModelNameSchema.safeParse("bedrock/anthropic.claude-sonnet-v1:0").success).toBe(false);
    });

    it("rejects an unsupported model from a supported provider", () => {
      expect(ModelNameSchema.safeParse("openai/private-model").success).toBe(false);
    });

    it("rejects a model under the wrong provider prefix", () => {
      expect(ModelNameSchema.safeParse("openai/claude-sonnet-4-6").success).toBe(false);
    });

    it("accepts a known model with provider credentials and headers", () => {
      expect(
        ModelConfigSchema.parse({
          modelName: "openai/gpt-5.4-mini",
          apiKey: "sk-test",
          headers: { "x-tenant-id": "tenant-123" },
        }),
      ).toEqual({
        modelName: "openai/gpt-5.4-mini",
        apiKey: "sk-test",
        headers: { "x-tenant-id": "tenant-123" },
      });
    });

    it("rejects an empty model API key", () => {
      expect(
        ModelConfigSchema.safeParse({
          modelName: "openai/gpt-5.4-mini",
          apiKey: "",
        }).success,
      ).toBe(false);
    });

    it("rejects the removed provider and provider options fields", () => {
      expect(
        ModelConfigSchema.safeParse({
          modelName: "openai/gpt-5.4-mini",
          provider: "openai",
          providerOptions: {},
        }).success,
      ).toBe(false);
    });
  });

  it("rejects declarative custom models", () => {
    expect(
      ModelConfigSchema.safeParse({
        modelName: "private/model-v2",
        baseURL: "https://models.example.com/v1",
      }).success,
    ).toBe(false);
  });

  describe("direct inference", () => {
    it.todo("uses direct inference when provider authentication is provided");
    it.todo("prefers direct inference when using a Browserbase browser with provider auth");
  });

  describe("Browserbase managed inference", () => {
    it.todo("uses Browserbase managed inference for an explicit model without provider auth");
    it("routes every primitive without a model through the Browserbase gateway", async () => {
      const act = vi.spyOn(actService, "act").mockResolvedValue({
        data: { success: true, message: "", actionDescription: "", actions: [] },
        metadata,
      });
      const extract = vi.spyOn(extractService, "extract").mockResolvedValue({
        data: {},
        metadata,
      });
      const observe = vi.spyOn(observeService, "observe").mockResolvedValue({
        data: [],
        metadata,
      });
      const controller = createStagehandController(
        runtimeWith({
          apiKey: "bb-api-key",
          browser: { sessionId: "session-123", region: "eu-central-1" },
        } as StagehandInitParams),
      );

      await controller.act({ pageId: "page-1", instruction: "Click" }, handlerContext);
      await controller.extract(
        { pageId: "page-1", instruction: "Extract", schema: {} },
        handlerContext,
      );
      await controller.observe({ pageId: "page-1" }, handlerContext);

      for (const service of [act, extract, observe]) {
        expect(service).toHaveBeenCalledWith(
          expect.objectContaining({
            model: undefined,
            gateway: {
              apiUrl: "https://api.euc1.stagehand.browserbase.com/v1",
              apiKey: "bb-api-key",
              sessionId: "session-123",
            },
          }),
        );
      }
    });

    it("rejects every primitive without a model or Browserbase gateway", async () => {
      const act = vi.spyOn(actService, "act");
      const extract = vi.spyOn(extractService, "extract");
      const observe = vi.spyOn(observeService, "observe");
      const controller = createStagehandController(runtimeWith({} as StagehandInitParams));

      await expect(
        controller.act({ pageId: "page-1", instruction: "Click" }, handlerContext),
      ).rejects.toThrow("An LLM was not configured during Stagehand initialization");
      await expect(
        controller.extract(
          { pageId: "page-1", instruction: "Extract", schema: {} },
          handlerContext,
        ),
      ).rejects.toThrow("An LLM was not configured during Stagehand initialization");
      await expect(controller.observe({ pageId: "page-1" }, handlerContext)).rejects.toThrow(
        "An LLM was not configured during Stagehand initialization",
      );

      expect(act).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
    });
    it.todo("rejects Browserbase managed inference when using a local browser");
    it.todo("rejects an explicit model without provider auth when using a local browser");
    it.todo("rejects a missing model when using a local browser");
  });

  describe("client inference", () => {
    it.todo("uses the connected SDK when a client LLM callback is provided");
  });

  describe("per-call models", () => {
    it.todo("uses the initialized model when a call does not provide one");
    it.todo("uses the complete per-call model when a call provides one");
    it.todo("does not inherit initialized credentials into a per-call model");
  });
});
