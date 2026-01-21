import { after, before, describe, it } from "node:test";

import assert from "node:assert/strict";

import {
  assertFetchOk,
  assertFetchStatus,
  createSession,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
} from "../utils.js";

// =============================================================================
// POST /v1/sessions/:id/end (V3 Format)
// =============================================================================

describe("POST /v1/sessions/:id/end (V3)", () => {
  const headers = getHeaders("3.0.0");
  let sessionId: string;

  before(async () => {
    sessionId = await createSession(headers);
  });

  after(async () => {
    // Try to clean up in case test didn't end the session
    try {
      await endSession(sessionId, headers);
    } catch {
      // Ignore - session may already be ended
    }
  });

  it("should return 200 if JSON content-type has an empty body", async () => {
    const url = getBaseUrl();
    // Create a fresh session for this test since we need to test error cases
    const testSessionId = await createSession(headers);

    const response = await fetch(`${url}/v1/sessions/${testSessionId}/end`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: "",
    });

    // Empty body should be accepted
    assertFetchStatus(
      {
        status: response.status,
        statusText: response.statusText,
        body: null,
        raw: "",
        durationMs: 0,
        headers: response.headers,
        debugSummary: () => `HTTP ${response.status}`,
      },
      HTTP_OK,
      "Should return 200 for empty body with JSON content-type",
    );

    // Clean up
    await endSession(testSessionId, headers);
  });

  it("should return 400 if body contains extra keys", async () => {
    const url = getBaseUrl();
    const testSessionId = await createSession(headers);

    const ctx = await fetchWithContext<{ success?: boolean; message?: string }>(
      `${url}/v1/sessions/${testSessionId}/end`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ unexpected: true }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_BAD_REQUEST,
      "Should return 400 for extra keys",
    );

    // Clean up
    await endSession(testSessionId, headers);
  });

  it("should return 200 when body is {}", async () => {
    const url = getBaseUrl();
    const testSessionId = await createSession(headers);

    const ctx = await fetchWithContext<{ success: boolean }>(
      `${url}/v1/sessions/${testSessionId}/end`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Should return 200 for empty object body");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(ctx.body.success === true, "Should indicate success", ctx);
  });

  it("should return 200 when body is 0 bytes (no body)", async () => {
    const url = getBaseUrl();
    const testSessionId = await createSession(headers);

    // Send request with no body at all
    const response = await fetch(`${url}/v1/sessions/${testSessionId}/end`, {
      method: "POST",
      headers: {
        ...headers,
        // Don't set Content-Type to application/json when there's no body
      },
    });

    // Should succeed with 200 for no body
    assert.equal(
      response.status,
      HTTP_OK,
      `Should return 200 for 0-byte body, got ${response.status}`,
    );

    const body = await response.json();
    assert.equal(body.success, true, "Should indicate success");
  });

  it("should end session successfully", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{ success: boolean }>(
      `${url}/v1/sessions/${sessionId}/end`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "End session should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(ctx.body.success === true, "Should indicate success", ctx);
  });

  it("should return error for non-existent session", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{ success?: boolean; message?: string }>(
      `${url}/v1/sessions/non-existent-session-id/end`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      },
    );

    // Server returns 404 or 500 for non-existent sessions
    assert.ok(
      [HTTP_NOT_FOUND, HTTP_INTERNAL_SERVER_ERROR].includes(ctx.status),
      `Expected 404 or 500, got ${ctx.status}`,
    );
  });
});
