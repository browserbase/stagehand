import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

import http from "http";
import express from "express";
import { Server as WebSocketServer } from "ws";

test.describe("StagehandContext - pages and newPage", () => {
  let stagehand: Stagehand;
  let server: http.Server;
  let wss: WebSocketServer;
  let serverPort: number;

  test.beforeAll(async () => {
    // 1. Spin up a local Express server
    const app = express();

    // Serve a single page at "/"
    app.get("/", (_req, res) => {
      res.set("Content-Type", "text/html");
      res.end(`
        <html>
          <head>
            <title>Test Page</title>
          </head>
          <body>
            <h1>Hello from local server</h1>
            <script>
              // Optionally register a service worker if you want it for demo:
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js')
                  .then(() => console.log('SW registered'))
                  .catch(e => console.error('SW failed', e));
              }
            </script>
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

    // Optionally set up a WebSocket for future tests
    wss = new WebSocketServer({ server, path: "/socket" });
    wss.on("connection", (ws) => {
      console.log("WebSocket client connected");
      ws.send("Hello from server WebSocket");
    });
  });

  test.beforeEach(async () => {
    // 2. Create & init Stagehand for each test
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  test.afterAll(async () => {
    // Shut down local server
    wss?.close();
    server?.close();
  });

  /**
   * Test context.newPage() and context.pages()
   */
  test("should create multiple pages and list them via context.pages()", async () => {
    const context = stagehand.context;

    // Create multiple pages
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Confirm context.pages() sees them
    const allPages = context.pages();

    // We expect at least these 2 pages. If a default blank page existed, total might be more.
    // The key is that page1 & page2 are in the array:
    expect(allPages).toContain(page1);
    expect(allPages).toContain(page2);

    // Navigate page1 to the local server
    await page1.goto(`http://localhost:${serverPort}`);
    expect(await page1.title()).toBe("Test Page");
  });
});
