import { describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_BAD_REQUEST,
  HTTP_OK,
} from "../utils.js";
import type { BrowserbaseRegion } from "@browserbasehq/stagehand";

// =============================================================================
// Response Type Definitions
// =============================================================================

interface StartSuccessResponse {
  success: true;
  data: {
    sessionId: string;
    cdpUrl: string;
    available: boolean;
  };
}

interface StartUnavailableResponse {
  success: true;
  data: {
    sessionId: null;
    available: false;
  };
}

interface StartErrorResponse {
  success: false;
  message: string;
}

type StartResponse =
  | StartSuccessResponse
  | StartUnavailableResponse
  | StartErrorResponse;

function isSuccessResponse(
  response: StartResponse,
): response is StartSuccessResponse {
  return response.success && response.data.sessionId !== null;
}

// =============================================================================
// V3 Format Tests (x-sdk-version: 3.x.x header)
// =============================================================================

describe("POST /v1/sessions/start - V3 format", () => {
  const headers = getHeaders("3.0.0");
  const localBrowser = {
    browser: {
      type: "local",
      launchOptions: {
        headless: true,
      },
    },
  };

  it("should start session with modelName string and V3 header", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ modelName: "gpt-4.1-nano", ...localBrowser }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(ctx.body.data.available, "Session should be available", ctx);
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    assertFetchOk(!!ctx.body.data.cdpUrl, "Should have cdpUrl", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should start session with experimental flag", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          experimental: true,
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should accept x-language header for python V3", async () => {
    const url = getBaseUrl();
    const pythonHeaders = getHeaders("1.0.0", "python");

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers: pythonHeaders,
        body: JSON.stringify({ modelName: "gpt-4.1-nano", ...localBrowser }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, pythonHeaders);
  });

  it("should start session with extended options (timeouts, verbose)", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          actTimeoutMs: 30000,
          domSettleTimeoutMs: 5000,
          verbose: "2",
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(ctx.body.data.available, "Session should be available", ctx);
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should return cdpUrl as a valid WebSocket URL for local browser", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ modelName: "gpt-4.1-nano", ...localBrowser }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    // cdpUrl should not be empty since we eagerly launch the browser
    assertFetchOk(
      ctx.body.data.cdpUrl !== "",
      "cdpUrl should not be empty",
      ctx,
    );
    // cdpUrl should be a valid WebSocket URL
    assertFetchOk(
      ctx.body.data.cdpUrl.startsWith("ws://"),
      "cdpUrl should be a WebSocket URL",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should return provided cdpUrl when explicit cdpUrl is passed", async () => {
    const url = getBaseUrl();
    const providedCdpUrl = "ws://localhost:9222/devtools/browser/test";

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browser: { type: "local", cdpUrl: providedCdpUrl },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.cdpUrl === providedCdpUrl,
      "cdpUrl should match provided value",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should return error for browserbase requests without API key", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browser: { type: "browserbase" },
        }),
      },
    );

    // Should fail because browserbase requires x-bb-api-key and x-bb-project-id headers
    assertFetchStatus(ctx, HTTP_BAD_REQUEST, "Request should fail with 400");
  });

  // =============================================================================
  // Multi-Region Support Tests
  // =============================================================================

  it("should accept non-default region in browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    // Test with us-east-1 region - server should accept this request
    // Note: Local browser sessions don't actually use the region, but the server
    // should still accept the parameter without returning { available: false }
    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "us-east-1" as BrowserbaseRegion,
          },
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    // The key assertion: non-default regions should NOT return available: false
    assertFetchOk(
      ctx.body.data.available === true,
      "Session should be available for non-default regions",
      ctx,
    );
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should accept eu-central-1 region in browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "eu-central-1" as BrowserbaseRegion,
          },
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.available === true,
      "Session should be available for eu-central-1 region",
      ctx,
    );
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should accept ap-southeast-1 region in browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "ap-southeast-1" as BrowserbaseRegion,
          },
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.available === true,
      "Session should be available for ap-southeast-1 region",
      ctx,
    );
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });
});
