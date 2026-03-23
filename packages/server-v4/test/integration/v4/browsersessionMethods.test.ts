import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";

import type { Browser } from "playwright";
import { chromium } from "playwright";

import {
  assertFetchOk,
  assertFetchStatus,
  createSessionWithCdp,
  endSession,
  fetchWithContext,
  getBaseUrl,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_OK,
  getHeaders,
} from "../utils.js";

interface BrowserSessionActionRecord {
  id: string;
  method: string;
  status: string;
  sessionId: string;
  pageId?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string | null;
  [key: string]: unknown;
}

interface BrowserSessionActionResponse {
  success: boolean;
  error: string | null;
  message?: string;
  statusCode?: number;
  stack?: string | null;
  action?: BrowserSessionActionRecord;
}

interface BrowserSessionStatusResponse {
  success: boolean;
  message?: string;
  data?: {
    browserSession: {
      id: string;
      status: string;
    };
  };
}

const headers = getHeaders("4.0.0");

async function withBrowser<T>(
  cdpUrl: string,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function postBrowserSessionRoute(
  path: string,
  sessionId: string,
  params: Record<string, unknown>,
) {
  return fetchWithContext<BrowserSessionActionResponse>(
    `${getBaseUrl()}/v4/browsersession/${path}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId,
        ...params,
      }),
    },
  );
}

function assertSuccessAction(
  ctx: Awaited<ReturnType<typeof postBrowserSessionRoute>>,
  expectedMethod: string,
): BrowserSessionActionRecord {
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
  assert.equal(action.method, expectedMethod);
  assert.equal(action.status, "completed");

  return action;
}

describe("v4 browsersession method routes", { concurrency: false }, () => {
  let sessionId: string;
  let cdpUrl: string;

  before(async () => {
    ({ sessionId, cdpUrl } = await createSessionWithCdp(headers));
  });

  after(async () => {
    await endSession(sessionId, headers);
  });

  it("POST /v4/browsersession methods expose the context/browser helpers", async () => {
    let requestHeaders: Record<string, string | string[] | undefined> | null =
      null;
    const server = createServer((req, res) => {
      requestHeaders = req.headers;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 browser session methods</title>
  </head>
  <body>
    <main id="message">browser-session-ok</main>
  </body>
</html>`);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/`;

    try {
      const connectURLCtx = await postBrowserSessionRoute(
        "connectURL",
        sessionId,
        {},
      );
      const connectURLAction = assertSuccessAction(connectURLCtx, "connectURL");
      assert.equal(
        (connectURLAction.result as { connectURL: string }).connectURL,
        cdpUrl,
      );

      const configuredViewportCtx = await postBrowserSessionRoute(
        "configuredViewport",
        sessionId,
        {},
      );
      const configuredViewportAction = assertSuccessAction(
        configuredViewportCtx,
        "configuredViewport",
      );
      assert.equal(
        (configuredViewportAction.result as { width: number }).width,
        1288,
      );
      assert.equal(
        (configuredViewportAction.result as { height: number }).height,
        711,
      );

      const isBrowserbaseCtx = await postBrowserSessionRoute(
        "isBrowserbase",
        sessionId,
        {},
      );
      const isBrowserbaseAction = assertSuccessAction(
        isBrowserbaseCtx,
        "isBrowserbase",
      );
      assert.equal(
        (isBrowserbaseAction.result as { isBrowserbase: boolean })
          .isBrowserbase,
        false,
      );

      const isAdvancedStealthCtx = await postBrowserSessionRoute(
        "isAdvancedStealth",
        sessionId,
        {},
      );
      const isAdvancedStealthAction = assertSuccessAction(
        isAdvancedStealthCtx,
        "isAdvancedStealth",
      );
      assert.equal(
        (
          isAdvancedStealthAction.result as {
            isAdvancedStealth: boolean;
          }
        ).isAdvancedStealth,
        false,
      );

      const browserbaseSessionIDCtx = await postBrowserSessionRoute(
        "browserbaseSessionID",
        sessionId,
        {},
      );
      const browserbaseSessionIDAction = assertSuccessAction(
        browserbaseSessionIDCtx,
        "browserbaseSessionID",
      );
      assert.equal(
        (
          browserbaseSessionIDAction.result as {
            browserbaseSessionID: string | null;
          }
        ).browserbaseSessionID,
        null,
      );

      const browserbaseSessionURLCtx = await postBrowserSessionRoute(
        "browserbaseSessionURL",
        sessionId,
        {},
      );
      const browserbaseSessionURLAction = assertSuccessAction(
        browserbaseSessionURLCtx,
        "browserbaseSessionURL",
      );
      assert.equal(
        (
          browserbaseSessionURLAction.result as {
            browserbaseSessionURL: string | null;
          }
        ).browserbaseSessionURL,
        null,
      );

      const browserbaseDebugURLCtx = await postBrowserSessionRoute(
        "browserbaseDebugURL",
        sessionId,
        {},
      );
      const browserbaseDebugURLAction = assertSuccessAction(
        browserbaseDebugURLCtx,
        "browserbaseDebugURL",
      );
      assert.equal(
        (
          browserbaseDebugURLAction.result as {
            browserbaseDebugURL: string | null;
          }
        ).browserbaseDebugURL,
        null,
      );

      const addInitScriptCtx = await postBrowserSessionRoute(
        "addInitScript",
        sessionId,
        {
          script: "window.__ctxInitValue = 'present';",
        },
      );
      const addInitScriptAction = assertSuccessAction(
        addInitScriptCtx,
        "addInitScript",
      );
      assert.equal(
        (addInitScriptAction.result as { added: boolean }).added,
        true,
      );

      const setHeadersCtx = await postBrowserSessionRoute(
        "setExtraHTTPHeaders",
        sessionId,
        {
          headers: {
            "x-stagehand-test": "present",
          },
        },
      );
      const setHeadersAction = assertSuccessAction(
        setHeadersCtx,
        "setExtraHTTPHeaders",
      );
      assert.equal(
        (
          setHeadersAction.result as {
            headers: Record<string, string>;
          }
        ).headers["x-stagehand-test"],
        "present",
      );

      const newPageCtx = await postBrowserSessionRoute("newPage", sessionId, {
        url,
      });
      const newPageAction = assertSuccessAction(newPageCtx, "newPage");
      const createdPage = (
        newPageAction.result as {
          page: { pageId: string; mainFrameId: string; url: string };
        }
      ).page;
      assert.equal(createdPage.url, url);

      const pagesCtx = await postBrowserSessionRoute("pages", sessionId, {});
      const pagesAction = assertSuccessAction(pagesCtx, "pages");
      const pages = (
        pagesAction.result as {
          pages: Array<{ pageId: string }>;
        }
      ).pages;
      assert.ok(pages.some((page) => page.pageId === createdPage.pageId));

      const activePageCtx = await postBrowserSessionRoute(
        "activePage",
        sessionId,
        {},
      );
      const activePageAction = assertSuccessAction(activePageCtx, "activePage");
      assert.equal(
        (
          activePageAction.result as {
            page: { pageId: string } | null;
          }
        ).page?.pageId,
        createdPage.pageId,
      );

      const awaitActivePageCtx = await postBrowserSessionRoute(
        "awaitActivePage",
        sessionId,
        {
          timeoutMs: 2_000,
        },
      );
      const awaitActivePageAction = assertSuccessAction(
        awaitActivePageCtx,
        "awaitActivePage",
      );
      assert.equal(
        (
          awaitActivePageAction.result as {
            page: { pageId: string };
          }
        ).page.pageId,
        createdPage.pageId,
      );

      const resolveCtx = await postBrowserSessionRoute(
        "resolvePageByMainFrameId",
        sessionId,
        {
          mainFrameId: createdPage.mainFrameId,
        },
      );
      const resolveAction = assertSuccessAction(
        resolveCtx,
        "resolvePageByMainFrameId",
      );
      assert.equal(
        (
          resolveAction.result as {
            page: { pageId: string } | null;
          }
        ).page?.pageId,
        createdPage.pageId,
      );

      const frameTreeCtx = await postBrowserSessionRoute(
        "getFullFrameTreeByMainFrameId",
        sessionId,
        {
          mainFrameId: createdPage.mainFrameId,
        },
      );
      const frameTreeAction = assertSuccessAction(
        frameTreeCtx,
        "getFullFrameTreeByMainFrameId",
      );
      assert.equal(
        (
          frameTreeAction.result as {
            frameTree: { frame: { id: string } };
          }
        ).frameTree.frame.id,
        createdPage.mainFrameId,
      );

      const setViewportSizeCtx = await postBrowserSessionRoute(
        "setViewportSize",
        sessionId,
        {
          width: 900,
          height: 600,
          deviceScaleFactor: 1,
        },
      );
      const setViewportSizeAction = assertSuccessAction(
        setViewportSizeCtx,
        "setViewportSize",
      );
      assert.equal(
        (setViewportSizeAction.result as { width: number }).width,
        900,
      );
      assert.equal(
        (setViewportSizeAction.result as { height: number }).height,
        600,
      );

      const addCookiesCtx = await postBrowserSessionRoute(
        "addCookies",
        sessionId,
        {
          cookies: [
            {
              name: "stagehand-test",
              value: "cookie-present",
              url,
            },
          ],
        },
      );
      const addCookiesAction = assertSuccessAction(addCookiesCtx, "addCookies");
      assert.equal((addCookiesAction.result as { added: number }).added, 1);

      const cookiesCtx = await postBrowserSessionRoute("cookies", sessionId, {
        urls: url,
      });
      const cookiesAction = assertSuccessAction(cookiesCtx, "cookies");
      const cookies = (
        cookiesAction.result as {
          cookies: Array<{ name: string; value: string }>;
        }
      ).cookies;
      assert.ok(
        cookies.some(
          (cookie) =>
            cookie.name === "stagehand-test" &&
            cookie.value === "cookie-present",
        ),
      );

      const clearCookiesCtx = await postBrowserSessionRoute(
        "clearCookies",
        sessionId,
        {
          name: "stagehand-test",
        },
      );
      const clearCookiesAction = assertSuccessAction(
        clearCookiesCtx,
        "clearCookies",
      );
      assert.equal(
        (clearCookiesAction.result as { cleared: boolean }).cleared,
        true,
      );

      const cookiesAfterClearCtx = await postBrowserSessionRoute(
        "cookies",
        sessionId,
        {
          urls: url,
        },
      );
      const cookiesAfterClearAction = assertSuccessAction(
        cookiesAfterClearCtx,
        "cookies",
      );
      assert.equal(
        (
          cookiesAfterClearAction.result as {
            cookies: unknown[];
          }
        ).cookies.length,
        0,
      );

      await withBrowser(cdpUrl, async (browser) => {
        const contexts = browser.contexts();
        assert.ok(contexts.length > 0, "Expected at least one browser context");

        const deadline = Date.now() + 5_000;
        let page = contexts[0]!
          .pages()
          .find((candidate) => candidate.url() === url);
        while (!page && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          page = contexts[0]!
            .pages()
            .find((candidate) => candidate.url() === url);
        }

        assert.ok(page, "Expected to find the new page in the CDP browser");
        await page!.waitForLoadState("load");

        const viewport = await page!.evaluate(() => ({
          height: window.innerHeight,
          init:
            (window as typeof window & { __ctxInitValue?: string })
              .__ctxInitValue ?? null,
          width: window.innerWidth,
        }));

        assert.equal(viewport.init, "present");
        assert.equal(viewport.width, 900);
        assert.equal(viewport.height, 600);
      });

      assert.equal(requestHeaders?.["x-stagehand-test"], "present");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("POST /v4/browsersession/setExtraHTTPHeaders returns the action error envelope for validation errors", async () => {
    const ctx = await fetchWithContext<BrowserSessionActionResponse>(
      `${getBaseUrl()}/v4/browsersession/setExtraHTTPHeaders`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.equal(typeof ctx.body.error, "string");
    assert.equal(ctx.body.statusCode, HTTP_BAD_REQUEST);
  });
});
