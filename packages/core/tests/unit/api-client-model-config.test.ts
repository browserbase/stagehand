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

  it("does not inject default model config on act calls without options", async () => {
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
});
