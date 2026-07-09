import { expect, test } from "@playwright/test";
import puppeteer from "puppeteer-core";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

const IFRAME_URL = "https://example.org/";
const IFRAME_DELAY_MS = (() => {
  const raw = process.env.IFRAME_DOCUMENT_DELAY_MS;
  if (raw === undefined) return 3000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3000;
  return parsed;
})();

const PARENT_HTML = `<!doctype html><html><body><iframe id="child" src="${IFRAME_URL}"></iframe></body></html>`;
const IFRAME_XPATH = "xpath=/html/body/iframe";

test.describe("cross-origin iframe main world while document loading (#2324)", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("deepLocator click waits for delayed OOPIF document", async () => {
    const page = v3.context.activePage();

    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
      defaultViewport: null,
    });
    const puppeteerPage = (await browser.pages())[0];
    await puppeteerPage.setRequestInterception(true);
    puppeteerPage.on("request", (req) => {
      if (req.url().startsWith(IFRAME_URL)) {
        setTimeout(() => req.continue().catch(() => {}), IFRAME_DELAY_MS);
      } else {
        req.continue().catch(() => {});
      }
    });

    try {
      await page.goto(`data:text/html,${encodeURIComponent(PARENT_HTML)}`, {
        waitUntil: "domcontentloaded",
      });

      const deadline = Date.now() + 10_000;
      while ((await page.mainFrame().locator(IFRAME_XPATH).count()) === 0) {
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for iframe element in parent DOM");
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      const started = Date.now();
      await page.deepLocator(IFRAME_XPATH).click();
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(IFRAME_DELAY_MS - 500);
    } finally {
      await browser.disconnect().catch(() => {});
    }
  });
});
