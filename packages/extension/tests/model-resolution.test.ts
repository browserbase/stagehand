import { describe, expect, it } from "vite-plus/test";
import {
  AnthropicModelIdSchema,
  CerebrasModelIdSchema,
  CustomModelConfigSchema,
  GoogleModelIdSchema,
  GroqModelIdSchema,
  ModelConfigSchema,
  ModelNameSchema,
  OpenAIModelIdSchema,
} from "../../protocol/schemas.js";

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

  describe("custom models", () => {
    it("accepts any non-empty model name for a custom OpenAI-compatible endpoint", () => {
      expect(
        CustomModelConfigSchema.parse({
          modelName: "private/model-v2",
          baseURL: "https://models.example.com/v1",
          apiKey: "custom-secret",
          headers: { "x-tenant-id": "tenant-123" },
        }),
      ).toEqual({
        modelName: "private/model-v2",
        baseURL: "https://models.example.com/v1",
        apiKey: "custom-secret",
        headers: { "x-tenant-id": "tenant-123" },
      });
    });

    it("requires a base URL for a custom model name", () => {
      expect(
        ModelConfigSchema.safeParse({
          modelName: "private/model-v2",
          apiKey: "custom-secret",
        }).success,
      ).toBe(false);
    });

    it("rejects an empty custom model name", () => {
      expect(
        CustomModelConfigSchema.safeParse({
          modelName: "",
          baseURL: "https://models.example.com/v1",
        }).success,
      ).toBe(false);
    });

    it("rejects an invalid custom base URL", () => {
      expect(
        CustomModelConfigSchema.safeParse({
          modelName: "private/model-v2",
          baseURL: "not-a-url",
        }).success,
      ).toBe(false);
    });
  });

  describe("direct inference", () => {
    it.todo("uses direct inference when provider authentication is provided");
    it.todo("uses direct inference when a custom base URL is provided");
    it.todo("forwards custom headers to the custom base URL");
    it.todo("prefers direct inference when using a Browserbase browser with provider auth");
  });

  describe("Browserbase managed inference", () => {
    it.todo("uses Browserbase managed inference for an explicit model without provider auth");
    it.todo("uses Browserbase automatic model selection when no model is provided");
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
