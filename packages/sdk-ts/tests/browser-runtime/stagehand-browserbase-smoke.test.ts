import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserbase, Stagehand, type StagehandBrowser } from "../../src/index.js";

const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const shouldRun = process.env.BROWSERBASE_SMOKE === "1" || Boolean(browserbaseApiKey);
const webMCPTestSite = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/";

describe.runIf(shouldRun)("Stagehand TS SDK Browserbase smoke", () => {
  let stagehand: Stagehand | undefined;
  let browser: StagehandBrowser | undefined;

  beforeAll(async () => {
    if (!browserbaseApiKey) {
      throw new Error("BROWSERBASE_API_KEY is required for the Browserbase smoke test");
    }

    browser = await browserbase.launch({
      apiKey: browserbaseApiKey,
      userMetadata: {
        suite: "stagehand-browserbase-smoke",
      },
    });
    stagehand = await Stagehand.create({ browser });
  }, 90_000);

  afterAll(async () => {
    try {
      await stagehand?.close();
    } finally {
      await browser?.close();
    }
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

  it("discovers and invokes a page-provided WebMCP tool", async () => {
    if (!stagehand) {
      throw new Error("Stagehand was not initialized");
    }

    const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());

    await page.goto(webMCPTestSite, { waitUntil: "load" });

    const tools = await page.tools({ timeout: 5_000 });
    const calculateSum = tools.find((tool) => tool.name === "calculateSum");

    expect(calculateSum).toBeDefined();

    const invocation = await calculateSum!.invoke({
      input: { a: 19, b: 23 },
    });
    const result = await invocation.result({ timeout: 5_000 });

    expect(result).toMatchObject({
      invocationId: invocation.invocationId,
      status: "Completed",
      output: { sum: 42 },
    });
    await expect(page.locator("#last-tool").textContent()).resolves.toBe("calculateSum");
    await expect(page.locator("#invocation-count").textContent()).resolves.toBe("1");
  }, 30_000);
});
