import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

// The form's target answers after a short delay, so the navigation commits
// while page.waitForSelector() is already pending in the outgoing document.
const RESPONSE_DELAY_MS = 150;

let server: Server | null = null;
let baseUrl = "";

test.describe("waitForSelector across a click-triggered navigation", () => {
  let v3: V3;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      if (req.url?.startsWith("/submit")) {
        setTimeout(() => {
          res.end(`<html><body><p id="query">${req.url}</p></body></html>`);
        }, RESPONSE_DELAY_MS);
        return;
      }
      res.end(
        `<html><body><form action="/submit">` +
          `<input id="name" name="name"><button id="submit">Go</button>` +
          `</form></body></html>`,
      );
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("the wait survives the navigation and resolves on the new document", async () => {
    const page = v3.context.pages()[0];
    await page.goto(`${baseUrl}/form.html`);
    await page.locator("#name").fill("panda");
    await page.locator("#submit").click();

    await expect(
      page.waitForSelector("#query", { timeout: 5000 }),
    ).resolves.toBe(true);
    expect(await page.locator("#query").textContent()).toBe(
      "/submit?name=panda",
    );
  });
});
