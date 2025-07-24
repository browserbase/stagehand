import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

import http from "http";
import express from "express";
import { Server as WebSocketServer } from "ws";

test.describe("StagehandContext - Multi-page Support", () => {
  let stagehand: Stagehand;
  let server: http.Server;
  let wss: WebSocketServer;
  let serverPort: number;

  test.beforeAll(async () => {
    // Set up a local Express server
    const app = express();

    // Serve test pages
    app.get("/page1", (_req, res) => {
      res.set("Content-Type", "text/html");
      res.end(`
        <html>
          <head><title>Page 1</title></head>
          <body>
            <h1>Page 1 Content</h1>
            <button id="popupBtn" onclick="window.open('/page2', '_blank')">Open Page 2</button>
          </body>
        </html>
      `);
    });

    app.get("/page2", (_req, res) => {
      res.set("Content-Type", "text/html");
      res.end(`
        <html>
          <head><title>Page 2</title></head>
          <body>
            <h1>Page 2 Content</h1>
          </body>
        </html>
      `);
    });

    // Create the server on a random free port
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      serverPort = address.port;
    } else {
      throw new Error("Failed to get server port");
    }

    // Set up WebSocket for future tests
    wss = new WebSocketServer({ server, path: "/socket" });
    wss.on("connection", (ws) => {
      console.log("WebSocket client connected");
      ws.send("Hello from server WebSocket");
    });
  });

  test.beforeEach(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  test.afterAll(async () => {
    wss?.close();
    server?.close();
  });

  /**
   * Test enhanced page capabilities
   */
  test("should provide enhanced capabilities for new pages", async () => {
    const context = stagehand.context;
    const newPage = await context.newPage();

    // Verify enhanced methods
    expect(typeof newPage.act).toBe("function");
    expect(typeof newPage.extract).toBe("function");
    expect(typeof newPage.observe).toBe("function");

    // Verify basic Playwright functionality
    expect(typeof newPage.goto).toBe("function");
    expect(typeof newPage.click).toBe("function");

    // Test navigation maintains capabilities
    await newPage.goto(`http://localhost:${serverPort}/page1`);
    expect(typeof newPage.act).toBe("function");
    expect(await newPage.title()).toBe("Page 1");
  });

  /**
   * Test context.pages() functionality
   */
  test("should return array of enhanced pages via context.pages()", async () => {
    const context = stagehand.context;

    // Create multiple pages
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto(`http://localhost:${serverPort}/page1`);
    await page2.goto(`http://localhost:${serverPort}/page2`);

    const pages = context.pages();
    expect(pages).toContain(page1);
    expect(pages).toContain(page2);

    // Verify all pages have enhanced capabilities
    for (const page of pages) {
      expect(typeof page.act).toBe("function");
      expect(typeof page.extract).toBe("function");
      expect(typeof page.observe).toBe("function");
    }
  });

  /**
   * Test popup handling
   */
  test("should handle popups with enhanced capabilities", async () => {
    await stagehand.page.goto(`http://localhost:${serverPort}/page1`);
    await stagehand.page.click("#popupBtn");

    await expect.poll(() => stagehand.context.pages().length).toBe(2);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_original, popupPage] = stagehand.context.pages();

    await popupPage.waitForLoadState();

    const get = (k: string) =>
      (popupPage as unknown as Record<string, unknown>)[k];

    expect(typeof get("act")).toBe("function");
    expect(typeof get("extract")).toBe("function");
    expect(typeof get("observe")).toBe("function");

    expect(await popupPage.title()).toBe("Page 2");
  });

  /**
   * Test page tracking and cleanup
   */
  test("should properly track and cleanup pages", async () => {
    const context = stagehand.context;
    const initialPages = context.pages().length;

    const newPage = await context.newPage();
    await newPage.goto(`http://localhost:${serverPort}/page1`);

    expect(context.pages().length).toBe(initialPages + 1);
    await newPage.close();
    expect(context.pages().length).toBe(initialPages);
  });

  /**
   * Test enhanced methods across pages
   */
  test("should support enhanced methods across all pages", async () => {
    const page1 = await stagehand.context.newPage();
    const page2 = await stagehand.context.newPage();

    await page1.goto(`http://localhost:${serverPort}/page1`);
    await page2.goto(`http://localhost:${serverPort}/page2`);

    // Verify both pages have enhanced capabilities
    expect(typeof page1.act).toBe("function");
    expect(typeof page1.extract).toBe("function");
    expect(typeof page1.observe).toBe("function");

    expect(typeof page2.act).toBe("function");
    expect(typeof page2.extract).toBe("function");
    expect(typeof page2.observe).toBe("function");
  });

  /**
   * Test active page tracking
   */
  test("should update stagehand.page when creating new pages", async () => {
    const initialTitle = await stagehand.page.title(); // "about:blank" → ""

    // Create a new page
    const newPage = await stagehand.context.newPage();
    await newPage.goto(`http://localhost:${serverPort}/page1`);

    // The proxy should now forward to the new page:
    expect(await stagehand.page.title()).toBe("Page 1");
    expect(await stagehand.page.title()).not.toBe(initialTitle);
  });
});
