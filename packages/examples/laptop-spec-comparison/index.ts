import { config } from "dotenv";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { run } from "./workflow.ts";

config({ path: new URL("../.env", import.meta.url), quiet: true });

const { BROWSERBASE_API_KEY, ANTHROPIC_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY || !ANTHROPIC_API_KEY) {
  throw new Error("Set BROWSERBASE_API_KEY and ANTHROPIC_API_KEY in packages/examples/.env");
}

const browser = await browserbase.launch({ apiKey: BROWSERBASE_API_KEY, proxies: true });
const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: "anthropic/claude-sonnet-5",
    apiKey: ANTHROPIC_API_KEY,
    // Stagehand calls the model from inside the browser extension.
    headers: { "anthropic-dangerous-direct-browser-access": "true" },
  },
});

try {
  const [page] = await browser.context.pages();
  console.log(JSON.stringify(await run(stagehand, page!), null, 2));
} finally {
  await stagehand.close();
  await browser.close();
}
