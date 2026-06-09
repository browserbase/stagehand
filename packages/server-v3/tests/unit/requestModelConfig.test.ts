import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FastifyRequest } from "fastify";

import {
  getRequestModelConfig,
  getStagehandInitModelConfig,
  type RequestModelConfig,
} from "../../src/lib/header.js";
import { withModelApiKeyFallback } from "../../src/lib/InMemorySessionStore.js";

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

function assertSuccess(
  result: ReturnType<typeof getRequestModelConfig>,
): RequestModelConfig {
  if (result.success === false) {
    throw result.error;
  }
  assert.equal(result.success, true);
  return result.data;
}

describe("getRequestModelConfig", () => {
  it("preserves a Vertex model config from an action request so auth fields reach session initialization", () => {
    const model = {
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
    };
    const request = createRequest({
      body: {
        options: { model },
      },
      headers: {
        "x-model-api-key": "sk-header",
      },
    });

    const config = assertSuccess(getRequestModelConfig(request));

    assert.equal(config.modelName, "vertex/gemini-2.5-flash");
    assert.equal(config.apiKey, "sk-header");
    assert.deepEqual(config.model, model);
  });

  it("preserves an Azure Entra model config from an action request so auth fields reach session initialization", () => {
    const model = {
      provider: "azure",
      modelName: "azure/gpt-4.1-mini",
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
    };
    const request = createRequest({
      body: {
        options: { model },
      },
      headers: {
        "x-model-api-key": "sk-header",
      },
    });

    const config = assertSuccess(getRequestModelConfig(request));

    assert.equal(config.modelName, "azure/gpt-4.1-mini");
    assert.equal(config.apiKey, "sk-header");
    assert.deepEqual(config.model, model);
  });

  it("does not read agentConfig.model as a request-level model config", () => {
    const request = createRequest({
      body: {
        agentConfig: { model: "google/gemini-2.5-flash" },
      },
    });

    assert.deepEqual(assertSuccess(getRequestModelConfig(request)), {
      model: undefined,
      modelName: undefined,
      apiKey: undefined,
    });
  });

  it("normalizes an agent string model into the session bootstrap model config", () => {
    const request = createRequest({
      body: {
        agentConfig: { model: "google/gemini-2.5-flash" },
      },
    });

    assert.deepEqual(assertSuccess(getStagehandInitModelConfig(request)), {
      model: { modelName: "google/gemini-2.5-flash" },
      modelName: "google/gemini-2.5-flash",
      apiKey: undefined,
    });
  });

  it("returns a validation result instead of throwing when agent bootstrap model config is invalid", () => {
    const request = createRequest({
      body: {
        agentConfig: {
          model: {
            provider: "vertex",
            modelName: "vertex/gemini-2.5-flash",
          },
        },
      },
    });

    assert.deepEqual(assertSuccess(getRequestModelConfig(request)), {
      model: undefined,
      modelName: undefined,
      apiKey: undefined,
    });

    const result = getStagehandInitModelConfig(request);
    assert.equal(result.success, false);
  });
});

describe("withModelApiKeyFallback", () => {
  it("does not merge request header API keys into provider-authenticated model configs", () => {
    const model = {
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
    } as const;

    assert.deepEqual(withModelApiKeyFallback(model, "sk-header"), model);
  });

  it("still uses request header API keys as a fallback for simple model configs", () => {
    assert.deepEqual(
      withModelApiKeyFallback(
        { modelName: "openai/gpt-4.1-mini" },
        "sk-header",
      ),
      {
        modelName: "openai/gpt-4.1-mini",
        apiKey: "sk-header",
      },
    );
  });

  it("does not overwrite per-model API keys with request header API keys", () => {
    assert.deepEqual(
      withModelApiKeyFallback(
        {
          modelName: "openai/gpt-4.1-mini",
          apiKey: "sk-body",
        },
        "sk-header",
      ),
      {
        modelName: "openai/gpt-4.1-mini",
        apiKey: "sk-body",
      },
    );
  });
});
