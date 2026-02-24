import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  createSession,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_OK,
  navigateSession,
} from "./utils.js";

// Shared read-only session — extract is safe to re-use across tests.
let sessionId: string;

before(async () => {
  sessionId = await createSession(getHeaders("3.0.0"));
  const nav = await navigateSession(
    sessionId,
    "https://example.com",
    getHeaders("3.0.0"),
  );
  assert.equal(nav.status, HTTP_OK, "Navigate should succeed");
});

after(async () => {
  await endSession(sessionId, getHeaders("3.0.0"));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractUrl() {
  return `${getBaseUrl()}/v1/sessions/${sessionId}/extract`;
}

function extractBody(instruction = "extract the page title") {
  return JSON.stringify({ instruction });
}

// ---------------------------------------------------------------------------
// browserbase-cache-bypass request header
// ---------------------------------------------------------------------------

describe("browserbase-cache-bypass request header", () => {
  it("request with bypass header does not return cache HIT", async () => {
    const ctx = await fetchWithContext(extractUrl(), {
      method: "POST",
      headers: {
        ...getHeaders("3.0.0"),
        "browserbase-cache-bypass": "true",
      },
      body: extractBody(),
    });

    assertFetchStatus(ctx, HTTP_OK, "Extract with bypass should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);

    const cacheStatus = ctx.headers.get("browserbase-cache-status");
    assert.notEqual(
      cacheStatus,
      "HIT",
      "A bypassed request must not return a cache HIT",
    );
  });
});

// ---------------------------------------------------------------------------
// browserbase-cache-status response header
// ---------------------------------------------------------------------------

describe("browserbase-cache-status response header", () => {
  it("returns HIT or MISS when the header is present", async () => {
    const ctx = await fetchWithContext(extractUrl(), {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: extractBody(),
    });

    assertFetchStatus(ctx, HTTP_OK, "Extract should succeed");

    const cacheStatus = ctx.headers.get("browserbase-cache-status");
    if (cacheStatus !== null) {
      assert.ok(
        cacheStatus === "HIT" || cacheStatus === "MISS",
        `browserbase-cache-status must be HIT or MISS, got: ${cacheStatus}`,
      );
    }
  });

  it("returns HIT on a repeated identical request when caching is active", async () => {
    const body = extractBody("count the number of links");

    // First call — warms the cache.
    const first = await fetchWithContext(extractUrl(), {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body,
    });
    assertFetchStatus(first, HTTP_OK, "First extract should succeed");

    // Second call — should be a HIT if server-side caching is enabled.
    const second = await fetchWithContext(extractUrl(), {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body,
    });
    assertFetchStatus(second, HTTP_OK, "Second extract should succeed");

    const cacheStatus = second.headers.get("browserbase-cache-status");
    if (cacheStatus !== null) {
      assert.equal(
        cacheStatus,
        "HIT",
        "Repeated identical request should be a cache HIT",
      );
    }
  });
});
