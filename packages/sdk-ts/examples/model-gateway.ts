import "dotenv/config";
import { z } from "zod/v4";
import { Stagehand } from "../src/index.js";

// BROWSERBASE_PROJECT_ID must also be set; the Browserbase SDK reads it from
// the environment when creating the session.
const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error();

// No model apiKey: inference routes through the Browserbase Model Gateway,
// authenticated by the Browserbase API key and session. Requires a
// Browserbase browser session and a gateway-allowlisted model.
const stagehand = new Stagehand({
  apiKey: BROWSERBASE_API_KEY,
  browser: {
    type: "browserbase",
  },
  model: {
    modelName: "openai/gpt-4.1",
  },
});

try {
  await stagehand.init();

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
}
