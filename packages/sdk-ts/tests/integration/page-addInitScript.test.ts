import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";
import type { BrowserContext } from "../../src/index.js";

describe("page.addInitScript", () => {
  let stagehand: Stagehand;
  let ctx: BrowserContext;
  let fixture: FixtureServer;

  beforeEach(async () => {
    fixture = await startFixtureServer("<!doctype html><body>fixture</body>");
    stagehand = await createStagehand();
    ctx = stagehand.context;
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("runs scripts on real network navigations", async () => {
    const page = await firstPage(stagehand);

    await page.addInitScript(() => {
      (window as unknown as { __fromPageInit?: string }).__fromPageInit = "page-level";
    });

    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

    const observed = await page.evaluate(() => {
      return (window as unknown as { __fromPageInit?: string }).__fromPageInit;
    });

    expect(observed).toBe("page-level");
  });

  it("scopes scripts to the page only", async () => {
    const first = await firstPage(stagehand);

    await first.addInitScript(`
      (function () {
        function markScope() {
          var root = document.documentElement;
          if (!root) return;
          root.dataset.scopeWitness = "page-one";
        }
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", markScope, {
            once: true,
          });
        } else {
          markScope();
        }
      })();
    `);

    await first.goto(`${fixture.url}?page=one`, {
      waitUntil: "domcontentloaded",
    });

    const second = await ctx.newPage();
    await second.goto(`${fixture.url}?page=two`, {
      waitUntil: "domcontentloaded",
    });

    const firstValue = await first.evaluate(() => {
      return document.documentElement.dataset.scopeWitness ?? "missing";
    });
    const secondValue = await second.evaluate(() => {
      return document.documentElement.dataset.scopeWitness ?? "missing";
    });

    expect(firstValue).toBe("page-one");
    expect(secondValue).toBe("missing");
  });

  it("supports passing arguments to function sources", async () => {
    const page = await firstPage(stagehand);
    const payload = { greeting: "hi", nested: { count: 1 } };

    const initPayload = ((arg) => {
      function setPayload() {
        const root = document.documentElement;
        if (!root) return;
        root.dataset.pageInitPayload = JSON.stringify(arg);
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setPayload, {
          once: true,
        });
      } else {
        setPayload();
      }
    }) as (arg: typeof payload) => void;
    await page.addInitScript(initPayload, payload);

    await page.goto(`${fixture.url}?page=payload`, {
      waitUntil: "domcontentloaded",
    });

    const observed = await page.evaluate(() => {
      const raw = document.documentElement.dataset.pageInitPayload;
      return raw ? JSON.parse(raw) : undefined;
    });

    expect(observed).toEqual(payload);
  });
});
