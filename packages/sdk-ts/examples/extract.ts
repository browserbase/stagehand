import "dotenv/config";
import { z } from "zod/v4";
import { Stagehand } from "../src/index.js";

const stagehand = new Stagehand({
  browser: {
    type: "local",
    headless: true,
  },
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: requireEnvironmentVariable("OPENAI_API_KEY"),
  },
});

try {
  await stagehand.init();

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
  await stagehand.close();
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
