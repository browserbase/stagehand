import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_OK,
  LOCAL_BROWSER_BODY,
} from "../utils.js";

interface BrowserSessionRecord {
  id: string;
  llmId: string;
  actLlmId: string | null;
  observeLlmId: string | null;
  extractLlmId: string | null;
  env: "LOCAL" | "BROWSERBASE";
  status: "running" | "ended";
  cdpUrl: string;
  available: boolean;
  selfHeal?: boolean;
}

interface BrowserSessionResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    browserSession: BrowserSessionRecord;
  };
}

interface LLMResponse {
  success: boolean;
  data?: {
    llm: {
      id: string;
      source: "user" | "system-default";
      modelName: string;
    };
  };
}

const headers = getHeaders("4.0.0");

describe("v4 browsersession routes", { concurrency: false }, () => {
  it("POST /v4/browsersession creates a local browser session with an explicit llm and PATCH can rebind it", async () => {
    const primaryLLMCtx = await fetchWithContext<LLMResponse>(
      `${getBaseUrl()}/v4/llms`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          displayName: "Primary",
          modelName: "openai/gpt-4.1-nano",
        }),
      },
    );

    assertFetchStatus(primaryLLMCtx, HTTP_OK);
    assertFetchOk(
      primaryLLMCtx.body?.data?.llm !== undefined,
      "Expected llm payload",
      primaryLLMCtx,
    );

    const createCtx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          llmId: primaryLLMCtx.body!.data!.llm.id,
          actLlmId: primaryLLMCtx.body!.data!.llm.id,
          ...LOCAL_BROWSER_BODY,
        }),
      },
    );

    assertFetchStatus(createCtx, HTTP_OK);
    assertFetchOk(
      createCtx.body !== null,
      "Expected a JSON response body",
      createCtx,
    );
    assert.equal(createCtx.body.success, true);
    assertFetchOk(
      createCtx.body.data?.browserSession !== undefined,
      "Expected a browserSession payload",
      createCtx,
    );

    const browserSession = createCtx.body.data!.browserSession;
    assert.equal(browserSession.env, "LOCAL");
    assert.equal(browserSession.status, "running");
    assert.equal(browserSession.llmId, primaryLLMCtx.body!.data!.llm.id);
    assert.equal(browserSession.actLlmId, primaryLLMCtx.body!.data!.llm.id);
    assert.equal(browserSession.observeLlmId, null);
    assert.equal(browserSession.extractLlmId, null);
    assert.equal(browserSession.available, true);
    assert.ok(browserSession.cdpUrl.length > 0);

    const statusCtx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession/${browserSession.id}`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(statusCtx, HTTP_OK);
    assertFetchOk(
      statusCtx.body !== null,
      "Expected a JSON response body",
      statusCtx,
    );
    assert.equal(statusCtx.body.data?.browserSession.id, browserSession.id);
    assert.equal(statusCtx.body.data?.browserSession.status, "running");

    const secondaryLLMCtx = await fetchWithContext<LLMResponse>(
      `${getBaseUrl()}/v4/llms`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          displayName: "Secondary",
          modelName: "anthropic/claude-sonnet-4-5-20250929",
        }),
      },
    );

    assertFetchStatus(secondaryLLMCtx, HTTP_OK);
    assertFetchOk(
      secondaryLLMCtx.body?.data?.llm !== undefined,
      "Expected llm payload",
      secondaryLLMCtx,
    );

    const patchCtx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession/${browserSession.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          llmId: secondaryLLMCtx.body!.data!.llm.id,
          actLlmId: null,
          observeLlmId: secondaryLLMCtx.body!.data!.llm.id,
          selfHeal: true,
        }),
      },
    );

    assertFetchStatus(patchCtx, HTTP_OK);
    assertFetchOk(patchCtx.body !== null, "Expected JSON response", patchCtx);
    assert.equal(
      patchCtx.body.data?.browserSession.llmId,
      secondaryLLMCtx.body!.data!.llm.id,
    );
    assert.equal(patchCtx.body.data?.browserSession.actLlmId, null);
    assert.equal(
      patchCtx.body.data?.browserSession.observeLlmId,
      secondaryLLMCtx.body!.data!.llm.id,
    );
    assert.equal(patchCtx.body.data?.browserSession.selfHeal, true);

    const endCtx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession/${browserSession.id}/end`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      },
    );

    assertFetchStatus(endCtx, HTTP_OK);
    assertFetchOk(
      endCtx.body !== null,
      "Expected a JSON response body",
      endCtx,
    );
    assert.equal(endCtx.body.data?.browserSession.id, browserSession.id);
    assert.equal(endCtx.body.data?.browserSession.status, "ended");
    assert.equal(endCtx.body.data?.browserSession.available, false);
    assert.equal(
      endCtx.body.data?.browserSession.llmId,
      secondaryLLMCtx.body!.data!.llm.id,
    );

    const missingCtx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession/${browserSession.id}`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(missingCtx, HTTP_NOT_FOUND);
    assertFetchOk(
      missingCtx.body !== null,
      "Expected a JSON response body",
      missingCtx,
    );
    assert.equal(missingCtx.body.success, false);
  });

  it("POST /v4/browsersession creates and attaches a default llm when llmId is omitted", async () => {
    const ctx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...LOCAL_BROWSER_BODY,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assertFetchOk(
      ctx.body.data?.browserSession !== undefined,
      "Expected a browserSession payload",
      ctx,
    );
    assert.ok(ctx.body.data!.browserSession.llmId.length > 0);
    assert.equal(ctx.body.data!.browserSession.actLlmId, null);
    assert.equal(ctx.body.data!.browserSession.observeLlmId, null);
    assert.equal(ctx.body.data!.browserSession.extractLlmId, null);

    const llmCtx = await fetchWithContext<LLMResponse>(
      `${getBaseUrl()}/v4/llms/${ctx.body.data!.browserSession.llmId}`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(llmCtx, HTTP_OK);
    assert.equal(llmCtx.body.data?.llm.source, "system-default");
  });

  it("POST /v4/browsersession rejects LOCAL requests without cdpUrl or localBrowserLaunchOptions", async () => {
    const ctx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          env: "LOCAL",
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.ok(ctx.body.error ?? ctx.body.message);
  });
});
