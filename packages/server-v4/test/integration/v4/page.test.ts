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

interface PageActionRecord {
  id: string;
  type: string;
  status: string;
  sessionId: string;
  pageId?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string | null;
  [key: string]: unknown;
}

interface PageActionResponse {
  success: boolean;
  error: string | null;
  action?: PageActionRecord;
  actions?: PageActionRecord[];
}

const headers = getHeaders("3.0.0");

const GOTO_TEST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 goto route</title>
  </head>
  <body>
    <main id="message">goto-ok</main>
  </body>
</html>
`)}`;

const CLICK_TEST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 click route</title>
  </head>
  <body data-clicked="no">
    <button
      id="click-target"
      onclick="document.body.dataset.clicked='yes';document.getElementById('status').textContent='clicked';"
    >
      Submit
    </button>
    <div id="status">idle</div>
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

async function postPageRoute(
  path: string,
  sessionId: string,
  params: Record<string, unknown>,
) {
  return fetchWithContext<PageActionResponse>(
    `${getBaseUrl()}/v4/page/${path}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId,
        params,
      }),
    },
  );
}

function assertSuccessAction(
  ctx: Awaited<ReturnType<typeof postPageRoute>>,
  expectedType: string,
): PageActionRecord {
  assertFetchStatus(ctx, HTTP_OK);
  assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
  assert.equal(ctx.body.success, true);
  assert.equal(ctx.body.error, null);
  assertFetchOk(
    ctx.body.action !== undefined,
    "Expected an action payload",
    ctx,
  );

  const action = ctx.body.action;
  assert.equal(typeof action.id, "string");
  assert.notEqual(action.id.length, 0);
  assert.equal(action.type, expectedType);
  assert.equal(action.status, "completed");

  return action;
}

function assertSuccessActionList(
  ctx: Awaited<ReturnType<typeof fetchWithContext<PageActionResponse>>>,
) {
  assertFetchStatus(ctx, HTTP_OK);
  assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
  assert.equal(ctx.body.success, true);
  assert.equal(ctx.body.error, null);
  assertFetchOk(
    Array.isArray(ctx.body.actions),
    "Expected an actions array payload",
    ctx,
  );

  return ctx.body.actions;
}

describe("v4 page routes", { concurrency: false }, () => {
  let sessionId: string;
  let cdpUrl: string;

  before(async () => {
    ({ sessionId, cdpUrl } = await createSessionWithCdp(headers));
  });

  after(async () => {
    await endSession(sessionId, headers);
  });

  it("POST /v4/page/goto returns the new envelope and navigates a real local session", async () => {
    const ctx = await postPageRoute("goto", sessionId, {
      url: GOTO_TEST_URL,
      waitUntil: "load",
    });

    const action = assertSuccessAction(ctx, "goto");
    assert.equal(action.sessionId, sessionId);

    await withSessionPage(cdpUrl, async (page) => {
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      assert.equal(await page.title(), "V4 goto route");
      assert.equal(await page.textContent("#message"), "goto-ok");
    });
  });

  it("POST /v4/page/click returns the new envelope and clicks a real page element", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: CLICK_TEST_URL,
      waitUntil: "load",
    });
    assertSuccessAction(gotoCtx, "goto");

    const clickCtx = await postPageRoute("click", sessionId, {
      selector: {
        xpath: "//button[@id='click-target']",
      },
    });

    const action = assertSuccessAction(clickCtx, "click");
    assert.equal(action.sessionId, sessionId);

    await withSessionPage(cdpUrl, async (page) => {
      await page.waitForFunction(
        () => document.body.dataset.clicked === "yes",
        undefined,
        {
          timeout: 15_000,
        },
      );
      assert.equal(await page.locator("#status").textContent(), "clicked");
    });
  });

  it("GET /v4/page/action/:actionId returns the new envelope for a stored action", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: GOTO_TEST_URL,
      waitUntil: "load",
    });
    const createdAction = assertSuccessAction(gotoCtx, "goto");

    const detailCtx = await fetchWithContext<PageActionResponse>(
      `${getBaseUrl()}/v4/page/action/${createdAction.id}?sessionId=${sessionId}`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(detailCtx, HTTP_OK);
    assertFetchOk(
      detailCtx.body !== null,
      "Expected a JSON response body",
      detailCtx,
    );
    assert.equal(detailCtx.body.success, true);
    assert.equal(detailCtx.body.error, null);
    assertFetchOk(
      detailCtx.body.action !== undefined,
      "Expected an action payload",
      detailCtx,
    );
    assert.equal(detailCtx.body.action.id, createdAction.id);
    assert.equal(detailCtx.body.action.type, "goto");
    assert.equal(detailCtx.body.action.sessionId, sessionId);
  });

  it("GET /v4/page/action returns the new envelope with action history", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: CLICK_TEST_URL,
      waitUntil: "load",
    });
    const gotoAction = assertSuccessAction(gotoCtx, "goto");

    const clickCtx = await postPageRoute("click", sessionId, {
      selector: {
        xpath: "//button[@id='click-target']",
      },
    });
    const clickAction = assertSuccessAction(clickCtx, "click");

    const listCtx = await fetchWithContext<PageActionResponse>(
      `${getBaseUrl()}/v4/page/action?sessionId=${sessionId}`,
      {
        method: "GET",
        headers,
      },
    );

    const actions = assertSuccessActionList(listCtx);
    const actionIds = new Set(actions.map((action) => action.id));

    assert.ok(actionIds.has(gotoAction.id), "Expected goto action in history");
    assert.ok(
      actionIds.has(clickAction.id),
      "Expected click action in history",
    );

    const listedClickAction = actions.find(
      (action) => action.id === clickAction.id,
    );
    assert.ok(listedClickAction, "Expected click action details in history");
    assert.equal(listedClickAction.type, "click");
    assert.equal(listedClickAction.sessionId, sessionId);
  });

  it("POST /v4/page/click returns the new top-level failure shape for validation errors", async () => {
    const ctx = await postPageRoute("click", sessionId, {});

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.equal(typeof ctx.body.error, "string");
    assert.ok(ctx.body.error);
    assert.equal(ctx.body.action, undefined);
    assert.equal(ctx.body.actions, undefined);
  });
});
