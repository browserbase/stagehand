import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { V3Context } from "../understudy/context";

const EXAMPLE_URL = "https://example.com";

test.describe("page.addInitScript", () => {
  let v3: V3;
  let ctx: V3Context;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
    ctx = v3.context;
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("runs scripts on real network navigations", async () => {
    const page = await ctx.awaitActivePage();

    await page.addInitScript(() => {
      (window as unknown as { __fromPageInit?: string }).__fromPageInit =
        "page-level";
    });

    await page.goto(EXAMPLE_URL, { waitUntil: "domcontentloaded" });

    const observed = await page.evaluate(() => {
      return (window as unknown as { __fromPageInit?: string }).__fromPageInit;
    });

    expect(observed).toBe("page-level");
  });

  test("scopes scripts to the page only", async () => {
    const first = await ctx.awaitActivePage();

    await first.addInitScript(() => {
      function markScope(): void {
        const root = document.documentElement;
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
    });

    await first.goto(`${EXAMPLE_URL}/?page=one`, {
      waitUntil: "domcontentloaded",
    });

    const second = await ctx.newPage();
    await second.goto(`${EXAMPLE_URL}/?page=two`, {
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

  test("supports passing arguments to function sources", async () => {
    const page = await ctx.awaitActivePage();
    const payload = { greeting: "hi", nested: { count: 1 } };

    await page.addInitScript((arg) => {
      function setPayload(): void {
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
    }, payload);

    await page.goto(`${EXAMPLE_URL}/?page=payload`, {
      waitUntil: "domcontentloaded",
    });

    const observed = await page.evaluate(() => {
      const raw = document.documentElement.dataset.pageInitPayload;
      return raw ? JSON.parse(raw) : undefined;
    });

    expect(observed).toEqual(payload);
  });
});
