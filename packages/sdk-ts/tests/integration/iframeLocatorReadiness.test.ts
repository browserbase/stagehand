import { afterEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const HOST_CHILD_DELAY_MS = 4_000;
const DEEP_CHILD_DELAY_MS = 300;
const FAST_CLICK_BUDGET_MS = 1_500;
const XPATH_IFRAME = "xpath=/html[1]/body[1]/div[1]/iframe[1]";
const XPATH_INNER = "xpath=/html[1]/body[1]/div[1]/iframe[1]/html[1]/body[1]/div[1]/button[1]";

type IframeFixture = {
  parent: FixtureServer;
  child: FixtureServer;
  parentGotoUrl: string;
  clickCount: () => number;
  childServed: () => number;
};

function createChildResponseGate(): { ready: Promise<void>; release: () => void } {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function createDelayedIframeFixture(options: {
  /** Absolute iframe src written into the parent HTML. */
  childSrc: (child: FixtureServer) => string;
  childDelayMs: number;
  childResponseGate?: Promise<void>;
  /** URL passed to page.goto (may use a mapped hostname). */
  parentGotoUrl: (parent: FixtureServer) => string;
}): Promise<IframeFixture> {
  let clickCount = 0;
  let childServed = 0;

  const child = await startFixtureServer({
    "/child": async () => {
      await options.childResponseGate;
      await new Promise((resolve) => setTimeout(resolve, options.childDelayMs));
      childServed += 1;
      return {
        body: `<!doctype html><html><body style="margin:0">
<div style="padding:20px">
  <button id="b" style="width:300px;height:120px"
    onclick="fetch('/clicked').catch(()=>{})">click me</button>
</div>
</body></html>`,
      };
    },
    "/clicked": () => {
      clickCount += 1;
      return { headers: { "content-type": "text/plain" }, body: "ok" };
    },
  });

  const parent = await startFixtureServer({
    "/": `<!doctype html><html><body style="margin:0">
<div style="padding:40px">
  <iframe src="${options.childSrc(child)}" width="600" height="360"></iframe>
</div>
</body></html>`,
  });

  return {
    parent,
    child,
    parentGotoUrl: options.parentGotoUrl(parent),
    clickCount: () => clickCount,
    childServed: () => childServed,
  };
}

async function waitForIframeElement(page: Awaited<ReturnType<typeof firstPage>>): Promise<void> {
  await expect.poll(async () => page.locator("iframe").count(), { timeout: 10_000 }).toBe(1);
}

describe("iframe locator readiness", () => {
  const stagehands: Stagehand[] = [];
  const fixtures: IframeFixture[] = [];

  afterEach(async () => {
    await Promise.all(stagehands.splice(0).map((stagehand) => closeStagehand(stagehand)));
    await Promise.all(
      fixtures.splice(0).map(async (fixture) => {
        await Promise.all([fixture.parent.close(), fixture.child.close()]);
      }),
    );
  });

  it.each([
    { oopif: false, directClick: false },
    { oopif: true, directClick: false },
    { oopif: false, directClick: true },
    { oopif: true, directClick: true },
  ])(
    "four-second child load (OOPIF: $oopif, default locator timeout: $directClick)",
    async ({ oopif, directClick }) => {
      const gate = createChildResponseGate();
      const fixture = await createDelayedIframeFixture({
        childDelayMs: 4000,
        childResponseGate: gate.ready,
        childSrc: (child) =>
          oopif
            ? new URL("/child", child.url.replace("127.0.0.1", "child.test")).href
            : new URL("/child", child.url).href,
        parentGotoUrl: (parent) =>
          oopif ? parent.url.replace("127.0.0.1", "parent.test") : parent.url,
      });
      fixtures.push(fixture);
      const stagehand = await createStagehand(
        oopif
          ? {
              browser: {
                args: [
                  "--host-resolver-rules=MAP parent.test 127.0.0.1,MAP child.test 127.0.0.1",
                  "--site-per-process",
                ],
              },
            }
          : undefined,
      );
      stagehands.push(stagehand);
      const page = await firstPage(stagehand);
      await page.goto(fixture.parentGotoUrl, { waitUntil: "domcontentloaded" });
      await waitForIframeElement(page);
      const waiting = directClick
        ? page.locator(XPATH_INNER).click()
        : page.waitForSelector(XPATH_INNER, { timeout: 8000 });
      gate.release();
      await waiting;
      if (!directClick) await page.locator(XPATH_INNER).click();
      await expect.poll(fixture.clickCount).toBe(1);
    },
  );

  it("short act and selector deadlines expire during readiness without a late click", async () => {
    const gate = createChildResponseGate();
    const fixture = await createDelayedIframeFixture({
      childDelayMs: 0,
      childResponseGate: gate.ready,
      childSrc: (child) => new URL("/child", child.url).href,
      parentGotoUrl: (parent) => parent.url,
    });
    fixtures.push(fixture);
    const stagehand = await createStagehand();
    stagehands.push(stagehand);
    const page = await firstPage(stagehand);
    await page.goto(fixture.parentGotoUrl, { waitUntil: "domcontentloaded" });
    await waitForIframeElement(page);
    try {
      const started = Date.now();
      await expect(page.waitForSelector(XPATH_INNER, { timeout: 250 })).rejects.toThrow(/250ms/);
      await expect(
        stagehand.act(
          { selector: XPATH_INNER, method: "click", arguments: [], description: "click child" },
          { timeout: 250 },
        ),
      ).rejects.toThrow(/250ms/);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      gate.release();
    }
    await page.waitForSelector(XPATH_INNER, { timeout: 5000 });
    // Readiness completing later must not resume either expired operation.
    await page.waitForTimeout(200);
    expect(fixture.clickCount()).toBe(0);
  });

  it("same-process trailing iframe XPath clicks without waiting for the child document", async () => {
    const fixture = await createDelayedIframeFixture({
      childDelayMs: HOST_CHILD_DELAY_MS,
      childSrc: (child) => new URL("/child", child.url).href,
      parentGotoUrl: (parent) => parent.url,
    });
    fixtures.push(fixture);

    const stagehand = await createStagehand();
    stagehands.push(stagehand);
    const page = await firstPage(stagehand);
    await page.goto(fixture.parentGotoUrl, { waitUntil: "domcontentloaded" });
    await waitForIframeElement(page);

    expect(fixture.childServed()).toBe(0);
    const started = Date.now();
    await page.locator(XPATH_IFRAME).click();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(FAST_CLICK_BUDGET_MS);
    expect(fixture.childServed()).toBe(0);
  });

  it("same-process deep XPath handles brief child initialization and clicks the button", async () => {
    const gate = createChildResponseGate();
    const fixture = await createDelayedIframeFixture({
      childDelayMs: DEEP_CHILD_DELAY_MS,
      childResponseGate: gate.ready,
      childSrc: (child) => new URL("/child", child.url).href,
      parentGotoUrl: (parent) => parent.url,
    });
    fixtures.push(fixture);

    const stagehand = await createStagehand();
    stagehands.push(stagehand);
    const page = await firstPage(stagehand);
    await page.goto(fixture.parentGotoUrl, { waitUntil: "domcontentloaded" });
    await waitForIframeElement(page);

    expect(fixture.childServed()).toBe(0);
    // Start the action while the child response is held, then allow brief initialization.
    const click = page.locator(XPATH_INNER).click();
    gate.release();
    await click;

    await expect.poll(() => fixture.clickCount(), { timeout: 5_000 }).toBe(1);
  });

  it("OOPIF trailing iframe XPath clicks without waiting for the child document", async () => {
    let childServed = 0;
    const child = await startFixtureServer({
      "/child": async () => {
        await new Promise((resolve) => setTimeout(resolve, HOST_CHILD_DELAY_MS));
        childServed += 1;
        return {
          body: `<!doctype html><html><body style="margin:0">
<div style="padding:20px">
  <button id="b" style="width:300px;height:120px"
    onclick="fetch('/clicked').catch(()=>{})">click me</button>
</div>
</body></html>`,
        };
      },
    });
    const childPort = new URL(child.url).port;

    const parent = await startFixtureServer({
      "/": `<!doctype html><html><body style="margin:0">
<div style="padding:40px">
  <iframe src="http://child.test:${childPort}/child" width="600" height="360"></iframe>
</div>
</body></html>`,
    });
    const parentPort = new URL(parent.url).port;
    fixtures.push({
      parent,
      child,
      parentGotoUrl: `http://parent.test:${parentPort}/`,
      clickCount: () => 0,
      childServed: () => childServed,
    });

    const stagehand = await createStagehand({
      browser: {
        args: [
          `--host-resolver-rules=MAP parent.test 127.0.0.1:${parentPort},MAP child.test 127.0.0.1:${childPort}`,
          "--site-per-process",
        ],
      },
    });
    stagehands.push(stagehand);
    const page = await firstPage(stagehand);
    await page.goto(`http://parent.test:${parentPort}/`, { waitUntil: "domcontentloaded" });
    await waitForIframeElement(page);

    expect(childServed).toBe(0);
    const started = Date.now();
    await page.locator(XPATH_IFRAME).click();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(FAST_CLICK_BUDGET_MS);
    expect(childServed).toBe(0);
  });

  it("OOPIF deep XPath handles brief initialization across session adoption and clicks", async () => {
    const gate = createChildResponseGate();
    let clickCount = 0;
    let childServed = 0;
    const child = await startFixtureServer({
      "/child": async () => {
        await gate.ready;
        await new Promise((resolve) => setTimeout(resolve, DEEP_CHILD_DELAY_MS));
        childServed += 1;
        return {
          body: `<!doctype html><html><body style="margin:0">
<div style="padding:20px">
  <button id="b" style="width:300px;height:120px"
    onclick="fetch('/clicked').catch(()=>{})">click me</button>
</div>
</body></html>`,
        };
      },
      "/clicked": () => {
        clickCount += 1;
        return { headers: { "content-type": "text/plain" }, body: "ok" };
      },
    });
    const childPort = new URL(child.url).port;
    const parent = await startFixtureServer({
      "/": `<!doctype html><html><body style="margin:0">
<div style="padding:40px">
  <iframe src="http://child.test:${childPort}/child" width="600" height="360"></iframe>
</div>
</body></html>`,
    });
    const parentPort = new URL(parent.url).port;
    fixtures.push({
      parent,
      child,
      parentGotoUrl: `http://parent.test:${parentPort}/`,
      clickCount: () => clickCount,
      childServed: () => childServed,
    });

    const stagehand = await createStagehand({
      browser: {
        args: [
          `--host-resolver-rules=MAP parent.test 127.0.0.1:${parentPort},MAP child.test 127.0.0.1:${childPort}`,
          "--site-per-process",
        ],
      },
    });
    stagehands.push(stagehand);
    const page = await firstPage(stagehand);
    await page.goto(`http://parent.test:${parentPort}/`, { waitUntil: "domcontentloaded" });
    await waitForIframeElement(page);

    expect(childServed).toBe(0);
    // Start the action while the child response is held, then allow brief initialization.
    const click = page.locator(XPATH_INNER).click();
    gate.release();
    await click;

    await expect.poll(() => clickCount, { timeout: 5_000 }).toBe(1);
    expect(childServed).toBeGreaterThanOrEqual(1);
  });
});
