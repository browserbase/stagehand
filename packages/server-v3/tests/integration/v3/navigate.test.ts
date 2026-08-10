import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { chromium } from "playwright";

import {
  assertFetchOk,
  assertFetchStatus,
  createSessionWithCdp,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_BAD_REQUEST,
  HTTP_OK,
} from "../utils.js";

// =============================================================================
// POST /v1/sessions/:id/navigate (V3 Format)
// =============================================================================

describe("POST /v1/sessions/:id/navigate (V3)", () => {
  let sessionId: string;
  let cdpUrl: string;

  before(async () => {
    ({ sessionId, cdpUrl } = await createSessionWithCdp(getHeaders("3.0.0")));
  });

  after(async () => {
    await endSession(sessionId, getHeaders("3.0.0"));
  });

  it("should navigate to a URL successfully and verify via CDP", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/navigate`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({ url: "https://example.com", frameId: "" }),
    });

    assertFetchStatus(ctx, HTTP_OK, "Navigate should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      typeof ctx.body.data.actionId === "string",
      "Response should have actionId",
      ctx,
    );

    // Verify navigation via CDP
    const browser = await chromium.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    assert.ok(contexts.length > 0, "Should have at least one browser context");
    const pages = contexts[0]!.pages();
    assert.ok(pages.length > 0, "Should have at least one page");
    const page = pages[0]!;
    await page
      .waitForLoadState("domcontentloaded", { timeout: 15_000 })
      .catch(() => {});
    await page
      .waitForURL("**example.com**", { timeout: 15_000 })
      .catch(() => {});
    const pageUrl = page.url();
    assert.ok(
      pageUrl.includes("example.com"),
      `Page URL should be example.com, got: ${pageUrl}`,
    );
    await browser.close();
  });

  it("should navigate with options", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success: boolean;
      data?: { result: unknown; actionId?: string };
    }>(`${url}/v1/sessions/${sessionId}/navigate`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        url: "https://example.com",
        frameId: "",
        options: {
          waitUntil: "networkidle",
          timeout: 30000,
        },
      }),
    });

    assertFetchStatus(ctx, HTTP_OK, "Navigate with options should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should have data",
      ctx,
    );
    assertFetchOk(
      typeof ctx.body.data.actionId === "string",
      "Response should have actionId",
      ctx,
    );
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  it("should return 400 when url is missing", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<{
      success?: boolean;
      message?: string;
      error?: string;
    }>(`${url}/v1/sessions/${sessionId}/navigate`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({ frameId: "" }), // Missing url
    });

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    // Fastify validation errors may have different format than our custom errors
    assertFetchOk(
      !ctx.body.success ||
        ctx.body.error !== undefined ||
        ctx.body.message !== undefined,
      "Response should indicate failure",
      ctx,
    );
  });
});
