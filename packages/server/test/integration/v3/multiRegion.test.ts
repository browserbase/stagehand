import { describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_OK,
} from "../utils.js";

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

interface StartErrorResponse {
  success: false;
  message: string;
}

type StartResponse = StartSuccessResponse | StartErrorResponse;

function isSuccessResponse(
  response: StartResponse,
): response is StartSuccessResponse {
  return response.success && response.data.sessionId !== null;
}

// =============================================================================
// Multi-Region Integration Tests
// =============================================================================
// These tests verify that the API client correctly handles multi-region
// configuration. Prior to the multi-region feature, non-us-west-2 regions
// would be rejected with { available: false }. Now all supported regions
// are accepted.
// =============================================================================

describe("POST /v1/sessions/start - Multi-region support", () => {
  const headers = getHeaders("3.0.0");
  const localBrowser = {
    browser: {
      type: "local",
      launchOptions: {
        headless: true,
      },
    },
  };

  it("should start session with us-west-2 region (default)", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "us-west-2",
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

    try {
      assertFetchOk(
        ctx.body.data.available,
        "Session should be available",
        ctx,
      );
      assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    } finally {
      await endSession(ctx.body.data.sessionId, headers);
    }
  });

  it("should start session with us-east-1 region", async () => {
    const url = getBaseUrl();

    // This test verifies that non-us-west-2 regions are now accepted.
    // Previously, this would have returned { available: false }.
    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "us-east-1",
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

    try {
      assertFetchOk(
        ctx.body.data.available,
        "Session should be available",
        ctx,
      );
      assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    } finally {
      await endSession(ctx.body.data.sessionId, headers);
    }
  });

  it("should start session with eu-central-1 region", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "eu-central-1",
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

    try {
      assertFetchOk(
        ctx.body.data.available,
        "Session should be available",
        ctx,
      );
      assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    } finally {
      await endSession(ctx.body.data.sessionId, headers);
    }
  });

  it("should start session with ap-southeast-1 region", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "ap-southeast-1",
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

    try {
      assertFetchOk(
        ctx.body.data.available,
        "Session should be available",
        ctx,
      );
      assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    } finally {
      await endSession(ctx.body.data.sessionId, headers);
    }
  });

  it("should start session without region (defaults to us-west-2)", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {},
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

    try {
      assertFetchOk(
        ctx.body.data.available,
        "Session should be available",
        ctx,
      );
      assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    } finally {
      await endSession(ctx.body.data.sessionId, headers);
    }
  });

  it("should start session without browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
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

    try {
      assertFetchOk(
        ctx.body.data.available,
        "Session should be available",
        ctx,
      );
      assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    } finally {
      await endSession(ctx.body.data.sessionId, headers);
    }
  });
});
