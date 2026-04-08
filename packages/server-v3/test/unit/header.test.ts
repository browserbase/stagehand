import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyRequest } from "fastify";

function makeRequest(body: unknown): FastifyRequest {
  return {
    body,
    headers: {},
  } as FastifyRequest;
}

async function loadHeaderModule() {
  return await import(new URL("../../lib/header.js", import.meta.url).href);
}

describe("getRequestModelConfig", () => {
  it("returns a string options.model as { modelName }", async () => {
    const { getRequestModelConfig } = await loadHeaderModule();

    assert.deepEqual(
      getRequestModelConfig(
        makeRequest({
          options: {
            model: "openai/gpt-4.1-nano",
          },
        }),
      ),
      { modelName: "openai/gpt-4.1-nano" },
    );
  });

  it("returns agentConfig.model objects for agentExecute lazy init", async () => {
    const { getRequestModelConfig } = await loadHeaderModule();
    const modelConfig = {
      modelName: "openai/gpt-4.1-nano",
      apiKey: "sk-test",
      providerConfig: {
        provider: "bedrock",
        options: {
          region: "us-east-1",
        },
      },
    };

    assert.deepEqual(
      getRequestModelConfig(
        makeRequest({
          agentConfig: {
            model: modelConfig,
          },
        }),
      ),
      modelConfig,
    );
  });

  it("supports parsed request bodies passed directly", async () => {
    const { getRequestModelConfigFromBody } = await loadHeaderModule();

    assert.deepEqual(
      getRequestModelConfigFromBody({
        agentConfig: {
          model: "openai/gpt-4.1-mini",
        },
      }),
      { modelName: "openai/gpt-4.1-mini" },
    );
  });
});
