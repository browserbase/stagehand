import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { V3Context } from "../understudy/context";

// TODO: mark as unskipped once we have a fix
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

      // Wait for iframe to load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      // Check iframe background - find the child frame (not main frame)
      const frames = page.frames();
      const iframe = frames.find((f) => f !== page.mainFrame());
      expect(iframe).toBeDefined();

      const iframeBgColor = await iframe!.evaluate(() => {
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

      // Wait for iframe to load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      // Check iframe background - find the child frame (not main frame)
      const frames = page.frames();
      const iframe = frames.find((f) => f !== page.mainFrame());
      expect(iframe).toBeDefined();

      const iframeBgColor = await iframe!.evaluate(() => {
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

      // Wait for iframe to load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      // Check iframe background - find the child frame (not main frame)
      const frames = page.frames();
      const iframe = frames.find((f) => f !== page.mainFrame());
      expect(iframe).toBeDefined();

      const iframeBgColor = await iframe!.evaluate(() => {
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

      // Wait for iframe to load
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check main page background
      const mainBgColor = await page.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      // Check iframe background - find the child frame (not main frame)
      const frames = page.frames();
      const iframe = frames.find((f) => f !== page.mainFrame());
      expect(iframe).toBeDefined();

      const iframeBgColor = await iframe!.evaluate(() => {
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

      // Wait for iframe to load in popup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check popup main page background
      const mainBgColor = await popup.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      // Check iframe background in popup - find the child frame (not main frame)
      const frames = popup.frames();
      const iframe = frames.find((f) => f !== popup.mainFrame());
      expect(iframe).toBeDefined();

      const iframeBgColor = await iframe!.evaluate(() => {
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

      // Wait for iframe to load in popup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check popup main page background
      const mainBgColor = await popup.mainFrame().evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(mainBgColor).toBe("rgb(255, 0, 0)");

      // Check iframe background in popup - find the child frame (not main frame)
      const frames = popup.frames();
      const iframe = frames.find((f) => f !== popup.mainFrame());
      expect(iframe).toBeDefined();

      const iframeBgColor = await iframe!.evaluate(() => {
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(iframeBgColor).toBe("rgb(255, 0, 0)");
    });
  });
});
