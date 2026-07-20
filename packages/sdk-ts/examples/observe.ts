import "dotenv/config";
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

  const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());
  await page.goto("https://example.com");

  const actions = await page.observe(
    "Find the link that provides more information about Example Domain",
  );

  // oxlint-disable-next-line no-console -- This example intentionally displays the SDK result.
  console.log(JSON.stringify(actions, null, 2));

  if (actions.length === 0) {
    throw new Error("observe() returned no matching actions");
  }
} finally {
  await stagehand.close();
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
