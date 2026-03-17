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
  env: "LOCAL" | "BROWSERBASE";
  status: "running" | "ended";
  modelName: string;
  cdpUrl: string;
  available: boolean;
}

interface BrowserSessionResponse {
  success: boolean;
  message?: string;
  data?: {
    browserSession: BrowserSessionRecord;
  };
}

const headers = getHeaders("4.0.0");

describe("v4 browsersession routes", { concurrency: false }, () => {
  it("POST /v4/browsersession creates a local browser session and GET/POST end work", async () => {
    const createCtx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
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
    assert.equal(browserSession.modelName, "gpt-4.1-nano");
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

  it("POST /v4/browsersession rejects LOCAL requests without cdpUrl or localBrowserLaunchOptions", async () => {
    const ctx = await fetchWithContext<BrowserSessionResponse>(
      `${getBaseUrl()}/v4/browsersession`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          env: "LOCAL",
          modelName: "gpt-4.1-nano",
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.ok(ctx.body.message);
  });
});
