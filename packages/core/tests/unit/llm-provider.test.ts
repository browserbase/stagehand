import { describe, expect, it } from "vitest";
import {
  getAISDKLanguageModel,
  LLMProvider,
  toAISDKClientOptions,
} from "../../lib/v3/llm/LLMProvider.js";

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
});

describe("LLMProvider", () => {
  it("allows Vertex models without experimental mode", () => {
    const provider = new LLMProvider(() => {});

    expect(() =>
      provider.getClient(
        "vertex/gemini-2.5-flash" as never,
        {
          auth: {
            type: "googleServiceAccount",
            credentials: {
              client_email: "stagehand@example.iam.gserviceaccount.com",
              private_key:
                "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
            },
          },
          providerOptions: {
            vertex: {
              project: "test-project",
              location: "us-central1",
            },
          },
        } as never,
        { experimental: false, disableAPI: false },
      ),
    ).not.toThrow();
  });

  it("adapts canonical Vertex auth into AI SDK googleAuthOptions", () => {
    expect(
      toAISDKClientOptions("vertex", {
        auth: {
          type: "googleServiceAccount",
          credentials: {
            client_email: "stagehand@example.iam.gserviceaccount.com",
            private_key:
              "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
          },
          projectId: "test-project",
          universeDomain: "googleapis.com",
        },
        providerOptions: {
          vertex: {
            project: "test-project",
            location: "us-central1",
          },
        },
      }),
    ).toEqual({
      project: "test-project",
      location: "us-central1",
      googleAuthOptions: {
        credentials: {
          client_email: "stagehand@example.iam.gserviceaccount.com",
          private_key:
            "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
        },
        projectId: "test-project",
        universeDomain: "googleapis.com",
      },
    });
  });

  it("allows Azure models without experimental mode", () => {
    const provider = new LLMProvider(() => {});

    expect(() =>
      provider.getClient(
        "azure/gpt-4.1-mini" as never,
        {
          auth: {
            type: "azureEntraId",
            token: "test-entra-token",
          },
          providerOptions: {
            azure: {
              resourceName: "test-azure-resource",
            },
          },
        } as never,
        { experimental: false, disableAPI: false },
      ),
    ).not.toThrow();
  });

  it("adapts canonical Azure Entra auth into an AI SDK tokenProvider", async () => {
    const options = toAISDKClientOptions("azure", {
      auth: {
        type: "azureEntraId",
        token: "test-entra-token",
      },
      providerOptions: {
        azure: {
          resourceName: "test-azure-resource",
          apiVersion: "2024-10-01-preview",
        },
      },
    });

    expect(options).toEqual(
      expect.objectContaining({
        resourceName: "test-azure-resource",
        apiVersion: "2024-10-01-preview",
      }),
    );
    const tokenProvider = options?.tokenProvider;
    expect(typeof tokenProvider).toBe("function");
    await expect((tokenProvider as () => Promise<string>)()).resolves.toBe(
      "test-entra-token",
    );
  });

  it("does not pass an API key to Azure when provider auth is configured", async () => {
    const options = toAISDKClientOptions("azure", {
      apiKey: "env-or-default-key-that-should-not-be-used",
      auth: {
        type: "azureEntraId",
        token: "test-entra-token",
      },
      providerOptions: {
        azure: {
          resourceName: "test-azure-resource",
        },
      },
    } as never);

    expect(options).not.toHaveProperty("apiKey");
    expect(options).toEqual(
      expect.objectContaining({
        resourceName: "test-azure-resource",
      }),
    );
    const tokenProvider = options?.tokenProvider;
    expect(typeof tokenProvider).toBe("function");
    await expect((tokenProvider as () => Promise<string>)()).resolves.toBe(
      "test-entra-token",
    );
  });
});
