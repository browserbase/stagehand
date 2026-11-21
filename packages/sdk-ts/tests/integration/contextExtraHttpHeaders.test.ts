import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("context.setExtraHTTPHeaders", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeEach(async () => {
    fixture = await startFixtureServer((request) => ({
      body: String(request.headers["x-stagehand-test"] ?? "missing"),
    }));
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("applies headers to navigation requests", async () => {
    await stagehand.browser.context.setExtraHTTPHeaders({ "x-stagehand-test": "yes" });
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);

    await expect(page.locator("body").innerText()).resolves.toBe("yes");
  });
});

describe("context.setExtraHTTPHeaders in cross-site iframes", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;
  let childFetchHeaders: Record<string, string | string[] | undefined> | undefined;

  beforeEach(async () => {
    childFetchHeaders = undefined;
    fixture = await startFixtureServer({
      "/": () => {
        const childUrl = new URL("/child", fixture.url);
        childUrl.hostname = "child.test";
        return `<!doctype html><iframe src="${childUrl.href}"></iframe>`;
      },
      "/child":
        '<!doctype html><button id="child" onclick="fetch(\'/child-fetch\')">Child action</button>',
      "/child-fetch": (request) => {
        childFetchHeaders = request.headers;
        return "ok";
      },
    });
    stagehand = await createStagehand({
      browser: {
        args: ["--host-resolver-rules=MAP child.test 127.0.0.1", "--site-per-process"],
      },
    });
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  // The click runs after Stagehand adopts the iframe's own CDP session, so the fetch
  // reflects the headers that session ends up with rather than the pre-adoption ones.
  it("applies headers to requests the iframe sends after it loads", async () => {
    await stagehand.browser.context.setExtraHTTPHeaders({ "x-stagehand-test": "yes" });
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);
    await page.locator("iframe >> #child").click();

    await expect.poll(() => childFetchHeaders).toBeDefined();
    expect(childFetchHeaders?.["x-stagehand-test"]).toBe("yes");
  });

  it("layers page headers on top of context headers in the iframe", async () => {
    await stagehand.browser.context.setExtraHTTPHeaders({ "x-stagehand-test": "yes" });
    const page = await firstPage(stagehand);
    await page.setExtraHTTPHeaders({ "x-page-header": "from-page" });
    await page.goto(fixture.url);
    await page.locator("iframe >> #child").click();

    await expect.poll(() => childFetchHeaders).toBeDefined();
    expect(childFetchHeaders?.["x-stagehand-test"]).toBe("yes");
    expect(childFetchHeaders?.["x-page-header"]).toBe("from-page");
  });
});
