import "dotenv/config";
import { z } from "zod/v4";
import { browserbase, Stagehand } from "../src/index.js";

const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error();

// With no model, Browserbase Model Gateway selects one automatically for
// each inference call. The Browserbase API key and session authenticate it.
const browser = await browserbase.launch({
  apiKey: BROWSERBASE_API_KEY,
});
const stagehand = await Stagehand.create({ browser });

try {
  const [page] = await browser.context.pages();
  await page.goto("https://example.com");

  const result = await stagehand.extract(
    "Extract the page heading and the domain this page says it is for",
    z.object({ heading: z.string(), domain: z.string() }),
  );

  console.log(JSON.stringify(result.data, null, 2));
} finally {
  await stagehand.close();
  await browser.close();
}
