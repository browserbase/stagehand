import "dotenv/config";
import { z } from "zod/v4";
import { browserbase, Stagehand } from "../src/index.js";

const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error();

// No model apiKey: inference routes through the Browserbase Model Gateway,
// authenticated by the Browserbase API key and session. Requires a
// Browserbase browser session and a gateway-allowlisted model.
const browser = await browserbase.launch({
  apiKey: BROWSERBASE_API_KEY,
});
const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: "openai/gpt-4.1",
  },
});

try {
  const page = await stagehand.context.activePage();
  if (!page) {
    throw new Error("Stagehand initialized without an active page");
  }
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
