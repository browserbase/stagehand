import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { V3Context } from "../understudy/context";
import type { Page } from "../understudy/page";

/**
 * Poll until a child frame (non-main) appears on `page` and its document
 * has finished loading.  Returns the child frame.
 */
async function waitForChildFrame(
  page: Page,
  timeoutMs = 10_000,
): Promise<ReturnType<Page["frames"]>[number]> {
  const mainFrameId = page.mainFrame().frameId;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const frames = page.frames();
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
  throw new Error("Timed out waiting for child frame to load");
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
      const popup = await ctx.awaitActivePage();
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
      const popup = await ctx.awaitActivePage();
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
