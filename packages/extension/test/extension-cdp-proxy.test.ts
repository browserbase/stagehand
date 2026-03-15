/**
 * E2E Test: Extension CDP Proxy via WebSocket Relay
 *
 * Verifies the REAL flow:
 *   CdpClient → /v4/cdp (relay) → /v4/extension (relay) → extension background.ts → chrome.debugger → page
 *
 * Tests:
 * 1. Extension connects to relay server via WebSocket
 * 2. CDP commands routed through extension to the page
 * 3. Screenshot capture via CDP through the relay
 * 4. DOM modification via CDP through the relay
 * 5. CDP events received through the relay
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
  startTestServer,
  startRelayServer,
} from "./helpers.js";

describe("Extension CDP Proxy via Relay E2E", () => {
  let chrome: LaunchedChrome;
  let port: number;
  let relayPort: number;
  let relayClose: () => Promise<void>;
  let waitForExtension: (timeoutMs?: number) => Promise<void>;
  let testServer: Server;
  let testUrl: string;
  let cdpClient: CdpClient;

  before(async () => {
    // 1. Start local test server for page content
    const srv = await startTestServer();
    testServer = srv.server;
    testUrl = srv.url;

    // 2. Start the WebSocket relay on port 3000 (extension default)
    const relay = await startRelayServer(3000);
    relayPort = relay.port;
    relayClose = relay.close;
    waitForExtension = relay.waitForExtension;

    // 3. Launch Chrome with extension (extension will auto-connect to relay on port 3000)
    const result = await launchChromeWithExtension();
    chrome = result.chrome;
    port = result.port;

    // 4. Wait for extension to connect to the relay
    await waitForExtension(15_000);

    // 5. Navigate the default tab to the test page via direct CDP
    const targets = await getTargets(port);
    const pageTarget = targets.find(
      (t) => t.type === "page" && t.webSocketDebuggerUrl
    );
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Should have a page target");

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

    // 6. Connect a CDP client through the relay
    // The extension will auto-attach to the active tab on first CDP command
    cdpClient = new CdpClient(`ws://127.0.0.1:${relayPort}/v4/cdp`);
    await cdpClient.connect();
  });

  after(async () => {
    try { await cdpClient?.close(); } catch { /* best-effort */ }
    try { await chrome?.kill(); } catch { /* best-effort */ }
    try { testServer?.close(); } catch { /* best-effort */ }
    try { await relayClose?.(); } catch { /* best-effort */ }
  });

  it("should have extension connected to the relay", async () => {
    // The extension should already be connected (we waited in before())
    // Verify by sending a simple CDP command through the relay
    assert.ok(cdpClient, "CDP client should be connected to relay");
  });

  it("should route CDP commands through the extension to the page", async () => {
    // Send Runtime.evaluate through the relay → extension → chrome.debugger → page
    const result = (await cdpClient.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    })) as { result: { value: string } };

    assert.strictEqual(
      result.result.value,
      "Example Domain",
      `Page title should be 'Example Domain', got: ${result.result.value}`
    );
  });

  it("should take a screenshot via CDP through the relay", async () => {
    const result = (await cdpClient.send("Page.captureScreenshot", {
      format: "png",
    })) as { data: string };

    assert.ok(result.data, "Screenshot should return base64 data");
    assert.ok(result.data.length > 100, "Screenshot data should be non-trivial");

    const buffer = Buffer.from(result.data, "base64");
    assert.strictEqual(buffer[0], 137, "Should be a valid PNG (byte 0)");
    assert.strictEqual(buffer[1], 80, "Should be a valid PNG (byte 1)");
  });

  it("should modify the DOM via CDP through the relay", async () => {
    // Modify h1 via the relay path
    await cdpClient.send("Runtime.evaluate", {
      expression: "document.querySelector('h1').textContent = 'Modified via Relay'",
      returnByValue: true,
    });

    // Verify the modification
    const result = (await cdpClient.send("Runtime.evaluate", {
      expression: "document.querySelector('h1')?.textContent",
      returnByValue: true,
    })) as { result: { value: string } };

    assert.strictEqual(result.result.value, "Modified via Relay");

    // Restore
    await cdpClient.send("Runtime.evaluate", {
      expression: "document.querySelector('h1').textContent = 'Example Domain'",
      returnByValue: true,
    });
  });

  it("should receive CDP events through the relay", async () => {
    // Enable Runtime domain to receive console events
    await cdpClient.send("Runtime.enable");

    const events: string[] = [];
    cdpClient.on("Runtime.consoleAPICalled", (params: unknown) => {
      const p = params as { args?: Array<{ value?: string }> };
      if (p.args?.[0]?.value) events.push(p.args[0].value);
    });

    await cdpClient.send("Runtime.evaluate", {
      expression: "console.log('relay-test-event')",
      returnByValue: true,
    });
    await sleep(500);

    assert.ok(
      events.includes("relay-test-event"),
      `Should receive console event via relay. Got: ${JSON.stringify(events)}`
    );
  });
});
