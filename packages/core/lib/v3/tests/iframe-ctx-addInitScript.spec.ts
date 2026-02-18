import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { V3Context } from "../understudy/context";
import type { Page } from "../understudy/page";

const isBrowserbase =
  (process.env.STAGEHAND_BROWSER_TARGET ?? "local").toLowerCase() ===
  "browserbase";
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;

const parseBoundedTimeoutMs = (
  value: string | undefined,
  fallbackMs: number,
): number => {
  const parsed = Number(value ?? fallbackMs);
  if (!Number.isFinite(parsed)) return fallbackMs;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, parsed));
};

const CHILD_FRAME_TIMEOUT_MS = parseBoundedTimeoutMs(
  process.env.IFRAME_CHILD_FRAME_TIMEOUT_MS,
  isBrowserbase ? 80_000 : 40_000,
);
const POPUP_TIMEOUT_MS = parseBoundedTimeoutMs(
  process.env.IFRAME_POPUP_TIMEOUT_MS,
  isBrowserbase ? 60_000 : 40_000,
);
const POPUP_URL_TIMEOUT_MS = parseBoundedTimeoutMs(
  process.env.IFRAME_POPUP_URL_TIMEOUT_MS,
  isBrowserbase ? 80_000 : 40_000,
);
const DEBUG_INTERVAL_MS = 5_000;
const iframeDebugEnabled = isBrowserbase || process.env.IFRAME_DEBUG === "1";
const TEST_VIEWPORT = { width: 1288, height: 711 };

type FrameTreeNode = {
  frame: { id: string; parentId?: string; url?: string };
  childFrames?: FrameTreeNode[];
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const flattenFrameTree = (
  node: FrameTreeNode,
  out: Array<{ id: string; parentId: string | null; url: string }> = [],
): Array<{ id: string; parentId: string | null; url: string }> => {
  out.push({
    id: node.frame.id,
    parentId: node.frame.parentId ?? null,
    url: node.frame.url ?? "",
  });
  for (const child of node.childFrames ?? []) {
    flattenFrameTree(child, out);
  }
  return out;
};

function debugLog(
  step: string,
  payload?: Record<string, unknown> | string,
): void {
  if (!iframeDebugEnabled) return;
  if (payload === undefined) {
    console.log(`[iframe-debug] ${step}`);
    return;
  }
  if (typeof payload === "string") {
    console.log(`[iframe-debug] ${step}: ${payload}`);
    return;
  }
  try {
    console.log(`[iframe-debug] ${step}: ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[iframe-debug] ${step}: <unserializable payload>`);
  }
}

async function collectFrameSnapshot(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const known = new Map<string, ReturnType<Page["frames"]>[number]>();
  known.set(page.mainFrame().frameId, page.mainFrame());
  for (const frame of page.frames()) known.set(frame.frameId, frame);

  return Promise.all(
    [...known.values()].map(async (frame) => {
      try {
        const state = await frame.evaluate(() => {
          return {
            href: location.href,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            iframeCount: document.querySelectorAll("iframe").length,
            hasShadowHost: Boolean(document.querySelector("shadow-host")),
          };
        });
        return {
          frameId: frame.frameId,
          sessionId: frame.sessionId ?? "root",
          ...state,
        };
      } catch (error) {
        return {
          frameId: frame.frameId,
          sessionId: frame.sessionId ?? "root",
          error: formatError(error),
        };
      }
    }),
  );
}

async function logPageDiagnostics(
  page: Page,
  reason: string,
  markerSelector?: string,
): Promise<void> {
  if (!iframeDebugEnabled) return;
  const diagnostics: Record<string, unknown> = {
    reason,
    pageUrl: page.url(),
    mainFrameId: page.mainFrame().frameId,
    knownFrameCount: page.frames().length,
  };

  try {
    const domState = await page.mainFrame().evaluate((marker) => {
      const el = marker ? document.querySelector(marker) : null;
      const rect =
        el instanceof Element ? el.getBoundingClientRect().toJSON() : null;
      return {
        href: location.href,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        markerSelector: marker,
        markerPresent: Boolean(el),
        markerRect: rect,
        iframeCount: document.querySelectorAll("iframe").length,
      };
    }, markerSelector);
    diagnostics.domState = domState;
  } catch (error) {
    diagnostics.domStateError = formatError(error);
  }

  try {
    const frameTreeResponse = (await page.sendCDP("Page.getFrameTree")) as {
      frameTree?: FrameTreeNode;
    };
    if (frameTreeResponse.frameTree) {
      diagnostics.cdpFrameTree = flattenFrameTree(frameTreeResponse.frameTree);
    }
  } catch (error) {
    diagnostics.cdpFrameTreeError = formatError(error);
  }

  diagnostics.frameSnapshot = await collectFrameSnapshot(page);
  debugLog("page-diagnostics", diagnostics);
}

async function closeAllPages(ctx: V3Context): Promise<void> {
  const pages = ctx.pages();
  await Promise.allSettled(pages.map((page) => page.close()));
}

/**
 * Poll until a child frame (non-main) appears on `page` and its document
 * has finished loading.  Returns the child frame.
 */
async function waitForChildFrame(
  page: Page,
  timeoutMs = CHILD_FRAME_TIMEOUT_MS,
): Promise<ReturnType<Page["frames"]>[number]> {
  const mainFrameId = page.mainFrame().frameId;
  const deadline = Date.now() + timeoutMs;
  let observedFrameCount = 0;
  let lastUrl = "";
  let lastLogAt = Date.now();

  while (Date.now() < deadline) {
    const frames = page.frames();
    observedFrameCount = Math.max(observedFrameCount, frames.length);
    lastUrl = page.url();
    const childIds = frames
      .filter((f) => f.frameId !== mainFrameId)
      .map((f) => f.frameId);
    if (iframeDebugEnabled && Date.now() - lastLogAt >= DEBUG_INTERVAL_MS) {
      debugLog("waitForChildFrame:progress", {
        url: lastUrl,
        mainFrameId,
        observedFrameCount,
        childIds,
      });
      lastLogAt = Date.now();
    }
    const child = frames.find((f) => f.frameId !== mainFrameId);
    if (child) {
      try {
        const ready = await child.evaluate(() => document.readyState);
        if (ready === "complete") {
          debugLog("waitForChildFrame:ready", {
            childFrameId: child.frameId,
            url: lastUrl,
          });
          return child;
        }
      } catch {
        // frame not ready yet
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await logPageDiagnostics(page, "waitForChildFrame timeout");
  throw new Error(
    `Timed out waiting for child frame to load (timeout=${timeoutMs}ms, mainFrameId=${mainFrameId}, maxObservedFrames=${observedFrameCount}, url=${lastUrl || "<unknown>"})`,
  );
}

async function waitForPageUrl(
  page: Page,
  expectedUrlSubstring: string,
  timeoutMs = POPUP_URL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = "";
  let lastLogAt = Date.now();
  while (Date.now() < deadline) {
    lastUrl = page.url();
    if (iframeDebugEnabled && Date.now() - lastLogAt >= DEBUG_INTERVAL_MS) {
      debugLog("waitForPageUrl:progress", {
        expectedUrlSubstring,
        lastUrl,
      });
      lastLogAt = Date.now();
    }
    if (lastUrl.includes(expectedUrlSubstring)) {
      debugLog("waitForPageUrl:ready", {
        expectedUrlSubstring,
        lastUrl,
      });
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await logPageDiagnostics(
    page,
    `waitForPageUrl timeout for ${expectedUrlSubstring}`,
  );
  throw new Error(
    `Timed out waiting for popup URL to include "${expectedUrlSubstring}" (timeout=${timeoutMs}ms, lastUrl=${lastUrl || "<unknown>"})`,
  );
}

async function preparePopupForFrameAttach(
  page: Page,
  markerSelector: string,
  timeoutMs = CHILD_FRAME_TIMEOUT_MS,
): Promise<void> {
  debugLog("preparePopupForFrameAttach:start", {
    markerSelector,
    timeoutMs,
    url: page.url(),
  });
  await page.waitForLoadState("domcontentloaded", timeoutMs);
  await page.waitForSelector(markerSelector, {
    state: "attached",
    timeout: timeoutMs,
  });
  await page.mainFrame().evaluate(() => {
    const host = document.querySelector("shadow-host");
    if (host instanceof HTMLElement) {
      host.scrollIntoView({ block: "center", inline: "center" });
    } else {
      window.scrollTo(0, document.body.scrollHeight);
      window.scrollTo(0, 0);
    }
    window.dispatchEvent(new Event("scroll"));
  });
  await logPageDiagnostics(
    page,
    "preparePopupForFrameAttach:ready",
    markerSelector,
  );
}

async function ensurePopupViewport(page: Page): Promise<void> {
  await page.setViewportSize(TEST_VIEWPORT.width, TEST_VIEWPORT.height);
  await logPageDiagnostics(page, "ensurePopupViewport");
}

async function waitForPopupPage(
  ctx: V3Context,
  opener: Page,
  timeoutMs = POPUP_TIMEOUT_MS,
): Promise<Page> {
  const openerMainFrameId = opener.mainFrame().frameId;
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = Date.now();

  while (Date.now() < deadline) {
    const pages = ctx.pages();
    const popup = pages.find((candidate) => {
      return candidate.mainFrame().frameId !== openerMainFrameId;
    });
    if (popup) {
      debugLog("waitForPopupPage:found", {
        openerMainFrameId,
        popupMainFrameId: popup.mainFrame().frameId,
        popupUrl: popup.url(),
      });
      return popup;
    }

    if (iframeDebugEnabled && Date.now() - lastLogAt >= DEBUG_INTERVAL_MS) {
      debugLog("waitForPopupPage:progress", {
        openerMainFrameId,
        observedPageIds: pages.map((p) => p.mainFrame().frameId),
      });
      lastLogAt = Date.now();
    }

    try {
      const active = await ctx.awaitActivePage(500);
      if (active.mainFrame().frameId !== openerMainFrameId) {
        debugLog("waitForPopupPage:active-non-opener", {
          openerMainFrameId,
          activeMainFrameId: active.mainFrame().frameId,
          activeUrl: active.url(),
        });
        return active;
      }
    } catch {
      // keep polling until timeout
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  const pageIds = ctx
    .pages()
    .map((p) => p.mainFrame().frameId)
    .join(", ");
  throw new Error(
    `Timed out waiting for popup page (timeout=${timeoutMs}ms, openerMainFrameId=${openerMainFrameId}, observedPages=[${pageIds}])`,
  );
}

test.describe("context.addInitScript with iframes", () => {
  if (isBrowserbase) {
    test.describe.configure({ mode: "serial" });
  }

  let v3: V3;
  let ctx: V3Context;

  test.beforeAll(async () => {
    debugLog("beforeAll:config", {
      browserTarget: process.env.STAGEHAND_BROWSER_TARGET ?? "local",
      childFrameTimeoutMs: CHILD_FRAME_TIMEOUT_MS,
      popupTimeoutMs: POPUP_TIMEOUT_MS,
      popupUrlTimeoutMs: POPUP_URL_TIMEOUT_MS,
    });
    v3 = new V3(v3TestConfig);
    await v3.init();
    ctx = v3.context;

    // Add init script that sets background to red
    await ctx.addInitScript(`
      (() => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.backgroundColor = 'red';
        });
      })();
    `);
  });

  test.beforeEach(async () => {
    await closeAllPages(ctx);
  });

  test.afterEach(async () => {
    await closeAllPages(ctx);
  });

  test.afterAll(async () => {
    await v3?.close?.().catch(() => {});
  });

  test.describe("direct navigation", () => {
    test("with OOPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.newPage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
        { waitUntil: "networkidle" },
      );

      const iframe = await waitForChildFrame(page);

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      const iframeBgColor = await iframe.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });

    test("with SPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.newPage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-closed-shadow-dom/",
        { waitUntil: "networkidle" },
      );

      const iframe = await waitForChildFrame(page);

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      const iframeBgColor = await iframe.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });
  });

  test.describe("via newPage", () => {
    test("with OOPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.newPage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
        { waitUntil: "networkidle" },
      );

      const iframe = await waitForChildFrame(page);

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      const iframeBgColor = await iframe.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });

    test("with SPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.newPage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-closed-shadow-dom/",
        { waitUntil: "networkidle" },
      );

      const iframe = await waitForChildFrame(page);

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      const iframeBgColor = await iframe.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });
  });

  test.describe("via popup", () => {
    test("with OOPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.newPage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/ctx-add-init-script-oopif/",
        { waitUntil: "networkidle" },
      );

      // Click link to open popup
      await page.locator("a").click();
      debugLog("popup-oopif:clicked-link", { openerUrl: page.url() });

      // Wait for popup to open and become active
      const popup = await waitForPopupPage(ctx, page);
      ctx.setActivePage(popup);
      await ensurePopupViewport(popup);
      await waitForPageUrl(
        popup,
        "/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
      );
      debugLog("popup-oopif:refresh-navigation", { url: popup.url() });
      await popup.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
        { waitUntil: "networkidle" },
      );
      await logPageDiagnostics(
        popup,
        "popup-oopif:after-refresh",
        "shadow-host",
      );
      await preparePopupForFrameAttach(popup, "shadow-host");
      const iframe = await waitForChildFrame(popup);

      // Check popup main page background
      const mainBgColor = await popup.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      const iframeBgColor = await iframe.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });

    test("with SPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.newPage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/ctx-add-init-script-spif/",
        { waitUntil: "networkidle" },
      );

      // Click link to open popup
      await page.locator("a").click();
      debugLog("popup-spif:clicked-link", { openerUrl: page.url() });

      // Wait for popup to open and become active
      const popup = await waitForPopupPage(ctx, page);
      ctx.setActivePage(popup);
      await ensurePopupViewport(popup);
      await waitForPageUrl(
        popup,
        "/stagehand-eval-sites/sites/closed-shadow-dom-in-spif/",
      );
      await preparePopupForFrameAttach(popup, "iframe");
      const iframe = await waitForChildFrame(popup);

      // Check popup main page background
      const mainBgColor = await popup.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      const iframeBgColor = await iframe.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });
  });
});
