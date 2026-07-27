import "dotenv/config";
import { Stagehand } from "../src/index.js";

const useBrowserbase = process.env.USE_BROWSERBASE === "1";
const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;

if (useBrowserbase && !browserbaseApiKey) {
  throw new Error("BROWSERBASE_API_KEY is required when USE_BROWSERBASE=1");
}

const stagehand = new Stagehand({
  ...(browserbaseApiKey ? { apiKey: browserbaseApiKey } : {}),
  agentIndicator: true,
  browser: useBrowserbase
    ? {
        type: "browserbase",
        userMetadata: { demo: "agent-indicator" },
      }
    : {
        type: "local",
        headless: false,
      },
  logging: { level: "info" },
});

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

try {
  await stagehand.init();

  if (stagehand.browser.browserbaseSessionId) {
    console.log(`Browserbase session: ${stagehand.browser.browserbaseSessionId}`);
    console.log("Open the session in the Browserbase dashboard. The demo starts in 8 seconds.");
    await sleep(8_000);
  }

  const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());

  console.log("Navigating: the orange indicator should already be active.");
  await page.goto("https://example.com", { waitUntil: "load" });
  await sleep(1_500);

  console.log(`Reading the page title: ${await page.title()}`);
  await sleep(1_500);

  await sleep(2_500);
  console.log("The indicator should still be active. Closing Stagehand now.");
} finally {
  await stagehand.close();
}
