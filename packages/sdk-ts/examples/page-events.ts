import "dotenv/config";
import { z } from "zod/v4";
import { browserbase, Stagehand, type CDPSubscription } from "../src/index.js";

const { BROWSERBASE_API_KEY, OPENAI_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error("BROWSERBASE_API_KEY is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const browser = await browserbase.launch({ apiKey: BROWSERBASE_API_KEY });
try {
  const stagehand = await Stagehand.create({
    browser,
    model: { modelName: "openai/gpt-5.4-mini", apiKey: OPENAI_API_KEY },
  });
  let subscription: CDPSubscription | undefined;
  try {
    const page = await stagehand.context.activePage();
    if (!page) throw new Error("Stagehand initialized without an active page");

    let resolveConsoleEvent!: (method: string) => void;
    const consoleEvent = new Promise<string>((resolve) => {
      resolveConsoleEvent = resolve;
    });
    subscription = await page.on("console", (event) => {
      if (event.params.type === "log") resolveConsoleEvent(event.method);
    });

    await page.goto("https://example.com");
    await page.evaluate(`console.log("stagehand-page-on-example"); "emitted"`);
    const method = await Promise.race([
      consoleEvent,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for the console event")), 10_000),
      ),
    ]);

    const result = await stagehand.extract(
      "Extract the page heading and description",
      z.object({ heading: z.string(), description: z.string() }),
    );
    console.log(JSON.stringify({ eventMethod: method, extracted: result.data }, null, 2));
  } finally {
    await subscription?.unsubscribe();
    await stagehand.close();
  }
} finally {
  await browser.close();
}
