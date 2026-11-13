import { setTimeout } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  startFixtureServer,
  type FixtureRoutes,
  type FixtureServer,
} from "./_support.js";

function deferredRequest() {
  let release!: () => void;
  let markStarted!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    started,
    release,
    handle: async () => {
      markStarted();
      await response;
      return "done";
    },
  };
}

function observeWait(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return { promise, isSettled: () => settled };
}

async function expectPending(wait: ReturnType<typeof observeWait>) {
  // Observe longer than the 500ms quiet window while the server holds a request open.
  await setTimeout(650);
  expect(wait.isSettled()).toBe(false);
}

function busyPage(requestPath: string, marker = "initial") {
  return `<!doctype html><title>${marker}</title><body>${marker}
    <script>
      window.marker = ${JSON.stringify(marker)};
      window.requestDone = false;
      addEventListener("load", () => fetch(${JSON.stringify(requestPath)})
        .then(response => response.text()).then(() => { window.requestDone = true; }));
    </script>`;
}

describe("Page.waitForLoadState", () => {
  let stagehand: Stagehand;
  let page: Page;
  const fixtures: FixtureServer[] = [];
  const requests: ReturnType<typeof deferredRequest>[] = [];

  function holdRequest() {
    const request = deferredRequest();
    requests.push(request);
    return request;
  }

  async function serve(routes: FixtureRoutes) {
    const fixture = await startFixtureServer(routes);
    fixtures.push(fixture);
    return fixture;
  }

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  beforeEach(async () => {
    page = await stagehand.browser.context.newPage();
  });

  afterEach(async () => {
    for (const request of requests.splice(0)) request.release();
    await page.close().catch(() => {});
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("resolves networkidle after a fresh quiet window when the page is already idle", async () => {
    const fixture = await serve({ "/": "<!doctype html><title>idle</title>Idle page" });
    await page.goto(fixture.url, { waitUntil: "networkidle" });

    const started = Date.now();
    await expect(page.waitForLoadState("networkidle", 2_000)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  });

  it("includes requests that started before goto's networkidle waiter", async () => {
    const request = holdRequest();
    const load = holdRequest();
    const fixture = await serve({
      "/": `<!doctype html><title>busy before load</title>
        <script>
          window.requestDone = false;
          fetch("/held").then(response => response.text())
            .then(() => { window.requestDone = true; });
        </script><img src="/load">`,
      "/held": request.handle,
      "/load": load.handle,
    });
    const navigation = observeWait(page.goto(fixture.url, { waitUntil: "networkidle" }));
    await Promise.all([request.started, load.started]);
    load.release();
    await page.waitForLoadState("load");

    await expectPending(navigation);
    request.release();
    await navigation.promise;
    await expect(page.evaluate("window.requestDone")).resolves.toBe(true);
  });

  it("waits for an existing request and a full quiet window after it finishes", async () => {
    const request = holdRequest();
    const fixture = await serve({ "/": busyPage("/held"), "/held": request.handle });
    await page.goto(fixture.url, { waitUntil: "load" });
    await request.started;
    const wait = observeWait(page.waitForLoadState("networkidle", 5_000));

    await expectPending(wait);
    const released = Date.now();
    request.release();
    await wait.promise;
    expect(Date.now() - released).toBeGreaterThanOrEqual(450);
    await expect(page.evaluate("window.requestDone")).resolves.toBe(true);
  });

  it("keeps waiting for pending requests during a same-document goto", async () => {
    const request = holdRequest();
    const fixture = await serve({ "/": busyPage("/held"), "/held": request.handle });
    await page.goto(fixture.url, { waitUntil: "load" });
    await request.started;
    const navigation = observeWait(
      page.goto(`${fixture.url}#section`, { waitUntil: "networkidle", timeout: 5_000 }),
    );

    await expectPending(navigation);
    request.release();
    await expect(navigation.promise).resolves.toBeNull();
    await expect(page.evaluate("window.requestDone")).resolves.toBe(true);
    await expect(page.url()).resolves.toBe(`${fixture.url}#section`);
  });

  it("ignores Web Worker scripts", async () => {
    const fixture = await serve({
      "/": `<!doctype html><title>worker</title><body>Worker page
        <script>new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" })));</script>`,
    });
    await page.goto(fixture.url, { waitUntil: "networkidle" });

    await expect(page.waitForLoadState("networkidle", 2_000)).resolves.toBeUndefined();
  });

  it.each(["navigation", "same-URL reload"])(
    "follows the replacement document's requests after %s",
    async (transition) => {
      const original = holdRequest();
      const replacement = holdRequest();
      let visits = 0;
      const fixture = await serve({
        "/": () =>
          ++visits === 1 ? busyPage("/original") : busyPage("/replacement", "replacement"),
        "/next": busyPage("/replacement", "replacement"),
        "/original": original.handle,
        "/replacement": replacement.handle,
      });
      await page.goto(fixture.url, { waitUntil: "load" });
      await original.started;
      const wait = observeWait(page.waitForLoadState("networkidle", 5_000));
      await expectPending(wait);

      if (transition === "same-URL reload") {
        await page.reload({ waitUntil: "load" });
      } else {
        await page.goto(`${fixture.url}next`, { waitUntil: "load" });
      }
      await replacement.started;
      await expectPending(wait);

      // Keep the original response blocked: only the replacement document should count.
      replacement.release();
      await wait.promise;
      await expect(
        page.evaluate("({ marker: window.marker, done: window.requestDone })"),
      ).resolves.toEqual({ marker: "replacement", done: true });
    },
  );

  it.each(["goto", "waitForLoadState"])(
    "%s rejects when the timeout is shorter than the required quiet window",
    async (method) => {
      const fixture = await serve({ "/": "<!doctype html><title>idle</title>Idle page" });
      if (method === "goto") {
        await expect(
          page.goto(fixture.url, { waitUntil: "networkidle", timeout: 100 }),
        ).rejects.toThrow(/timed out|timeout/i);
      } else {
        await page.goto(fixture.url, { waitUntil: "load" });
        await expect(page.waitForLoadState("networkidle", 100)).rejects.toThrow(
          /timed out|timeout/i,
        );
      }
    },
  );

  it("keeps one timeout budget across load and the full quiet window", async () => {
    const load = holdRequest();
    const fixture = await serve({
      "/": `<!doctype html><title>loading</title><link rel="icon" href="data:,"><img src="/load">
        <script>window.loaded = false; addEventListener("load", () => { window.loaded = true; });</script>`,
      "/load": load.handle,
    });
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await load.started;
    const wait = observeWait(page.waitForLoadState("networkidle", 1_200));
    await setTimeout(800);
    load.release();
    await page.waitForLoadState("load");

    await expect(wait.promise).rejects.toThrow(/timed out|timeout/i);
    await expect(page.evaluate("window.loaded")).resolves.toBe(true);
  });

  it("rejects a pending idle wait when the page closes", async () => {
    const request = holdRequest();
    const fixture = await serve({ "/": busyPage("/held"), "/held": request.handle });
    await page.goto(fixture.url, { waitUntil: "load" });
    await request.started;
    const wait = observeWait(page.waitForLoadState("networkidle", 10_000));
    await expectPending(wait);

    await page.close();
    await expect.poll(wait.isSettled, { timeout: 1_500 }).toBe(true);
    await expect(wait.promise).rejects.toThrow(/closed|disposed|detached|No Page|target/i);
  });
});
