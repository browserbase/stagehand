import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  fetchWithContext,
  getBaseUrl,
  HTTP_BAD_REQUEST,
} from "../utils.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

interface V4ErrorEnvelope {
  id: string;
  error: {
    code: string;
    message: string;
  };
  result: null;
  metadata: {
    requestId: string;
    sessionId?: string;
    pageId?: string;
    actionId?: string;
    timestamp: string;
  };
}

describe("v4 page route stubs", () => {
  it("POST /v4/page/click validates and returns a stub error envelope", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/click`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-click",
          sessionId: "session-123",
          params: {
            pageId: "page-123",
            selector: {
              xpath: "//button[text()='Submit']",
            },
          },
        }),
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.id, "req-click");
    assert.equal(ctx.body.error.code, "not_implemented");
    assert.equal(ctx.body.metadata.sessionId, "session-123");
    assert.equal(ctx.body.metadata.pageId, "page-123");
  });

  it("POST /v4/page/click rejects a missing selector", async () => {
    const ctx = await fetchWithContext<Record<string, unknown>>(
      `${getBaseUrl()}/v4/page/click`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-click-invalid",
          sessionId: "session-123",
          params: {},
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
  });

  it("POST /v4/page/scroll accepts the selector variant", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/scroll`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-scroll-selector",
          sessionId: "session-123",
          params: {
            target: "selector",
            selector: {
              xpath: "//div[@data-testid='results']",
            },
            percentage: 80,
          },
        }),
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.id, "req-scroll-selector");
  });

  it("POST /v4/page/scroll accepts the coordinate variant", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/scroll`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-scroll-coordinates",
          sessionId: "session-123",
          params: {
            target: "coordinates",
            x: 120,
            y: 240,
            deltaY: 600,
          },
        }),
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.id, "req-scroll-coordinates");
  });

  it("POST /v4/page/scroll rejects invalid selector payloads", async () => {
    const ctx = await fetchWithContext<Record<string, unknown>>(
      `${getBaseUrl()}/v4/page/scroll`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-scroll-invalid",
          sessionId: "session-123",
          params: {
            target: "selector",
            percentage: 80,
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
  });

  it("POST /v4/page/navigate validates and returns a stub error envelope", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/navigate`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-navigate",
          sessionId: "session-123",
          params: {
            pageId: "page-123",
            url: "https://example.com",
            waitUntil: "domcontentloaded",
          },
        }),
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.metadata.pageId, "page-123");
  });

  it("POST /v4/page/screenshot validates and returns a stub error envelope", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/screenshot`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: "req-screenshot",
          sessionId: "session-123",
          params: {
            pageId: "page-123",
            type: "jpeg",
            quality: 80,
            fullPage: true,
          },
        }),
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.metadata.pageId, "page-123");
  });

  it("GET /v4/page/action validates query and path params", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/action/action-123?id=req-details&sessionId=session-123`,
      {
        method: "GET",
        headers: JSON_HEADERS,
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.metadata.actionId, "action-123");
  });

  it("GET /v4/page/action requires sessionId", async () => {
    const ctx = await fetchWithContext<Record<string, unknown>>(
      `${getBaseUrl()}/v4/page/action`,
      {
        method: "GET",
        headers: JSON_HEADERS,
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
  });

  it("GET /v4/page/action returns a stub error envelope when query is valid", async () => {
    const ctx = await fetchWithContext<V4ErrorEnvelope>(
      `${getBaseUrl()}/v4/page/action?id=req-list&sessionId=session-123&pageId=page-123&type=click&status=queued&limit=25`,
      {
        method: "GET",
        headers: JSON_HEADERS,
      },
    );

    assertFetchStatus(ctx, 501);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.id, "req-list");
    assert.equal(ctx.body.metadata.pageId, "page-123");
  });
});
