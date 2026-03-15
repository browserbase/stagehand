/**
 * E2E Test: Stagehand Library Integration via Extension Relay
 *
 * Verifies the REAL flow:
 *   Stagehand V3 (CdpConnection) → /v4/cdp (relay) → extension → chrome.debugger → page
 *
 * This tests that stagehand's understudy CdpConnection can connect to the relay's
 * /v4/cdp WebSocket endpoint and drive a real page through the extension's
 * chrome.debugger proxy.
 *
 * Tests:
 * 1. Stagehand connects via relay cdpUrl
 * 2. Page navigation works through the relay
 * 3. DOM modification via page.evaluate
 * 4. Screenshot capture
 * 5. agent.execute() reaches the LLM layer (API key error expected)
 * 6. stagehand.act() reaches the LLM layer (API key error expected)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { LaunchedChrome } from "chrome-launcher";
import type { Server } from "http";
import {
  launchChromeWithExtension,
  CdpClient,
  getTargets,
  startTestServer,
  startRelayServer,
} from "./helpers.js";

// Dynamic import for ESM module
async function importStagehand() {
  return await import("@browserbasehq/stagehand");
}

describe("Stagehand Library Integration via Extension Relay E2E", () => {
  let chrome: LaunchedChrome;
  let relayPort: number;
  let relayClose: () => Promise<void>;
  let waitForExtension: (timeoutMs?: number) => Promise<void>;
  let testServer: Server;
  let testUrl: string;
  let cdpUrl: string;

  before(async () => {
    // 1. Start local test server
    const srv = await startTestServer();
    testServer = srv.server;
    testUrl = srv.url;

    // 2. Start relay on port 3000 (extension default)
    const relay = await startRelayServer(3000);
    relayPort = relay.port;
    relayClose = relay.close;
    waitForExtension = relay.waitForExtension;
    cdpUrl = `ws://127.0.0.1:${relayPort}/v4/cdp`;

    // 3. Launch Chrome with extension
    const result = await launchChromeWithExtension();
    chrome = result.chrome;

    // 4. Wait for extension to connect
    await waitForExtension(15_000);

    // 5. Navigate the default tab to testUrl via direct CDP so it's not about:blank
    const targets = await getTargets(result.port);
    const pageTarget = targets.find(
      (t) => t.type === "page" && t.webSocketDebuggerUrl
    );
    if (pageTarget?.webSocketDebuggerUrl) {
      const directClient = new CdpClient(pageTarget.webSocketDebuggerUrl);
      await directClient.connect();
      await directClient.send("Page.enable");
      const loadPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Navigation timed out")), 15_000);
        directClient.on("Page.loadEventFired", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await directClient.send("Page.navigate", { url: testUrl });
      await loadPromise;
      await directClient.close();
    }

    // Extension will auto-attach to the active tab on first CDP command
  });

  after(async () => {
    try { await chrome?.kill(); } catch { /* best-effort */ }
    try { testServer?.close(); } catch { /* best-effort */ }
    try { await relayClose?.(); } catch { /* best-effort */ }
  });

  it("should connect stagehand to the relay cdpUrl", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl },
      verbose: 0,
      disablePino: true,
    });

    await stagehand.init();
    assert.ok(stagehand.context, "Stagehand should have a context");

    const page = await stagehand.context.awaitActivePage();
    assert.ok(page, "Should have an active page");

    await stagehand.close();
  });

  it("should navigate and read page via stagehand through the relay", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl },
      verbose: 0,
      disablePino: true,
    });

    await stagehand.init();
    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    const title = await page.evaluate(() => document.title);
    assert.strictEqual(title, "Example Domain");

    const url = await page.evaluate(() => window.location.href);
    assert.ok(
      url?.toString().includes("127.0.0.1"),
      `Should be on test server, got: ${url}`
    );

    await stagehand.close();
  });

  it("should modify the DOM via stagehand through the relay", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl },
      verbose: 0,
      disablePino: true,
    });

    await stagehand.init();
    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      if (h1) h1.textContent = "Modified via Stagehand Relay";
    });

    const h1Text = await page.evaluate(() =>
      document.querySelector("h1")?.textContent
    );
    assert.strictEqual(h1Text, "Modified via Stagehand Relay");

    await stagehand.close();
  });

  it("should take a screenshot via stagehand through the relay", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl },
      verbose: 0,
      disablePino: true,
    });

    await stagehand.init();
    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    const screenshotBuffer = await page.screenshot();
    assert.ok(screenshotBuffer, "Screenshot should return data");
    assert.ok(
      screenshotBuffer.length > 100,
      `Screenshot should be non-trivial, got ${screenshotBuffer.length} bytes`
    );

    await stagehand.close();
  });

  it("should call agent.execute() through relay and reach LLM layer", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl },
      verbose: 1,
      disablePino: true,
    });

    await stagehand.init();
    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    const agent = stagehand.agent();
    const result = await agent.execute("Click the 'More information' link");

    assert.ok(result, "agent.execute() should return a result");

    if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
      assert.ok(result.success, "agent.execute() should succeed with API key");
    } else {
      assert.strictEqual(result.success, false, "Should fail without API key");
      assert.ok(
        result.message?.includes("API key") || result.message?.includes("api_key"),
        `Error should mention API key, got: ${result.message}`
      );
    }

    await stagehand.close();
  });

  it("should call stagehand.act() through relay and reach LLM layer", async () => {
    const { Stagehand } = await importStagehand();

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl },
      verbose: 1,
      disablePino: true,
    });

    await stagehand.init();
    const page = await stagehand.context.awaitActivePage();
    await page.goto(testUrl, { waitUntil: "load" });

    if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) {
      const result = await stagehand.act("Click the 'More information' link");
      assert.ok(result.success, "act() should succeed with API key");
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
