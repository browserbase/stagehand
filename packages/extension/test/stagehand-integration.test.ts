/**
 * E2E Test: Stagehand Library Integration
 *
 * Verifies that the stagehand library (V3) can connect to a running Chrome
 * instance via CDP and control a live page.
 *
 * This tests the full stagehand flow:
 * 1. Launch Chrome with remote debugging
 * 2. Create a Stagehand V3 instance with cdpUrl
 * 3. Navigate to a test page
 * 4. Use stagehand's page.evaluate() to modify the DOM
 * 5. Verify modifications via CDP
 *
 * NOTE: act()/observe()/extract() require an LLM API key, so we test those
 * only if ANTHROPIC_API_KEY or OPENAI_API_KEY is set. The core CDP transport
 * and page control is tested unconditionally.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { LaunchedChrome } from "chrome-launcher";
import type { Server } from "http";
import { launchChrome, CdpClient, sleep, evaluate, startTestServer } from "./helpers.js";

// Dynamic import for ESM module
async function importStagehand() {
  return await import("@browserbasehq/stagehand");
}

describe("Stagehand Library Integration E2E", () => {
  let chrome: LaunchedChrome;
  let wsUrl: string;
  let testServer: Server;
  let testUrl: string;

  before(async () => {
    // Start local test server (Chrome in Docker can't reach external URLs)
    const srv = await startTestServer();
    testServer = srv.server;
    testUrl = srv.url;

    const result = await launchChrome();
    chrome = result.chrome;
    wsUrl = result.wsUrl;
  });

  after(async () => {
    try {
      await chrome?.kill();
    } catch {
      // best-effort
    }
    try {
      testServer?.close();
    } catch {
      // best-effort
    }
  });

  it("should connect stagehand to a running Chrome via cdpUrl", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 0,
      disablePino: true,
      disableAPI: true,
    });

    await stagehand.init();

    // Verify stagehand is connected
    assert.ok(stagehand.context, "Stagehand should have a context");

    // Get the active page
    const page = await stagehand.context.awaitActivePage();
    assert.ok(page, "Should have an active page");

    await stagehand.close();
  });

  it("should navigate to test page via stagehand", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 0,
      disablePino: true,
      disableAPI: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // Verify navigation worked
    const url = await page.evaluate(() => window.location.href);
    assert.ok(
      url?.toString().includes("127.0.0.1"),
      `Should be on test server, got: ${url}`
    );

    const title = await page.evaluate(() => document.title);
    assert.strictEqual(title, "Example Domain");

    await stagehand.close();
  });

  it("should modify the DOM via stagehand page.evaluate", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 0,
      disablePino: true,
      disableAPI: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // Modify the page via stagehand
    await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      if (h1) h1.textContent = "Modified by Stagehand";
    });

    // Verify modification via stagehand
    const h1Text = await page.evaluate(() =>
      document.querySelector("h1")?.textContent
    );
    assert.strictEqual(
      h1Text,
      "Modified by Stagehand",
      "DOM modification via stagehand should work"
    );

    // Also verify by connecting directly via CDP
    const resp = await fetch(`http://127.0.0.1:${chrome.port}/json`);
    const targets = (await resp.json()) as Array<{
      webSocketDebuggerUrl?: string;
      url: string;
      type: string;
    }>;
    const pageTarget = targets.find(
      (t) => t.type === "page" && t.url.includes("127.0.0.1")
    );

    if (pageTarget?.webSocketDebuggerUrl) {
      const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
      await cdp.connect();
      await cdp.send("Runtime.enable");

      const directH1 = await evaluate(
        cdp,
        "document.querySelector('h1')?.textContent"
      );
      assert.strictEqual(
        directH1,
        "Modified by Stagehand",
        "DOM modification should be visible via direct CDP"
      );

      await cdp.close();
    }

    await stagehand.close();
  });

  it("should take a screenshot via stagehand", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 0,
      disablePino: true,
      disableAPI: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // Take screenshot via stagehand
    const screenshotBuffer = await page.screenshot();
    assert.ok(screenshotBuffer, "Screenshot should return data");
    assert.ok(
      screenshotBuffer.length > 100,
      `Screenshot should be non-trivial, got ${screenshotBuffer.length} bytes`
    );

    await stagehand.close();
  });

  it("should interact with elements via stagehand locator", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 0,
      disablePino: true,
      disableAPI: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // Use locator to find the "More information..." link
    const link = page.locator("a");
    const linkText = await link.textContent();
    assert.ok(
      linkText?.includes("More information"),
      `Link text should contain 'More information', got: '${linkText}'`
    );

    // Verify the link href via page.evaluate
    const href = await page.evaluate(() =>
      document.querySelector("a")?.getAttribute("href")
    );
    assert.ok(
      href?.includes("iana.org"),
      `Link href should point to iana.org, got: '${href}'`
    );

    await stagehand.close();
  });

  it("should add and verify DOM elements via stagehand", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 0,
      disablePino: true,
      disableAPI: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // Add a new element
    await page.evaluate(() => {
      const div = document.createElement("div");
      div.id = "stagehand-integration-test";
      div.textContent = "Stagehand integration test element";
      div.style.background = "red";
      div.style.padding = "20px";
      document.body.prepend(div);
    });

    // Verify via locator
    const testDiv = page.locator("#stagehand-integration-test");
    const text = await testDiv.textContent();
    assert.strictEqual(text, "Stagehand integration test element");

    // Verify the element is visible in a screenshot
    const screenshot = await page.screenshot();
    assert.ok(screenshot.length > 100, "Screenshot with new element should work");

    await stagehand.close();
  });

  it("should call agent.execute() and reach the LLM layer (API key error expected)", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 1,
      disablePino: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // agent.execute() should reach the LLM layer.
    // Without an API key it returns {success: false} with an API key error.
    const agent = stagehand.agent();
    const result = await agent.execute("Click the 'More information' link");

    assert.ok(result, "agent.execute() should return a result");

    if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
      // If we have an API key, it should succeed
      assert.ok(result.success, `agent.execute() should succeed, got: ${JSON.stringify(result)}`);
    } else {
      // Without an API key the LLM call fails - proves the full pipeline ran
      assert.strictEqual(result.success, false, "Should fail without API key");
      assert.ok(
        result.message?.includes("API key") || result.message?.includes("api_key"),
        `Error should mention API key, got: ${result.message}`
      );
    }

    await stagehand.close();
  });

  it("should call stagehand.act() and reach the LLM layer (API key error expected)", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        cdpUrl: wsUrl,
      },
      verbose: 1,
      disablePino: true,
    });

    await stagehand.init();

    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    // act() should reach the LLM layer and throw an API key error
    // when no key is configured
    if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
      const result = await stagehand.act("Click the 'More information' link");
      assert.ok(result.success, `act() should succeed with API key`);
    } else {
      await assert.rejects(
        () => stagehand.act("Click the 'More information' link"),
        (err: any) => {
          assert.ok(
            err.message?.includes("API key") || err.message?.includes("api_key"),
            `act() error should mention API key, got: ${err.message}`
          );
          return true;
        },
        "act() should throw API key error without key"
      );
    }

    await stagehand.close();
  });
});
