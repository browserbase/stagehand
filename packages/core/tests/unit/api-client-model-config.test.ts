import { describe, expect, it, vi } from "vitest";

import { StagehandAPIClient } from "../../lib/v3/api.js";

describe("StagehandAPIClient model config handling", () => {
  it("starts Bedrock sessions without x-model-api-key when providerOptions carry auth", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const fetchWithCookies = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            available: true,
            sessionId: "session-id",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    (
      client as unknown as { fetchWithCookies: typeof fetchWithCookies }
    ).fetchWithCookies = fetchWithCookies;

    await client.init({
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      modelClientOptions: {
        providerOptions: {
          region: "us-east-1",
          accessKeyId: "AKIATEST",
          secretAccessKey: "secret-test",
        },
      },
    });

    expect(fetchWithCookies).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchWithCookies.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(requestInit.headers).not.toHaveProperty("x-model-api-key");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      modelClientOptions: {
        providerConfig: {
          provider: "bedrock",
          options: {
            region: "us-east-1",
            accessKeyId: "AKIATEST",
            secretAccessKey: "secret-test",
          },
        },
      },
    });
  });

  it("keeps Bedrock bearer tokens in providerConfig instead of x-model-api-key", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const fetchWithCookies = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            available: true,
            sessionId: "session-id",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    (
      client as unknown as { fetchWithCookies: typeof fetchWithCookies }
    ).fetchWithCookies = fetchWithCookies;

    await client.init({
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      modelApiKey: "bedrock-bearer-token",
      modelClientOptions: {
        providerOptions: {
          region: "us-east-1",
          apiKey: "bedrock-bearer-token",
        },
      },
    });

    const [, requestInit] = fetchWithCookies.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(requestInit.headers).not.toHaveProperty("x-model-api-key");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      modelClientOptions: {
        providerConfig: {
          provider: "bedrock",
          options: {
            region: "us-east-1",
            apiKey: "bedrock-bearer-token",
          },
        },
      },
    });
  });

  it("normalizes legacy Vertex settings into providerConfig on session start", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const fetchWithCookies = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            available: true,
            sessionId: "session-id",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    (
      client as unknown as { fetchWithCookies: typeof fetchWithCookies }
    ).fetchWithCookies = fetchWithCookies;

    await client.init({
      modelName: "vertex/gemini-2.5-pro",
      modelClientOptions: {
        project: "test-project",
        location: "us-central1",
        googleAuthOptions: {
          credentials: {
            client_email: "test@example.com",
          },
        },
      },
    });

    const [, requestInit] = fetchWithCookies.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      modelName: "vertex/gemini-2.5-pro",
      modelClientOptions: {
        providerConfig: {
          provider: "vertex",
          options: {
            project: "test-project",
            location: "us-central1",
            googleAuthOptions: {
              credentials: {
                client_email: "test@example.com",
              },
            },
          },
        },
      },
    });
  });

  it("resends the session Bedrock model config on act calls without explicit model", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const fetchWithCookies = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            available: true,
            sessionId: "session-id",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    (
      client as unknown as { fetchWithCookies: typeof fetchWithCookies }
    ).fetchWithCookies = fetchWithCookies;

    await client.init({
      modelName: "bedrock/us.amazon.nova-lite-v1:0",
      modelClientOptions: {
        providerOptions: {
          region: "us-east-1",
          accessKeyId: "AKIATEST",
          secretAccessKey: "secret-test",
        },
      },
    });

    const execute = vi.fn().mockResolvedValue({
      actions: [],
      actionDescription: "noop",
      message: "ok",
      success: true,
    });

    (client as unknown as { execute: typeof execute }).execute = execute;

    await client.act({ input: "click the login button" });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "act",
        args: {
          input: "click the login button",
          options: {
            model: {
              modelName: "bedrock/us.amazon.nova-lite-v1:0",
              providerConfig: {
                provider: "bedrock",
                options: {
                  region: "us-east-1",
                  accessKeyId: "AKIATEST",
                  secretAccessKey: "secret-test",
                },
              },
            },
          },
          frameId: undefined,
        },
      }),
    );
  });

  it("resends the session Vertex model config on navigate calls", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const fetchWithCookies = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            available: true,
            sessionId: "session-id",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    (
      client as unknown as { fetchWithCookies: typeof fetchWithCookies }
    ).fetchWithCookies = fetchWithCookies;

    await client.init({
      modelName: "vertex/gemini-2.5-pro",
      modelClientOptions: {
        providerOptions: {
          project: "vertex-project",
          location: "us-central1",
          googleAuthOptions: {
            credentials: {
              client_email: "vertex@example.com",
              private_key: "private-key",
            },
          },
        },
      },
    });

    const execute = vi.fn().mockResolvedValue(null);

    (client as unknown as { execute: typeof execute }).execute = execute;

    await client.goto("https://example.com", {
      waitUntil: "domcontentloaded",
    });

    expect(execute).toHaveBeenCalledWith({
      method: "navigate",
      args: {
        url: "https://example.com",
        options: {
          waitUntil: "domcontentloaded",
          model: {
            modelName: "vertex/gemini-2.5-pro",
            providerConfig: {
              provider: "vertex",
              options: {
                project: "vertex-project",
                location: "us-central1",
                googleAuthOptions: {
                  credentials: {
                    client_email: "vertex@example.com",
                    private_key: "private-key",
                  },
                },
              },
            },
          },
        },
        frameId: undefined,
      },
    });
  });
});
