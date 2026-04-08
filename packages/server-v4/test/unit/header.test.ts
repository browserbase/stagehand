import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FastifyRequest } from "fastify";

import {
  getModelApiKey,
  getModelName,
  getRequestModelConfig,
} from "../../src/lib/header.js";

function createMockRequest(body?: Record<string, unknown>): FastifyRequest {
  return {
    headers: {},
    body,
  } as unknown as FastifyRequest;
}

describe("header model config helpers", () => {
  it("extracts top-level model client options used by session start", () => {
    const request = createMockRequest({
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      modelClientOptions: {
        apiKey: "bedrock-bearer-token",
        providerConfig: {
          provider: "bedrock",
          options: { region: "us-east-1" },
        },
      },
    });

    assert.deepEqual(getRequestModelConfig(request), {
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      apiKey: "bedrock-bearer-token",
      providerConfig: {
        provider: "bedrock",
        options: { region: "us-east-1" },
      },
    });
    assert.equal(
      getModelName(request),
      "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
    );
    assert.equal(getModelApiKey(request), "bedrock-bearer-token");
  });

  it("extracts per-request inline model configs used by action routes", () => {
    const request = createMockRequest({
      options: {
        model: {
          modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
          providerConfig: {
            provider: "bedrock",
            options: {
              region: "us-east-1",
              accessKeyId: "AKIAIOSFODNN7EXAMPLE",
            },
          },
        },
      },
    });

    assert.deepEqual(getRequestModelConfig(request), {
      modelName: "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
      providerConfig: {
        provider: "bedrock",
        options: {
          region: "us-east-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        },
      },
    });
    assert.equal(
      getModelName(request),
      "bedrock/anthropic.claude-3-7-sonnet-20250219-v1:0",
    );
    assert.equal(getModelApiKey(request), undefined);
  });
});
