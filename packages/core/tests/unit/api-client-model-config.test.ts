import { describe, expect, it, vi } from "vitest";

import { StagehandAPIClient } from "../../lib/v3/api.js";

describe("StagehandAPIClient model config handling", () => {
  it("starts sessions without x-model-api-key when modelClientOptions carry auth", async () => {
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

    (client as unknown as { fetchWithCookies: typeof fetchWithCookies })
      .fetchWithCookies = fetchWithCookies;

    await client.init({
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      modelClientOptions: {
        apiKey: "bedrock-bearer-token",
        providerOptions: { region: "us-east-1" },
      },
    });

    expect(fetchWithCookies).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchWithCookies.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(requestInit.headers).not.toHaveProperty("x-model-api-key");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      modelClientOptions: {
        apiKey: "bedrock-bearer-token",
        providerOptions: { region: "us-east-1" },
      },
    });
  });

  it("resends session model config on act calls without explicit model", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const execute = vi.fn().mockResolvedValue({
      actions: [],
      actionDescription: "noop",
      message: "ok",
      success: true,
    });

    Object.assign(
      client as unknown as {
        modelApiKey: string | undefined;
        modelProvider: string;
        sessionModelConfig: Record<string, unknown>;
        execute: typeof execute;
      },
      {
        modelApiKey: undefined,
        modelProvider: "bedrock",
        sessionModelConfig: {
          modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
          providerOptions: {
            region: "us-east-1",
            accessKeyId: "AKIATEST",
          },
        },
        execute,
      },
    );

    await client.act({ input: "click the login button" });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "act",
        args: {
          input: "click the login button",
          options: {
            model: {
              modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
              providerOptions: {
                region: "us-east-1",
                accessKeyId: "AKIATEST",
              },
            },
          },
          frameId: undefined,
        },
      }),
    );
  });

  it("does not inject session model config when no modelClientOptions provided", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const execute = vi.fn().mockResolvedValue({
      actions: [],
      actionDescription: "noop",
      message: "ok",
      success: true,
    });

    Object.assign(
      client as unknown as {
        modelApiKey: string;
        modelProvider: string;
        execute: typeof execute;
      },
      {
        modelApiKey: "sk-openai-key",
        modelProvider: "openai",
        execute,
      },
    );

    await client.act({ input: "click the login button" });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "act",
        args: {
          input: "click the login button",
          options: undefined,
          frameId: undefined,
        },
      }),
    );
  });

  it("prepareModelConfig attaches apiKey for per-call model overrides", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const execute = vi.fn().mockResolvedValue({
      actions: [],
      actionDescription: "noop",
      message: "ok",
      success: true,
    });

    Object.assign(
      client as unknown as {
        modelApiKey: string;
        modelProvider: string;
        execute: typeof execute;
      },
      {
        modelApiKey: "sk-openai-key",
        modelProvider: "openai",
        execute,
      },
    );

    // Per-call override with a string model name from the same provider
    await client.act({
      input: "click",
      options: { model: "openai/gpt-4.1-mini" },
    });

    const actArgs = execute.mock.calls[0][0].args as Record<string, unknown>;
    const options = actArgs.options as Record<string, unknown>;
    const model = options.model as Record<string, unknown>;
    expect(model.modelName).toBe("openai/gpt-4.1-mini");
    expect(model.apiKey).toBe("sk-openai-key");
  });

  it("prepareModelConfig works without modelApiKey for Bedrock per-call override", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-api-key",
      projectId: "bb-project-id",
      logger: () => {},
    });
    const execute = vi.fn().mockResolvedValue({
      actions: [],
      actionDescription: "noop",
      message: "ok",
      success: true,
    });

    Object.assign(
      client as unknown as {
        modelApiKey: string | undefined;
        modelProvider: string;
        execute: typeof execute;
      },
      {
        modelApiKey: undefined,
        modelProvider: "bedrock",
        execute,
      },
    );

    // Per-call override with object config (no apiKey needed for Bedrock)
    await client.act({
      input: "click",
      options: {
        model: {
          modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
          providerOptions: { region: "us-east-1" },
        },
      },
    });

    const actArgs = execute.mock.calls[0][0].args as Record<string, unknown>;
    const options = actArgs.options as Record<string, unknown>;
    const model = options.model as Record<string, unknown>;
    expect(model.modelName).toBe(
      "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
    );
    expect(model.apiKey).toBeUndefined();
    expect(model.providerOptions).toEqual({ region: "us-east-1" });
  });
});
