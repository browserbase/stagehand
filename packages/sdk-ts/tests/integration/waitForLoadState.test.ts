import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("Page.waitForLoadState", () => {
  let stagehand: Stagehand;
  let fixture: FixtureServer;

  beforeAll(async () => {
    fixture = await startFixtureServer({
      "/": "<!doctype html><title>idle</title><body>Idle page",
      "/busy": `<!doctype html><title>busy</title><body>Busy page
        <script>
          addEventListener("load", () => fetch("/slow").then(() => { window.slowDone = true; }));
        </script>`,
      "/slow": async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return "done";
      },
      "/worker": `<!doctype html><title>worker</title><body>Worker page
        <script>new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" })));</script>`,
    });
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("resolves networkidle when the page is already idle", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixture.url, { waitUntil: "networkidle" });

    await expect(page.waitForLoadState("networkidle", 2_000)).resolves.toBeUndefined();
  });

  it("waits for in-flight requests before resolving networkidle", async () => {
    const page = await firstPage(stagehand);
    await page.goto(`${fixture.url}busy`, { waitUntil: "load" });

    await page.waitForLoadState("networkidle", 5_000);
    await expect(page.evaluate("window.slowDone")).resolves.toBe(true);
  });

  it("ignores Web Worker scripts", async () => {
    const page = await firstPage(stagehand);
    await page.goto(`${fixture.url}worker`, { waitUntil: "networkidle" });

    await expect(page.waitForLoadState("networkidle", 2_000)).resolves.toBeUndefined();
  });

  it("stops waiting for requests of a document that navigated away", async () => {
    const page = await firstPage(stagehand);
    await page.goto(`${fixture.url}busy`, { waitUntil: "load" });
    await page.evaluate("setTimeout(() => { location.href = '/'; }, 300)");

    await expect(page.waitForLoadState("networkidle", 5_000)).resolves.toBeUndefined();
  });
});
