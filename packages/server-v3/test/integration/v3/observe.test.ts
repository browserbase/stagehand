import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  assertEventExists,
  assertFetchOk,
  assertFetchStatus,
  assertWithContext,
  createSessionWithCdp,
  endSession,
  fetchWithContext,
  GEMINI_API_KEY,
  getBaseUrl,
  getHeaders,
  getMainFrameId,
  HTTP_OK,
  navigateSession,
  readTypedSSEStreamWithContext,
  requireEnv,
} from "../utils.js";

/** Result type for observe SSE events */
type ObserveResult = unknown[];

// Shared session for all observe tests (observe is read-only, safe to share)
let sessionId: string;
let cdpUrl: string;

before(async () => {
  ({ sessionId, cdpUrl } = await createSessionWithCdp(getHeaders("3.0.0")));
  // Navigate to a page first
  const navResponse = await navigateSession(
    sessionId,
    "https://example.com",
    getHeaders("3.0.0"),
  );
  assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
});

after(async () => {
  await endSession(sessionId, getHeaders("3.0.0"));
});

// =============================================================================
// POST /v1/sessions/:id/observe - V3 Format Tests
// =============================================================================

describe("POST /v1/sessions/:id/observe (V3)", () => {
  it("should observe elements with instruction", async () => {
    const url = getBaseUrl();
    const frameId = await getMainFrameId(cdpUrl);

    interface ObserveResponse {
      success: boolean;
      data?: { result: unknown[]; actionId?: string };
    }

    const ctx = await fetchWithContext<ObserveResponse>(
      `${url}/v1/sessions/${sessionId}/observe`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "Find any link on the page",
          frameId,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Observe should succeed");
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(ctx.body.data.result),
      "Result should be an array of observed elements",
      ctx,
    );
  });

  it("should observe with instruction and options", async () => {
    const url = getBaseUrl();

    interface ObserveResponse {
      success: boolean;
      data?: { result: unknown[]; actionId?: string };
    }

    const ctx = await fetchWithContext<ObserveResponse>(
      `${url}/v1/sessions/${sessionId}/observe`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "Find any link on the page",
          options: {
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Observe with options should succeed");
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(ctx.body.data.result),
      "Result should be an array of observed elements",
      ctx,
    );
  });

  it("should observe with selector option", async () => {
    const url = getBaseUrl();

    interface ObserveResponse {
      success: boolean;
      data?: { result: unknown[]; actionId?: string };
    }

    const ctx = await fetchWithContext<ObserveResponse>(
      `${url}/v1/sessions/${sessionId}/observe`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "Find any link on the page",
          options: {
            selector: "a",
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Observe with selector should succeed");
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(ctx.body.data.result),
      "Result should be an array of observed elements",
      ctx,
    );
  });

  it("should observe without instruction (observe all)", async () => {
    const url = getBaseUrl();

    interface ObserveResponse {
      success: boolean;
      data?: { result: unknown[]; actionId?: string };
    }

    const ctx = await fetchWithContext<ObserveResponse>(
      `${url}/v1/sessions/${sessionId}/observe`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          options: {
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "Observe without instruction should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(ctx.body.data.result),
      "Result should be an array of observed elements",
      ctx,
    );
  });

  it("should observe with google/gemini-2.5-flash-lite model", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    interface ObserveResponse {
      success: boolean;
      data?: { result: unknown[]; actionId?: string };
    }

    const ctx = await fetchWithContext<ObserveResponse>(
      `${url}/v1/sessions/${sessionId}/observe`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
          "x-model-api-key": "", // Clear the header to ensure body config is used
        },
        body: JSON.stringify({
          instruction: "Find any link on the page",
          options: {
            model: {
              modelName: "google/gemini-2.5-flash-lite",
              apiKey: geminiApiKey,
            },
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "Observe with google/gemini-2.5-flash-lite model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(ctx.body.data.result),
      "Result should be an array of observed elements",
      ctx,
    );
  });
});

// =============================================================================
// SSE Streaming Tests - V3
// =============================================================================

describe("POST /v1/sessions/:id/observe with SSE streaming (V3)", () => {
  it("should stream valid SSE events with correct structure", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/observe`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "Find any link on the page",
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ObserveResult>(response);
    const { events } = ctx;

    assertWithContext(
      events.length >= 2,
      "Should have at least starting and finished events",
      ctx,
    );

    // Verify starting event
    const startingEvent = assertEventExists(events, "starting", ctx);
    assertWithContext(
      startingEvent.type === "system",
      "Starting event should be system type",
      ctx,
    );

    // Verify finished event with result
    const finishedEvent = assertEventExists(events, "finished", ctx);
    assertWithContext(
      finishedEvent.type === "system",
      "Finished event should be system type",
      ctx,
    );
    assertWithContext(
      !!finishedEvent.data.result,
      "Finished event must have result",
      ctx,
    );
    assertWithContext(
      Array.isArray(finishedEvent.data.result),
      "Result must be an array of observed elements",
      ctx,
    );
  });

  it("should have correct event sequence: starting -> connected -> finished", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/observe`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "Find any link on the page",
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ObserveResult>(response);
    const { events } = ctx;

    assertEventExists(events, "starting", ctx);
    assertEventExists(events, "connected", ctx);
    assertEventExists(events, "finished", ctx);

    const startingIndex = events.findIndex((e) => e.data.status === "starting");
    const connectedIndex = events.findIndex(
      (e) => e.data.status === "connected",
    );
    const finishedIndex = events.findIndex((e) => e.data.status === "finished");

    assertWithContext(
      startingIndex < connectedIndex,
      "Starting event must come before connected event",
      ctx,
    );
    assertWithContext(
      connectedIndex < finishedIndex,
      "Connected event must come before finished event",
      ctx,
    );
  });

  it("should have valid UUID for each event id", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/observe`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "Find any link on the page",
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ObserveResult>(response);
    const { events } = ctx;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const event of events) {
      assertWithContext(
        uuidRegex.test(event.id),
        `Event id should be a valid UUID format, got: ${event.id}`,
        ctx,
      );
    }
  });

  it("should return observed elements with expected properties", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/observe`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "Find any link on the page",
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ObserveResult>(response);
    const { events } = ctx;

    const finishedEvent = assertEventExists(events, "finished", ctx);
    assertWithContext(!!finishedEvent.data.result, "Should have result", ctx);
    assertWithContext(
      Array.isArray(finishedEvent.data.result),
      "Result should be an array",
      ctx,
    );

    // If there are observed elements, verify they have expected structure
    if (finishedEvent.data.result.length > 0) {
      const firstElement = finishedEvent.data.result[0] as Record<
        string,
        unknown
      >;
      assertWithContext(
        typeof firstElement === "object",
        "Each observed element should be an object",
        ctx,
      );
      // Observed elements typically have selector and description
      assertWithContext(
        "selector" in firstElement || "description" in firstElement,
        "Observed element should have selector or description",
        ctx,
      );
    }
  });
});
