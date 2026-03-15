/**
 * E2E Test: Extension CDP Proxy
 *
 * Verifies that the Stagehand extension's background service worker correctly
 * loads in Chrome and that CDP commands work on a live page.
 *
 * Tests:
 * 1. Extension service worker loads in Chrome
 * 2. CDP navigation to https://example.com
 * 3. Screenshot capture via CDP
 * 4. DOM modification and verification via CDP
 * 5. CDP event reception
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { LaunchedChrome } from "chrome-launcher";
import type { Server } from "http";
import {
  launchChromeWithExtension,
  CdpClient,
  getTargets,
  sleep,
  evaluate,
  startTestServer,
} from "./helpers.js";

describe("Extension CDP Proxy E2E", () => {
  let chrome: LaunchedChrome;
  let port: number;
  let wsUrl: string;
  let pageClient: CdpClient;
  let testServer: Server;
  let testUrl: string;

  before(async () => {
    // Start local test server (Chrome in Docker can't reach external URLs)
    const srv = await startTestServer();
    testServer = srv.server;
    testUrl = srv.url;

    const result = await launchChromeWithExtension();
    chrome = result.chrome;
    port = result.port;
    wsUrl = result.wsUrl;

    // Find the initial about:blank page and navigate it
    const targets = await getTargets(port);
    const pageTarget = targets.find(
      (t) => t.type === "page" && t.webSocketDebuggerUrl
    );
    assert.ok(
      pageTarget?.webSocketDebuggerUrl,
      "Should have an initial page target"
    );

    pageClient = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await pageClient.connect();
    await pageClient.send("Page.enable");
    await pageClient.send("Runtime.enable");

    // Navigate to local test server and wait for load
    const loadPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Navigation timed out")),
        15_000
      );
      pageClient.on("Page.loadEventFired", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await pageClient.send("Page.navigate", { url: testUrl });
    await loadPromise;
  });

  after(async () => {
    try {
      await pageClient?.close();
    } catch {
      // best-effort
    }
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

  it("should launch Chrome with the extension loaded", async () => {
    assert.ok(wsUrl, "Should have a WebSocket URL");

    // Use browser-level CDP to check for extension targets
    const browserClient = new CdpClient(wsUrl);
    await browserClient.connect();

    const result = (await browserClient.send("Target.getTargets")) as {
      targetInfos: Array<{ type: string; url: string }>;
    };

    const extensionTarget = result.targetInfos.find(
      (t) =>
        t.url.includes("chrome-extension://") ||
        t.type === "service_worker"
    );

    assert.ok(
      extensionTarget,
      `Extension target should exist. Found: ${JSON.stringify(result.targetInfos.map((t) => ({ type: t.type, url: t.url.substring(0, 80) })))}`
    );

    await browserClient.close();
  });

  it("should be on the test page with correct title", async () => {
    const title = await evaluate(pageClient, "document.title");
    assert.strictEqual(title, "Example Domain");

    const url = await evaluate(pageClient, "window.location.href");
    assert.ok(
      (url as string).includes("127.0.0.1"),
      `Should be on test server, got: ${url}`
    );
  });

  it("should take a screenshot via CDP", async () => {
    const result = (await pageClient.send("Page.captureScreenshot", {
      format: "png",
    })) as { data: string };

    assert.ok(result.data, "Screenshot should return base64 data");
    assert.ok(result.data.length > 100, "Screenshot data should be non-trivial");

    const buffer = Buffer.from(result.data, "base64");
    assert.strictEqual(buffer[0], 137, "Should be a valid PNG (byte 0)");
    assert.strictEqual(buffer[1], 80, "Should be a valid PNG (byte 1)");
  });

  it("should modify the DOM via CDP and verify changes persist", async () => {
    // Read original h1
    const originalH1 = await evaluate(
      pageClient,
      "document.querySelector('h1')?.textContent"
    );
    assert.strictEqual(originalH1, "Example Domain");

    // Modify the h1 via CDP
    await evaluate(
      pageClient,
      "document.querySelector('h1').textContent = 'Stagehand Was Here'"
    );

    // Verify modification
    const modifiedH1 = await evaluate(
      pageClient,
      "document.querySelector('h1')?.textContent"
    );
    assert.strictEqual(modifiedH1, "Stagehand Was Here");

    // Simulate a click to verify input events work
    await pageClient.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 200,
      y: 200,
      button: "left",
      clickCount: 1,
    });
    await pageClient.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 200,
      y: 200,
      button: "left",
      clickCount: 1,
    });

    // DOM should still be modified after interaction
    const afterClick = await evaluate(
      pageClient,
      "document.querySelector('h1')?.textContent"
    );
    assert.strictEqual(afterClick, "Stagehand Was Here");

    // Restore for other tests
    await evaluate(
      pageClient,
      "document.querySelector('h1').textContent = 'Example Domain'"
    );
  });

  it("should add DOM elements via CDP", async () => {
    await evaluate(
      pageClient,
      `
      const p = document.createElement('p');
      p.id = 'stagehand-test';
      p.textContent = 'Added by Stagehand extension test';
      document.body.appendChild(p);
    `
    );

    const testText = await evaluate(
      pageClient,
      "document.getElementById('stagehand-test')?.textContent"
    );
    assert.strictEqual(
      testText,
      "Added by Stagehand extension test"
    );

    const htmlLength = (await evaluate(
      pageClient,
      "document.documentElement.outerHTML.length"
    )) as number;
    assert.ok(htmlLength > 200, `Document should have substantial HTML, got ${htmlLength}`);
  });

  it("should receive CDP events from the page", async () => {
    const consoleMessages: string[] = [];
    pageClient.on("Runtime.consoleAPICalled", (params: unknown) => {
      const p = params as { args?: Array<{ value?: string }> };
      if (p.args?.[0]?.value) {
        consoleMessages.push(p.args[0].value);
      }
    });

    await evaluate(pageClient, "console.log('stagehand-test-event')");
    await sleep(500);

    assert.ok(
      consoleMessages.includes("stagehand-test-event"),
      `Should have received console event. Got: ${JSON.stringify(consoleMessages)}`
    );
  });
});
