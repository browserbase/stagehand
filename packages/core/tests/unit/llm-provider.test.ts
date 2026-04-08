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

  describe("providerConfig handling", () => {
    it("maps Bedrock providerConfig into the AI SDK constructor args", () => {
      const model = getAISDKLanguageModel(
        "bedrock",
        "anthropic.claude-3-7-sonnet-20250219-v1:0",
        {
          apiKey: "bedrock-bearer-token",
          providerConfig: {
            provider: "bedrock",
            options: {
              region: "us-west-2",
            },
          },
        },
      );
      expect(model).toBeDefined();
    });

    it("normalizes legacy Vertex top-level options", () => {
      const model = getAISDKLanguageModel("vertex", "gemini-2.5-pro", {
        project: "test-project",
        location: "us-central1",
      });
      expect(model).toBeDefined();
    });

    it("accepts typed Vertex providerConfig", () => {
      const model = getAISDKLanguageModel("vertex", "gemini-2.5-pro", {
        providerConfig: {
          provider: "vertex",
          options: {
            project: "test-project",
            location: "us-central1",
          },
        },
      });
      expect(model).toBeDefined();
    });

    it("throws when providerConfig does not match the model provider", () => {
      expect(() =>
        getAISDKLanguageModel("bedrock", "anthropic.claude-3-haiku", {
          providerConfig: {
            provider: "vertex",
            options: {
              project: "test-project",
            },
          },
        }),
      ).toThrow(/providerConfig\.provider/);
    });
  });
});
