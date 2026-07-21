import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

// #1924: page targets with a non-web scheme were dropped, so tabs opened with
// Ctrl+T (chrome://newtab/) never attached. Any chrome:// target covers that.
// Not the New Tab Page itself though — chrome://newtab/ and chrome://new-tab-page/
// both segfault Chrome 151 headless on CI runners seconds after the tab opens.
const WEBUI_URL = "chrome://version/";

// data: needs no network, so this behaves the same when the browser is remote
// (e2e-bb). Leaving the WebUI still forces the renderer process swap under test.
const TARGET_MARKER = "newtab target";
const TARGET_URL = `data:text/html,<html><body><h1 id="marker">${TARGET_MARKER}</h1></body></html>`;

test.describe("V3 chrome:// new-tab page tracking", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("pages() includes a tab opened at a chrome:// URL", async () => {
    const ctx = v3.context;
    const initialPages = ctx.pages();
    expect(initialPages.length).toBe(1);

    // Same CDP path the browser takes when the user presses Ctrl+T.
    const { targetId } = await ctx.conn.send<{ targetId: string }>(
      "Target.createTarget",
      { url: WEBUI_URL },
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

  test("a chrome:// tab becomes usable after navigating to a web URL", async () => {
    const ctx = v3.context;

    const { targetId } = await ctx.conn.send<{ targetId: string }>(
      "Target.createTarget",
      { url: WEBUI_URL },
    );

    // Wait for registration.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (ctx.pages().some((p) => p.targetId() === targetId)) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const newPage = ctx.pages().find((p) => p.targetId() === targetId);
    expect(newPage).toBeTruthy();

    // Navigate the new tab out of the privileged WebUI into web content.
    await newPage!.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    expect(newPage!.url()).toContain("data:text/html");

    // The swap must not orphan the caller's Page object.
    expect(ctx.pages().find((p) => p.targetId() === targetId)).toBe(newPage);

    // "Usable" means drivable, not just a correct url().
    expect(await newPage!.locator("#marker").textContent()).toBe(TARGET_MARKER);
  });
});
