import assert from "node:assert/strict";
import { createServer } from "node:http";
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
  getMainFrameId,
  getHeaders,
  HTTP_BAD_REQUEST,
  HTTP_OK,
} from "../utils.js";

interface PageActionRecord {
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

interface PageActionResponse {
  success: boolean;
  error: string | null;
  statusCode?: number;
  stack?: string | null;
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

const METHODS_TEST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 methods route</title>
    <style>
      body { font-family: sans-serif; }
      #scroll-box {
        border: 1px solid #333;
        height: 80px;
        overflow: auto;
        width: 200px;
      }
      #scroll-inner {
        height: 400px;
      }
      #drag-source, #drag-target {
        align-items: center;
        border: 1px solid #333;
        display: flex;
        height: 40px;
        justify-content: center;
        margin-top: 8px;
        width: 120px;
      }
    </style>
  </head>
  <body data-hovered="no" data-dropped="no">
    <main id="message">methods-ok</main>
    <input id="text-input" value="" />
    <button
      id="hover-target"
      onmouseover="document.body.dataset.hovered='yes';"
    >
      Hover me
    </button>
    <div id="scroll-box">
      <div id="scroll-inner">scroll target</div>
    </div>
    <div
      id="drag-source"
      onmousedown="window.__dragStart = true;"
    >
      Drag source
    </div>
    <div
      id="drag-target"
      onmouseup="if (window.__dragStart) { document.body.dataset.dropped='yes'; }"
    >
      Drop target
    </div>
    <script>
      setTimeout(() => {
        const lateItem = document.createElement("div");
        lateItem.id = "late-item";
        lateItem.textContent = "ready";
        document.body.appendChild(lateItem);
      }, 150);
    </script>
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

async function getPageRoute(
  path: string,
  sessionId: string,
  params: Record<string, unknown>,
) {
  const searchParams = new URLSearchParams();
  searchParams.set("sessionId", sessionId);

  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  return fetchWithContext<PageActionResponse>(
    `${getBaseUrl()}/v4/page/${path}?${searchParams.toString()}`,
    {
      method: "GET",
      headers,
    },
  );
}

function assertSuccessAction(
  ctx: Awaited<ReturnType<typeof fetchWithContext<PageActionResponse>>>,
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
  assert.equal(action.method, expectedType);
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
    assert.equal(
      (action.result as { response: unknown | null; url: string }).url,
      GOTO_TEST_URL,
    );
    assert.equal(
      (action.result as { response: unknown | null }).response,
      null,
    );

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
    const gotoAction = assertSuccessAction(gotoCtx, "goto");

    const clickCtx = await postPageRoute("click", sessionId, {
      pageId: gotoAction.pageId,
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

  it("POST /v4/page methods route through the underlying understudy implementation", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: METHODS_TEST_URL,
      waitUntil: "load",
    });
    assertSuccessAction(gotoCtx, "goto");

    const hoverCtx = await postPageRoute("hover", sessionId, {
      selector: {
        xpath: "//button[@id='hover-target']",
      },
    });
    assertSuccessAction(hoverCtx, "hover");

    const scrollCtx = await postPageRoute("scroll", sessionId, {
      selector: {
        xpath: "//div[@id='scroll-box']",
      },
      percentage: 100,
    });
    assertSuccessAction(scrollCtx, "scroll");

    const dragCtx = await postPageRoute("dragAndDrop", sessionId, {
      from: {
        xpath: "//div[@id='drag-source']",
      },
      to: {
        xpath: "//div[@id='drag-target']",
      },
    });
    assertSuccessAction(dragCtx, "dragAndDrop");

    const focusInputCtx = await postPageRoute("click", sessionId, {
      selector: {
        xpath: "//input[@id='text-input']",
      },
    });
    assertSuccessAction(focusInputCtx, "click");

    const typeCtx = await postPageRoute("type", sessionId, {
      text: "hello",
    });
    assertSuccessAction(typeCtx, "type");

    const keyPressCtx = await postPageRoute("keyPress", sessionId, {
      key: "Backspace",
    });
    assertSuccessAction(keyPressCtx, "keyPress");

    const waitForSelectorCtx = await postPageRoute(
      "waitForSelector",
      sessionId,
      {
        selector: {
          xpath: "//div[@id='late-item']",
        },
        state: "visible",
        timeout: 5_000,
      },
    );
    const waitForSelectorAction = assertSuccessAction(
      waitForSelectorCtx,
      "waitForSelector",
    );
    assert.equal(
      (waitForSelectorAction.result as { matched: boolean }).matched,
      true,
    );

    const waitForLoadStateCtx = await postPageRoute(
      "waitForLoadState",
      sessionId,
      {
        state: "load",
      },
    );
    assertSuccessAction(waitForLoadStateCtx, "waitForLoadState");

    const titleCtx = await getPageRoute("title", sessionId, {});
    const titleAction = assertSuccessAction(titleCtx, "title");
    assert.equal(
      (titleAction.result as { title: string }).title,
      "V4 methods route",
    );

    const urlCtx = await getPageRoute("url", sessionId, {});
    const urlAction = assertSuccessAction(urlCtx, "url");
    assert.equal((urlAction.result as { url: string }).url, METHODS_TEST_URL);

    const evaluateCtx = await postPageRoute("evaluate", sessionId, {
      expression: "arg.value * 2",
      arg: {
        value: 21,
      },
    });
    const evaluateAction = assertSuccessAction(evaluateCtx, "evaluate");
    assert.equal((evaluateAction.result as { value: number }).value, 42);

    const sendCDPCtx = await postPageRoute("sendCDP", sessionId, {
      method: "Runtime.evaluate",
      params: {
        expression: "6 * 7",
        returnByValue: true,
      },
    });
    const sendCDPAction = assertSuccessAction(sendCDPCtx, "sendCDP");
    assert.equal(
      (
        sendCDPAction.result as {
          value: { result?: { value?: number } };
        }
      ).value.result?.value,
      42,
    );

    await withSessionPage(cdpUrl, async (page) => {
      await page.waitForFunction(
        () => document.body.dataset.hovered === "yes",
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForFunction(
        () => document.body.dataset.dropped === "yes",
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await page.locator("#text-input").inputValue(), "hell");
      assert.ok(
        await page
          .locator("#scroll-box")
          .evaluate((node) => (node as HTMLDivElement).scrollTop > 0),
      );
    });
  });

  it("POST /v4/page navigation helpers, screenshot, snapshot, viewport, timeout, and close work on a live session", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: METHODS_TEST_URL,
      waitUntil: "load",
    });
    const gotoAction = assertSuccessAction(gotoCtx, "goto");
    assert.equal(
      (gotoAction.result as { response: unknown | null; url: string }).url,
      METHODS_TEST_URL,
    );
    assert.equal(
      (gotoAction.result as { response: unknown | null }).response,
      null,
    );

    const setViewportSizeCtx = await postPageRoute(
      "setViewportSize",
      sessionId,
      {
        width: 900,
        height: 700,
        deviceScaleFactor: 1,
      },
    );
    assertSuccessAction(setViewportSizeCtx, "setViewportSize");

    const screenshotCtx = await postPageRoute("screenshot", sessionId, {
      type: "jpeg",
      quality: 70,
    });
    const screenshotAction = assertSuccessAction(screenshotCtx, "screenshot");
    const screenshotResult = screenshotAction.result as {
      base64: string;
      mimeType: string;
    };
    assert.equal(screenshotResult.mimeType, "image/jpeg");
    assert.ok(screenshotResult.base64.length > 0);

    const snapshotCtx = await postPageRoute("snapshot", sessionId, {
      includeIframes: true,
    });
    const snapshotAction = assertSuccessAction(snapshotCtx, "snapshot");
    assert.match(
      (snapshotAction.result as { formattedTree: string }).formattedTree,
      /methods-ok/i,
    );

    const waitStart = Date.now();
    const waitCtx = await postPageRoute("waitForTimeout", sessionId, {
      ms: 75,
    });
    assertSuccessAction(waitCtx, "waitForTimeout");
    assert.ok(Date.now() - waitStart >= 50);

    const zeroWaitCtx = await postPageRoute("waitForTimeout", sessionId, {
      ms: 0,
    });
    assertSuccessAction(zeroWaitCtx, "waitForTimeout");

    const reloadCtx = await postPageRoute("reload", sessionId, {
      waitUntil: "load",
    });
    const reloadAction = assertSuccessAction(reloadCtx, "reload");
    assert.equal(
      (reloadAction.result as { response: unknown | null; url: string }).url,
      METHODS_TEST_URL,
    );
    assert.equal(
      (reloadAction.result as { response: unknown | null }).response,
      null,
    );

    await withSessionPage(cdpUrl, async (page) => {
      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      assert.equal(viewport.width, 900);
      assert.equal(viewport.height, 700);
      assert.equal(
        await page.evaluate(
          () =>
            performance.getEntriesByType("navigation")[0]?.toJSON().type ?? "",
        ),
        "reload",
      );
    });

    const gotoBackTargetCtx = await postPageRoute("goto", sessionId, {
      url: GOTO_TEST_URL,
      waitUntil: "load",
    });
    assertSuccessAction(gotoBackTargetCtx, "goto");

    const goBackCtx = await postPageRoute("goBack", sessionId, {
      waitUntil: "load",
    });
    const goBackAction = assertSuccessAction(goBackCtx, "goBack");
    assert.equal(
      (goBackAction.result as { response: unknown | null; url: string }).url,
      METHODS_TEST_URL,
    );
    assert.equal(
      (goBackAction.result as { response: unknown | null }).response,
      null,
    );

    await withSessionPage(cdpUrl, async (page) => {
      assert.equal(await page.title(), "V4 methods route");
    });

    const goForwardCtx = await postPageRoute("goForward", sessionId, {
      waitUntil: "load",
    });
    const goForwardAction = assertSuccessAction(goForwardCtx, "goForward");
    assert.equal(
      (goForwardAction.result as { response: unknown | null; url: string }).url,
      GOTO_TEST_URL,
    );
    assert.equal(
      (goForwardAction.result as { response: unknown | null }).response,
      null,
    );

    await withSessionPage(cdpUrl, async (page) => {
      assert.equal(await page.title(), "V4 goto route");
    });

    const temp = await createSessionWithCdp(headers);
    try {
      const closeGotoCtx = await postPageRoute("goto", temp.sessionId, {
        url: GOTO_TEST_URL,
        waitUntil: "load",
      });
      assertSuccessAction(closeGotoCtx, "goto");

      const closeCtx = await fetchWithContext<PageActionResponse>(
        `${getBaseUrl()}/v4/page/close`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            sessionId: temp.sessionId,
            params: {},
          }),
        },
      );
      assertSuccessAction(closeCtx, "close");

      const browser = await chromium.connectOverCDP(temp.cdpUrl);
      try {
        const contexts = browser.contexts();
        const pages = contexts.flatMap((context) => context.pages());
        assert.equal(pages.length, 0);
      } finally {
        await browser.close();
      }
    } finally {
      await endSession(temp.sessionId, headers);
    }
  });

  it("GET page getters and POST page config methods expose the underlying understudy interface", async () => {
    const temp = await createSessionWithCdp(headers);
    let requestHeaders: Record<string, string | string[] | undefined> | null =
      null;
    const server = createServer((req, res) => {
      if (req.url === "/") {
        requestHeaders = req.headers;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>V4 header route</title>
  </head>
  <body>
    <main id="message">header-ok</main>
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
      const enableCursorOverlayCtx = await postPageRoute(
        "enableCursorOverlay",
        temp.sessionId,
        {},
      );
      const enableCursorOverlayAction = assertSuccessAction(
        enableCursorOverlayCtx,
        "enableCursorOverlay",
      );
      assert.equal(
        (enableCursorOverlayAction.result as { enabled: boolean }).enabled,
        true,
      );

      const addInitScriptCtx = await postPageRoute(
        "addInitScript",
        temp.sessionId,
        {
          script: "window.__v4InitValue = 'present';",
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

      const setHeadersCtx = await postPageRoute(
        "setExtraHTTPHeaders",
        temp.sessionId,
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

      const gotoCtx = await postPageRoute("goto", temp.sessionId, {
        url,
        waitUntil: "load",
      });
      const gotoAction = assertSuccessAction(gotoCtx, "goto");
      assert.equal(requestHeaders?.["x-stagehand-test"], "present");

      const targetIdCtx = await getPageRoute("targetId", temp.sessionId, {});
      const targetIdAction = assertSuccessAction(targetIdCtx, "targetId");
      assert.equal(
        (targetIdAction.result as { targetId: string }).targetId,
        gotoAction.pageId,
      );

      const mainFrameIdCtx = await getPageRoute(
        "mainFrameId",
        temp.sessionId,
        {},
      );
      const mainFrameIdAction = assertSuccessAction(
        mainFrameIdCtx,
        "mainFrameId",
      );
      const mainFrameId = (mainFrameIdAction.result as { mainFrameId: string })
        .mainFrameId;
      assert.equal(mainFrameId, await getMainFrameId(temp.cdpUrl));

      const framesCtx = await getPageRoute("frames", temp.sessionId, {});
      const framesAction = assertSuccessAction(framesCtx, "frames");
      const frames = (
        framesAction.result as {
          frames: Array<{ frameId: string }>;
        }
      ).frames;
      assert.ok(frames.some((frame) => frame.frameId === mainFrameId));

      const fullFrameTreeCtx = await getPageRoute(
        "getFullFrameTree",
        temp.sessionId,
        {},
      );
      const fullFrameTreeAction = assertSuccessAction(
        fullFrameTreeCtx,
        "getFullFrameTree",
      );
      assert.equal(
        (
          fullFrameTreeAction.result as {
            frameTree: { frame: { id: string } };
          }
        ).frameTree.frame.id,
        mainFrameId,
      );

      const listAllFrameIdsCtx = await getPageRoute(
        "listAllFrameIds",
        temp.sessionId,
        {},
      );
      const listAllFrameIdsAction = assertSuccessAction(
        listAllFrameIdsCtx,
        "listAllFrameIds",
      );
      const frameIds = (listAllFrameIdsAction.result as { frameIds: string[] })
        .frameIds;
      assert.ok(frameIds.includes(mainFrameId));
      assert.deepEqual(
        [...frameIds].sort(),
        [...frames.map((frame) => frame.frameId)].sort(),
      );

      const evaluateCtx = await postPageRoute("evaluate", temp.sessionId, {
        expression: `({
          title: document.title,
          cursorOverlay: !!document.getElementById("__v3_cursor_overlay__"),
          initValue: globalThis.__v4InitValue ?? null
        })`,
      });
      const evaluateAction = assertSuccessAction(evaluateCtx, "evaluate");
      assert.deepEqual(evaluateAction.result, {
        value: {
          title: "V4 header route",
          cursorOverlay: true,
          initValue: "present",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await endSession(temp.sessionId, headers);
    }
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
    assert.equal(detailCtx.body.action.method, "goto");
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
    assert.equal(listedClickAction.method, "click");
    assert.equal(listedClickAction.sessionId, sessionId);
  });

  it("GET /v4/page/action still returns stored actions after the session ends", async () => {
    const temp = await createSessionWithCdp(headers);
    try {
      const gotoCtx = await postPageRoute("goto", temp.sessionId, {
        url: GOTO_TEST_URL,
        waitUntil: "load",
      });
      const action = assertSuccessAction(gotoCtx, "goto");

      await endSession(temp.sessionId, headers);

      const detailCtx = await fetchWithContext<PageActionResponse>(
        `${getBaseUrl()}/v4/page/action/${action.id}?sessionId=${temp.sessionId}`,
        {
          method: "GET",
          headers,
        },
      );
      const fetchedAction = assertSuccessAction(detailCtx, "goto");
      assert.equal(fetchedAction.id, action.id);

      const listCtx = await fetchWithContext<PageActionResponse>(
        `${getBaseUrl()}/v4/page/action?sessionId=${temp.sessionId}`,
        {
          method: "GET",
          headers,
        },
      );
      const actions = assertSuccessActionList(listCtx);
      assert.ok(actions.some((candidate) => candidate.id === action.id));
    } finally {
      await endSession(temp.sessionId, headers);
    }
  });

  it("POST /v4/page/click accepts css, text, and coordinate selector types", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: CLICK_TEST_URL,
      waitUntil: "load",
    });
    assertSuccessAction(gotoCtx, "goto");

    const cssSelectorCtx = await postPageRoute("click", sessionId, {
      selector: { css: "#click-target" },
    });
    assertSuccessAction(cssSelectorCtx, "click");

    const cssWithIndexCtx = await postPageRoute("click", sessionId, {
      selector: { css: "button", idx: 0 },
    });
    assertSuccessAction(cssWithIndexCtx, "click");

    const xpathWithIndexCtx = await postPageRoute("click", sessionId, {
      selector: { xpath: "//button", idx: 0 },
    });
    assertSuccessAction(xpathWithIndexCtx, "click");

    const textWithIndexCtx = await postPageRoute("click", sessionId, {
      selector: { text: "Submit", idx: 0 },
    });
    assertSuccessAction(textWithIndexCtx, "click");

    const textSelectorCtx = await postPageRoute("click", sessionId, {
      selector: { text: "Submit" },
    });
    assertSuccessAction(textSelectorCtx, "click");

    const coordSelectorCtx = await postPageRoute("click", sessionId, {
      selector: { x: 100, y: 200 },
    });
    assertSuccessAction(coordSelectorCtx, "click");
  });

  it("POST /v4/page/dragAndDrop accepts mixed selector types (xpath from, coordinates to)", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: METHODS_TEST_URL,
      waitUntil: "load",
    });
    assertSuccessAction(gotoCtx, "goto");

    const dragCtx = await postPageRoute("dragAndDrop", sessionId, {
      from: { xpath: "//div[@id='drag-source']" },
      to: { x: 200, y: 300 },
    });
    assertSuccessAction(dragCtx, "dragAndDrop");
  });

  it("POST /v4/page/click returns the new top-level failure shape for validation errors", async () => {
    const ctx = await postPageRoute("click", sessionId, {});

    assertFetchStatus(ctx, HTTP_BAD_REQUEST);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.equal(ctx.body.statusCode, HTTP_BAD_REQUEST);
    assert.equal(typeof ctx.body.error, "string");
    assert.ok(ctx.body.error);
    assert.ok(
      ctx.body.stack === null || typeof ctx.body.stack === "string",
      "Expected stack to be null or a string",
    );
    assert.equal(ctx.body.action, undefined);
    assert.equal(ctx.body.actions, undefined);
  });

  it("POST /v4/page routes return the underlying error message and stack for route failures", async () => {
    const gotoCtx = await postPageRoute("goto", sessionId, {
      url: CLICK_TEST_URL,
      waitUntil: "load",
    });
    assertSuccessAction(gotoCtx, "goto");

    const ctx = await postPageRoute("click", sessionId, {
      selector: {
        xpath: "//button[@id='missing-target']",
      },
    });

    assertFetchStatus(ctx, 404);
    assertFetchOk(ctx.body !== null, "Expected a JSON response body", ctx);
    assert.equal(ctx.body.success, false);
    assert.equal(ctx.body.statusCode, 404);
    assert.equal(typeof ctx.body.error, "string");
    assert.ok(ctx.body.error);
    assert.equal(typeof ctx.body.stack, "string");
    assert.ok(ctx.body.stack);
    assertFetchOk(
      ctx.body.action !== undefined,
      "Expected a failed action payload",
      ctx,
    );
    assert.equal(ctx.body.action.status, "failed");
  });
});
