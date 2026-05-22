import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FastifyRequest } from "fastify";

import { getRequestModelConfig } from "../../src/lib/header.js";

function createRequest({
  body,
  headers = {},
}: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}): FastifyRequest {
  return {
    body,
    headers,
  } as FastifyRequest;
}

describe("getRequestModelConfig", () => {
  it("preserves a Vertex model config from an action request so auth fields reach session initialization", () => {
    const model = {
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
    };
    const request = createRequest({
      body: {
        options: { model },
      },
      headers: {
        "x-model-api-key": "sk-header",
      },
    });

    const config = getRequestModelConfig(request);

    assert.equal(config.modelName, "vertex/gemini-2.5-flash");
    assert.equal(config.apiKey, "sk-header");
    assert.deepEqual(config.model, model);
  });

  it("normalizes an agent string model into request model config for local server session bootstrap", () => {
    const request = createRequest({
      body: {
        agentConfig: { model: "google/gemini-2.5-flash" },
      },
    });

    assert.deepEqual(getRequestModelConfig(request), {
      model: { modelName: "google/gemini-2.5-flash" },
      modelName: "google/gemini-2.5-flash",
      apiKey: undefined,
    });
  });
});
