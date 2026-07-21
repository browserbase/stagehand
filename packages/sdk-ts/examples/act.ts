import "dotenv/config";
import { Stagehand } from "../src/index.js";

const stagehand = new Stagehand({
  browser: {
    type: "local",
    headless: true,
  },
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: process.env.OPENAI_API_KEY,
  },
});

try {
  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    throw new Error("Stagehand initialized without an active page");
  }
  await page.goto("https://example.com");

  const result = await page.act(
    "Click the link that provides more information about Example Domain",
  );

  console.log(JSON.stringify(result, null, 2));

  if (!result.success) {
    throw new Error(`act() failed: ${result.message}`);
  }
} finally {
  await stagehand.close();
}
