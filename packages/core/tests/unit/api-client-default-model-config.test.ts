import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StagehandAPIClient } from "../../lib/v3/api.js";
import { V3 as Stagehand } from "../../lib/v3/v3.js";
import type { ModelConfiguration } from "../../lib/v3/types/public/model.js";

const vertexModel = {
  provider: "vertex",
  modelName: "vertex/gemini-2.5-flash",
  auth: {
    type: "googleServiceAccount",
    credentials: {
      client_email: "vertex@example.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
    },
  },
  providerOptions: {
    vertex: {
      project: "test-gcp-project",
      location: "us-central1",
    },
  },
} as unknown as ModelConfiguration;

const azureEntraModel = {
  provider: "azure",
  modelName: "azure/gpt-4.1-mini",
  auth: {
    type: "azureEntraId",
    token: "test-entra-token",
  },
  providerOptions: {
    azure: {
      resourceName: "test-azure-resource",
    },
  },
} as unknown as ModelConfiguration;

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

describe("StagehandAPIClient default model config", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalAzureApiKey: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAzureApiKey = process.env.AZURE_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { sessionId: "sess-default-model", available: true },
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
    if (originalAzureApiKey === undefined) {
      delete process.env.AZURE_API_KEY;
    } else {
      process.env.AZURE_API_KEY = originalAzureApiKey;
    }
    vi.restoreAllMocks();
  });

  it("sends constructor Vertex model config on navigate bootstrap, act, observe, extract, and agent execute requests", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "vertex/gemini-2.5-flash",
      defaultModelConfig: vertexModel,
    });

    await client.goto("https://example.com");
    await client.act({ input: "click the login button" });
    await client.observe({ instruction: "find the login button" });
    await client.extract({ instruction: "extract the headline" });
    await client.agentExecute({ mode: "dom" }, "click the login button");

    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "navigate",
        args: expect.objectContaining({
          options: {
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.5-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          },
        }),
      }),
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "act",
        args: expect.objectContaining({
          options: {
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.5-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          },
        }),
      }),
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "observe",
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.5-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          }),
        }),
      }),
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: "extract",
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.5-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          }),
        }),
      }),
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        method: "agentExecute",
        args: expect.objectContaining({
          agentConfig: expect.objectContaining({
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.5-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          }),
        }),
      }),
    );
  });

  it("prefers a per-call model over the constructor default model config", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "vertex/gemini-2.5-flash",
      defaultModelConfig: vertexModel,
    });

    await client.act({
      input: "click the login button",
      options: {
        model: {
          modelName: "openai/gpt-4.1-mini",
          apiKey: "sk-per-call",
        },
      },
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: {
              modelName: "openai/gpt-4.1-mini",
              apiKey: "sk-per-call",
            },
          }),
        }),
      }),
    );
  });

  it("inherits constructor Vertex auth for a same-provider string model override", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "vertex/gemini-2.5-flash",
      defaultModelConfig: vertexModel,
    });

    await client.observe({
      instruction: "find the login button",
      options: {
        model: "vertex/gemini-2.0-flash",
      },
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "observe",
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.0-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          }),
        }),
      }),
    );
  });

  it("does not treat model as a public navigate option", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "openai/gpt-4.1-mini",
      modelApiKey: "sk-header-only",
    });

    await client.goto("https://example.com", {
      model: {
        modelName: "openai/gpt-4o",
        apiKey: "sk-per-call",
      },
    } as unknown as Parameters<StagehandAPIClient["goto"]>[1]);

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "navigate",
        args: expect.objectContaining({
          options: undefined,
        }),
      }),
    );
  });

  it("keeps constructor bootstrap config when a caller passes an unsupported navigate model", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "vertex/gemini-2.5-flash",
      defaultModelConfig: vertexModel,
    });

    await client.goto("https://example.com", {
      model: {
        modelName: "openai/gpt-4o",
        apiKey: "sk-per-call",
      },
    } as unknown as Parameters<StagehandAPIClient["goto"]>[1]);

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "navigate",
        args: expect.objectContaining({
          options: {
            model: expect.objectContaining({
              modelName: "vertex/gemini-2.5-flash",
              auth: expect.objectContaining({
                type: "googleServiceAccount",
              }),
              providerOptions: {
                vertex: expect.objectContaining({
                  project: "test-gcp-project",
                  location: "us-central1",
                }),
              },
            }),
          },
        }),
      }),
    );
  });

  it("does not add a body model config when the constructor only provides a model API key", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "openai/gpt-4.1-mini",
      modelApiKey: "sk-header-only",
    });

    await client.act({ input: "click the login button" });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          options: undefined,
        }),
      }),
    );
  });

  it("does not serialize AZURE_API_KEY when constructor Azure Entra auth provides provider credentials", async () => {
    process.env.AZURE_API_KEY = "env-key-that-should-not-be-sent";
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "azure/gpt-4.1-mini",
      modelApiKey: "header-key-that-should-not-be-merged",
      defaultModelConfig: azureEntraModel,
    });

    await client.act({ input: "click the login button" });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "act",
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: expect.objectContaining({
              provider: "azure",
              modelName: "azure/gpt-4.1-mini",
              auth: expect.objectContaining({
                type: "azureEntraId",
                token: "test-entra-token",
              }),
              providerOptions: {
                azure: expect.objectContaining({
                  resourceName: "test-azure-resource",
                }),
              },
            }),
          }),
        }),
      }),
    );

    const model = executeMock.mock.calls[0][0].args.options.model as Record<
      string,
      unknown
    >;
    expect(model).not.toHaveProperty("apiKey");
  });

  it("does not serialize AZURE_API_KEY when per-call Azure Entra auth provides provider credentials", async () => {
    process.env.AZURE_API_KEY = "env-key-that-should-not-be-sent";
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "openai/gpt-4.1-mini",
      modelApiKey: "sk-default",
    });

    await client.observe({
      instruction: "find the login button",
      options: {
        model: azureEntraModel,
      },
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "observe",
        args: expect.objectContaining({
          options: expect.objectContaining({
            model: expect.objectContaining({
              provider: "azure",
              modelName: "azure/gpt-4.1-mini",
              auth: expect.objectContaining({
                type: "azureEntraId",
                token: "test-entra-token",
              }),
            }),
          }),
        }),
      }),
    );

    const model = executeMock.mock.calls[0][0].args.options.model as Record<
      string,
      unknown
    >;
    expect(model).not.toHaveProperty("apiKey");
  });

  it("keeps same-provider constructor options when per-call Azure Entra auth overrides credentials", async () => {
    const { client, executeMock } = createClientWithExecuteMock();

    await client.init({
      modelName: "azure/gpt-4.1-mini",
      modelApiKey: "header-key-that-should-not-be-merged",
      defaultModelConfig: azureEntraModel,
    });

    await client.observe({
      instruction: "find the login button",
      options: {
        model: {
          provider: "azure",
          modelName: "azure/gpt-4.1-mini",
          auth: {
            type: "azureEntraId",
            token: "fresh-per-call-token",
          },
        } as unknown as ModelConfiguration,
      },
    });

    const model = executeMock.mock.calls[0][0].args.options.model as Record<
      string,
      unknown
    >;
    expect(model).toEqual(
      expect.objectContaining({
        provider: "azure",
        modelName: "azure/gpt-4.1-mini",
        auth: {
          type: "azureEntraId",
          token: "fresh-per-call-token",
        },
        providerOptions: {
          azure: {
            resourceName: "test-azure-resource",
          },
        },
      }),
    );
    expect(model).not.toHaveProperty("apiKey");
  });

  it("does not load AZURE_API_KEY into local constructor config when Azure Entra auth provides provider credentials", () => {
    process.env.AZURE_API_KEY = "env-key-that-should-not-be-used";

    const stagehand = new Stagehand({
      env: "LOCAL",
      model: azureEntraModel,
    });

    const modelClientOptions = (
      stagehand as unknown as {
        modelClientOptions: Record<string, unknown>;
      }
    ).modelClientOptions;
    expect(modelClientOptions).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          type: "azureEntraId",
          token: "test-entra-token",
        }),
      }),
    );
    expect(modelClientOptions).not.toHaveProperty("apiKey");
  });

  it("keeps same-provider constructor options when a local per-call API key overrides credentials", () => {
    const stagehand = new Stagehand({
      env: "LOCAL",
      model: {
        modelName: "openai/gpt-4.1-mini",
        apiKey: "sk-constructor",
        baseURL: "https://proxy.example.com/v1",
        headers: {
          "x-stagehand-test": "yes",
        },
      },
    });
    const getClient = vi.fn().mockReturnValue({});
    const privateStagehand = stagehand as unknown as {
      llmProvider: { getClient: typeof getClient };
      resolveLlmClient(model: ModelConfiguration): unknown;
    };
    privateStagehand.llmProvider.getClient = getClient;

    privateStagehand.resolveLlmClient({
      modelName: "openai/gpt-4.1-mini",
      apiKey: "sk-per-call",
    } as ModelConfiguration);

    const clientOptions = getClient.mock.calls[0][1] as Record<string, unknown>;
    expect(clientOptions).toEqual(
      expect.objectContaining({
        apiKey: "sk-per-call",
        baseURL: "https://proxy.example.com/v1",
        headers: {
          "x-stagehand-test": "yes",
        },
      }),
    );
  });
});
