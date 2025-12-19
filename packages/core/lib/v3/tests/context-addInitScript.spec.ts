import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { V3Context } from "../understudy/context";

const toDataUrl = (html: string): string =>
  `data:text/html,${encodeURIComponent(html)}`;

test.describe("context.addInitScript", () => {
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

  test("runs before inline document scripts on navigation", async () => {
    const page = await ctx.awaitActivePage();

    await ctx.addInitScript(() => {
      (window as unknown as { __fromContextInit?: string }).__fromContextInit =
        "injected-value";
    });

    const html = `<!DOCTYPE html>
      <html>
        <body>
          <script>
            var value = (window && window.__fromContextInit) || 'missing';
            document.body.dataset.initWitness = value;
          </script>
        </body>
      </html>`;

    await page.goto(toDataUrl(html), { waitUntil: "load" });

    const observed = await page.evaluate(() => {
      return document.body.dataset.initWitness;
    });
    expect(observed).toBe("injected-value");
  });

  test("re-applies the script on every navigation for the same page", async () => {
    const page = await ctx.awaitActivePage();

    await ctx.addInitScript(() => {
      function markVisit() {
        const root = document.documentElement;
        if (!root) return;
        const current = Number(window.name || "0");
        const next = current + 1;
        window.name = String(next);
        root.dataset.visitCount = String(next);
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", markVisit, {
          once: true,
        });
      } else {
        markVisit();
      }
    });

    await page.goto(toDataUrl("<html><body>first</body></html>"), {
      waitUntil: "load",
    });
    const first = await page.evaluate(() => {
      return Number(document.documentElement.dataset.visitCount ?? "0");
    });
    expect(first).toBe(1);

    await page.goto(toDataUrl("<html><body>second</body></html>"), {
      waitUntil: "load",
    });
    const second = await page.evaluate(() => {
      return Number(document.documentElement.dataset.visitCount ?? "0");
    });
    expect(second).toBe(2);
  });

  test("applies script (with args) to newly created pages", async () => {
    const payload = { greeting: "hi", nested: { count: 2 } };

    await ctx.addInitScript((arg) => {
      function setPayload(): void {
        const root = document.documentElement;
        if (!root) return;
        root.dataset.initPayload = JSON.stringify(arg);
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setPayload, {
          once: true,
        });
      } else {
        setPayload();
      }
    }, payload);

    const newPage = await ctx.newPage();
    await newPage.goto(toDataUrl("<html><body>child</body></html>"), {
      waitUntil: "load",
    });

    const observed = await newPage.evaluate(() => {
      const raw = document.documentElement.dataset.initPayload;
      return raw ? JSON.parse(raw) : undefined;
    });
    expect(observed).toEqual(payload);
  });

  test("context.addInitScript installs a function callable from page.evaluate", async () => {
    const page = await ctx.awaitActivePage();

    await ctx.addInitScript(() => {
      // installed before any navigation
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      window.sayHelloFromStagehand = () => "hello from stagehand";
    });

    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      return window.sayHelloFromStagehand();
    });

    expect(result).toBe("hello from stagehand");
  });
});
