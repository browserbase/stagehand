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

/** Result type for extract SSE events */
type ExtractResult = Record<string, unknown>;

// Shared session for all extract tests (extract is read-only, safe to share)
let sessionId: string;
let cdpUrl: string;

before(async () => {
  ({ sessionId, cdpUrl } = await createSessionWithCdp(getHeaders("3.0.0")));
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
// POST /v1/sessions/:id/extract - V3 Format Tests
// =============================================================================

describe("POST /v1/sessions/:id/extract (V3)", () => {
  it("should extract data with instruction and schema", async () => {
    const url = getBaseUrl();
    const frameId = await getMainFrameId(cdpUrl);

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the page title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
            required: ["title"],
          },
          frameId,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
    assertFetchOk(
      "title" in ctx.body.data.result,
      "Result should have title property",
      ctx,
    );
  });

  it("should extract with instruction and options", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the page title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
          },
          options: {
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract with options should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with CSS selector in options", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the link information",
          schema: {
            type: "object",
            properties: {
              href: { type: "string" },
              text: { type: "string" },
            },
          },
          options: {
            selector: "a", // CSS selector
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract with CSS selector should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with XPath selector in options", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the link information",
          schema: {
            type: "object",
            properties: {
              href: { type: "string" },
              text: { type: "string" },
            },
          },
          options: {
            selector: "//a", // XPath selector
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "Extract with XPath selector should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with instruction only (no schema)", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the main content from the page",
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract without schema should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract without instruction (extract all)", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
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
      "Extract without instruction should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with google/gemini-2.5-flash-lite model", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the page title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
            required: ["title"],
          },
          options: {
            model: {
              modelName: "google/gemini-2.5-flash-lite",
              apiKey: geminiApiKey,
            },
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract with Gemini model should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
    assertFetchOk(
      "title" in ctx.body.data.result,
      "Result should have title property",
      ctx,
    );
  });
});

// =============================================================================
// SSE Streaming Tests - V3
// =============================================================================

describe("POST /v1/sessions/:id/extract with SSE streaming (V3)", () => {
  it("should stream valid SSE events with correct structure", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
    const { events } = ctx;

    assertWithContext(
      events.length >= 2,
      "Should have at least starting and finished events",
      ctx,
    );

    // Verify starting event
    const startingEvent = assertEventExists(events, "starting", ctx);
    assert.equal(
      startingEvent.type,
      "system",
      "Starting event should be system type",
    );

    // Verify finished event with result
    const finishedEvent = assertEventExists(events, "finished", ctx);
    assert.equal(
      finishedEvent.type,
      "system",
      "Finished event should be system type",
    );
    assertWithContext(
      !!finishedEvent.data.result,
      "Finished event must have result",
      ctx,
    );
    assert.equal(
      typeof finishedEvent.data.result,
      "object",
      "Result must be an object",
    );
    assertWithContext(
      "title" in finishedEvent.data.result,
      "Result should have title property",
      ctx,
    );
  });

  it("should have correct event sequence: starting -> connected -> finished", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
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

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
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

  it("should extract data matching the provided schema", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
    const { events } = ctx;

    const finishedEvent = assertEventExists(events, "finished", ctx);
    assertWithContext(!!finishedEvent.data.result, "Should have result", ctx);

    // Verify the extracted data has the expected shape
    assert.equal(
      typeof finishedEvent.data.result.title,
      "string",
      "Extracted title should be a string",
    );
  });
});
