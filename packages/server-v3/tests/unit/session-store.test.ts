import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemorySessionStore } from "../../src/lib/InMemorySessionStore.js";
import type {
  CreateSessionParams,
  RequestContext,
} from "../../src/lib/SessionStore.js";

type BuildV3Options = (
  params: CreateSessionParams,
  ctx: RequestContext,
  loggerRef: { current?: (message: unknown) => void },
) => { model?: Record<string, unknown> };

describe("InMemorySessionStore buildV3Options", () => {
  it("does not inject a fallback apiKey when Bedrock AWS auth is nested under providerConfig", () => {
    const store = new InMemorySessionStore();
    const buildV3Options = (
      store as unknown as { buildV3Options: BuildV3Options }
    ).buildV3Options;

    const options = buildV3Options(
      {
        browserType: "local",
        modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
        modelClientOptions: {
          providerConfig: {
            provider: "bedrock",
            options: {
              region: "us-east-1",
              accessKeyId: "AKIATEST",
              secretAccessKey: "secret",
            },
          },
        },
      },
      {
        modelApiKey: "fallback-model-key",
      },
      {},
    );

    assert.deepEqual(options.model, {
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      providerConfig: {
        provider: "bedrock",
        options: {
          region: "us-east-1",
          accessKeyId: "AKIATEST",
          secretAccessKey: "secret",
        },
      },
    });
  });

  it("does not inject a fallback apiKey when any explicit Bedrock AWS credential field is present", () => {
    const store = new InMemorySessionStore();
    const buildV3Options = (
      store as unknown as { buildV3Options: BuildV3Options }
    ).buildV3Options;

    const options = buildV3Options(
      {
        browserType: "local",
        modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      },
      {
        modelApiKey: "fallback-model-key",
        modelConfig: {
          modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
          providerConfig: {
            provider: "bedrock",
            options: {
              region: "us-east-1",
              sessionToken: "session-token",
            },
          },
        },
      },
      {},
    );

    assert.deepEqual(options.model, {
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      providerConfig: {
        provider: "bedrock",
        options: {
          region: "us-east-1",
          sessionToken: "session-token",
        },
      },
    });
  });
});
