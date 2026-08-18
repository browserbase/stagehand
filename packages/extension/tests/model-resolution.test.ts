import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicModelIdSchema,
  CerebrasModelIdSchema,
  GoogleModelIdSchema,
  GroqModelIdSchema,
  ModelConfigSchema,
  ModelNameSchema,
  OpenAIModelIdSchema,
} from "../../protocol/schemas.js";
import type { StagehandInitParams, StagehandResultMetadata } from "../../protocol/types.js";
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

const browserbaseGateway = {
  apiUrl: "https://api.euc1.stagehand.browserbase.com/v1",
  apiKey: "bb-api-key",
  sessionId: "session-123",
} as const;

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

function spyPrimitiveServices(options?: { resolve?: boolean }) {
  const resolve = options?.resolve ?? true;
  const act = vi.spyOn(actService, "act");
  const extract = vi.spyOn(extractService, "extract");
  const observe = vi.spyOn(observeService, "observe");
  if (resolve) {
    act.mockResolvedValue({
      data: { success: true, message: "", actionDescription: "", actions: [] },
      metadata,
    });
    extract.mockResolvedValue({ data: {}, metadata });
    observe.mockResolvedValue({ data: [], metadata });
  }
  return { act, extract, observe };
}

async function callPrimitives(
  controller: ReturnType<typeof createStagehandController>,
  model?: StagehandInitParams["model"],
) {
  const options = model === undefined ? undefined : { model };
  await controller.act(
    { pageId: "page-1", instruction: "Click", ...(options ? { options } : {}) },
    handlerContext,
  );
  await controller.extract(
    {
      pageId: "page-1",
      instruction: "Extract",
      schema: {},
      ...(options ? { options } : {}),
    },
    handlerContext,
  );
  await controller.observe(
    { pageId: "page-1", ...(options ? { options } : {}) },
    handlerContext,
  );
}

async function expectPrimitivesReject(
  controller: ReturnType<typeof createStagehandController>,
  message: string,
) {
  await expect(
    controller.act({ pageId: "page-1", instruction: "Click" }, handlerContext),
  ).rejects.toThrow(message);
  await expect(
    controller.extract(
      { pageId: "page-1", instruction: "Extract", schema: {} },
      handlerContext,
    ),
  ).rejects.toThrow(message);
  await expect(controller.observe({ pageId: "page-1" }, handlerContext)).rejects.toThrow(
    message,
  );
}

function expectForwarded(
  services: ReturnType<typeof spyPrimitiveServices>,
  expected: Record<string, unknown>,
) {
  for (const service of [services.act, services.extract, services.observe]) {
    expect(service).toHaveBeenCalledWith(expect.objectContaining(expected));
  }
}

function expectNotCalled(services: ReturnType<typeof spyPrimitiveServices>) {
  expect(services.act).not.toHaveBeenCalled();
  expect(services.extract).not.toHaveBeenCalled();
  expect(services.observe).not.toHaveBeenCalled();
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
    it("uses direct inference when provider authentication is provided", async () => {
      const services = spyPrimitiveServices();
      const model = {
        modelName: "openai/gpt-5.4-mini" as const,
        apiKey: "sk-provider",
      };
      const controller = createStagehandController(
        runtimeWith({ model } as StagehandInitParams),
      );

      await callPrimitives(controller);
      expectForwarded(services, { model, gateway: undefined });
    });

    it("prefers direct inference when using a Browserbase browser with provider auth", async () => {
      const services = spyPrimitiveServices();
      const model = {
        modelName: "openai/gpt-5.4-mini" as const,
        apiKey: "sk-provider",
      };
      const controller = createStagehandController(
        runtimeWith({
          apiKey: "bb-api-key",
          browser: { sessionId: "session-123", region: "eu-central-1" },
          model,
        } as StagehandInitParams),
      );

      await callPrimitives(controller);
      // Gateway is still passed; llmService prefers direct inference when apiKey is set.
      expectForwarded(services, { model, gateway: browserbaseGateway });
    });
  });

  describe("Browserbase managed inference", () => {
    it("uses Browserbase managed inference for an explicit model without provider auth", async () => {
      const services = spyPrimitiveServices();
      const model = { modelName: "openai/gpt-5.4-mini" as const };
      const controller = createStagehandController(
        runtimeWith({
          apiKey: "bb-api-key",
          browser: { sessionId: "session-123", region: "eu-central-1" },
          model,
        } as StagehandInitParams),
      );

      await callPrimitives(controller);
      expectForwarded(services, { model, gateway: browserbaseGateway });
    });

    it("routes every primitive without a model through the Browserbase gateway", async () => {
      const services = spyPrimitiveServices();
      const controller = createStagehandController(
        runtimeWith({
          apiKey: "bb-api-key",
          browser: { sessionId: "session-123", region: "eu-central-1" },
        } as StagehandInitParams),
      );

      await callPrimitives(controller);
      expectForwarded(services, { model: undefined, gateway: browserbaseGateway });
    });

    it("rejects every primitive without a model or Browserbase gateway", async () => {
      const services = spyPrimitiveServices({ resolve: false });
      const controller = createStagehandController(runtimeWith({} as StagehandInitParams));

      await expectPrimitivesReject(
        controller,
        "An LLM was not configured during Stagehand initialization",
      );
      expectNotCalled(services);
    });

    it("rejects Browserbase managed inference when using a local browser", async () => {
      const services = spyPrimitiveServices({ resolve: false });
      const controller = createStagehandController(
        runtimeWith({
          apiKey: "bb-api-key",
          browserCdpUrl: "ws://localhost:9222",
        } as StagehandInitParams),
      );

      await expectPrimitivesReject(
        controller,
        "An LLM was not configured during Stagehand initialization",
      );
      expectNotCalled(services);
    });

    it("forwards an explicit keyless model when using a local browser", async () => {
      const services = spyPrimitiveServices();
      const model = { modelName: "openai/gpt-5.4-mini" as const };
      const controller = createStagehandController(
        runtimeWith({
          browserCdpUrl: "ws://localhost:9222",
          model,
        } as StagehandInitParams),
      );

      // Controller forwards keyless models; llmService rejects later without a gateway.
      await callPrimitives(controller);
      expectForwarded(services, { model, gateway: undefined });
    });

    it("rejects a missing model when using a local browser", async () => {
      const services = spyPrimitiveServices({ resolve: false });
      const controller = createStagehandController(
        runtimeWith({
          browserCdpUrl: "ws://localhost:9222",
        } as StagehandInitParams),
      );

      await expectPrimitivesReject(
        controller,
        "An LLM was not configured during Stagehand initialization",
      );
      expectNotCalled(services);
    });
  });

  describe("client inference", () => {
    it("uses the connected SDK when a client LLM callback is provided", async () => {
      const services = spyPrimitiveServices();
      const model = { source: "client" as const };
      const runtime = runtimeWith({ model } as StagehandInitParams);
      const controller = createStagehandController(runtime);

      await callPrimitives(controller);
      expectForwarded(services, {
        model,
        clientLLMGenerate: runtime.adapters.clientLLMGenerate,
        gateway: undefined,
      });
    });
  });

  describe("per-call models", () => {
    it("uses the initialized model when a call does not provide one", async () => {
      const services = spyPrimitiveServices();
      const model = {
        modelName: "openai/gpt-5.4-mini" as const,
        apiKey: "sk-init",
      };
      const controller = createStagehandController(
        runtimeWith({ model } as StagehandInitParams),
      );

      await callPrimitives(controller);
      expectForwarded(services, { model });
    });

    it("uses the complete per-call model when a call provides one", async () => {
      const services = spyPrimitiveServices();
      const initModel = {
        modelName: "openai/gpt-5.4-mini" as const,
        apiKey: "sk-init",
      };
      const callModel = {
        modelName: "anthropic/claude-sonnet-4-6" as const,
        apiKey: "sk-call",
        headers: { "x-call": "1" },
      };
      const controller = createStagehandController(
        runtimeWith({ model: initModel } as StagehandInitParams),
      );

      await callPrimitives(controller, callModel);
      expectForwarded(services, { model: callModel });
    });

    it("does not inherit initialized credentials into a per-call model", async () => {
      const services = spyPrimitiveServices();
      const initModel = {
        modelName: "openai/gpt-5.4-mini" as const,
        apiKey: "sk-init",
        headers: { "x-init": "1" },
      };
      // Keyless per-call model is forwarded as-is; llmService rejects later without a gateway.
      const callModel = { modelName: "anthropic/claude-sonnet-4-6" as const };
      const controller = createStagehandController(
        runtimeWith({ model: initModel } as StagehandInitParams),
      );

      await callPrimitives(controller, callModel);
      for (const service of [services.act, services.extract, services.observe]) {
        expect(service.mock.calls[0]?.[0].model).toEqual(callModel);
      }
    });
  });
});
