import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const PAST_IDLE_WINDOW_MS = 1_000;

function track(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

describe("Page.waitForLoadState", () => {
  let stagehand: Stagehand;
  let fixture: FixtureServer;
  let releaseSlow: () => void = () => {};
  let slowGate: Promise<void> = Promise.resolve();

  beforeAll(async () => {
    fixture = await startFixtureServer({
      "/": "<!doctype html><title>idle</title><body>Idle page",
      "/busy": `<!doctype html><title>busy</title><body>Busy page
        <script>
          addEventListener("load", () => fetch("/slow").then(() => { window.slowDone = true; }));
        </script>`,
      "/slow": async () => {
        await slowGate;
        return "done";
      },
      "/worker": `<!doctype html><title>worker</title><body>Worker page
        <script>new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" })));</script>`,
    });
    stagehand = await createStagehand();
  });

  beforeEach(() => {
    slowGate = new Promise((resolve) => {
      releaseSlow = resolve;
    });
  });

  afterEach(() => {
    releaseSlow();
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

    const idle = page.waitForLoadState("networkidle", 10_000);
    const state = track(idle);
    await page.waitForTimeout(PAST_IDLE_WINDOW_MS);
    expect(state.settled).toBe(false);

    releaseSlow();
    await expect(idle).resolves.toBeUndefined();
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

    const idle = page.waitForLoadState("networkidle", 10_000);
    const state = track(idle);
    await page.waitForTimeout(PAST_IDLE_WINDOW_MS);
    expect(state.settled).toBe(false);

    // Deferred so the evaluate call returns before its execution context is destroyed.
    await page.evaluate("setTimeout(() => { location.href = '/'; }, 0)");
    await expect(idle).resolves.toBeUndefined();
  });

  it.each(["goto", "reload"] as const)(
    "waits for the new document's requests after %s replaces the document",
    async (method) => {
      const page = await firstPage(stagehand);
      await page.goto(`${fixture.url}busy`, { waitUntil: "load" });

      const idle = page.waitForLoadState("networkidle", 15_000);
      const state = track(idle);
      await page.waitForTimeout(300);
      await (method === "goto"
        ? page.goto(`${fixture.url}busy?next`, { waitUntil: "load" })
        : page.reload({ waitUntil: "load" }));

      await page.waitForTimeout(PAST_IDLE_WINDOW_MS);
      expect(state.settled).toBe(false);

      releaseSlow();
      await expect(idle).resolves.toBeUndefined();
      await expect(page.evaluate("window.slowDone")).resolves.toBe(true);
    },
  );
});
