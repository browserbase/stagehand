import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("Page.goto() response surface", () => {
  let fixtureServer: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer({
      "/": {
        status: 200,
        headers: { "x-stagehand-fixture": "goto-response" },
        body: "<!doctype html><html><body><h1>Example Domain</h1></body></html>",
      },
    });
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixtureServer.close();
  });

  it("returns the page for network navigations", async () => {
    const page = await firstPage(stagehand);
    const response = await page.goto(fixtureServer.url, { waitUntil: "load" });

    expect(response).toBe(page);
    await expect(
      page.evaluate("performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0"),
    ).resolves.toBe(200);
    await expect(
      page.evaluate(
        "performance.getEntriesByType('navigation')[0]?.responseStatus >= 200 && performance.getEntriesByType('navigation')[0]?.responseStatus < 400",
      ),
    ).resolves.toBe(true);
    await expect(
      page.evaluate(
        "fetch(location.href).then(response => Array.from(response.headers.entries()))",
      ),
    ).resolves.toEqual(expect.arrayContaining([["x-stagehand-fixture", "goto-response"]]));
    await expect(page.locator("body").innerText()).resolves.toContain("Example Domain");
    await expect(page.evaluate("document.readyState")).resolves.toBe("complete");
  });

  it("returns the page for data URLs", async () => {
    const page = await firstPage(stagehand);
    const response = await page.goto(
      "data:text/html,<html><body data-testid='fallback'>inline</body></html>",
    );

    expect(response).toBe(page);
    // v3 asserted `response === null` here, because a data: URL produces no network Response.
    // v4's goto always returns `this`, so that assertion has no v4 equivalent and `toBe(page)`
    // alone is tautological. Assert the data URL actually rendered instead, so the test still
    // fails if data: navigation breaks.
    await expect(page.locator("[data-testid='fallback']").innerText()).resolves.toBe("inline");
    await expect(page.url()).resolves.toContain("data:text/html");
  });
});
