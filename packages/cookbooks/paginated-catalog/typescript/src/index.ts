import "dotenv/config";
import { browserbase, localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { exportCatalog, pageSchema, parseMaxPages } from "./catalog.js";

const apiKey = process.env.BROWSERBASE_API_KEY;
const local = process.env.BROWSER_ENV === "LOCAL";
if (process.env.BROWSER_ENV && !["LOCAL", "BROWSERBASE"].includes(process.env.BROWSER_ENV))
  throw new Error("BROWSER_ENV must be LOCAL or BROWSERBASE");
if (!local && !apiKey) throw new Error("BROWSERBASE_API_KEY is required");
const gateway =
  process.env.MODEL_PROVIDER === "gateway" ||
  (!process.env.MODEL_PROVIDER && !process.env.OPENAI_API_KEY);
if (local && gateway) throw new Error("Local fixture runs require OPENAI_API_KEY");
if (process.env.MODEL_PROVIDER && !["gateway", "openai"].includes(process.env.MODEL_PROVIDER))
  throw new Error("MODEL_PROVIDER must be gateway or openai");
const openaiKey = process.env.OPENAI_API_KEY;
if (!gateway && !openaiKey)
  throw new Error("OPENAI_API_KEY is required unless MODEL_PROVIDER=gateway");
const maxPages = parseMaxPages(process.env.MAX_PAGES);
const catalogUrl =
  process.env.CATALOG_URL ??
  "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html";
const browser = local
  ? await localBrowser.launch({ headless: true })
  : await browserbase.launch({ apiKey: apiKey!, api_timeout: 300 });
try {
  if (browser.sessionId)
    console.log(`Session: https://www.browserbase.com/sessions/${browser.sessionId}`);
  const stagehand = await Stagehand.create({
    browser,
    ...(gateway ? {} : { model: { modelName: "openai/gpt-5.4-mini", apiKey: openaiKey } }),
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    const result = await exportCatalog(
      {
        goto: async (url) => {
          await page.goto(url);
        },
        url: () => page.url(),
        extract: async () =>
          (
            await stagehand.extract(
              "Extract every book in the product grid, including title, displayed price, and availability.",
              pageSchema,
              { page },
            )
          ).data,
        advance: async () => {
          if ((await page.locator(process.env.NEXT_SELECTOR ?? "li.next a").count()) === 0)
            return false;
          const next = (
            await stagehand.observe(
              "Find the enabled Next pagination link. Return no actions if there is no next page.",
              { page },
            )
          ).data[0];
          if (!next) throw new Error("Next link exists but observe returned no action");
          const acted = await stagehand.act(next, { page });
          if (!acted.data.success) throw new Error(`Next-page act failed: ${acted.data.message}`);
          await page.waitForLoadState("domcontentloaded");
          return true;
        },
      },
      catalogUrl,
      maxPages,
      process.env.OUT_DIR ?? "out",
    );
    console.log(
      `Saved ${result.count} books from ${result.pages} pages to ${process.env.OUT_DIR ?? "out"}/catalog.json`,
    );
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}
