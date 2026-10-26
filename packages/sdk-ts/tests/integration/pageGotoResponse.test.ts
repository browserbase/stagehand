import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Response, type Stagehand } from "../../src/index.js";
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

  it("returns a response for network navigations", async () => {
    const page = await firstPage(stagehand);
    const response = await page.goto(fixtureServer.url, { waitUntil: "load" });

    expect(response).toBeInstanceOf(Response);
    expect(response?.url()).toBe(fixtureServer.url);
    expect(response?.status()).toBe(200);
    expect(response?.statusText()).toBe("OK");
    expect(response?.ok()).toBe(true);
    expect(response?.headers()["x-stagehand-fixture"]).toBe("goto-response");
    await expect(response?.headerValue("X-Stagehand-Fixture")).resolves.toBe("goto-response");
    await expect(response?.text()).resolves.toContain("Example Domain");
    await expect(response?.finished()).resolves.toBeNull();
    await expect(page.locator("body").innerText()).resolves.toContain("Example Domain");
    await expect(page.evaluate("document.readyState")).resolves.toBe("complete");
  });

  it("returns null for data URLs", async () => {
    const page = await firstPage(stagehand);
    const response = await page.goto(
      "data:text/html,<html><body data-testid='fallback'>inline</body></html>",
    );

    expect(response).toBeNull();
    await expect(page.locator("[data-testid='fallback']").innerText()).resolves.toBe("inline");
    await expect(page.url()).resolves.toContain("data:text/html");
  });
});
