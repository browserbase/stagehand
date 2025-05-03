import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

import http from "http";
import express from "express";
import { Server as WebSocketServer } from "ws";
import fs from "fs";
import path from "path";

const HAR_CONTENT = `{
  "log": {
    "version": "1.2",
    "creator": { "name": "PlaywrightTest", "version": "1.0" },
    "entries": [
      {
        "startedDateTime": "2023-01-01T00:00:00.000Z",
        "time": 5,
        "request": {
          "method": "GET",
          "url": "http://localhost/har-example.json",
          "httpVersion": "HTTP/1.1",
          "cookies": [],
          "headers": [],
          "queryString": [],
          "headersSize": -1,
          "bodySize": 0
        },
        "response": {
          "status": 200,
          "statusText": "OK",
          "httpVersion": "HTTP/1.1",
          "cookies": [],
          "headers": [{"name":"Content-Type","value":"application/json"}],
          "content": {
            "size": 27,
            "mimeType": "application/json",
            "text": "{\\"harKey\\":\\"harValue\\"}"
          },
          "redirectURL": "",
          "headersSize": -1,
          "bodySize": 0
        },
        "cache": {},
        "timings": { "send": 0, "wait": 5, "receive": 0 }
      }
    ]
  }
}`;

test.describe("StagehandContext - Routing APIs with dynamic setup", () => {
  let stagehand: Stagehand;
  let server: http.Server;
  let wss: WebSocketServer;
  let serverPort: number;

  test.beforeAll(async () => {
    const app = express();

    app.get("/example.json", (_req, res) => {
      res.json({ original: "server-data" });
    });

    app.get("/har-example.json", (_req, res) => {
      res.json({
        fromServer:
          "This should be replaced by HAR if routeFromHar is in effect",
      });
    });

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

    // Set up a WebSocket endpoint at "/socket"
    wss = new WebSocketServer({ server, path: "/socket" });
    wss.on("connection", (ws) => {
      console.log("WebSocket client connected");
      ws.send("Hello from server WebSocket");

      // Echo messages back
      ws.on("message", (message) => {
        console.log("Server received WS message:", message);
        ws.send(`Server echo: ${message}`);
      });
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

  test("should intercept requests, mock the response, handle websockets, and unroute them", async () => {
    const context = stagehand.context;
    const baseURL = `http://localhost:${serverPort}`;

    // 1. route: intercept "/example.json" and fulfill with a mock response
    await context.route("**/example.json", async (route) => {
      console.log("[route] Intercepting:", route.request().url());

      // Mock the response entirely:
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mockedData: 1234 }),
      });
    });

    // 2. routeWebSocket: intercept "/socket"
    await context.routeWebSocket("**/socket", async (pageSideRoute) => {
      console.log("Intercepting WebSocket at:", pageSideRoute.url());

      // Connect to the real server
      const serverSideRoute = pageSideRoute.connectToServer();

      // Page -> Server
      pageSideRoute.onMessage((msg) => {
        console.log("Page -> Server message:", msg);
        // Forward to server side
        serverSideRoute.send(msg);
      });

      // Server -> Page
      serverSideRoute.onMessage((msg) => {
        console.log("Server -> Page message:", msg);
        pageSideRoute.send(msg);
      });
    });

    // 3. Open a page and fetch /example.json
    const page = await context.newPage();
    await page.goto(baseURL);

    const fetchResult = await page.evaluate(async () => {
      const res = await fetch("/example.json");
      return res.json();
    });
    // We should get the mocked data from our route, not the real 'server-data'
    expect(fetchResult.mockedData).toBe(1234);

    // 4. Test the WebSocket
    // We'll store messages from the server in an array so we can assert them
    const wsMessages: string[] = [];
    page.on("console", (msg) => {
      // We'll parse out the console logs we used for WebSocket
      if (msg.type() === "log") {
        wsMessages.push(msg.text());
      }
    });

    // Create a WS from the page
    await page.evaluate((port) => {
      const ws = new WebSocket(`ws://localhost:${port}/socket`);
      ws.onmessage = (evt) => {
        console.log(`WS message from server: ${evt.data}`);
      };
      setTimeout(() => {
        // send a message from the page side
        ws.send("Hello from the client");
      }, 1000);
    }, serverPort);

    // Wait a moment for messages
    await page.waitForTimeout(3000);

    // We expect the server to have initially sent "Hello from server WebSocket"
    // And also an echo of "Hello from the client" => "Server echo: Hello from the client"
    const initialHello = wsMessages.find((m) =>
      m.includes("Hello from server WebSocket"),
    );
    expect(initialHello).toBeTruthy();

    const echoMessage = wsMessages.find((m) =>
      m.includes("Server echo: Hello from the client"),
    );
    expect(echoMessage).toBeTruthy();

    // 5. unroute the JSON route
    await context.unroute("**/example.json");

    // 6. confirm the WebSocket route is still active
    // do a second fetch -> This time it won't be mocked
    const fetchResult2 = await page.evaluate(async () => {
      const res = await fetch("/example.json");
      return res.json();
    });
    // The real server returns { original: "server-data" }
    expect(fetchResult2.original).toBe("server-data");

    // 7. unrouteAll
    await context.unrouteAll();
  });

  test("should demonstrate routeFromHar usage", async () => {
    const harPath = path.join(__dirname, "tmp-test.har");

    const dynamicHar = HAR_CONTENT.replace(
      "http://localhost/har-example.json",
      `http://localhost:${serverPort}/har-example.json`,
    );

    fs.writeFileSync(harPath, dynamicHar, "utf-8");

    const context = stagehand.context;

    await context.routeFromHAR(harPath, { update: false });

    const page = await context.newPage();
    await page.goto(`http://localhost:${serverPort}/har-example.json`);

    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("HAR-based body text:", bodyText);
    expect(bodyText).toContain("harKey");
    expect(bodyText).toContain("harValue");

    await context.unrouteAll();
    fs.unlinkSync(harPath);
  });
});
