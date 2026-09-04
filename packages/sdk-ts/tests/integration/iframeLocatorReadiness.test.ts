import { afterEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const CHILD_DELAY_MS = 4_000;
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

async function createDelayedIframeFixture(options: {
  /** Absolute iframe src written into the parent HTML. */
  childSrc: (child: FixtureServer) => string;
  /** URL passed to page.goto (may use a mapped hostname). */
  parentGotoUrl: (parent: FixtureServer) => string;
}): Promise<IframeFixture> {
  let clickCount = 0;
  let childServed = 0;

  const child = await startFixtureServer({
    "/child": async () => {
      await new Promise((resolve) => setTimeout(resolve, CHILD_DELAY_MS));
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

  it("same-process trailing iframe XPath clicks without waiting for the child document", async () => {
    const fixture = await createDelayedIframeFixture({
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

  it("same-process deep XPath waits for the child and performs a verifiable button action", async () => {
    const fixture = await createDelayedIframeFixture({
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
    await page.locator(XPATH_INNER).click();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(CHILD_DELAY_MS - 500);
    await expect.poll(() => fixture.clickCount(), { timeout: 5_000 }).toBe(1);
  });

  it("OOPIF trailing iframe XPath clicks without waiting for the child document", async () => {
    let childServed = 0;
    const child = await startFixtureServer({
      "/child": async () => {
        await new Promise((resolve) => setTimeout(resolve, CHILD_DELAY_MS));
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

  it("OOPIF deep XPath waits across session adoption and performs a verifiable button action", async () => {
    let clickCount = 0;
    let childServed = 0;
    const child = await startFixtureServer({
      "/child": async () => {
        await new Promise((resolve) => setTimeout(resolve, CHILD_DELAY_MS));
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
    const started = Date.now();
    await page.locator(XPATH_INNER).click();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(CHILD_DELAY_MS - 500);
    await expect.poll(() => clickCount, { timeout: 5_000 }).toBe(1);
    expect(childServed).toBeGreaterThanOrEqual(1);
  });
});
