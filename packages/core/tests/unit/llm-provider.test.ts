import { describe, expect, it } from "vitest";
import { getAISDKLanguageModel } from "../../lib/v3/llm/LLMProvider.js";

describe("getAISDKLanguageModel", () => {
  describe("ollama provider", () => {
    it("works without clientOptions", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2");
      expect(model).toBeDefined();
    });

    it("works with empty clientOptions", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {});
      expect(model).toBeDefined();
    });

    it("works with clientOptions containing only undefined values", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: undefined,
      });
      expect(model).toBeDefined();
    });

    it("works with clientOptions containing only null values", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: null as unknown as string,
      });
      expect(model).toBeDefined();
    });

    it("works with custom baseURL", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        baseURL: "http://custom-ollama:11434",
      });
      expect(model).toBeDefined();
    });

    it("works even when apiKey is mistakenly provided", () => {
      // Ollama doesn't need an API key, but users might set one anyway
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: "unnecessary-key",
      });
      expect(model).toBeDefined();
    });
  });

  describe("providers with API keys", () => {
    it("openai requires valid clientOptions for custom configuration", () => {
      // Without clientOptions, uses default provider
      const defaultModel = getAISDKLanguageModel("openai", "gpt-4o");
      expect(defaultModel).toBeDefined();

      // With valid apiKey, uses custom provider
      const customModel = getAISDKLanguageModel("openai", "gpt-4o", {
        apiKey: "test-key",
      });
      expect(customModel).toBeDefined();
    });
  });

  describe("novita provider", () => {
    it("works with apiKey", () => {
      const model = getAISDKLanguageModel(
        "novita",
        "moonshotai/kimi-k2.5",
        { apiKey: "test-novita-key" },
      );
      expect(model).toBeDefined();
    });

    it("works without clientOptions (uses static provider)", () => {
      const model = getAISDKLanguageModel("novita", "moonshotai/kimi-k2.5");
      expect(model).toBeDefined();
    });

    it("works with custom baseURL override", () => {
      const model = getAISDKLanguageModel("novita", "minimax/minimax-m2.5", {
        apiKey: "test-novita-key",
        baseURL: "https://api.novita.ai/openai",
      });
      expect(model).toBeDefined();
    });
  });

  describe("hasValidOptions logic", () => {
    it("treats undefined apiKey as no options", () => {
      // This should use the default provider path (AISDKProviders)
      // not the custom provider path (AISDKProvidersWithAPIKey)
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: undefined,
      });
      expect(model).toBeDefined();
    });
  });
});
