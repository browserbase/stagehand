import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { V3Context } from "../../lib/v3/understudy/context.js";
import type { Page as V3Page } from "../../lib/v3/understudy/page.js";

const POPUP_TIMEOUT_MS = 20_000;

const toDataUrl = (html: string): string =>
  `data:text/html,${encodeURIComponent(html)}`;

const waitForPopupPage = async (
  ctx: V3Context,
  knownTargetIds: Set<string>,
  timeoutMs = POPUP_TIMEOUT_MS,
): Promise<V3Page> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const popup = ctx
      .pages()
      .find((page) => !knownTargetIds.has(page.targetId()));
    if (popup) return popup;
    try {
      const active = await ctx.awaitActivePage(500);
      if (!knownTargetIds.has(active.targetId())) return active;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Popup page was not created");
};

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

    await ctx.addInitScript(`
      (function () {
        function markVisit() {
          var root = document.documentElement;
          if (!root) return;
          var current = Number(window.name || "0");
          var next = current + 1;
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
      })();
    `);

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

    const initPayload = ((arg) => {
      function setPayload() {
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
    }) as (arg: typeof payload) => void;
    await ctx.addInitScript(initPayload, payload);

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

  test("applies script to newPage(url) on initial document", async () => {
    const payload = { marker: "newPageUrl" };

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

    const newPage = await ctx.newPage(
      toDataUrl("<html><body>new page</body></html>"),
    );
    await newPage.waitForLoadState("load");

    const observed = await newPage.evaluate(() => {
      const raw = document.documentElement.dataset.initPayload;
      return raw ? JSON.parse(raw) : undefined;
    });
    expect(observed).toEqual(payload);
  });

  test("applies script to pages opened via link clicks", async () => {
    const payload = { marker: "linkClick" };

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

    const popupUrl = "https://example.com/";
    const openerHtml =
      "<!DOCTYPE html>" +
      "<html><body>" +
      '<a id="open" target="_blank" href="' +
      popupUrl +
      '">open</a>' +
      "</body></html>";

    const opener = await ctx.awaitActivePage();
    await opener.goto(toDataUrl(openerHtml), { waitUntil: "load" });
    const knownTargetIds = new Set(ctx.pages().map((p) => p.targetId()));
    await opener.locator("#open").click();

    const popup = await waitForPopupPage(ctx, knownTargetIds);

    await popup.waitForLoadState("load");

    const observed = await popup.evaluate(() => {
      const raw = document.documentElement.dataset.initPayload;
      return raw ? JSON.parse(raw) : undefined;
    });
    expect(observed).toEqual(payload);

    await popup.reload({ waitUntil: "load" });
    const observedAfterReload = await popup.evaluate(() => {
      const raw = document.documentElement.dataset.initPayload;
      return raw ? JSON.parse(raw) : undefined;
    });
    expect(observedAfterReload).toEqual(payload);
  });

  test("applies script to in-process popup", async () => {
    await ctx.addInitScript(() => {
      (window as unknown as { __injected?: number }).__injected = 123;
    });

    const opener = await ctx.awaitActivePage();
    const openerHtml =
      "<!DOCTYPE html>" +
      "<html><body>" +
      '<a id="open" target="_blank" href="about:blank">open</a>' +
      "</body></html>";
    await opener.goto(toDataUrl(openerHtml), { waitUntil: "load" });
    const knownTargetIds = new Set(ctx.pages().map((p) => p.targetId()));
    await opener.locator("#open").click();

    const popup = await waitForPopupPage(ctx, knownTargetIds);
    await popup.waitForLoadState("load");
    const injected = await popup.evaluate(() => {
      return (window as unknown as { __injected?: number }).__injected;
    });
    expect(injected).toBe(123);
  });

  test("applies script to cross-process popup and survives reload", async () => {
    await ctx.addInitScript(() => {
      (window as unknown as { __injected?: number }).__injected = 123;
    });

    const opener = await ctx.awaitActivePage();
    const openerHtml =
      "<!DOCTYPE html>" +
      "<html><body>" +
      '<a id="open" target="_blank" href="https://example.com/">open</a>' +
      "</body></html>";
    await opener.goto(toDataUrl(openerHtml), {
      waitUntil: "load",
    });
    const knownTargetIds = new Set(ctx.pages().map((p) => p.targetId()));
    await opener.locator("#open").click();

    const popup = await waitForPopupPage(ctx, knownTargetIds);
    await popup.waitForLoadState("load");

    const injected = await popup.evaluate(() => {
      return (window as unknown as { __injected?: number }).__injected;
    });
    expect(injected).toBe(123);

    await popup.reload({ waitUntil: "load" });
    const injectedAfterReload = await popup.evaluate(() => {
      return (window as unknown as { __injected?: number }).__injected;
    });
    expect(injectedAfterReload).toBe(123);
  });

  test("applies script to cross-process popup opened via window.open and survives reload", async () => {
    await ctx.addInitScript(() => {
      (window as unknown as { __injected?: number }).__injected = 789;
    });

    const opener = await ctx.awaitActivePage();
    await opener.goto("about:blank", { waitUntil: "load" });
    await opener.mainFrame().evaluate(() => {
      const button = document.createElement("button");
      button.id = "open-via-window-open";
      button.textContent = "open popup";
      button.addEventListener("click", () => {
        window.open("https://example.com/", "_blank");
      });
      document.body.appendChild(button);
    });

    const knownTargetIds = new Set(ctx.pages().map((p) => p.targetId()));
    await opener.locator("#open-via-window-open").click();

    const popup = await waitForPopupPage(ctx, knownTargetIds);
    await popup.waitForLoadState("load");

    const injected = await popup.evaluate(() => {
      return (window as unknown as { __injected?: number }).__injected;
    });
    expect(injected).toBe(789);

    await popup.reload({ waitUntil: "load" });
    const injectedAfterReload = await popup.evaluate(() => {
      return (window as unknown as { __injected?: number }).__injected;
    });
    expect(injectedAfterReload).toBe(789);
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
