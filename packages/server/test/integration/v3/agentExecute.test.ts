import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  assertWithContext,
  createSession,
  createSessionWithCdp,
  endSession,
  fetchWithContext,
  GEMINI_API_KEY,
  getBaseUrl,
  getHeaders,
  getMainFrameId,
  HTTP_BAD_REQUEST,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
  navigateSession,
  OPENAI_API_KEY,
  readTypedSSEStreamWithContext,
  requireEnv,
} from "../utils.js";

// =============================================================================
// POST /v1/sessions/:id/agentExecute (V3 Format)
// =============================================================================

describe("POST /v1/sessions/:id/agentExecute (V3) - Basic Config", () => {
  let sessionId: string;
  let cdpUrl: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    ({ sessionId, cdpUrl } = await createSessionWithCdp(headers));
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should execute agent with basic config (empty agentConfig)", async () => {
    const url = getBaseUrl();
    const frameId = await getMainFrameId(cdpUrl);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {},
        executeOptions: {
          instruction: "Describe the main heading on this page",
          frameId,
        },
      }),
    });

    assertFetchStatus(ctx, HTTP_OK, "V3 agent execute should succeed");
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with string agentConfig.model", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: "gpt-4.1-nano",
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with string model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with object model config (provider + modelName)", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: {
            provider: "openai",
            modelName: "gpt-4.1-nano",
          },
        },
        executeOptions: {
          instruction: "Describe the page content",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with object model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with systemPrompt and maxSteps", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          systemPrompt: "You are a helpful web browsing assistant.",
        },
        executeOptions: {
          instruction: "Find and describe the main content",
          maxSteps: 3,
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with systemPrompt and maxSteps should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });
});

// ===========================================================================
// V3 Format Tests with model: {modelName, apiKey} format - Google Gemini
// ===========================================================================

describe("POST /v1/sessions/:id/agentExecute (V3) - Google Gemini with API key", () => {
  let sessionId: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    sessionId = await createSession(headers);
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should execute agent with Google model object containing modelName and apiKey", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
            apiKey: geminiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with Google model object should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with Google model object, systemPrompt, and maxSteps", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
            apiKey: geminiApiKey,
          },
          systemPrompt: "You are a helpful web browsing assistant.",
        },
        executeOptions: {
          instruction: "Find and read the main heading",
          maxSteps: 3,
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with Google model, systemPrompt and maxSteps should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });
});

// ===========================================================================
// V3 Format Tests with OpenAI model: {modelName, apiKey} format
// ===========================================================================

describe("POST /v1/sessions/:id/agentExecute (V3) - OpenAI with API key", () => {
  let sessionId: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    sessionId = await createSession(headers);
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should execute agent with OpenAI model object containing modelName and apiKey", async () => {
    const url = getBaseUrl();
    const openaiApiKey = requireEnv("OPENAI_API_KEY", OPENAI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: {
            modelName: "openai/gpt-4.1-nano",
            apiKey: openaiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with OpenAI model object should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });
});

// ===========================================================================
// V3 CUA Mode Tests - Testing explicit cua flag with model compatibility
// ===========================================================================

describe("POST /v1/sessions/:id/agentExecute (V3) - CUA flag compatibility", () => {
  let sessionId: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    sessionId = await createSession(headers);
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should execute agent with cua: true and CUA model (valid combination)", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          cua: true,
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
            apiKey: geminiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with cua: true and CUA model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with cua: false and non-CUA model (valid combination)", async () => {
    const url = getBaseUrl();
    const openaiApiKey = requireEnv("OPENAI_API_KEY", OPENAI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          cua: false,
          model: {
            modelName: "openai/gpt-4.1-nano",
            apiKey: openaiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with cua: false and non-CUA model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with cua: false and CUA model (works in non-CUA mode)", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      message?: string;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          cua: false,
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
            apiKey: geminiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with cua: false and Google CUA model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should fail with cua: true and non-CUA model (invalid combination)", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      message?: string;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          cua: true,
          model: {
            modelName: "google/gemini-2.5-flash-lite",
            apiKey: geminiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_UNPROCESSABLE_ENTITY,
      "V3 agent execute with cua: true and non-CUA model should fail",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(!ctx.body.success, "Response should indicate failure", ctx);
  });
});

// =============================================================================
// V3 Mode Tests - Testing agentConfig.mode field (dom, hybrid, cua)
// =============================================================================

describe("POST /v1/sessions/:id/agentExecute - agentConfig.mode (V3)", () => {
  let sessionId: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    sessionId = await createSession(headers);
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should execute agent with mode: dom", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          mode: "dom",
        },
        executeOptions: {
          instruction: "What is the title of this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with mode: dom should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with mode: hybrid", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          mode: "hybrid",
          model: {
            provider: "google", // bonus: test split provider/modelName format
            modelName: "gemini-2.5-flash-preview-04-17",
            apiKey: geminiApiKey,
          },
        },
        executeOptions: {
          instruction: "Describe the main heading on this page",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with mode: hybrid should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });

  it("should execute agent with mode: cua and CUA model", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          mode: "cua",
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
            apiKey: geminiApiKey,
          },
        },
        executeOptions: {
          instruction: "What is visible on this page?",
        },
      }),
    });

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "V3 agent execute with mode: cua and CUA model should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response body should be parseable", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.result !== undefined,
      "Response should have result",
      ctx,
    );
  });
});

// =============================================================================
// SSE Streaming Tests (V3)
// =============================================================================

describe("POST /v1/sessions/:id/agentExecute with SSE streaming (V3)", () => {
  let sessionId: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    sessionId = await createSession(headers);
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should stream SSE events with valid structure, sequence, and UUIDs", async () => {
    const url = getBaseUrl();

    const response = await fetch(
      `${url}/v1/sessions/${sessionId}/agentExecute`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentConfig: {},
          executeOptions: {
            instruction: "Describe the main content on the page",
          },
          streamResponse: true,
        }),
      },
    );

    const ctx = await readTypedSSEStreamWithContext(response);

    // Verify event count
    assertWithContext(
      ctx.events.length >= 2,
      "Should have at least starting and finished events",
      ctx,
    );

    // Verify event sequence
    const startingIndex = ctx.events.findIndex(
      (e) => e.data.status === "starting",
    );
    const connectedIndex = ctx.events.findIndex(
      (e) => e.data.status === "connected",
    );
    const finishedIndex = ctx.events.findIndex(
      (e) => e.data.status === "finished",
    );

    assertWithContext(
      startingIndex !== -1,
      "Should have a starting event",
      ctx,
    );
    assertWithContext(
      connectedIndex !== -1,
      "Should have a connected event",
      ctx,
    );
    assertWithContext(
      finishedIndex !== -1,
      "Should have a finished event",
      ctx,
    );
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

    // Verify event types
    const startingEvent = ctx.events[startingIndex];
    const finishedEvent = ctx.events[finishedIndex];

    assertWithContext(
      startingEvent !== undefined,
      "Starting event should exist",
      ctx,
    );
    assertWithContext(
      finishedEvent !== undefined,
      "Finished event should exist",
      ctx,
    );
    assertWithContext(
      startingEvent.type === "system",
      "Starting event should be system type",
      ctx,
    );
    assertWithContext(
      finishedEvent.type === "system",
      "Finished event should be system type",
      ctx,
    );
    assertWithContext(
      finishedEvent.data.result !== undefined,
      "Finished event must have result",
      ctx,
    );

    // Verify UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const event of ctx.events) {
      assertWithContext(
        uuidRegex.test(event.id),
        `Event id should be a valid UUID format, got: ${event.id}`,
        ctx,
      );
    }
  });
});

// =============================================================================
// Validation Error Tests (V3)
// =============================================================================

describe("POST /v1/sessions/:id/agentExecute - validation errors (V3)", () => {
  let sessionId: string;
  const headers = getHeaders("3.0.0");

  before(async () => {
    sessionId = await createSession(headers);
  });

  beforeEach(async () => {
    // Navigate to example.com before each test (including first)
    const navResponse = await navigateSession(
      sessionId,
      "https://example.com",
      headers,
    );
    assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
  });

  after(async () => {
    if (sessionId) {
      await endSession(sessionId, headers);
      sessionId = "";
    }
  });

  it("should return 400 when agentConfig is missing", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success?: boolean;
      error?: string;
      message?: string;
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        executeOptions: {
          instruction: "Do something",
        },
      }),
    });

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(
      !ctx.body?.success || ctx.body.error !== undefined,
      "Response should indicate failure",
      ctx,
    );
  });

  it("should return 400 when executeOptions is missing", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success?: boolean;
      error?: string;
      message?: string;
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
          },
        },
      }),
    });

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(
      !ctx.body?.success || ctx.body.error !== undefined,
      "Response should indicate failure",
      ctx,
    );
  });

  it("should return 400 when instruction is missing", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success?: boolean;
      error?: string;
      message?: string;
    }>(`${url}/v1/sessions/${sessionId}/agentExecute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentConfig: {
          model: {
            modelName: "google/gemini-2.5-computer-use-preview-10-2025",
          },
        },
        executeOptions: {
          maxSteps: 5,
        },
      }),
    });

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(
      !ctx.body?.success || ctx.body.error !== undefined,
      "Response should indicate failure",
      ctx,
    );
  });
});
