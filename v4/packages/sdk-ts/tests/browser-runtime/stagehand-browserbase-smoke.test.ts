import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Stagehand } from "../../src/index.js";

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const shouldRun = process.env.BROWSERBASE_SMOKE === "1" || Boolean(browserbaseApiKey);

describe.runIf(shouldRun)("Stagehand TS SDK Browserbase smoke", () => {
  let stagehand: Stagehand | undefined;

  beforeAll(async () => {
    if (!browserbaseApiKey) {
      throw new Error("BROWSERBASE_API_KEY is required for the Browserbase smoke test");
    }

    stagehand = new Stagehand({
      apiKey: browserbaseApiKey,
      browser: {
        type: "browserbase",
        userMetadata: {
          suite: "stagehand-v4-browserbase-smoke",
        },
      },
    });
    await stagehand.init();
  }, 90_000);

  afterAll(async () => {
    await stagehand?.close();
  }, 30_000);

  it("drives a Browserbase browser through the public TS object model", async () => {
    if (!stagehand) {
      throw new Error("Stagehand was not initialized");
    }

    const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());

    await page.goto("https://example.com", { waitUntil: "load" });

    await expect(page.url()).resolves.toBe("https://example.com/");
    await expect(page.title()).resolves.toBe("Example Domain");
    await expect(page.locator("h1").innerText()).resolves.toBe("Example Domain");
  });
});
