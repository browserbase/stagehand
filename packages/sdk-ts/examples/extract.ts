import "dotenv/config";
import { z } from "zod/v4";
import { localBrowser, Stagehand } from "../src/index.js";

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) throw new Error();

const browser = await localBrowser.launch({ headless: true });
let stagehand: Stagehand | undefined;

try {
  stagehand = await Stagehand.create({
    browser,
    model: {
      modelName: "openai/gpt-5.4-mini",
      apiKey: OPENAI_API_KEY,
    },
  });

  const page = await stagehand.context.activePage();
  if (!page) {
    throw new Error("Stagehand initialized without an active page");
  }
  await page.goto("https://example.com");

  const pageInfo = await stagehand.extract(
    "Extract the page heading and description",
    z.object({
      heading: z.string(),
      description: z.string(),
    }),
  );

  console.log(JSON.stringify(pageInfo, null, 2));
} finally {
  await stagehand?.close();
  await browser.close();
}
