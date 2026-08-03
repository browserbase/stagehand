import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserContext, Page, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const POPUP_TIMEOUT_MS = 20_000;

const toDataUrl = (html: string): string => `data:text/html,${encodeURIComponent(html)}`;

function installInitPayload<T>(payload: T): void {
  function setPayload(): void {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.initPayload = JSON.stringify(payload);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setPayload, { once: true });
  } else {
    setPayload();
  }
}

const waitForPopupPage = async (
  ctx: BrowserContext,
  knownTargetIds: Set<string>,
  timeoutMs = POPUP_TIMEOUT_MS,
): Promise<Page> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const popup = (await ctx.pages()).find((page) => !knownTargetIds.has(page.pageId));
      if (popup) return popup;
      const active = await ctx.activePage();
      if (active && !knownTargetIds.has(active.pageId)) return active;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Popup page was not created");
};

const openPopupAndAssertInjection = async <T>(
  ctx: BrowserContext,
  opener: Page,
  selector: string,
  readInjection: (popup: Page) => Promise<T>,
  expected: T,
  options: { withReload?: boolean } = {},
): Promise<void> => {
  const knownTargetIds = new Set((await ctx.pages()).map((page) => page.pageId));
  await opener.locator(selector).click();
  const popup = await waitForPopupPage(ctx, knownTargetIds);
  await popup.waitForLoadState("load");
  await expect(readInjection(popup)).resolves.toEqual(expected);

  if (options.withReload) {
    await popup.reload({ waitUntil: "load" });
    await expect(readInjection(popup)).resolves.toEqual(expected);
  }
};

const readInjectedNumber = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => (window as unknown as { __injected?: number }).__injected);

describe("context.addInitScript", () => {
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

  it("runs before inline document scripts on navigation", async () => {
    const page = await firstPage(stagehand);

    await ctx.addInitScript(() => {
      (window as unknown as { __fromContextInit?: string }).__fromContextInit = "injected-value";
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

  it("re-applies the script on every navigation for the same page", async () => {
    const page = await firstPage(stagehand);

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

  it("applies script (with args) to newly created pages", async () => {
    const payload = { greeting: "hi", nested: { count: 2 } };

    await ctx.addInitScript(installInitPayload, payload);

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

  it("applies script to newPage(url) on initial document", async () => {
    const payload = { marker: "newPageUrl" };

    await ctx.addInitScript(installInitPayload, payload);

    const newPage = await ctx.newPage({
      url: toDataUrl("<html><body>new page</body></html>"),
    });
    await newPage.waitForLoadState("load");

    const observed = await newPage.evaluate(() => {
      const raw = document.documentElement.dataset.initPayload;
      return raw ? JSON.parse(raw) : undefined;
    });
    expect(observed).toEqual(payload);
  });

  it("applies script to pages opened via link clicks", async () => {
    const payload = { marker: "linkClick" };

    await ctx.addInitScript(installInitPayload, payload);

    const popupUrl = fixture.url;
    const openerHtml =
      "<!DOCTYPE html>" +
      "<html><body>" +
      '<a id="open" target="_blank" href="' +
      popupUrl +
      '">open</a>' +
      "</body></html>";

    const opener = await firstPage(stagehand);
    await opener.goto(toDataUrl(openerHtml), { waitUntil: "load" });
    await openPopupAndAssertInjection(
      ctx,
      opener,
      "#open",
      (popup) =>
        popup.evaluate(() => {
          const raw = document.documentElement.dataset.initPayload;
          return raw ? JSON.parse(raw) : undefined;
        }),
      payload,
      { withReload: true },
    );
  });

  it("applies script to in-process popup", async () => {
    await ctx.addInitScript(() => {
      (window as unknown as { __injected?: number }).__injected = 123;
    });

    const opener = await firstPage(stagehand);
    const openerHtml =
      "<!DOCTYPE html>" +
      "<html><body>" +
      '<a id="open" target="_blank" href="about:blank">open</a>' +
      "</body></html>";
    await opener.goto(toDataUrl(openerHtml), { waitUntil: "load" });
    await openPopupAndAssertInjection(ctx, opener, "#open", readInjectedNumber, 123);
  });

  it("applies script to cross-process popup and survives reload", async () => {
    await ctx.addInitScript(() => {
      (window as unknown as { __injected?: number }).__injected = 123;
    });

    const opener = await firstPage(stagehand);
    const openerHtml =
      "<!DOCTYPE html>" +
      "<html><body>" +
      `<a id="open" target="_blank" href="${fixture.url}">open</a>` +
      "</body></html>";
    await opener.goto(toDataUrl(openerHtml), {
      waitUntil: "load",
    });
    await openPopupAndAssertInjection(ctx, opener, "#open", readInjectedNumber, 123, {
      withReload: true,
    });
  });

  it("applies script to cross-process popup opened via window.open and survives reload", async () => {
    await ctx.addInitScript(() => {
      (window as unknown as { __injected?: number }).__injected = 789;
    });

    const opener = await firstPage(stagehand);
    await opener.goto("about:blank", { waitUntil: "load" });
    await opener.evaluate((popupUrl) => {
      const button = document.createElement("button");
      button.id = "open-via-window-open";
      button.textContent = "open popup";
      button.addEventListener("click", () => {
        window.open(popupUrl, "_blank");
      });
      document.body.appendChild(button);
    }, fixture.url);

    await openPopupAndAssertInjection(
      ctx,
      opener,
      "#open-via-window-open",
      readInjectedNumber,
      789,
      { withReload: true },
    );
  });

  it("context.addInitScript installs a function callable from page.evaluate", async () => {
    const page = await firstPage(stagehand);

    await ctx.addInitScript(() => {
      // installed before any navigation
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      window.sayHelloFromStagehand = () => "hello from stagehand";
    });

    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      return window.sayHelloFromStagehand();
    });

    expect(result).toBe("hello from stagehand");
  });
});
