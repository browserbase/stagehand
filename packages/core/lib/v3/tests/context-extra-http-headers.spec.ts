import { test, expect } from "@playwright/test";
import type { Protocol } from "devtools-protocol";
import { V3 } from "../v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

const TEST_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/example/";

test.describe("context.setExtraHTTPHeaders", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("applies headers to navigation requests", async () => {
    const ctx = v3.context;
    const page = await ctx.awaitActivePage();

    await ctx.setExtraHTTPHeaders({ "x-stagehand-test": "yes" });

    const internal = page as unknown as {
      mainSession: {
        send: (method: string, params?: unknown) => Promise<unknown>;
        on: (event: string, handler: (params: unknown) => void) => void;
        off: (event: string, handler: (params: unknown) => void) => void;
      };
    };

    await internal.mainSession.send("Network.enable");

    const requestPromise = new Promise<Protocol.Network.RequestWillBeSentEvent>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          internal.mainSession.off("Network.requestWillBeSent", handler);
          reject(new Error("Timed out waiting for request"));
        }, 5000);

        const handler = (evt: Protocol.Network.RequestWillBeSentEvent) => {
          if (evt.type !== "Document") return;
          const url = String(evt.request?.url ?? "");
          if (!url.startsWith(TEST_URL)) return;
          clearTimeout(timeout);
          internal.mainSession.off("Network.requestWillBeSent", handler);
          resolve(evt);
        };

        internal.mainSession.on("Network.requestWillBeSent", handler);
      },
    );

    await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });

    const request = await requestPromise;
    const headers = Object.fromEntries(
      Object.entries(request.request.headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        String(value),
      ]),
    );

    expect(headers["x-stagehand-test"]).toBe("yes");
  });
});
