import "dotenv/config";
import { Stagehand } from "../src/index.js";

const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) {
  throw new Error("BROWSERBASE_API_KEY is required");
}

const stagehand = new Stagehand({
  apiKey: BROWSERBASE_API_KEY,
  agentIndicator: true,
  browser: {
    type: "browserbase",
    userMetadata: { demo: "agent-indicator" },
  },
  logging: { level: "info" },
});

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

try {
  await stagehand.init();

  const sessionId = stagehand.browser.browserbaseSessionId;
  if (!sessionId) throw new Error("Browserbase did not return a session ID");

  console.log(`View the live browser: https://www.browserbase.com/sessions/${sessionId}`);

  const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());
  await page.goto("https://example.com", { waitUntil: "load" });

  console.log("The orange halo will remain visible for 60 seconds.");
  await sleep(60_000);
} finally {
  await stagehand.close();
}
