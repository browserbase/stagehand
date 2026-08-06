import "dotenv/config";
import { z } from "zod/v4";
import { browserbase, Stagehand } from "../src/index.js";

const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error();
const BROWSERBASE_BASE_URL = "https://api.browserbase.com";
const STAGEHAND_API_URL = "https://api.stagehand.browserbase.com";

// With no model, Browserbase Model Gateway selects one automatically for
// each inference call. The Browserbase API key and session authenticate it.
const browser = await browserbase.launch({
  apiKey: BROWSERBASE_API_KEY,
  baseUrl: BROWSERBASE_BASE_URL,
});
const stagehand = await Stagehand.create({ browser, apiUrl: STAGEHAND_API_URL });

try {
  const [page] = await browser.context.pages();
  await page.goto("https://example.com");

  const result = await stagehand.extract(
    "Extract the page heading and the domain this page says it is for",
    z.object({ heading: z.string(), domain: z.string() }),
  );

  console.log(JSON.stringify(result, null, 2));
} finally {
  await stagehand.close();
  await browser.close();
}
