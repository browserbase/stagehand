import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { V3Context } from "../understudy/context";
import type { Page } from "../understudy/page";

const isBrowserbase =
  (process.env.STAGEHAND_BROWSER_TARGET ?? "local").toLowerCase() ===
  "browserbase";
const isCi = process.env.CI === "true";
const CHILD_FRAME_TIMEOUT_MS = Number(
  process.env.IFRAME_CHILD_FRAME_TIMEOUT_MS ??
    (isBrowserbase && isCi ? "20000" : "10000"),
);
const POPUP_TIMEOUT_MS = Number(
  process.env.IFRAME_POPUP_TIMEOUT_MS ??
    (isBrowserbase && isCi ? "20000" : "10000"),
);

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

  while (Date.now() < deadline) {
    const frames = page.frames();
    observedFrameCount = Math.max(observedFrameCount, frames.length);
    const child = frames.find((f) => f.frameId !== mainFrameId);
    if (child) {
      try {
        const ready = await child.evaluate(() => document.readyState);
        if (ready === "complete") return child;
      } catch {
        // frame not ready yet
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Timed out waiting for child frame to load (timeout=${timeoutMs}ms, mainFrameId=${mainFrameId}, maxObservedFrames=${observedFrameCount})`,
  );
}

async function waitForPopupPage(
  ctx: V3Context,
  opener: Page,
  timeoutMs = POPUP_TIMEOUT_MS,
): Promise<Page> {
  const openerMainFrameId = opener.mainFrame().frameId;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pages = ctx.pages();
    const popup = pages.find((candidate) => {
      return candidate.mainFrame().frameId !== openerMainFrameId;
    });
    if (popup) {
      return popup;
    }

    try {
      const active = await ctx.awaitActivePage(500);
      if (active.mainFrame().frameId !== openerMainFrameId) {
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
  let v3: V3;
  let ctx: V3Context;

  test.beforeEach(async () => {
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

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test.describe("direct navigation", () => {
    test("with OOPIF - sets background red in main page and iframe", async () => {
      const page = await ctx.awaitActivePage();

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
      const page = await ctx.awaitActivePage();

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
      const page = await ctx.awaitActivePage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/ctx-add-init-script-oopif/",
        { waitUntil: "networkidle" },
      );

      // Click link to open popup
      await page.locator("a").click();

      // Wait for popup to open and become active
      const popup = await waitForPopupPage(ctx, page);
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
      const page = await ctx.awaitActivePage();

      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/ctx-add-init-script-spif/",
        { waitUntil: "networkidle" },
      );

      // Click link to open popup
      await page.locator("a").click();

      // Wait for popup to open and become active
      const popup = await waitForPopupPage(ctx, page);
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
