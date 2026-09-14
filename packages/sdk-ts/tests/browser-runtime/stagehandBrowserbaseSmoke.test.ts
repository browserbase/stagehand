import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
      keepAlive: false,
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

    const page =
      (await stagehand.browser.context.pages())[0] ?? (await stagehand.browser.context.newPage());

    await page.goto("https://example.com", { waitUntil: "load" });

    await expect(page.url()).resolves.toBe("https://example.com/");
    await expect(page.title()).resolves.toBe("Example Domain");
    await expect(page.locator("h1").innerText()).resolves.toBe("Example Domain");
  });

  it("discovers and invokes a page-provided WebMCP tool", async () => {
    if (!stagehand) {
      throw new Error("Stagehand was not initialized");
    }

    const page =
      (await stagehand.browser.context.pages())[0] ?? (await stagehand.browser.context.newPage());

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

  it("uploads a local file to a Browserbase browser", async () => {
    if (!stagehand) {
      throw new Error("Stagehand was not initialized");
    }

    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-browserbase-upload-"));
    const filePath = path.join(directory, "hello.txt");
    await writeFile(filePath, "hello from Browserbase");
    try {
      const page =
        (await stagehand.browser.context.pages())[0] ?? (await stagehand.browser.context.newPage());
      await page.goto(`data:text/html,${encodeURIComponent('<input id="upload" type="file">')}`);
      const input = page.locator("#upload");

      await input.setInputFiles(filePath);
      await expect(
        page.evaluate(`(async () => {
          const file = document.querySelector('#upload').files[0];
          return file ? { name: file.name, text: await file.text() } : null;
        })()`),
      ).resolves.toStrictEqual({ name: "hello.txt", text: "hello from Browserbase" });

      await input.setInputFiles([]);
      await expect(page.evaluate(`document.querySelector('#upload').files.length`)).resolves.toBe(
        0,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("closes and reattaches Stagehand without closing a non-keepalive Browserbase session", async () => {
    if (!stagehand || !browser) {
      throw new Error("Stagehand was not initialized");
    }
    const firstStagehand = stagehand;
    const page = (await browser.context.pages())[0] ?? (await browser.context.newPage());
    await page.goto("https://example.com", { waitUntil: "load" });
    const pageId = page.pageId;

    await expect(firstStagehand.close()).resolves.toBeUndefined();
    expect(browser.closed).toBe(false);

    const nextStagehand = await Stagehand.create({ browser });
    stagehand = nextStagehand;
    const reattachedPage = (await browser.context.pages()).find(
      (candidate) => candidate.pageId === pageId,
    );

    expect(reattachedPage).toBeDefined();
    if (!reattachedPage) throw new Error("Reattached Stagehand did not retain the existing page");
    await expect(reattachedPage.title()).resolves.toBe("Example Domain");

    await nextStagehand.close();
    stagehand = undefined;
    await browser.close();
    expect(browser.closed).toBe(true);
  }, 30_000);
});
