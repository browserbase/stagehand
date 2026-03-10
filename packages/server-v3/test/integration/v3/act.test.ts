import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { chromium } from "playwright";

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
  OPENAI_API_KEY,
  readTypedSSEStreamWithContext,
  requireEnv,
} from "../utils.js";

interface ActResponse {
  success: boolean;
  data?: {
    result: { success: boolean; message?: string };
    actionId?: string;
  };
}

/** Result type for act SSE events */
interface ActResult {
  success: boolean;
  message?: string;
  action?: string;
}

// Module-level session variable shared across all describe blocks
let sessionId: string;
let cdpUrl: string;

// Single session creation for all tests
before(async () => {
  ({ sessionId, cdpUrl } = await createSessionWithCdp(getHeaders("3.0.0")));
});

// Navigate back to example.com before each test since act() may navigate away
beforeEach(async () => {
  const navResponse = await navigateSession(
    sessionId,
    "https://example.com",
    getHeaders("3.0.0"),
  );
  assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
});

// Single session cleanup after all tests
after(async () => {
  await endSession(sessionId, getHeaders("3.0.0"));
});

// =============================================================================
// POST /v1/sessions/:id/act (V3 Format)
// =============================================================================

describe("POST /v1/sessions/:id/act (V3)", () => {
  // ===========================================================================
  // V3 Format Tests
  // ===========================================================================

  it("should perform an action using string input format", async () => {
    const url = getBaseUrl();
    const frameId = await getMainFrameId(cdpUrl);

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
        },
        body: JSON.stringify({
          input: "click the Learn more link",
          frameId,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "act should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );

    // Verify navigation via CDP
    const browser = await chromium.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    assert.ok(contexts.length > 0, "Should have at least one browser context");
    const pages = contexts[0]!.pages();
    assert.ok(pages.length > 0, "Should have at least one page");
    const pageUrl = pages[0]!.url();
    assert.ok(
      pageUrl.includes("iana.org/help/example-domains"),
      `Page URL should be iana.org/help/example-domains, got: ${pageUrl}`,
    );
    await browser.close();
  });

  it("should perform an action using object input format", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
        },
        body: JSON.stringify({
          input: {
            selector: "a",
            description: "Click a link on the page",
            method: "click",
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "act with object input should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );
  });

  it("should accept options with string input", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
        },
        body: JSON.stringify({
          input: "click the Learn more link",
          options: {
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "act with options should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );
  });

  // ===========================================================================
  // V3 Inline Model Configuration Tests
  // ===========================================================================

  it("should perform action with inline model config (modelName + apiKey)", async () => {
    const url = getBaseUrl();
    const openaiApiKey = requireEnv("OPENAI_API_KEY", OPENAI_API_KEY);

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
          "x-model-api-key": "", // Clear the header to ensure body config is used
        },
        body: JSON.stringify({
          input: "click the Learn more link",
          options: {
            model: {
              modelName: "openai/gpt-4.1-nano",
              apiKey: openaiApiKey,
            },
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "act with inline model config should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );
  });

  it("should perform action with inline model config and options", async () => {
    const url = getBaseUrl();
    const openaiApiKey = requireEnv("OPENAI_API_KEY", OPENAI_API_KEY);

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
          "x-model-api-key": "", // Clear the header to ensure body config is used
        },
        body: JSON.stringify({
          input: "click the Learn more link",
          options: {
            model: {
              modelName: "openai/gpt-4.1-nano",
              apiKey: openaiApiKey,
            },
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "act with inline model config and options should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );
  });

  it("should perform action with object input and inline model config", async () => {
    const url = getBaseUrl();
    const openaiApiKey = requireEnv("OPENAI_API_KEY", OPENAI_API_KEY);

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
          "x-model-api-key": "", // Clear the header to ensure body config is used
        },
        body: JSON.stringify({
          input: {
            selector: "a",
            description: "Click a link on the page",
            method: "click",
          },
          options: {
            model: {
              modelName: "openai/gpt-4.1-nano",
              apiKey: openaiApiKey,
            },
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "act with object input and inline model config should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );
  });

  it("should perform action with google/gemini-2.5-flash-lite model", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<ActResponse>(
      `${url}/v1/sessions/${sessionId}/act`,
      {
        method: "POST",
        headers: {
          ...getHeaders("3.0.0"),
          "x-model-api-key": "", // Clear the header to ensure body config is used
        },
        body: JSON.stringify({
          input: "click the Learn more link",
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
      "act with google/gemini-2.5-flash-lite model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result.success,
      "boolean",
      "Result should have success boolean",
    );
  });
});

// =============================================================================
// SSE Streaming Tests (V3)
// =============================================================================

describe("POST /v1/sessions/:id/act with SSE streaming (V3)", () => {
  it("should stream valid SSE events with correct structure", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/act`, {
      method: "POST",
      headers: {
        ...getHeaders("3.0.0"),
      },
      body: JSON.stringify({
        input: "click the Learn more link",
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ActResult>(response);
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
      typeof finishedEvent.data.result.success,
      "boolean",
      "Result.success must be a boolean",
    );
  });

  it("should stream SSE events with inline model config", async () => {
    const url = getBaseUrl();
    const openaiApiKey = requireEnv("OPENAI_API_KEY", OPENAI_API_KEY);

    const response = await fetch(`${url}/v1/sessions/${sessionId}/act`, {
      method: "POST",
      headers: {
        ...getHeaders("3.0.0"),
        "x-model-api-key": "", // Clear the header to ensure body config is used
      },
      body: JSON.stringify({
        input: "click the Learn more link",
        options: {
          model: {
            modelName: "openai/gpt-4.1-nano",
            apiKey: openaiApiKey,
          },
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ActResult>(response);
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
      typeof finishedEvent.data.result.success,
      "boolean",
      "Result.success must be a boolean",
    );
  });
});
