import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("Page.waitForURL", () => {
  let stagehand: Stagehand;
  let fixture: FixtureServer;
  let page: Page;
  const image = Promise.withResolvers<void>();

  beforeAll(async () => {
    fixture = await startFixtureServer({
      "/": '<!doctype html><title>Start</title><a href="/target">Navigate</a>',
      "/target": '<!doctype html><title>Target</title><img src="/slow-image">',
      "/slow-image": async () => {
        await image.promise;
        return {
          headers: { "content-type": "image/svg+xml" },
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        };
      },
      "/frame": "<!doctype html><title>Frame</title>",
    });
    stagehand = await createStagehand();
  });

  beforeEach(async () => {
    page = await firstPage(stagehand);
    await page.goto(fixture.url);
  });

  afterAll(async () => {
    image.resolve();
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("matches an already-loaded exact URL, treating query punctuation literally", async () => {
    const url = `${fixture.url}?value=(a+b)#section`;
    await page.goto(url);
    await page.waitForURL(url, { timeout: 1_000 });
    expect(await page.evaluate("document.readyState")).toBe("complete");
  });

  it("observes history and hash changes without requiring a new document", async () => {
    const pending = page.waitForURL("**/done#section");
    await page.evaluate("history.pushState({}, '', '/done#section')");
    await pending;
    await page.waitForURL("**/done#*", { timeout: 0 });
  });

  it("waits for the matched navigation's requested lifecycle state", async () => {
    let loaded = false;
    const dom = page.waitForURL("**/target", { waitUntil: "domcontentloaded" });
    const load = page.waitForURL("**/target").then(() => {
      loaded = true;
    });
    try {
      await page.evaluate("document.querySelector('a').click()");
      await dom;
      expect(loaded).toBe(false);
      expect(await page.evaluate("document.readyState")).toBe("interactive");
      image.resolve();
      await load;
      expect(await page.evaluate("document.readyState")).toBe("complete");
    } finally {
      image.resolve();
      await Promise.allSettled([dom, load]);
    }
  });

  it("does not match a child-frame URL", async () => {
    const pending = page.waitForURL("**/frame", { timeout: 1_000 });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const framePath = await page.evaluate(`new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.onload = () => resolve(frame.contentWindow.location.pathname);
      frame.src = '/frame';
      document.body.append(frame);
    })`);
    expect(framePath).toBe("/frame");
    expect(settled).toBe(false);
    await expect(pending).rejects.toThrow(/timed out/);
  });

  it("rejects a nonmatching URL at its deadline", async () => {
    await expect(page.waitForURL("**/never", { timeout: 100 })).rejects.toThrow(/timed out/);
  });

  it("ends an unbounded wait when its page closes", async () => {
    const disposable = await stagehand.browser.context.newPage(fixture.url);
    const pending = disposable.waitForURL("**/never", { timeout: 0 });
    const rejected = expect(pending).rejects.toThrow(/closed|Page not found/);
    await disposable.close();
    await rejected;
  });
});
