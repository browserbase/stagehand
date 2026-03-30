import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { Page } from "playwright";
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

interface StagehandSuccessBody<TResult = unknown> {
  success: boolean;
  data?: {
    result: TResult;
    eventId?: string;
  };
  message?: string;
}

const headers = getHeaders("4.0.0");

const NAVIGATE_TEST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 stagehand navigate route</title>
  </head>
  <body>
    <main id="message">stagehand-navigate-ok</main>
  </body>
</html>
`)}`;

async function withSessionPage<T>(
  cdpUrl: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const contexts = browser.contexts();
    assert.ok(contexts.length > 0, "Expected at least one browser context");

    const pages = contexts[0]!.pages();
    assert.ok(pages.length > 0, "Expected at least one browser page");

    return await fn(pages[0]!);
  } finally {
    await browser.close();
  }
}

async function postStagehandRoute<TResult>(
  path: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
) {
  return fetchWithContext<StagehandSuccessBody<TResult>>(
    `${getBaseUrl()}/v4/stagehand/${path}`,
    {
      method: "POST",
      headers: {
        ...headers,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("v4 stagehand routes", { concurrency: false }, () => {
  let sessionId: string;
  let cdpUrl: string;

  before(async () => {
    ({ sessionId, cdpUrl } = await createSessionWithCdp(headers));
  });

  after(async () => {
    await endSession(sessionId, headers);
  });

  it("POST /v4/stagehand/navigate navigates the active page", async () => {
    const ctx = await postStagehandRoute("navigate", {
      sessionId,
      url: NAVIGATE_TEST_URL,
      options: {
        waitUntil: "load",
      },
    });

    assertFetchStatus(ctx, HTTP_OK);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, true);
    assert.equal(typeof ctx.body.data?.eventId, "string");
    assert.ok(ctx.body.data?.eventId);

    await withSessionPage(cdpUrl, async (page) => {
      assert.equal(page.url(), NAVIGATE_TEST_URL);
      assert.equal(await page.textContent("#message"), "stagehand-navigate-ok");
    });
  });

  it("POST /v4/stagehand/* routes are registered under the new names", async () => {
    const invalidRequests = [
      {
        path: "act",
        body: {
          sessionId,
        },
      },
      {
        path: "extract",
        body: {},
      },
      {
        path: "observe",
        body: {},
      },
      {
        path: "navigate",
        body: {
          sessionId,
        },
      },
    ] as const;

    for (const { path, body } of invalidRequests) {
      const ctx = await postStagehandRoute(path, body);
      assertFetchStatus(ctx, HTTP_BAD_REQUEST);
      assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
      assert.equal(ctx.body.success, false);
      assert.equal(ctx.body.message, "Request validation failed");
    }
  });
});
