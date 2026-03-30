import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

test.describe("V3 chrome:// new-tab page tracking", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("pages() includes a tab opened via chrome://newtab/", async () => {
    const ctx = v3.context;
    const initialPages = ctx.pages();
    expect(initialPages.length).toBe(1);

    // Simulate a manually-opened tab by creating a target at chrome://newtab/.
    // This is the same CDP path the browser takes when the user presses Ctrl+T.
    const { targetId } = await ctx.conn.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "chrome://newtab/" },
    );

    // Wait for the page to be registered (onAttachedToTarget is async).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (ctx.pages().length >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const pages = ctx.pages();
    expect(pages.length).toBe(2);

    // The new page's target should match the one we created.
    const newPage = pages.find((p) => p.targetId() === targetId);
    expect(newPage).toBeTruthy();
  });

  test("chrome://newtab/ tab becomes usable after navigating to a web URL", async () => {
    const ctx = v3.context;

    // Create a tab at chrome://newtab/ (same as user pressing Ctrl+T).
    const { targetId } = await ctx.conn.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "chrome://newtab/" },
    );

    // Wait for registration.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (ctx.pages().some((p) => p.targetId() === targetId)) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const newPage = ctx.pages().find((p) => p.targetId() === targetId);
    expect(newPage).toBeTruthy();

    // Navigate the new tab to a real web page.
    await newPage!.goto("https://example.com/", {
      waitUntil: "domcontentloaded",
    });

    expect(newPage!.url()).toContain("example.com");
  });
});
