import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("Page.waitForFunction", () => {
  let stagehand: Stagehand;
  let fixture: FixtureServer;
  let page: Page;

  beforeAll(async () => {
    fixture = await startFixtureServer({
      "/": `<!doctype html><title>before</title><body>Function waits
        <script>window.app = { ready: true }; window.pollCount = 0;</script>`,
      "/after": "<!doctype html><title>after-navigation</title><body>New document",
    });
    stagehand = await createStagehand();
  });

  beforeEach(async () => {
    page = await firstPage(stagehand);
    await page.goto(fixture.url);
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("reads page-owned main-world globals and returns their JSON value", async () => {
    await expect(page.waitForFunction("window.app")).resolves.toEqual({
      ready: true,
    });
  });

  it("invokes a string that evaluates to a function on every poll", async () => {
    await page.evaluate(() => {
      setTimeout(() => {
        document.title = "ready";
      }, 100);
    });
    await expect(
      page.waitForFunction("() => document.title === 'ready' && document.title"),
    ).resolves.toBe("ready");
  });

  it("passes the argument to a function string and ignores it for plain expressions", async () => {
    await expect(
      page.waitForFunction("async (key) => window.app[key] && { key }", "ready"),
    ).resolves.toEqual({ key: "ready" });
    await expect(page.waitForFunction("window.app.ready", "ignored")).resolves.toBe(true);
  });

  it("serializes a function argument and waits on animation frames by default", async () => {
    await page.evaluate(() => {
      setTimeout(() => {
        document.title = "ready";
      }, 100);
    });
    await expect(
      page.waitForFunction(
        (expected) => document.title === expected && { title: document.title },
        "ready",
      ),
    ).resolves.toEqual({ title: "ready" });
  });

  it("awaits an asynchronous predicate using an interval", async () => {
    await page.evaluate(() => {
      setTimeout(() => {
        document.title = "ready";
      }, 100);
    });
    await expect(
      page.waitForFunction(
        async (expected) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return document.title === expected && "async-ready";
        },
        "ready",
        { polling: 20, timeout: 5000 },
      ),
    ).resolves.toBe("async-ready");
  });

  it("stops browser polling after a timeout", async () => {
    await expect(
      page.waitForFunction("(++window.pollCount, false)", undefined, {
        polling: 10,
        timeout: 100,
      }),
    ).rejects.toThrow(/waitForFunction timed out/);
    // Cleanup is best-effort and may complete just after the timeout is returned.
    await page.waitForTimeout(50);
    const count = await page.evaluate<number>("window.pollCount");
    expect(count).toBeGreaterThan(0);
    await page.waitForTimeout(100);
    expect(await page.evaluate("window.pollCount")).toBe(count);
  });

  it("supports a disabled deadline and resolves when the predicate becomes truthy", async () => {
    await page.evaluate(() => {
      setTimeout(() => {
        document.title = "ready";
      }, 100);
    });
    await expect(
      page.waitForFunction("document.title === 'ready' && document.title", undefined, {
        timeout: 0,
      }),
    ).resolves.toBe("ready");
  });

  it("keeps concurrent waits isolated when one expires", async () => {
    const timedOut = expect(
      page.waitForFunction("false", undefined, {
        polling: 10,
        timeout: 100,
      }),
    ).rejects.toThrow(/waitForFunction timed out/);
    const surviving = expect(
      page.waitForFunction("document.title === 'ready' && 'survived'", undefined, {
        polling: 10,
        timeout: 0,
      }),
    ).resolves.toBe("survived");
    await timedOut;
    await page.evaluate(() => {
      document.title = "ready";
    });
    await surviving;
  });

  it("reinstalls an active predicate after navigation destroys its context", async () => {
    const pending = page.waitForFunction(
      "(document.body && (document.body.dataset.waitStarted = 'true'), document.title === 'after-navigation' && document.title)",
      undefined,
      { timeout: 5000 },
    );
    await Promise.all([
      expect(pending).resolves.toBe("after-navigation"),
      (async () => {
        await page.waitForSelector("body[data-wait-started]");
        await page.goto(`${fixture.url}after`);
      })(),
    ]);
  });

  it("stands in for waitForNavigation across a same-URL reload", async () => {
    await page.evaluate(() => {
      document.documentElement.dataset.stagehandBefore = "1";
    });
    const navigated = page.waitForFunction(
      () => !document.documentElement.dataset.stagehandBefore,
      undefined,
      { timeout: 5000 },
    );
    await page.evaluate(() => {
      setTimeout(() => location.reload(), 100);
    });
    await expect(navigated).resolves.toBe(true);
  });

  it("stands in for waitForURL with a flagged RegExp", async () => {
    const pattern = /\/AFTER$/i;
    const reachedUrl = page.waitForFunction(
      ([source, flags]) => new RegExp(source, flags).test(location.href),
      [pattern.source, pattern.flags],
      { timeout: 5000 },
    );
    await page.evaluate((url) => {
      setTimeout(() => location.assign(url), 100);
    }, `${fixture.url}after`);
    await expect(reachedUrl).resolves.toBe(true);
  });

  it("invokes a callback once per poll and rejects a function it returns", async () => {
    await expect(
      page.waitForFunction(() => () => true, undefined, { timeout: 2000 }),
    ).rejects.toThrow("JSON-serializable");
  });

  it("keeps comma expressions and __proto__ keys intact when binding an argument", async () => {
    await expect(
      page.waitForFunction("window.pollCount++, (arg) => arg.__proto__.ok", {
        ["__proto__"]: { ok: "kept" },
      }),
    ).resolves.toBe("kept");
  });

  it("does not retry a predicate exception that resembles a CDP context error", async () => {
    await expect(
      page.waitForFunction(
        "(() => { window.pollCount++; throw new Error('Cannot find context with specified id'); })()",
        undefined,
        { timeout: 1000 },
      ),
    ).rejects.toThrow("Cannot find context with specified id");
    expect(await page.evaluate("window.pollCount")).toBe(1);
  });

  it("rejects an unlimited active wait when its page closes", async () => {
    const pending = page.waitForFunction(
      "(document.body.dataset.waitStarted = 'true', false)",
      undefined,
      { timeout: 0 },
    );
    const rejected = expect(pending).rejects.toThrow(/closed|detached|disposed/i);
    await page.waitForSelector("body[data-wait-started]");
    await page.close();
    await rejected;
  });
});
