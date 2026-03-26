import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_OK,
} from "../utils.js";

interface LLMRecord {
  id: string;
  displayName?: string;
  source: "user" | "system-default";
  modelName: string;
  baseUrl?: string;
  systemPrompt?: string;
  providerOptions?: {
    temperature?: number;
    organization?: string;
    project?: string;
    location?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface LLMResponse {
  success: boolean;
  message?: string;
  data?: {
    llm: LLMRecord;
  };
}

interface LLMListResponse {
  success: boolean;
  data?: {
    llms: LLMRecord[];
  };
}

const headers = getHeaders("4.0.0");

describe("v4 llm routes", { concurrency: false }, () => {
  it("POST/GET/PATCH /v4/llms expose a reusable llm stub resource", async () => {
    const createCtx = await fetchWithContext<LLMResponse>(
      `${getBaseUrl()}/v4/llms`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          displayName: "Primary LLM",
          modelName: "openai/gpt-4.1-nano",
          baseUrl: "https://api.openai.com/v1",
          systemPrompt: "Be precise.",
          providerOptions: {
            temperature: 0.2,
            organization: "org_123",
          },
        }),
      },
    );

    assertFetchStatus(createCtx, HTTP_OK);
    assertFetchOk(createCtx.body !== null, "Expected JSON response", createCtx);
    assertFetchOk(
      createCtx.body.data?.llm !== undefined,
      "Expected llm",
      createCtx,
    );

    const llm = createCtx.body.data!.llm;
    assert.equal(llm.displayName, "Primary LLM");
    assert.equal(llm.source, "user");
    assert.equal(llm.modelName, "openai/gpt-4.1-nano");
    assert.equal(llm.baseUrl, "https://api.openai.com/v1");
    assert.equal(llm.systemPrompt, "Be precise.");
    assert.equal(llm.providerOptions?.temperature, 0.2);
    assert.equal("apiKey" in llm, false);

    const listCtx = await fetchWithContext<LLMListResponse>(
      `${getBaseUrl()}/v4/llms`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(listCtx, HTTP_OK);
    assertFetchOk(listCtx.body !== null, "Expected JSON response", listCtx);
    assertFetchOk(
      listCtx.body.data?.llms !== undefined,
      "Expected llms",
      listCtx,
    );
    assert.ok(
      listCtx.body.data!.llms.some((candidate) => candidate.id === llm.id),
    );

    const getCtx = await fetchWithContext<LLMResponse>(
      `${getBaseUrl()}/v4/llms/${llm.id}`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(getCtx, HTTP_OK);
    assertFetchOk(getCtx.body !== null, "Expected JSON response", getCtx);
    assert.equal(getCtx.body.data?.llm.id, llm.id);

    const patchCtx = await fetchWithContext<LLMResponse>(
      `${getBaseUrl()}/v4/llms/${llm.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          displayName: "Secondary LLM",
          systemPrompt: "Be terse.",
          providerOptions: {
            temperature: 0.7,
            project: "vertex-project",
            location: "us-central1",
          },
        }),
      },
    );

    assertFetchStatus(patchCtx, HTTP_OK);
    assertFetchOk(patchCtx.body !== null, "Expected JSON response", patchCtx);
    assert.equal(patchCtx.body.data?.llm.id, llm.id);
    assert.equal(patchCtx.body.data?.llm.displayName, "Secondary LLM");
    assert.equal(patchCtx.body.data?.llm.source, "user");
    assert.equal(patchCtx.body.data?.llm.systemPrompt, "Be terse.");
    assert.equal(patchCtx.body.data?.llm.providerOptions?.temperature, 0.7);
    assert.equal(
      patchCtx.body.data?.llm.providerOptions?.project,
      "vertex-project",
    );
    assert.equal(
      patchCtx.body.data?.llm.providerOptions?.location,
      "us-central1",
    );
  });
});
