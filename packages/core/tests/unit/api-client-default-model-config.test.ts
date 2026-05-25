import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StagehandAPIClient } from "../../lib/v3/api.js";
import type { ModelConfiguration } from "../../lib/v3/types/public/model.js";

const vertexModel = {
  provider: "vertex",
  modelName: "vertex/gemini-2.5-flash",
  project: "test-gcp-project",
  location: "us-central1",
  googleAuthOptions: {
    credentials: {
      client_email: "vertex@example.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
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

  beforeEach(() => {
    originalFetch = globalThis.fetch;
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
    vi.restoreAllMocks();
  });

  it("sends constructor Vertex model config on navigate, act, observe, extract, and agent execute requests", async () => {
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
              project: "test-gcp-project",
              location: "us-central1",
              googleAuthOptions: expect.any(Object),
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
              project: "test-gcp-project",
              location: "us-central1",
              googleAuthOptions: expect.any(Object),
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
              project: "test-gcp-project",
              location: "us-central1",
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
              project: "test-gcp-project",
              location: "us-central1",
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
              project: "test-gcp-project",
              location: "us-central1",
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
});
