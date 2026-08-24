import "dotenv/config";
import { browserbase, Stagehand } from "../src/index.js";

const browser = await browserbase.launch({
  apiKey: process.env.BROWSERBASE_API_KEY!,
  region: "ap-southeast-1",
  timeout: 120,
  keepAlive: true,
});

try {
  const stagehand = await Stagehand.create({ browser });
  // Never reached.
  const [page] = await browser.context.pages();
  const ctx = browser.context;
  await ctx.close();
  await page.goto("https://example.com/");
  await stagehand.close();
} finally {
  await browser.close();
}
